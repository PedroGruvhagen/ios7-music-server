const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { extractMetadata, extractArtwork } = require('./metadata');
const { getConfig } = require('./config');

const SUPPORTED_EXTENSIONS = new Set([
  '.mp3', '.m4a', '.aac', '.flac', '.wav', '.ogg', '.alac', '.aiff', '.wma'
]);

class LibraryScanner extends EventEmitter {
  constructor() {
    super();
    this.isScanning = false;
    this.songs = [];
    this.songsMap = new Map();
    this.artists = [];
    this.artistsMap = new Map();
    this.albums = [];
    this.albumsMap = new Map();
    this.totalFilesFound = 0;
    this.processedFiles = 0;
    this.lastScanTime = null;
  }

  getCacheFilePath() {
    const config = getConfig();
    return path.join(config.cacheDir, 'library.json');
  }

  loadFromCache() {
    const cacheFile = this.getCacheFilePath();
    try {
      if (fs.existsSync(cacheFile)) {
        const raw = fs.readFileSync(cacheFile, 'utf8');
        const data = JSON.parse(raw);
        if (Array.isArray(data.songs) && data.songs.length > 0) {
          this.songs = data.songs;
          this.lastScanTime = data.lastScanTime || Date.now();
          this.rebuildIndexes();
          console.log(`Loaded ${this.songs.length} songs from library cache.`);
          return true;
        }
      }
    } catch (err) {
      console.error('Failed to load library cache:', err.message);
    }
    return false;
  }

  saveToCache() {
    const cacheFile = this.getCacheFilePath();
    try {
      const data = {
        lastScanTime: this.lastScanTime,
        songs: this.songs
      };
      fs.writeFileSync(cacheFile, JSON.stringify(data), 'utf8');
      console.log(`Saved ${this.songs.length} songs to library cache.`);
    } catch (err) {
      console.error('Failed to save library cache:', err.message);
    }
  }

