const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const COMMON_COVER_NAMES = [
  'cover.jpg', 'cover.jpeg', 'cover.png',
  'folder.jpg', 'folder.jpeg', 'folder.png',
  'album.jpg', 'album.jpeg', 'album.png',
  'front.jpg', 'front.jpeg', 'front.png'
];

let hasFfprobe = null;
let hasFfmpeg = null;

function checkBinary(name) {
  return new Promise((resolve) => {
    execFile(name, ['-version'], (err) => {
      resolve(!err);
    });
  });
}

async function detectBinaries() {
  if (hasFfprobe === null) {
    hasFfprobe = await checkBinary('ffprobe');
  }
  if (hasFfmpeg === null) {
    hasFfmpeg = await checkBinary('ffmpeg');
  }
}

// MPEG-1 Audio Layer III bitrates (kbps)
const MP3_BITRATES_V1_L3 = [
  0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0
];
const MP3_SAMPLERATES_V1 = [44100, 48000, 32000, 0];

/**
 * Estimate MP3 duration from file size and first frame header
 */
function estimateMp3Duration(buffer, fileSize, tagSize = 0) {
  const audioBytes = Math.max(0, fileSize - tagSize);
  // Scan for sync 0xFF 0xFB/0xFA/0xF3/0xF2
  for (let i = 0; i < buffer.length - 4; i++) {
    if (buffer[i] === 0xff && (buffer[i+1] & 0xe0) === 0xe0) {
      const versionBits = (buffer[i+1] >> 3) & 0x03;
      const layerBits = (buffer[i+1] >> 1) & 0x03;
      const bitrateIdx = (buffer[i+2] >> 4) & 0x0f;
      const sampleRateIdx = (buffer[i+2] >> 2) & 0x03;

      if (versionBits === 3 && layerBits === 1 && bitrateIdx > 0 && bitrateIdx < 15) {
        const kbps = MP3_BITRATES_V1_L3[bitrateIdx];
        if (kbps > 0) {
          const durationSec = (audioBytes * 8) / (kbps * 1000);
          return Math.round(durationSec);
        }
      }
    }
  }
  // Default estimate assuming 256kbps
  return Math.round((audioBytes * 8) / (256 * 1000));
}

/**
 * Pure JS ID3v1 parser (last 128 bytes)
 */
function parseID3v1(buffer) {
  if (buffer.length < 128) return null;
  const tag = buffer.subarray(buffer.length - 128);
  if (tag.toString('ascii', 0, 3) !== 'TAG') return null;

  function cleanString(b) {
    return b.toString('latin1').replace(/\0+$/, '').trim();
  }

  const title = cleanString(tag.subarray(3, 33));
  const artist = cleanString(tag.subarray(33, 63));
  const album = cleanString(tag.subarray(63, 93));
  const year = cleanString(tag.subarray(93, 97));
  
  let track = 0;
  if (tag[125] === 0) {
    track = tag[126];
  }

  return {
    title: title || undefined,
    artist: artist || undefined,
    album: album || undefined,
    year: year || undefined,
    track: track > 0 ? track : undefined
  };
}

/**
 * Pure JS ID3v2 parser
 */
