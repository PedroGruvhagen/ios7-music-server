/**
 * Retro iPhone 4 (iOS 7) Music Client Application
 * Strict ECMAScript 5 (ES5) - No ES6+ features (no let/const, arrow functions, promises, or template literals)
 */

(function() {
  'use strict';

  // --- Helpers ---
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Toggle visibility via className, never element.style.display directly.
  // Real iOS 7 WebKit rejects an inline `style.display = 'flex'` assignment
  // silently, permanently hiding the element; the .hidden utility class in
  // style.css lets the stylesheet's own -webkit-box/-webkit-flex/flex
  // fallback chain apply instead. See style.css for the full explanation.
  function setHidden(el, hidden) {
    var base = el.className.replace(/\s*\bhidden\b\s*/g, ' ').trim();
    el.className = hidden ? (base + ' hidden') : base;
  }

  function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return '0:00';
    var totalSec = Math.floor(seconds);
    var mins = Math.floor(totalSec / 60);
    var secs = totalSec % 60;
    return mins + ':' + (secs < 10 ? '0' : '') + secs;
  }

  // Session token for <audio>/<img> URLs. iOS routes those requests through a
  // separate media process that doesn't carry the page's session cookie, so
  // stream/artwork URLs need the token appended as ?st= instead. Fetched once
  // at startup (the cookie itself gets us past that first request).
  var sessionToken = '';

  function mediaUrl(path) {
    if (!sessionToken) return path;
    return path + (path.indexOf('?') === -1 ? '?' : '&') + 'st=' + encodeURIComponent(sessionToken);
  }

  function ajax(method, url, data, callback) {
    var xhr = new XMLHttpRequest();
    var done = false;
    function finish(err, result) {
      if (done) { return; }
      done = true;
      callback(err, result);
    }
    xhr.open(method, url, true);
    if (data) {
      xhr.setRequestHeader('Content-Type', 'application/json;charset=UTF-8');
    }
    // iOS 7 Mobile Safari's XHR can stall on a dropped/flaky LAN connection
    // without ever reaching readyState 4 or firing onerror. Without a timeout
    // the callback (and thus loadLibrary()) never runs, leaving the UI stuck
    // on "Loading music library" forever with no visible error.
    try {
      xhr.timeout = 15000;
    } catch (e) {
      // old WebKit may not support xhr.timeout; the manual setTimeout below still covers it
    }
    var timeoutId = setTimeout(function() {
      finish(new Error('Request timed out'));
      try { xhr.abort(); } catch (e) {}
    }, 15000);
    xhr.onreadystatechange = function() {
      if (xhr.readyState === 4) {
        clearTimeout(timeoutId);
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            var parsed = JSON.parse(xhr.responseText);
            finish(null, parsed);
          } catch (e) {
            finish(null, xhr.responseText);
          }
        } else {
          finish(new Error('Request failed with status ' + xhr.status));
        }
      }
    };
    xhr.onerror = function() {
      clearTimeout(timeoutId);
      finish(new Error('Network error'));
    };
    xhr.ontimeout = function() {
      clearTimeout(timeoutId);
      finish(new Error('Request timed out'));
    };
    xhr.send(data ? JSON.stringify(data) : null);
  }

  // --- App State ---
  var state = {
    allSongs: [],
    artists: [],
    albums: [],
    currentView: 'songs',
    historyStack: [],
    currentSong: null,
    queue: [],
    originalQueue: [],
    queueIndex: -1,
    isPlaying: false,
    shuffle: false,
    repeat: 'off', // 'off', 'all', 'one'
    isScrubbing: false
  };

  // --- Audio Player ---
  var audio = document.getElementById('audio-player');

  // DOM Elements
  var navTitle = document.getElementById('nav-title');
  var btnNavBack = document.getElementById('btn-nav-back');
  var navBackLabel = document.getElementById('nav-back-label');
  var btnNavSearch = document.getElementById('btn-nav-search');
  var searchHeader = document.getElementById('search-header');
  var searchInput = document.getElementById('search-input');
  var btnSearchClear = document.getElementById('btn-search-clear');
  var btnSearchCancel = document.getElementById('btn-search-cancel');

  var views = {
    songs: document.getElementById('view-songs'),
    artists: document.getElementById('view-artists'),
    artistDetail: document.getElementById('view-artist-detail'),
    albums: document.getElementById('view-albums'),
    albumDetail: document.getElementById('view-album-detail'),
    search: document.getElementById('view-search'),
    live: document.getElementById('view-live'),
    settings: document.getElementById('view-settings')
  };

  var miniPlayer = document.getElementById('mini-player');
  var miniCover = document.getElementById('mini-cover');
  var miniTitle = document.getElementById('mini-title');
  var miniArtist = document.getElementById('mini-artist');
  var btnMiniPlay = document.getElementById('btn-mini-play');

  var nowPlayingModal = document.getElementById('now-playing-modal');
  var btnCloseNowPlaying = document.getElementById('btn-close-now-playing');
  var btnToggleQueue = document.getElementById('btn-toggle-queue');
  var npCover = document.getElementById('np-cover');
  var npTitle = document.getElementById('np-title');
  var npArtist = document.getElementById('np-artist');
  var npAlbum = document.getElementById('np-album');

  var scrubberBar = document.getElementById('scrubber-bar');
  var scrubberProgress = document.getElementById('scrubber-progress');
  var scrubberThumb = document.getElementById('scrubber-thumb');
  var timeElapsed = document.getElementById('time-elapsed');
  var timeRemaining = document.getElementById('time-remaining');

  var btnPrev = document.getElementById('btn-prev');
  var btnPlayPause = document.getElementById('btn-play-pause');
  var btnNext = document.getElementById('btn-next');
  var btnShuffle = document.getElementById('btn-shuffle');
  var btnRepeat = document.getElementById('btn-repeat');
  var repeatLabel = document.getElementById('repeat-label');

  var queuePanel = document.getElementById('queue-panel');
  var btnCloseQueue = document.getElementById('btn-close-queue');
  var queueList = document.getElementById('queue-list');

  var tabButtons = document.querySelectorAll('.tab-item');

  // --- SVG Icons ---
  var PLAY_ICON_PATH = 'M8 5v14l11-7z';
  var PAUSE_ICON_PATH = 'M6 19h4V5H6v14zm8-14v14h4V5h-4z';

  function updatePlayPauseIcons(isPlaying) {
    var path = isPlaying ? PAUSE_ICON_PATH : PLAY_ICON_PATH;
    var miniIcon = document.getElementById('mini-play-icon');
    var npIcon = document.getElementById('np-play-icon');
    if (miniIcon) miniIcon.querySelector('path').setAttribute('d', path);
    if (npIcon) npIcon.querySelector('path').setAttribute('d', path);
  }

  // --- Navigation & Routing ---
  function showView(viewName, skipHistory, customTitle) {
    if (!views[viewName]) return;

    if (!skipHistory && state.currentView !== viewName) {
      state.historyStack.push({
        view: state.currentView,
        title: navTitle.textContent
      });
    }

    state.currentView = viewName;

    // Hide all views
    for (var key in views) {
      if (views.hasOwnProperty(key)) {
        views[key].className = 'view-panel';
      }
    }

    // Show target view
    views[viewName].className = 'view-panel active';

    // Update Top Navigation Bar
    if (state.historyStack.length > 0) {
      setHidden(btnNavBack, false);
      var last = state.historyStack[state.historyStack.length - 1];
      navBackLabel.textContent = last.title.length > 10 ? 'Back' : last.title;
    } else {
      setHidden(btnNavBack, true);
    }

    if (customTitle) {
      navTitle.textContent = customTitle;
    } else if (viewName === 'songs') {
      navTitle.textContent = 'Songs';
    } else if (viewName === 'artists') {
      navTitle.textContent = 'Artists';
    } else if (viewName === 'albums') {
      navTitle.textContent = 'Albums';
    } else if (viewName === 'settings') {
      navTitle.textContent = 'Settings';
    } else if (viewName === 'search') {
      navTitle.textContent = 'Search';
    } else if (viewName === 'live') {
      navTitle.textContent = 'Live';
      refreshLiveStatus();
    }

    // Update bottom tab bar active state
    for (var i = 0; i < tabButtons.length; i++) {
      var btn = tabButtons[i];
      if (btn.getAttribute('data-view') === viewName) {
        btn.className = 'tab-item active';
      } else {
        btn.className = 'tab-item';
      }
    }

    // Scroll to top of content
    document.getElementById('content').scrollTop = 0;
  }

  function goBack() {
    if (state.historyStack.length === 0) return;
    var prev = state.historyStack.pop();
    showView(prev.view, true, prev.title);
  }

  // --- Audio Playback Logic ---
  function playTrack(song, trackList, trackIndex) {
    if (!song) return;

    state.currentSong = song;

    if (trackList && trackList.length > 0) {
      state.originalQueue = trackList.slice(0);
      if (state.shuffle) {
        // Create shuffled queue with current track first
        var remaining = [];
        for (var i = 0; i < trackList.length; i++) {
          if (trackList[i].id !== song.id) {
            remaining.push(trackList[i]);
          }
        }
        remaining.sort(function() { return 0.5 - Math.random(); });
        state.queue = [song].concat(remaining);
        state.queueIndex = 0;
      } else {
        state.queue = trackList.slice(0);
        state.queueIndex = (typeof trackIndex === 'number' && trackIndex >= 0) ? trackIndex : 0;
      }
    }

    // Load & Play stream
    audio.src = mediaUrl('/api/stream/' + encodeURIComponent(song.id));
    audio.load();
    
    var playPromise = audio.play();
    if (playPromise !== undefined && typeof playPromise.catch === 'function') {
      playPromise.catch(function(err) {
        console.log('Audio autoplay prevented or error:', err);
      });
    }

    updateNowPlayingUI(song);
    updateMiniPlayerUI(song);
    highlightPlayingTracks();
    renderQueueList();

    // Persist state
    try {
      localStorage.setItem('iphone4_last_song', JSON.stringify(song));
    } catch (e) {}
  }

  // --- Live cast playback (AirPlay relay, see lib/livecast.js server-side) ---
  // Not part of the normal song queue: it's an unbounded live stream, so
  // next/prev/shuffle/repeat simply don't apply while it's playing (their
  // guards on state.queue.length === 0 already make them no-ops).
  var LIVE_SONG = {
    id: 'live-spotify',
    title: 'Live from your phone',
    artist: 'AirPlay',
    album: '',
    duration: 0,
    hasArtwork: false,
    isLive: true
  };

  function playLiveSpotify() {
    state.queue = [];
    state.originalQueue = [];
    state.currentSong = LIVE_SONG;
    // Cache-bust with a per-tap random value: the session token in
    // mediaUrl()'s querystring never changes between taps, so without this
    // the <audio> element's src is byte-identical to whatever it already
    // was, and some WebKit builds treat re-assigning an identical src as a
    // no-op that just resumes existing (possibly stalled/dead) element
    // state instead of opening a genuinely fresh connection -- silent, no
    // sound, no new request to the server, exactly the failure seen here.
    var url = mediaUrl('/api/live/spotify');
    url += (url.indexOf('?') === -1 ? '?' : '&') + '_=' + Math.floor(Math.random() * 1e9);
    audio.src = url;
    audio.load();
    var playPromise = audio.play();
    if (playPromise !== undefined && typeof playPromise.catch === 'function') {
      playPromise.catch(function(err) {
        console.log('Live audio autoplay prevented or error:', err);
      });
    }
    updateMiniPlayerUI(LIVE_SONG);
    updateNowPlayingUI(LIVE_SONG);
  }

  function stopLiveSpotify() {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    state.currentSong = null;
    updateMiniPlayerUI(null);
  }

  function refreshLiveStatus() {
    var statusEl = document.getElementById('live-status');
    var toggleBtn = document.getElementById('btn-live-toggle');
    if (!statusEl || !toggleBtn) return;
    ajax('GET', '/api/live/status', null, function(err, data) {
      var isLivePlaying = !!(state.currentSong && state.currentSong.isLive) && !audio.paused;
      if (isLivePlaying) {
        toggleBtn.textContent = 'Stop';
      } else {
        toggleBtn.textContent = 'Listen';
      }
      if (err || !data) {
        statusEl.textContent = 'Unknown';
        return;
      }
      if (data.active) {
        statusEl.textContent = 'Receiving audio' + (data.listeners > 0 ? ' (' + data.listeners + ' listening)' : '');
      } else {
        statusEl.textContent = 'Nothing playing';
      }
    });
  }

  function playNext() {
    if (state.queue.length === 0) return;

    if (state.repeat === 'one') {
      audio.currentTime = 0;
      audio.play();
      return;
    }

    var nextIdx = state.queueIndex + 1;
    if (nextIdx < state.queue.length) {
      state.queueIndex = nextIdx;
      playTrack(state.queue[nextIdx]);
    } else if (state.repeat === 'all') {
      state.queueIndex = 0;
      playTrack(state.queue[0]);
    } else {
      // Queue finished
      state.isPlaying = false;
      updatePlayPauseIcons(false);
    }
  }

  function playPrev() {
    if (audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }
    if (state.queueIndex > 0) {
      state.queueIndex--;
      playTrack(state.queue[state.queueIndex]);
    } else {
      audio.currentTime = 0;
    }
  }

  function togglePlayPause() {
    if (!state.currentSong) {
      if (state.allSongs.length > 0) {
        playTrack(state.allSongs[0], state.allSongs, 0);
      }
      return;
    }

    if (audio.paused) {
      audio.play();
    } else {
      audio.pause();
    }
  }

  function toggleShuffle() {
    state.shuffle = !state.shuffle;
    if (state.shuffle) {
      btnShuffle.className = 'secondary-btn active';
      if (state.currentSong && state.queue.length > 0) {
        var remaining = [];
        for (var i = 0; i < state.originalQueue.length; i++) {
          if (state.originalQueue[i].id !== state.currentSong.id) {
            remaining.push(state.originalQueue[i]);
          }
        }
        remaining.sort(function() { return 0.5 - Math.random(); });
        state.queue = [state.currentSong].concat(remaining);
        state.queueIndex = 0;
      }
    } else {
      btnShuffle.className = 'secondary-btn';
      if (state.originalQueue.length > 0) {
        state.queue = state.originalQueue.slice(0);
        for (var j = 0; j < state.queue.length; j++) {
          if (state.queue[j].id === state.currentSong.id) {
            state.queueIndex = j;
            break;
          }
        }
      }
    }
    renderQueueList();
  }

  function toggleRepeat() {
    if (state.repeat === 'off') {
      state.repeat = 'all';
      btnRepeat.className = 'secondary-btn active';
      repeatLabel.textContent = 'All';
    } else if (state.repeat === 'all') {
      state.repeat = 'one';
      btnRepeat.className = 'secondary-btn active';
      repeatLabel.textContent = 'One';
    } else {
      state.repeat = 'off';
      btnRepeat.className = 'secondary-btn';
      repeatLabel.textContent = 'Off';
    }
  }

  // --- UI Updates ---
  function updateMiniPlayerUI(song) {
    if (!song) {
      setHidden(miniPlayer, true);
      return;
    }
    setHidden(miniPlayer, false);
    miniTitle.textContent = song.title;
    miniArtist.textContent = song.artist;
    miniCover.src = song.hasArtwork ? (mediaUrl('/api/artwork/' + encodeURIComponent(song.id))) : '/assets/placeholder.png';
  }

  function updateNowPlayingUI(song) {
    if (!song) return;
    npTitle.textContent = song.title;
    npArtist.textContent = song.artist;
    npAlbum.textContent = song.album || '';
    npCover.src = song.hasArtwork ? (mediaUrl('/api/artwork/' + encodeURIComponent(song.id))) : '/assets/placeholder.png';
    timeElapsed.textContent = '0:00';
    timeRemaining.textContent = song.duration ? ('-' + formatTime(song.duration)) : '-0:00';
    scrubberProgress.style.width = '0%';
    scrubberThumb.style.left = '0%';
  }

  function highlightPlayingTracks() {
    var items = document.querySelectorAll('.list-item');
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var songId = item.getAttribute('data-song-id');
      if (state.currentSong && songId === state.currentSong.id) {
        item.className = item.className.indexOf('playing') === -1 ? (item.className + ' playing') : item.className;
      } else {
        item.className = item.className.replace(/\bplaying\b/, '').trim();
      }
    }
  }

  // --- View Renderers ---
  function renderSongsList(songs, container, isQueue) {
    if (!songs || songs.length === 0) {
      container.innerHTML = '<div class="empty-state">No songs found.</div>';
      return;
    }

    var html = '';
    for (var i = 0; i < songs.length; i++) {
      var s = songs[i];
      var isPlaying = (state.currentSong && state.currentSong.id === s.id);
      var artUrl = s.hasArtwork ? (mediaUrl('/api/artwork/' + encodeURIComponent(s.id))) : '/assets/placeholder.png';

      html += '<div class="list-item' + (isPlaying ? ' playing' : '') + '" data-song-id="' + escapeHtml(s.id) + '" data-index="' + i + '">';
      html += '<img class="item-thumb" src="' + artUrl + '" alt="Art" onerror="this.src=\'/assets/placeholder.png\'">';
      html += '<div class="item-info">';
      html += '<div class="item-title">' + escapeHtml(s.title) + '</div>';
      html += '<div class="item-subtitle">' + escapeHtml(s.artist) + '</div>';
      html += '</div>';
      html += '<div class="item-meta">' + formatTime(s.duration) + '</div>';
      html += '</div>';
    }

    container.innerHTML = html;

    // Attach click listeners
    var items = container.querySelectorAll('.list-item');
    for (var j = 0; j < items.length; j++) {
      (function(idx) {
        items[idx].addEventListener('click', function() {
          playTrack(songs[idx], songs, idx);
        });
      })(j);
    }
  }

  function renderArtistsList(artists) {
    var container = document.getElementById('artists-list');
    if (!artists || artists.length === 0) {
      container.innerHTML = '<div class="empty-state">No artists found.</div>';
      return;
    }

    var html = '';
    for (var i = 0; i < artists.length; i++) {
      var a = artists[i];
      html += '<div class="list-item" data-artist-id="' + escapeHtml(a.id) + '">';
      html += '<div class="item-info">';
      html += '<div class="item-title">' + escapeHtml(a.name) + '</div>';
      html += '<div class="item-subtitle">' + a.albumCount + ' album' + (a.albumCount === 1 ? '' : 's') + ' • ' + a.songCount + ' song' + (a.songCount === 1 ? '' : 's') + '</div>';
      html += '</div>';
      html += '<div class="item-chevron">›</div>';
      html += '</div>';
    }

    container.innerHTML = html;

    var items = container.querySelectorAll('.list-item');
    for (var j = 0; j < items.length; j++) {
      (function(idx) {
        items[idx].addEventListener('click', function() {
          loadArtistDetail(artists[idx].id, artists[idx].name);
        });
      })(j);
    }
  }

  function loadArtistDetail(artistId, artistName) {
    ajax('GET', '/api/artist/' + encodeURIComponent(artistId), null, function(err, data) {
      if (err || !data) {
        alert('Could not load artist details');
        return;
      }

      document.getElementById('artist-detail-name').textContent = data.name;
      document.getElementById('artist-detail-meta').textContent = (data.albums ? data.albums.length : 0) + ' albums • ' + (data.songList ? data.songList.length : 0) + ' songs';

      // Render albums for this artist
      var albumsContainer = document.getElementById('artist-detail-albums');
      if (data.albums && data.albums.length > 0) {
        var albHtml = '';
        for (var i = 0; i < data.albums.length; i++) {
          var alb = data.albums[i];
          var artUrl = alb.artworkSongId ? (mediaUrl('/api/artwork/' + encodeURIComponent(alb.artworkSongId))) : '/assets/placeholder.png';
          albHtml += '<div class="list-item" data-album-id="' + escapeHtml(alb.id) + '">';
          albHtml += '<img class="item-thumb" src="' + artUrl + '" alt="Art" onerror="this.src=\'/assets/placeholder.png\'">';
          albHtml += '<div class="item-info">';
          albHtml += '<div class="item-title">' + escapeHtml(alb.title) + '</div>';
          albHtml += '<div class="item-subtitle">' + (alb.year ? (alb.year + ' • ') : '') + alb.songCount + ' songs</div>';
          albHtml += '</div>';
          albHtml += '<div class="item-chevron">›</div>';
          albHtml += '</div>';
        }
        albumsContainer.innerHTML = albHtml;

        var albItems = albumsContainer.querySelectorAll('.list-item');
        for (var k = 0; k < albItems.length; k++) {
          (function(aIdx) {
            albItems[aIdx].addEventListener('click', function() {
              loadAlbumDetail(data.albums[aIdx].id, data.albums[aIdx].title);
            });
          })(k);
        }
      } else {
        albumsContainer.innerHTML = '<div class="empty-state">No albums.</div>';
      }

      // Render all songs for this artist
      var songsContainer = document.getElementById('artist-detail-songs');
      renderSongsList(data.songList || [], songsContainer);

      showView('artistDetail', false, artistName);
    });
  }

  function renderAlbumsList(albums) {
    var container = document.getElementById('albums-list');
    if (!albums || albums.length === 0) {
      container.innerHTML = '<div class="empty-state">No albums found.</div>';
      return;
    }

    var html = '';
    for (var i = 0; i < albums.length; i++) {
      var alb = albums[i];
      var artUrl = alb.artworkSongId ? (mediaUrl('/api/artwork/' + encodeURIComponent(alb.artworkSongId))) : '/assets/placeholder.png';
      html += '<div class="list-item" data-album-id="' + escapeHtml(alb.id) + '">';
      html += '<img class="item-thumb" src="' + artUrl + '" alt="Cover" onerror="this.src=\'/assets/placeholder.png\'">';
      html += '<div class="item-info">';
      html += '<div class="item-title">' + escapeHtml(alb.title) + '</div>';
      html += '<div class="item-subtitle">' + escapeHtml(alb.artist) + (alb.year ? (' • ' + alb.year) : '') + '</div>';
      html += '</div>';
      html += '<div class="item-chevron">›</div>';
      html += '</div>';
    }

    container.innerHTML = html;

    var items = container.querySelectorAll('.list-item');
    for (var j = 0; j < items.length; j++) {
      (function(idx) {
        items[idx].addEventListener('click', function() {
          loadAlbumDetail(albums[idx].id, albums[idx].title);
        });
      })(j);
    }
  }

  function loadAlbumDetail(albumId, albumTitle) {
    ajax('GET', '/api/album/' + encodeURIComponent(albumId), null, function(err, album) {
      if (err || !album) {
        alert('Could not load album details');
        return;
      }

      document.getElementById('album-detail-title').textContent = album.title;
      document.getElementById('album-detail-artist').textContent = album.artist;
      document.getElementById('album-detail-meta').textContent = (album.year ? (album.year + ' • ') : '') + (album.tracks ? album.tracks.length : 0) + ' tracks';

      var coverImg = document.getElementById('album-detail-cover');
      coverImg.src = album.artworkSongId ? (mediaUrl('/api/artwork/' + encodeURIComponent(album.artworkSongId))) : '/assets/placeholder.png';

      // Play album button
      var btnPlayAlbum = document.getElementById('btn-play-album');
      btnPlayAlbum.onclick = function() {
        if (album.tracks && album.tracks.length > 0) {
          playTrack(album.tracks[0], album.tracks, 0);
        }
      };

      // Render tracklist with track numbers
      var tracksContainer = document.getElementById('album-detail-tracks');
      if (album.tracks && album.tracks.length > 0) {
        var html = '';
        for (var i = 0; i < album.tracks.length; i++) {
          var t = album.tracks[i];
          var isPlaying = (state.currentSong && state.currentSong.id === t.id);
          html += '<div class="list-item' + (isPlaying ? ' playing' : '') + '" data-song-id="' + escapeHtml(t.id) + '">';
          html += '<div class="item-track-num">' + (t.track || (i + 1)) + '</div>';
          html += '<div class="item-info">';
          html += '<div class="item-title">' + escapeHtml(t.title) + '</div>';
          html += '<div class="item-subtitle">' + escapeHtml(t.artist) + '</div>';
          html += '</div>';
          html += '<div class="item-meta">' + formatTime(t.duration) + '</div>';
          html += '</div>';
        }
        tracksContainer.innerHTML = html;

        var items = tracksContainer.querySelectorAll('.list-item');
        for (var j = 0; j < items.length; j++) {
          (function(idx) {
            items[idx].addEventListener('click', function() {
              playTrack(album.tracks[idx], album.tracks, idx);
            });
          })(j);
        }
      } else {
        tracksContainer.innerHTML = '<div class="empty-state">No tracks found in this album.</div>';
      }

      showView('albumDetail', false, albumTitle);
    });
  }

  function renderQueueList() {
    if (!state.queue || state.queue.length === 0) {
      queueList.innerHTML = '<div class="empty-state">Queue is empty</div>';
      return;
    }

    var html = '';
    for (var i = 0; i < state.queue.length; i++) {
      var s = state.queue[i];
      var isPlaying = (i === state.queueIndex);
      var artUrl = s.hasArtwork ? (mediaUrl('/api/artwork/' + encodeURIComponent(s.id))) : '/assets/placeholder.png';

      html += '<div class="list-item' + (isPlaying ? ' playing' : '') + '" data-index="' + i + '">';
      html += '<img class="item-thumb" src="' + artUrl + '" alt="Art" onerror="this.src=\'/assets/placeholder.png\'">';
      html += '<div class="item-info">';
      html += '<div class="item-title">' + escapeHtml(s.title) + '</div>';
      html += '<div class="item-subtitle">' + escapeHtml(s.artist) + '</div>';
      html += '</div>';
      html += '<div class="item-meta">' + formatTime(s.duration) + '</div>';
      html += '</div>';
    }

    queueList.innerHTML = html;

    var items = queueList.querySelectorAll('.list-item');
    for (var j = 0; j < items.length; j++) {
      (function(idx) {
        items[idx].addEventListener('click', function() {
          state.queueIndex = idx;
          playTrack(state.queue[idx]);
        });
      })(j);
    }
  }

  // --- Search Logic ---
  var searchTimeout = null;
  function handleSearchInput() {
    var val = searchInput.value.trim();
    if (val.length > 0) {
      btnSearchClear.style.display = 'block';
    } else {
      btnSearchClear.style.display = 'none';
    }

    if (searchTimeout) clearTimeout(searchTimeout);
    searchTimeout = setTimeout(function() {
      executeSearch(val);
    }, 250);
  }

  function executeSearch(query) {
    var container = document.getElementById('search-results');
    if (!query) {
      container.innerHTML = '<div class="empty-state">Type a song, artist, or album name above</div>';
      return;
    }

    container.innerHTML = '<div class="loading-state">Searching...</div>';

    ajax('GET', '/api/search?q=' + encodeURIComponent(query), null, function(err, results) {
      if (err || !results) {
        container.innerHTML = '<div class="empty-state">Search error.</div>';
        return;
      }

      var hasSongs = results.songs && results.songs.length > 0;
      var hasArtists = results.artists && results.artists.length > 0;
      var hasAlbums = results.albums && results.albums.length > 0;

      if (!hasSongs && !hasArtists && !hasAlbums) {
        container.innerHTML = '<div class="empty-state">No results found for "' + escapeHtml(query) + '"</div>';
        return;
      }

      var html = '';

      if (hasSongs) {
        html += '<div class="section-title">SONGS</div><div class="list-group" id="search-songs-group"></div>';
      }
      if (hasArtists) {
        html += '<div class="section-title">ARTISTS</div><div class="list-group" id="search-artists-group"></div>';
      }
      if (hasAlbums) {
        html += '<div class="section-title">ALBUMS</div><div class="list-group" id="search-albums-group"></div>';
      }

      container.innerHTML = html;

      if (hasSongs) {
        renderSongsList(results.songs, document.getElementById('search-songs-group'));
      }
      if (hasArtists) {
        renderArtistsList(results.artists);
        // Move rendered artists to search group
        var aGroup = document.getElementById('search-artists-group');
        var fullAList = document.getElementById('artists-list');
        aGroup.innerHTML = fullAList.innerHTML;
        // Re-attach clicks
        var aItems = aGroup.querySelectorAll('.list-item');
        for (var i = 0; i < aItems.length; i++) {
          (function(idx) {
            aItems[idx].addEventListener('click', function() {
              loadArtistDetail(results.artists[idx].id, results.artists[idx].name);
            });
          })(i);
        }
      }
      if (hasAlbums) {
        var albGroup = document.getElementById('search-albums-group');
        var albHtml = '';
        for (var k = 0; k < results.albums.length; k++) {
          var alb = results.albums[k];
          var artUrl = alb.artworkSongId ? (mediaUrl('/api/artwork/' + encodeURIComponent(alb.artworkSongId))) : '/assets/placeholder.png';
          albHtml += '<div class="list-item" data-album-id="' + escapeHtml(alb.id) + '">';
          albHtml += '<img class="item-thumb" src="' + artUrl + '" alt="Cover" onerror="this.src=\'/assets/placeholder.png\'">';
          albHtml += '<div class="item-info">';
          albHtml += '<div class="item-title">' + escapeHtml(alb.title) + '</div>';
          albHtml += '<div class="item-subtitle">' + escapeHtml(alb.artist) + '</div>';
          albHtml += '</div>';
          albHtml += '<div class="item-chevron">›</div>';
          albHtml += '</div>';
        }
        albGroup.innerHTML = albHtml;
        var albItems = albGroup.querySelectorAll('.list-item');
        for (var m = 0; m < albItems.length; m++) {
          (function(idx) {
            albItems[idx].addEventListener('click', function() {
              loadAlbumDetail(results.albums[idx].id, results.albums[idx].title);
            });
          })(m);
        }
      }
    });
  }

  // --- Initial Data Load ---
  function loadStatus() {
    ajax('GET', '/api/status', null, function(err, status) {
      if (!err && status) {
        document.getElementById('setting-ip').textContent = status.ips && status.ips.length ? status.ips.join(', ') : 'localhost';
        document.getElementById('setting-port').textContent = status.port;
        document.getElementById('setting-folder').textContent = status.musicDir;
        document.getElementById('setting-songs-count').textContent = status.totalSongs;
        document.getElementById('setting-artists-count').textContent = status.totalArtists;
        document.getElementById('setting-albums-count').textContent = status.totalAlbums;
      }
    });
  }

  function loadLibrary() {
    // Load Songs
    ajax('GET', '/api/songs?limit=1000', null, function(err, data) {
      if (!err && data && data.songs) {
        state.allSongs = data.songs;
        renderSongsList(data.songs, document.getElementById('songs-list'));
      } else {
        var listEl = document.getElementById('songs-list');
        if (listEl) {
          listEl.innerHTML = '<div class="loading-state">Could not load your music library. '
            + '<a href="javascript:void(0);" onclick="location.reload();">Tap to retry</a></div>';
        }
      }
    });

    // Load Artists
    ajax('GET', '/api/artists', null, function(err, data) {
      if (!err && data) {
        state.artists = data;
        renderArtistsList(data);
      }
    });

    // Load Albums
    ajax('GET', '/api/albums', null, function(err, data) {
      if (!err && data) {
        state.albums = data;
        renderAlbumsList(data);
      }
    });

    loadStatus();
  }

  // --- Scrubber Drag & Seek ---
  function seekToPosition(clientX) {
    var rect = scrubberBar.getBoundingClientRect();
    var pos = (clientX - rect.left) / rect.width;
    if (pos < 0) pos = 0;
    if (pos > 1) pos = 1;

    var duration = audio.duration || (state.currentSong ? state.currentSong.duration : 0);
    if (duration > 0) {
      audio.currentTime = duration * pos;
      scrubberProgress.style.width = (pos * 100) + '%';
      scrubberThumb.style.left = (pos * 100) + '%';
      timeElapsed.textContent = formatTime(audio.currentTime);
      timeRemaining.textContent = '-' + formatTime(duration - audio.currentTime);
    }
  }

  // --- Event Listeners Setup ---
  function setupEventListeners() {
    // Audio Events
    audio.addEventListener('play', function() {
      state.isPlaying = true;
      updatePlayPauseIcons(true);
      highlightPlayingTracks();
    });

    audio.addEventListener('pause', function() {
      state.isPlaying = false;
      updatePlayPauseIcons(false);
      highlightPlayingTracks();
    });

    audio.addEventListener('timeupdate', function() {
      if (state.isScrubbing) return;
      var current = audio.currentTime;
      var duration = audio.duration || (state.currentSong ? state.currentSong.duration : 0);
      if (duration > 0) {
        var pct = (current / duration) * 100;
        scrubberProgress.style.width = pct + '%';
        scrubberThumb.style.left = pct + '%';
        timeElapsed.textContent = formatTime(current);
        timeRemaining.textContent = '-' + formatTime(Math.max(0, duration - current));
      }
    });

    audio.addEventListener('ended', function() {
      playNext();
    });

    audio.addEventListener('error', function(e) {
      console.error('Audio playback error:', e);
      // If error occurs, try advancing to next track after 2 seconds
      setTimeout(function() {
        if (state.isPlaying) playNext();
      }, 2000);
    });

    // Scrubber Touch & Mouse Events
    scrubberBar.addEventListener('mousedown', function(e) {
      state.isScrubbing = true;
      seekToPosition(e.clientX);
    });
    window.addEventListener('mousemove', function(e) {
      if (state.isScrubbing) {
        seekToPosition(e.clientX);
      }
    });
    window.addEventListener('mouseup', function() {
      state.isScrubbing = false;
    });

    scrubberBar.addEventListener('touchstart', function(e) {
      state.isScrubbing = true;
      if (e.touches.length > 0) {
        seekToPosition(e.touches[0].clientX);
      }
    });
    window.addEventListener('touchmove', function(e) {
      if (state.isScrubbing && e.touches.length > 0) {
        seekToPosition(e.touches[0].clientX);
      }
    });
    window.addEventListener('touchend', function() {
      state.isScrubbing = false;
    });

    // Top Navigation & Search Buttons
    btnNavBack.addEventListener('click', goBack);

    btnNavSearch.addEventListener('click', function() {
      setHidden(searchHeader, false);
      searchInput.focus();
      showView('search');
    });

    btnSearchCancel.addEventListener('click', function() {
      setHidden(searchHeader, true);
      searchInput.value = '';
      btnSearchClear.style.display = 'none';
      goBack();
    });

    btnSearchClear.addEventListener('click', function() {
      searchInput.value = '';
      btnSearchClear.style.display = 'none';
      executeSearch('');
    });

    searchInput.addEventListener('input', handleSearchInput);

    // Mini Player & Now Playing Modal
    document.getElementById('mini-player-tap-area').addEventListener('click', function() {
      nowPlayingModal.className = 'now-playing-modal active';
    });

    btnMiniPlay.addEventListener('click', function(e) {
      e.stopPropagation();
      togglePlayPause();
    });

    btnCloseNowPlaying.addEventListener('click', function() {
      nowPlayingModal.className = 'now-playing-modal';
      queuePanel.className = 'queue-panel';
    });

    btnPlayPause.addEventListener('click', togglePlayPause);
    btnNext.addEventListener('click', playNext);
    btnPrev.addEventListener('click', playPrev);
    btnShuffle.addEventListener('click', toggleShuffle);
    btnRepeat.addEventListener('click', toggleRepeat);

    // Queue Panel
    btnToggleQueue.addEventListener('click', function() {
      queuePanel.className = 'queue-panel active';
      renderQueueList();
    });

    btnCloseQueue.addEventListener('click', function() {
      queuePanel.className = 'queue-panel';
    });

    // Tab Bar Clicks
    for (var i = 0; i < tabButtons.length; i++) {
      (function(btn) {
        btn.addEventListener('click', function() {
          var targetView = btn.getAttribute('data-view');
          state.historyStack = []; // Clear history on root tab switch
          showView(targetView);
        });
      })(tabButtons[i]);
    }

    // Settings Rescan Button
    var btnRescan = document.getElementById('btn-rescan-library');
    var rescanStatus = document.getElementById('rescan-status');
    btnRescan.addEventListener('click', function() {
      btnRescan.disabled = true;
      rescanStatus.textContent = 'Rescanning music library...';
      ajax('POST', '/api/rescan', {}, function(err, resp) {
        if (!err) {
          rescanStatus.textContent = 'Scan started in background!';
          setTimeout(function() {
            loadLibrary();
            btnRescan.disabled = false;
            rescanStatus.textContent = 'Library refreshed.';
          }, 3000);
        } else {
          rescanStatus.textContent = 'Scan failed.';
          btnRescan.disabled = false;
        }
      });
    });

    // Live Cast Listen/Stop Button
    var btnLiveToggle = document.getElementById('btn-live-toggle');
    btnLiveToggle.addEventListener('click', function() {
      var isLivePlaying = !!(state.currentSong && state.currentSong.isLive) && !audio.paused;
      if (isLivePlaying) {
        stopLiveSpotify();
      } else {
        playLiveSpotify();
      }
      refreshLiveStatus();
    });

    // Poll live status every 5s while the Live tab is the active view, so
    // "Nothing playing" flips to "Receiving audio" without needing a manual
    // refresh once the other phone starts AirPlaying.
    setInterval(function() {
      if (state.currentView === 'live') {
        refreshLiveStatus();
      }
    }, 5000);
  }

  // --- Initialize App ---
  function init() {
    setupEventListeners();

    ajax('GET', '/api/session-token', null, function(err, data) {
      if (!err && data && data.token) {
        sessionToken = data.token;
      }
      loadLibrary();
    });

    // Check if there was a saved track in localStorage to populate mini-player
    try {
      var saved = localStorage.getItem('iphone4_last_song');
      if (saved) {
        var parsedSong = JSON.parse(saved);
        if (parsedSong && parsedSong.id) {
          state.currentSong = parsedSong;
          updateMiniPlayerUI(parsedSong);
          updateNowPlayingUI(parsedSong);
        }
      }
    } catch (e) {}
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init);
  }

})();