  /**
   * Recursively collect all audio file paths
   */
  async collectAudioFiles(dir, fileList = []) {
    try {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.name.startsWith('.')) continue; // skip hidden files

        if (entry.isDirectory()) {
          await this.collectAudioFiles(fullPath, fileList);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (SUPPORTED_EXTENSIONS.has(ext)) {
            fileList.push(fullPath);
          }
        }
      }
    } catch (err) {
      console.warn(`Cannot read directory ${dir}: ${err.message}`);
    }
    return fileList;
  }

  /**
   * Scan or rescan the music directory
   */
  async scanLibrary(forceRescan = false) {
    if (this.isScanning) {
      console.log('Scan already in progress...');
      return;
    }

    this.isScanning = true;
    const config = getConfig();
    const musicDir = config.musicDir;

    console.log(`Starting library scan in: ${musicDir}`);
    this.emit('scan-start', { musicDir });

    try {
      if (!fs.existsSync(musicDir)) {
        console.warn(`Music directory does not exist: ${musicDir}`);
        this.isScanning = false;
        this.emit('scan-complete', { count: 0 });
        return;
      }

      // Collect all files
      const allFiles = await this.collectAudioFiles(musicDir);
      this.totalFilesFound = allFiles.length;
      this.processedFiles = 0;
      console.log(`Found ${allFiles.length} audio files. Analyzing metadata...`);

      // Build a lookup map of existing cached songs by path
      const existingMap = new Map();
      if (!forceRescan) {
        for (const s of this.songs) {
          existingMap.set(s.path, s);
        }
      }

      const updatedSongs = [];
      const BATCH_SIZE = 20;

      for (let i = 0; i < allFiles.length; i += BATCH_SIZE) {
        const batch = allFiles.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.all(batch.map(async (filePath) => {
          try {
            const stat = await fs.promises.stat(filePath);
            const cached = existingMap.get(filePath);

            if (cached && cached.mtime === stat.mtimeMs && !forceRescan) {
              return cached;
            }

            const meta = await extractMetadata(filePath);
            const id = crypto.createHash('sha1').update(filePath).digest('hex').substring(0, 16);

            return {
              id,
              title: meta.title || path.basename(filePath),
              artist: meta.artist || 'Unknown Artist',
              album: meta.album || 'Unknown Album',
              track: meta.track || 0,
              year: meta.year || '',
              duration: meta.duration || 0,
              size: stat.size,
              mtime: stat.mtimeMs,
              format: meta.format || 'mp3',
              hasArtwork: meta.hasArtwork || false,
              path: filePath
            };
          } catch (fileErr) {
            console.warn(`Error processing ${filePath}: ${fileErr.message}`);
            return null;
          }
        }));

        for (const res of batchResults) {
          if (res) updatedSongs.push(res);
        }

        this.processedFiles = Math.min(i + BATCH_SIZE, allFiles.length);
        if (i % 200 === 0 || this.processedFiles === allFiles.length) {
          this.emit('scan-progress', {
            current: this.processedFiles,
            total: this.totalFilesFound,
            percent: Math.round((this.processedFiles / (this.totalFilesFound || 1)) * 100)
          });
        }
      }

      this.songs = updatedSongs;
      this.lastScanTime = Date.now();
      this.rebuildIndexes();
      this.saveToCache();

      console.log(`Library scan completed: ${this.songs.length} songs indexed, ${this.artists.length} artists, ${this.albums.length} albums.`);
      this.emit('scan-complete', {
        songs: this.songs.length,
        artists: this.artists.length,
        albums: this.albums.length
      });
    } catch (err) {
      console.error('Scan error:', err);
      this.emit('scan-error', err);
    } finally {
      this.isScanning = false;
    }
  }

  /**
   * Rebuild sorted index mappings for artists, albums, and tracks
   */
  rebuildIndexes() {
    this.songsMap.clear();
    this.artistsMap.clear();
    this.albumsMap.clear();

    // Sort songs alphabetically by default
    this.songs.sort((a, b) => (a.title || '').localeCompare(b.title || ''));

    for (const song of this.songs) {
      this.songsMap.set(song.id, song);

      // Artist indexing
      const artistName = song.artist || 'Unknown Artist';
      const artistKey = artistName.toLowerCase();
      if (!this.artistsMap.has(artistKey)) {
        this.artistsMap.set(artistKey, {
          id: Buffer.from(artistKey).toString('hex').substring(0, 16),
          name: artistName,
          albumKeys: new Set(),
          songs: []
        });
      }
      const artistEntry = this.artistsMap.get(artistKey);
      artistEntry.songs.push(song.id);

      // Album indexing
      const albumTitle = song.album || 'Unknown Album';
      // Album key groups by album title + album artist
      const albumKey = `${artistKey}:::${albumTitle.toLowerCase()}`;
      if (!this.albumsMap.has(albumKey)) {
        this.albumsMap.set(albumKey, {
          id: Buffer.from(albumKey).toString('hex').substring(0, 16),
          title: albumTitle,
          artist: artistName,
          year: song.year || '',
          artworkSongId: song.hasArtwork ? song.id : null,
          songs: []
        });
      }
      const albumEntry = this.albumsMap.get(albumKey);
      if (!albumEntry.artworkSongId && song.hasArtwork) {
        albumEntry.artworkSongId = song.id;
      }
      albumEntry.songs.push(song.id);
      artistEntry.albumKeys.add(albumKey);
    }

    // Build artists array
    this.artists = Array.from(this.artistsMap.values()).map(a => ({
      id: a.id,
      name: a.name,
      songCount: a.songs.length,
      albumCount: a.albumKeys.size,
      songs: a.songs
    })).sort((a, b) => a.name.localeCompare(b.name));

    // Build albums array and sort tracks within each album
    this.albums = Array.from(this.albumsMap.values()).map(alb => {
      // Sort tracks in album by track number, then title
      alb.songs.sort((idA, idB) => {
        const sA = this.songsMap.get(idA);
        const sB = this.songsMap.get(idB);
        if (sA && sB) {
          if (sA.track && sB.track && sA.track !== sB.track) {
            return sA.track - sB.track;
          }
          return (sA.title || '').localeCompare(sB.title || '');
        }
        return 0;
      });

      return {
        id: alb.id,
        title: alb.title,
        artist: alb.artist,
        year: alb.year,
        songCount: alb.songs.length,
        artworkSongId: alb.artworkSongId,
        songs: alb.songs
      };
    }).sort((a, b) => a.title.localeCompare(b.title));
  }

  getSong(id) {
    return this.songsMap.get(id);
  }

  getArtist(id) {
    for (const a of this.artists) {
      if (a.id === id) {
        // Collect detailed albums and songs
        const artistSongs = a.songs.map(sId => this.songsMap.get(sId)).filter(Boolean);
        const artistAlbums = this.albums.filter(alb => alb.artist.toLowerCase() === a.name.toLowerCase());
        return {
          ...a,
          albums: artistAlbums,
          songList: artistSongs
        };
      }
    }
    return null;
  }

  getAlbum(id) {
    for (const a of this.albums) {
      if (a.id === id) {
        const trackList = a.songs.map(sId => this.songsMap.get(sId)).filter(Boolean);
        return {
          ...a,
          tracks: trackList
        };
      }
    }
    return null;
  }

  search(query) {
    if (!query || typeof query !== 'string') return { songs: [], artists: [], albums: [] };
    const q = query.trim().toLowerCase();
    if (!q) return { songs: [], artists: [], albums: [] };

    const matchingSongs = [];
    for (const s of this.songs) {
      if (s.title.toLowerCase().includes(q) ||
          s.artist.toLowerCase().includes(q) ||
          s.album.toLowerCase().includes(q)) {
        matchingSongs.push(s);
        if (matchingSongs.length >= 100) break;
      }
    }

    const matchingArtists = [];
    for (const a of this.artists) {
      if (a.name.toLowerCase().includes(q)) {
        matchingArtists.push(a);
        if (matchingArtists.length >= 25) break;
      }
    }

    const matchingAlbums = [];
    for (const alb of this.albums) {
      if (alb.title.toLowerCase().includes(q) || alb.artist.toLowerCase().includes(q)) {
        matchingAlbums.push(alb);
        if (matchingAlbums.length >= 25) break;
      }
    }

    return {
      songs: matchingSongs,
      artists: matchingArtists,
      albums: matchingAlbums
    };
  }

  getStatus() {
    return {
      isScanning: this.isScanning,
      totalSongs: this.songs.length,
      totalArtists: this.artists.length,
      totalAlbums: this.albums.length,
      processedFiles: this.processedFiles,
      totalFilesFound: this.totalFilesFound,
      lastScanTime: this.lastScanTime,
      musicDir: getConfig().musicDir
    };
  }
}

// Singleton scanner instance
const scanner = new LibraryScanner();

module.exports = scanner;