function parseID3v2(buffer) {
  if (buffer.length < 10) return null;
  if (buffer.toString('ascii', 0, 3) !== 'ID3') return null;

  const version = buffer[3];
  const flags = buffer[5];
  
  // Syncsafe size
  const tagSize = ((buffer[6] & 0x7f) << 21) |
                  ((buffer[7] & 0x7f) << 14) |
                  ((buffer[8] & 0x7f) << 7)  |
                  (buffer[9] & 0x7f);

  const result = {
    tagSize: tagSize + 10,
    hasArtwork: false
  };

  let offset = 10;
  if (flags & 0x40) {
    if (offset + 4 <= buffer.length) {
      const extSize = ((buffer[offset] & 0x7f) << 21) |
                      ((buffer[offset+1] & 0x7f) << 14) |
                      ((buffer[offset+2] & 0x7f) << 7)  |
                      (buffer[offset+3] & 0x7f);
      offset += extSize;
    }
  }

  const end = Math.min(buffer.length, tagSize + 10);

  while (offset + 10 <= end) {
    let frameId;
    let frameSize;

    if (version === 2) {
      if (offset + 6 > end) break;
      frameId = buffer.toString('ascii', offset, offset + 3);
      frameSize = (buffer[offset + 3] << 16) | (buffer[offset + 4] << 8) | buffer[offset + 5];
      offset += 6;
    } else if (version === 3) {
      frameId = buffer.toString('ascii', offset, offset + 4);
      frameSize = buffer.readUInt32BE(offset + 4);
      offset += 10;
    } else if (version === 4) {
      frameId = buffer.toString('ascii', offset, offset + 4);
      frameSize = ((buffer[offset + 4] & 0x7f) << 21) |
                  ((buffer[offset + 5] & 0x7f) << 14) |
                  ((buffer[offset + 6] & 0x7f) << 7)  |
                  (buffer[offset + 7] & 0x7f);
      offset += 10;
    } else {
      break;
    }

    if (frameId.charCodeAt(0) === 0 || frameSize <= 0 || offset + frameSize > buffer.length) {
      break;
    }

    const frameData = buffer.subarray(offset, offset + frameSize);
    offset += frameSize;

    if (frameId === 'APIC' || frameId === 'PIC') {
      result.hasArtwork = true;
    } else if (frameId === 'TIT2' || frameId === 'TT2') {
      result.title = decodeTextFrame(frameData);
    } else if (frameId === 'TPE1' || frameId === 'TP1') {
      result.artist = decodeTextFrame(frameData);
    } else if (frameId === 'TALB' || frameId === 'TAL') {
      result.album = decodeTextFrame(frameData);
    } else if (frameId === 'TRCK' || frameId === 'TRK') {
      const trk = decodeTextFrame(frameData);
      if (trk) {
        const num = parseInt(trk.split('/')[0], 10);
        if (!isNaN(num)) result.track = num;
      }
    } else if (frameId === 'TYER' || frameId === 'TDRC' || frameId === 'TYE') {
      const y = decodeTextFrame(frameData);
      if (y) result.year = y.substring(0, 4);
    } else if (frameId === 'TLEN') {
      const lenStr = decodeTextFrame(frameData);
      const ms = parseInt(lenStr, 10);
      if (!isNaN(ms) && ms > 0) {
        result.duration = Math.round(ms / 1000);
      }
    }
  }

  return result;
}

function decodeTextFrame(buffer) {
  if (!buffer || buffer.length === 0) return '';
  const encoding = buffer[0];
  const content = buffer.subarray(1);

  try {
    if (encoding === 0) {
      return content.toString('latin1').replace(/\0+$/, '').trim();
    } else if (encoding === 1) {
      return content.toString('utf16le').replace(/\0+$/, '').trim();
    } else if (encoding === 2) {
      return content.swap16().toString('utf16le').replace(/\0+$/, '').trim();
    } else if (encoding === 3) {
      return content.toString('utf8').replace(/\0+$/, '').trim();
    }
    return content.toString('utf8').replace(/\0+$/, '').trim();
  } catch (e) {
    return '';
  }
}

/**
 * Run ffprobe to get comprehensive metadata for non-MP3 files (FLAC, M4A, etc.)
 */
function probeFile(filePath) {
  return new Promise((resolve) => {
    execFile('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      filePath
    ], { maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
      if (err || !stdout) {
        return resolve(null);
      }
      try {
        const json = JSON.parse(stdout);
        resolve(json);
      } catch (e) {
        resolve(null);
      }
    });
  });
}

function findFolderCover(dirPath) {
  try {
    for (const name of COMMON_COVER_NAMES) {
      const full = path.join(dirPath, name);
      if (fs.existsSync(full)) {
        return full;
      }
    }
  } catch (e) {}
  return null;
}

/**
 * High-speed metadata extraction:
 * Fast-path pure JS parser for MP3s (< 0.1ms per file)
 * ffprobe for non-MP3 formats (FLAC, M4A, OGG)
 */
