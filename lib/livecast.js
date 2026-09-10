// Live "cast from another device" relay: shairport-sync (a real, legally
// operated AirPlay *receiver*, same category of software commercial AirPlay
// speakers run) writes raw PCM to a named pipe whenever someone AirPlays to
// this machine. This module keeps one persistent ffmpeg process alive
// reading that pipe and re-encoding to a continuous MP3 elementary stream,
// then fans that single encode out to any number of connected HTTP clients
// -- exactly like an internet radio station, so the iPhone 4 (and anything
// else) can tune in via a normal <audio> tag pointed at /api/live/spotify.
//
// This never touches Spotify's own encrypted stream: whatever licensed app
// is AirPlaying (Spotify, Apple Music, anything) has already fully decoded
// the audio before it reaches shairport-sync, the same as audio reaching
// any other AirPlay speaker.
const { spawn } = require('child_process');
const fs = require('fs');

const RESTART_DELAY_MS = 3000;
// If ffmpeg hasn't produced a chunk in this long, treat the source as idle
// (no active AirPlay session) rather than "streaming" for status purposes.
const IDLE_TIMEOUT_MS = 8000;

let ffmpegProc = null;
let subscribers = [];
let lastChunkAt = 0;
let restartTimer = null;

function log() {
  var args = Array.prototype.slice.call(arguments);
  console.log.apply(console, ['[livecast]'].concat(args));
}

function broadcast(chunk) {
  lastChunkAt = Date.now();
  for (var i = subscribers.length - 1; i >= 0; i--) {
    var res = subscribers[i];
    try {
      var ok = res.write(chunk);
      if (ok === false) {
        // Slow client: Node already buffers internally; nothing further to
        // do here, backpressure is handled by the socket itself. We do not
        // drop slow subscribers -- a live audio stream a client can't keep
        // up with will simply lag, not corrupt other listeners' streams.
      }
    } catch (err) {
      // Client gone; remove it.
      subscribers.splice(i, 1);
    }
  }
}

function startFfmpeg(pipePath) {
  if (ffmpegProc) return;

  if (!fs.existsSync(pipePath)) {
    log('AirPlay pipe not found at', pipePath, '-- is shairport-sync installed and configured? Retrying in', RESTART_DELAY_MS, 'ms');
    restartTimer = setTimeout(function () { startFfmpeg(pipePath); }, RESTART_DELAY_MS);
    return;
  }

  log('starting ffmpeg reading', pipePath);

  // shairport-sync's "pipe" backend writes raw signed 16-bit little-endian
  // PCM, stereo, 44100Hz -- its fixed, documented output format.
  var args = [
    '-f', 's16le',
    '-ar', '44100',
    '-ac', '2',
    '-i', pipePath,
    '-acodec', 'libmp3lame',
    '-b:a', '192k',
    '-f', 'mp3',
    'pipe:1'
  ];

  try {
    ffmpegProc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    log('failed to spawn ffmpeg:', err.message);
    ffmpegProc = null;
    restartTimer = setTimeout(function () { startFfmpeg(pipePath); }, RESTART_DELAY_MS);
    return;
  }

  ffmpegProc.stdout.on('data', broadcast);

  var stderrTail = '';
  ffmpegProc.stderr.on('data', function (chunk) {
    stderrTail += chunk.toString();
    if (stderrTail.length > 4000) stderrTail = stderrTail.slice(-2000);
  });

  ffmpegProc.on('error', function (err) {
    log('ffmpeg process error:', err.message);
  });

  ffmpegProc.on('close', function (code) {
    log('ffmpeg exited with code', code, '-- stderr tail:', stderrTail.slice(-500));
    ffmpegProc = null;
    // The pipe hitting EOF (e.g. shairport-sync restarted) is recoverable --
    // reopen it. This is expected to happen occasionally, not an error state
    // worth alerting on.
    restartTimer = setTimeout(function () { startFfmpeg(pipePath); }, RESTART_DELAY_MS);
  });
}

// Call once at server startup.
function init(pipePath) {
  startFfmpeg(pipePath);
}

// Registers an HTTP response as a live listener. Caller is responsible for
// having already written response headers (Content-Type: audio/mpeg, no
// Content-Length -- this is an unbounded live stream).
function subscribe(res) {
  subscribers.push(res);
  res.on('close', function () {
    var idx = subscribers.indexOf(res);
    if (idx !== -1) subscribers.splice(idx, 1);
  });
}

function getStatus() {
  return {
    ffmpegRunning: !!ffmpegProc,
    listeners: subscribers.length,
    // "active" means audio has actually flowed recently, i.e. someone is
    // AirPlaying right now -- not just that ffmpeg is up and idly blocked
    // waiting on the pipe.
    active: !!ffmpegProc && (Date.now() - lastChunkAt) < IDLE_TIMEOUT_MS
  };
}

module.exports = { init, subscribe, getStatus };
