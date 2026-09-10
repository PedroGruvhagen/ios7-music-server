const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

const MIME_TYPES = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.mp4': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
  '.aiff': 'audio/aiff',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg'
};

// .aiff added: Apple's own docs list AIF as natively iOS-playable alongside
// AAC/MP3/WAVE, so it must never be routed through the transcode path below.
const NATIVE_IOS7_EXTENSIONS = new Set(['.mp3', '.m4a', '.mp4', '.aac', '.wav', '.aiff']);

// Serves a file already on disk with full HTTP Range support: 206 Partial
// Content, 416 for an out-of-bounds/invalid range, and a plain 200 with a
// real Content-Length for a request with no Range header. Shared by both the
// native-format branch (serving a library file directly) and the transcode
// branch (serving a buffered temp file) below -- byte-range support is the
// critical iOS/AVFoundation requirement in both cases, not a native-format
// special case.
function serveFileWithRangeSupport(req, res, filePath, fileSize, mimeType, cacheControl) {
  const range = req.headers.range;

  if (range) {
    // Range header format: "bytes=start-end"
    const parts = range.replace(/bytes=/, '').split('-');
    let start = parseInt(parts[0], 10);
    let end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

    // Handle suffix range (e.g. "-500")
    if (isNaN(start)) {
      start = fileSize - end;
      end = fileSize - 1;
    }

    // Range check
    if (start >= fileSize || end >= fileSize || start > end) {
      res.writeHead(416, {
        'Content-Range': `bytes */${fileSize}`,
        'Accept-Ranges': 'bytes'
      });
      return res.end();
    }

    const chunkSize = (end - start) + 1;
    const fileStream = fs.createReadStream(filePath, { start, end });

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': mimeType,
      'Cache-Control': cacheControl
    });

    fileStream.pipe(res);

    req.on('close', () => {
      fileStream.destroy();
    });

    fileStream.on('error', (err) => {
      console.error('File stream error:', err.message);
      if (!res.headersSent) {
        res.writeHead(500);
        res.end();
      }
    });
  } else {
    // Full file transfer
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': mimeType,
      'Accept-Ranges': 'bytes',
      'Cache-Control': cacheControl
    });

    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);

    req.on('close', () => {
      fileStream.destroy();
    });
  }
}

function streamAudio(req, res, filePath) {
  const logTag = '[stream ' + path.basename(filePath) + ']';
  console.log(logTag, 'request, Range:', req.headers.range || '(none)', 'UA:', req.headers['user-agent']);

  res.on('finish', function () {
    console.log(logTag, 'response finished, status', res.statusCode, 'bytesWritten', res.socket ? res.socket.bytesWritten : '?');
  });
  req.on('aborted', function () {
    console.log(logTag, 'request ABORTED by client mid-stream');
  });

  if (!fs.existsSync(filePath)) {
    console.error(logTag, 'FILE NOT FOUND on disk:', filePath);
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Audio file not found');
  }

  const ext = path.extname(filePath).toLowerCase();
  const stat = fs.statSync(filePath);
  const fileSize = stat.size;

  // Check if native format for iOS 7 Safari
  if (NATIVE_IOS7_EXTENSIONS.has(ext)) {
    const mimeType = MIME_TYPES[ext] || 'audio/mpeg';
    serveFileWithRangeSupport(req, res, filePath, fileSize, mimeType, 'public, max-age=3600');
  } else {
    // Non-native format (e.g., FLAC, OGG) -> transcode to MP3, buffered to a
    // temp file on disk, then served through the same Range-aware path as
    // native formats above. The old approach piped ffmpeg's stdout straight
    // into the HTTP response with Transfer-Encoding: chunked and no
    // Content-Length, and never inspected req.headers.range at all -- a
    // hard-failure pattern for iOS Safari/AVFoundation (byte-range support
    // is Apple's own single most emphasized server requirement for iOS
    // media, and an unbounded chunked response makes audio.duration report
    // Infinity/NaN client-side). Buffering to a temp file first gives the
    // eventual response a real, known Content-Length and lets it answer
    // Range requests exactly like a native file does.
    //
    // This means a FLAC/OGG file gets re-transcoded on every request rather
    // than cached across requests. Caching is intentionally not implemented
    // here: it would require cache invalidation on rescans and coordination
    // between concurrent requests for the same song mid-transcode.
    console.log(logTag, 'non-native format', ext, '-- transcoding to a buffered temp file');

    const tmpFile = path.join(
      os.tmpdir(),
      'iphone4-music-transcode-' + crypto.randomBytes(8).toString('hex') + '.mp3'
    );

    // NOTE: the old `?t=`/startTime seek-offset feature (a `-ss` argument
    // built from the request's `t` query param) has been deliberately
    // removed here. It was dead code -- nothing in this repo ever sent
    // `?t=` -- and it is actively incompatible with the temp-file+Range
    // design: a `-ss`-shifted transcode output can't correctly answer Range
    // requests computed against the untouched source duration. Real seeking
    // now works the same way it does for native formats: via HTTP Range
    // headers against the full transcoded file.
    const ffmpegArgs = [
      '-i', filePath,
      '-vn',
      '-acodec', 'libmp3lame',
      '-b:a', '192k',
      '-ar', '44100',
      '-ac', '2',
      '-y', tmpFile
    ];

    let ffmpegProc;
    try {
      ffmpegProc = spawn('ffmpeg', ffmpegArgs);
    } catch (spawnErr) {
      console.error(logTag, 'Failed to launch ffmpeg for transcoding:', spawnErr.message);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      return res.end('Transcoding not available');
    }

    let tmpCleanedUp = false;
    function cleanupTmpFile() {
      if (tmpCleanedUp) return;
      tmpCleanedUp = true;
      fs.unlink(tmpFile, function (err) {
        if (err && err.code !== 'ENOENT') {
          console.error(logTag, 'Failed to clean up temp transcode file:', err.message);
        }
      });
    }

    let stderrBuf = '';
    ffmpegProc.stderr.on('data', (chunk) => {
      stderrBuf += chunk.toString();
      if (stderrBuf.length > 8000) {
        // Keep only the tail so this can't grow unbounded on a long transcode
        stderrBuf = stderrBuf.slice(-4000);
      }
    });

    ffmpegProc.on('error', (err) => {
      console.error(logTag, 'ffmpeg process error:', err.message);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Transcoding failed');
      }
      cleanupTmpFile();
    });

    ffmpegProc.on('close', (code) => {
      if (code !== 0) {
        console.error(logTag, 'ffmpeg exited with code', code, '-- stderr tail:', stderrBuf.slice(-500));
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Transcoding failed');
        }
        cleanupTmpFile();
        return;
      }

      let tmpStat;
      try {
        tmpStat = fs.statSync(tmpFile);
      } catch (statErr) {
        console.error(logTag, 'Transcoded temp file missing after ffmpeg exit 0:', statErr.message);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Transcoding failed');
        }
        cleanupTmpFile();
        return;
      }

      res.on('finish', cleanupTmpFile);
      res.on('close', cleanupTmpFile);

      serveFileWithRangeSupport(req, res, tmpFile, tmpStat.size, 'audio/mpeg', 'no-cache');
    });

    req.on('close', () => {
      if (!res.headersSent) {
        try {
          ffmpegProc.kill('SIGKILL');
        } catch (kErr) {}
        cleanupTmpFile();
      }
    });
  }
}

module.exports = {
  streamAudio,
  MIME_TYPES
};