async function extractMetadata(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const baseName = path.basename(filePath, ext);
  const dirPath = path.dirname(filePath);

  let metadata = {
    title: baseName,
    artist: 'Unknown Artist',
    album: path.basename(dirPath),
    track: 0,
    duration: 0,
    year: '',
    format: ext.replace('.', ''),
    hasArtwork: false,
    folderCover: findFolderCover(dirPath)
  };

  if (metadata.folderCover) {
    metadata.hasArtwork = true;
  }

  // Fast path for MP3: pure JavaScript parser
  if (ext === '.mp3') {
    try {
      const fd = fs.openSync(filePath, 'r');
      const stat = fs.fstatSync(fd);
      
      // Read first 64KB for ID3v2
      const readLen = Math.min(65536, stat.size);
      const headerBuf = Buffer.alloc(readLen);
      fs.readSync(fd, headerBuf, 0, readLen, 0);

      const v2 = parseID3v2(headerBuf);
      let tagSize = 0;
      if (v2) {
        if (v2.title) metadata.title = v2.title;
        if (v2.artist) metadata.artist = v2.artist;
        if (v2.album) metadata.album = v2.album;
        if (v2.track) metadata.track = v2.track;
        if (v2.year) metadata.year = v2.year;
        if (v2.duration) metadata.duration = v2.duration;
        if (v2.hasArtwork) metadata.hasArtwork = true;
        tagSize = v2.tagSize || 0;
      }

      // Estimate duration if TLEN frame was missing
      if (!metadata.duration && stat.size > 0) {
        metadata.duration = estimateMp3Duration(headerBuf, stat.size, tagSize);
      }

      // Check ID3v1 fallback if artist/title still default
      if ((metadata.title === baseName || metadata.artist === 'Unknown Artist') && stat.size > 128) {
        const v1Buf = Buffer.alloc(128);
        fs.readSync(fd, v1Buf, 0, 128, stat.size - 128);
        const v1 = parseID3v1(v1Buf);
        if (v1) {
          if (metadata.title === baseName && v1.title) metadata.title = v1.title;
          if (metadata.artist === 'Unknown Artist' && v1.artist) metadata.artist = v1.artist;
          if (!metadata.track && v1.track) metadata.track = v1.track;
        }
      }

      fs.closeSync(fd);
    } catch (e) {
      // Ignore read errors
    }
  } else {
    // Non-MP3 format (FLAC, M4A, etc.) -> use ffprobe
    await detectBinaries();
    if (hasFfprobe) {
      const probe = await probeFile(filePath);
      if (probe && probe.format) {
        const tags = probe.format.tags || {};
        const caseTags = {};
        for (const k of Object.keys(tags)) {
          caseTags[k.toLowerCase()] = tags[k];
        }

        if (caseTags.title) metadata.title = caseTags.title.trim();
        if (caseTags.artist) metadata.artist = caseTags.artist.trim();
        else if (caseTags.album_artist) metadata.artist = caseTags.album_artist.trim();

        if (caseTags.album) metadata.album = caseTags.album.trim();

        if (caseTags.track) {
          const trkNum = parseInt(caseTags.track.split('/')[0], 10);
          if (!isNaN(trkNum)) metadata.track = trkNum;
        }

        if (caseTags.date) metadata.year = caseTags.date.substring(0, 4);
        else if (caseTags.year) metadata.year = caseTags.year.substring(0, 4);

        if (probe.format.duration) {
          metadata.duration = Math.round(parseFloat(probe.format.duration)) || 0;
        }

        if (probe.streams && Array.isArray(probe.streams)) {
          for (const s of probe.streams) {
            if (s.disposition && s.disposition.attached_pic === 1) {
              metadata.hasArtwork = true;
              break;
            }
          }
        }
      }
    }
  }

  // Filename heuristics if title/artist are still unset
  if (metadata.title === baseName && baseName.includes(' - ')) {
    const parts = baseName.split(' - ');
    if (parts.length >= 2) {
      let part0 = parts[0].trim();
      const trkMatch = part0.match(/^(\d{1,3})[\.\s_-]+(.*)/);
      if (trkMatch) {
        if (!metadata.track) metadata.track = parseInt(trkMatch[1], 10);
        part0 = trkMatch[2].trim();
      }
      if (metadata.artist === 'Unknown Artist' && part0) {
        metadata.artist = part0;
      }
      metadata.title = parts.slice(1).join(' - ').trim();
    }
  }

  return metadata;
}

/**
 * Extract artwork image to cache
 */
async function extractArtwork(filePath, outputCachePath) {
  if (fs.existsSync(outputCachePath)) {
    return outputCachePath;
  }

  const dirCover = findFolderCover(path.dirname(filePath));
  if (dirCover && fs.existsSync(dirCover)) {
    try {
      fs.copyFileSync(dirCover, outputCachePath);
      return outputCachePath;
    } catch (e) {}
  }

  await detectBinaries();
  if (hasFfmpeg) {
    return new Promise((resolve) => {
      execFile('ffmpeg', [
        '-v', 'quiet',
        '-y',
        '-i', filePath,
        '-an',
        '-vcodec', 'copy',
        '-f', 'image2',
        outputCachePath
      ], (err) => {
        if (!err && fs.existsSync(outputCachePath) && fs.statSync(outputCachePath).size > 0) {
          resolve(outputCachePath);
        } else {
          resolve(null);
        }
      });
    });
  }

  return null;
}

module.exports = {
  extractMetadata,
  extractArtwork,
  detectBinaries
};
