const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { URL } = require('url');

const { getConfig, saveConfig } = require('./lib/config');
const scanner = require('./lib/scanner');
const { streamAudio } = require('./lib/streamer');
const { extractArtwork } = require('./lib/metadata');
const { printBanner } = require('./lib/qrcode');

const PUBLIC_DIR = path.join(__dirname, 'public');

const STATIC_MIMES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // IPv4 and not 127.0.0.1
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push(iface.address);
      }
    }
  }
  return addresses;
}

function sendJson(res, statusCode, data) {
  const jsonStr = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(jsonStr),
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-cache'
  });
  res.end(jsonStr);
}

function serveStatic(req, res, pathname) {
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);

  // Security check: prevent directory traversal
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    return res.end('Forbidden');
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    // If not found, check if index.html
    filePath = path.join(PUBLIC_DIR, 'index.html');
  }

  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Not Found');
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = STATIC_MIMES[ext] || 'application/octet-stream';
  const stat = fs.statSync(filePath);

  // .js/.css/.html must never be aggressively cached: a stale cached app.js on
  // the iPhone silently runs old client logic (no server-restart or Set-Cookie
  // ever tells it to refetch), which caused a real incident -- stream/artwork
  // requests going out without the session token, getting the login page back
  // instead of audio, and the client's error handler auto-skipping tracks
  // every 2s with zero sound. Images/icons are static assets, safe to cache.
  const cacheControl = (ext === '.js' || ext === '.css' || ext === '.html')
    ? 'no-cache'
    : 'public, max-age=3600';

  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': stat.size,
    'Cache-Control': cacheControl
  });

  fs.createReadStream(filePath).pipe(res);
}

async function handleApi(req, res, parsedUrl) {
  const method = req.method.toUpperCase();
  const pathname = parsedUrl.pathname;

  // Enable CORS
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Range',
      'Access-Control-Max-Age': '86400'
    });
    return res.end();
  }

  // GET /api/session-token
  // Lets the client, once authenticated via cookie, fetch its own session
  // token to embed as ?st= on <audio>/<img> URLs (see hasValidSession above:
  // iOS routes those through a cookie-less media process).
  if (pathname === '/api/session-token' && method === 'GET') {
    const token = getSessionCookieValue(req);
    return sendJson(res, 200, { token: token || null });
  }

  // GET /api/status
  if (pathname === '/api/status' && method === 'GET') {
    const status = scanner.getStatus();
    const ips = getLocalIpAddresses();
    return sendJson(res, 200, {
      ...status,
      ips,
      port: getConfig().port
    });
  }

  // GET /api/songs
  if (pathname === '/api/songs' && method === 'GET') {
    const page = parseInt(parsedUrl.searchParams.get('page') || '1', 10);
    const limit = parseInt(parsedUrl.searchParams.get('limit') || '500', 10);
    const startIndex = (page - 1) * limit;
    const pagedSongs = scanner.songs.slice(startIndex, startIndex + limit);

    return sendJson(res, 200, {
      total: scanner.songs.length,
      page,
      limit,
      totalPages: Math.ceil(scanner.songs.length / limit),
      songs: pagedSongs
    });
  }

  // GET /api/artists
  if (pathname === '/api/artists' && method === 'GET') {
    return sendJson(res, 200, scanner.artists);
  }

  // GET /api/artist/:id
  if (pathname.startsWith('/api/artist/') && method === 'GET') {
    const id = pathname.substring('/api/artist/'.length);
    const artist = scanner.getArtist(id);
    if (!artist) {
      return sendJson(res, 404, { error: 'Artist not found' });
    }
    return sendJson(res, 200, artist);
  }

  // GET /api/albums
  if (pathname === '/api/albums' && method === 'GET') {
    return sendJson(res, 200, scanner.albums);
  }

  // GET /api/album/:id
  if (pathname.startsWith('/api/album/') && method === 'GET') {
    const id = pathname.substring('/api/album/'.length);
    const album = scanner.getAlbum(id);
    if (!album) {
      return sendJson(res, 404, { error: 'Album not found' });
    }
    return sendJson(res, 200, album);
  }

  // GET /api/search?q=...
  if (pathname === '/api/search' && method === 'GET') {
    const q = parsedUrl.searchParams.get('q') || '';
    const results = scanner.search(q);
    return sendJson(res, 200, results);
  }

  // GET /api/stream/:id
  if (pathname.startsWith('/api/stream/') && method === 'GET') {
    const id = pathname.substring('/api/stream/'.length);
    const song = scanner.getSong(id);
    if (!song) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Track not found');
    }
    return streamAudio(req, res, song.path);
  }

  // GET /api/artwork/:id
  if (pathname.startsWith('/api/artwork/') && method === 'GET') {
    const id = pathname.substring('/api/artwork/'.length);
    const song = scanner.getSong(id);
    if (!song) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Artwork not found');
    }

    const config = getConfig();
    const artworkCachePath = path.join(config.cacheDir, 'artwork', `${id}.jpg`);

    try {
      const artPath = await extractArtwork(song.path, artworkCachePath);
      if (artPath && fs.existsSync(artPath)) {
        const stat = fs.statSync(artPath);
        res.writeHead(200, {
          'Content-Type': 'image/jpeg',
          'Content-Length': stat.size,
          'Cache-Control': 'public, max-age=86400'
        });
        return fs.createReadStream(artPath).pipe(res);
      }
    } catch (e) {
      console.error('Artwork extraction error:', e.message);
    }

    // Default fallback: return 404 so frontend can show retro album placeholder
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Artwork not found');
  }

  // POST /api/rescan
  if (pathname === '/api/rescan' && method === 'POST') {
    scanner.scanLibrary(true);
    return sendJson(res, 200, { success: true, message: 'Rescan initiated' });
  }

  // POST /api/settings
  if (pathname === '/api/settings' && method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        if (payload.musicDir && typeof payload.musicDir === 'string') {
          saveConfig({ musicDir: payload.musicDir.trim() });
          scanner.scanLibrary(true);
          return sendJson(res, 200, { success: true, config: getConfig() });
        }
        return sendJson(res, 400, { error: 'Invalid musicDir' });
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }
    });
    return;
  }

  // 404 for other API routes
  return sendJson(res, 404, { error: 'Endpoint not found' });
}

// --- Login (cookie-session based; plain HTML form, no JS/fetch required) ---
// HTTP Basic Auth was tried first but old WebKit (iOS 7 Mobile Safari) does not
// reliably re-attach cached Basic-Auth credentials to script-triggered XHR/fetch
// calls (the song list, artwork, streaming endpoints this app's own JS calls),
// which produced a repeating login prompt. A cookie, once set, is sent
// automatically by the browser with every request, JS-triggered or not, and
// cookies have been supported since Netscape 1994 -- older and more reliably
// compatible with iOS 7 than Basic Auth's credential caching.
// No hardcoded default: this app is meant to run on your own LAN, but it's
// still a login gate guarding your music library, so it refuses to start
// with a guessable built-in credential. Set MUSIC_AUTH_USER/MUSIC_AUTH_PASS
// before starting (see README).
const AUTH_USER = process.env.MUSIC_AUTH_USER;
const AUTH_PASS = process.env.MUSIC_AUTH_PASS;
if (!AUTH_USER || !AUTH_PASS) {
  console.error(
    'MUSIC_AUTH_USER and MUSIC_AUTH_PASS must both be set in the environment. ' +
    'Example: MUSIC_AUTH_USER=you MUSIC_AUTH_PASS="a real password" node server.js'
  );
  process.exit(1);
}
const SESSION_COOKIE = 'music_session';
const SESSION_MAX_AGE_S = 60 * 60 * 24 * 30; // 30 days

// Persisted to disk so a service restart (deploys, reboots) never logs
// anyone out. A secret regenerated per-process-start was the original design
// but that meant every restart silently invalidated every session -- during
// active development that was several logouts an hour, unacceptable in
// practice. Generated once, reused forever after.
const SESSION_SECRET_FILE = path.join(getConfig().cacheDir, 'session-secret');

function loadOrCreateSessionSecret() {
  try {
    if (fs.existsSync(SESSION_SECRET_FILE)) {
      const hex = fs.readFileSync(SESSION_SECRET_FILE, 'utf8').trim();
      const buf = Buffer.from(hex, 'hex');
      if (buf.length === 32) return buf;
    }
  } catch (e) {
    console.error('Could not read session secret, generating a new one:', e.message);
  }
  const fresh = crypto.randomBytes(32);
  try {
    fs.writeFileSync(SESSION_SECRET_FILE, fresh.toString('hex'), { mode: 0o600 });
  } catch (e) {
    console.error('Could not persist session secret (sessions will not survive a restart):', e.message);
  }
  return fresh;
}

const SESSION_SECRET = loadOrCreateSessionSecret();

function timingSafeStringEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) {
    // Still run a comparison of equal length to avoid leaking length via timing
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function makeSessionToken() {
  const nonce = crypto.randomBytes(16).toString('hex');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(nonce).digest('hex');
  return nonce + '.' + sig;
}

function isValidSessionToken(token) {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [nonce, sig] = parts;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(nonce).digest('hex');
  return timingSafeStringEqual(sig, expected);
}

function parseCookies(req) {
  const header = req.headers['cookie'] || '';
  const out = {};
  header.split(';').forEach(function (part) {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  });
  return out;
}

function getSessionCookieValue(req) {
  const cookies = parseCookies(req);
  return cookies[SESSION_COOKIE];
}

// iOS routes <audio>/<video> element requests through a separate media
// process (mediaserverd / AVFoundation), not the page's own cookie jar, so
// the session cookie never reaches /api/stream or /api/artwork when loaded
// as a media element src. And a page added to the Home Screen runs with its
// OWN separate cookie storage from Safari, so a cookie set while browsing in
// Safari won't carry over there either. To make streaming/artwork work in
// both cases, those endpoints also accept the same session token as a
// `?st=` query parameter, which the client embeds directly in the URL
// instead of relying on a cookie ever being sent.
function hasValidSession(req, parsedUrl) {
  const cookieToken = getSessionCookieValue(req);
  if (isValidSessionToken(cookieToken)) return true;
  if (parsedUrl) {
    const queryToken = parsedUrl.searchParams.get('st');
    if (isValidSessionToken(queryToken)) return true;
  }
  return false;
}

function readRequestBody(req, maxBytes) {
  return new Promise(function (resolve, reject) {
    let size = 0;
    const chunks = [];
    req.on('data', function (chunk) {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('Body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', function () {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });
}

function parseFormBody(body) {
  const out = {};
  body.split('&').forEach(function (pair) {
    if (!pair) return;
    const idx = pair.indexOf('=');
    const key = decodeURIComponent((idx === -1 ? pair : pair.slice(0, idx)).replace(/\+/g, ' '));
    const val = idx === -1 ? '' : decodeURIComponent(pair.slice(idx + 1).replace(/\+/g, ' '));
    out[key] = val;
  });
  return out;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderLoginPage(errorMessage) {
  return (
    '<!DOCTYPE html>\n' +
    '<html>\n' +
    '<head>\n' +
    '<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">\n' +
    '<title>Music Login</title>\n' +
    '<style>\n' +
    'body { background: #000; color: #fff; font-family: Helvetica, Arial, sans-serif; ' +
    'margin: 0; padding: 40px 20px; text-align: center; }\n' +
    'h1 { font-size: 20px; font-weight: normal; margin-bottom: 24px; }\n' +
    'form { display: inline-block; text-align: left; width: 100%; max-width: 280px; }\n' +
    'label { display: block; font-size: 13px; color: #999; margin: 12px 0 4px; }\n' +
    'input[type=text], input[type=password] { width: 100%; box-sizing: border-box; padding: 10px; ' +
    'font-size: 16px; border: 1px solid #444; background: #111; color: #fff; border-radius: 6px; }\n' +
    'input[type=submit] { width: 100%; margin-top: 20px; padding: 12px; font-size: 16px; ' +
    'background: #007aff; color: #fff; border: none; border-radius: 6px; }\n' +
    '.error { color: #ff3b30; font-size: 13px; margin-top: 12px; }\n' +
    '</style>\n' +
    '</head>\n' +
    '<body>\n' +
    '<h1>Music</h1>\n' +
    '<form method="POST" action="/login">\n' +
    '<label for="u">User</label>\n' +
    '<input type="text" id="u" name="username" autocapitalize="off" autocorrect="off">\n' +
    '<label for="p">Password</label>\n' +
    '<input type="password" id="p" name="password">\n' +
    '<input type="submit" value="Log In">\n' +
    (errorMessage ? '<div class="error">' + escapeHtml(errorMessage) + '</div>' : '') +
    '</form>\n' +
    '</body>\n' +
    '</html>\n'
  );
}

async function handleLoginPost(req, res) {
  let body;
  try {
    body = await readRequestBody(req, 10 * 1024);
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Bad request');
    return;
  }
  const fields = parseFormBody(body);
  const okUser = timingSafeStringEqual(fields.username || '', AUTH_USER);
  const okPass = timingSafeStringEqual(fields.password || '', AUTH_PASS);
  if (okUser && okPass) {
    const token = makeSessionToken();
    res.writeHead(302, {
      'Location': '/',
      'Set-Cookie': SESSION_COOKIE + '=' + token + '; Path=/; Max-Age=' + SESSION_MAX_AGE_S + '; HttpOnly'
    });
    res.end();
  } else {
    const html = renderLoginPage('Wrong username or password.');
    res.writeHead(401, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': Buffer.byteLength(html)
    });
    res.end(html);
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const host = req.headers.host || `localhost:${getConfig().port}`;
    const earlyUrl = new URL(req.url, `http://${host}`);

    console.log('REQ', req.method, earlyUrl.pathname + earlyUrl.search, '| UA:', req.headers['user-agent'], '| remote:', req.socket.remoteAddress);

    if (earlyUrl.pathname === '/login' && req.method === 'POST') {
      await handleLoginPost(req, res);
      return;
    }

    if (!hasValidSession(req, earlyUrl)) {
      // Diagnostic: if a media/API path falls through to the login page, that
      // IS the bug (client thinks it's authenticated, server disagrees) --
      // log it loudly instead of silently returning HTML the client can't play.
      const isMediaRequest = earlyUrl.pathname.startsWith('/api/stream/') || earlyUrl.pathname.startsWith('/api/artwork/');
      if (isMediaRequest) {
        console.error('AUTH REJECTED for media request:', earlyUrl.pathname + earlyUrl.search,
          '| cookie present:', !!getSessionCookieValue(req),
          '| st param present:', !!earlyUrl.searchParams.get('st'),
          '| UA:', req.headers['user-agent']);
      }

      if (isMediaRequest) {
        // Defense in depth: an <audio src>/<img src> pointed at a 200
        // text/html login page fails to decode almost instantly with no
        // useful signal. Any edge case that makes token validation silently
        // fail for a media request must degrade into a real 401, never HTML
        // disguised as a 200 success to a media element.
        const body = 'Unauthorized';
        res.writeHead(401, {
          'Content-Type': 'text/plain',
          'Content-Length': Buffer.byteLength(body)
        });
        res.end(body);
        return;
      }

      const html = renderLoginPage(null);
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': Buffer.byteLength(html)
      });
      res.end(html);
      return;
    }

    const parsedUrl = earlyUrl;

    if (parsedUrl.pathname.startsWith('/api/')) {
      await handleApi(req, res, parsedUrl);
    } else {
      serveStatic(req, res, parsedUrl.pathname);
    }
  } catch (err) {
    console.error('Server error handling request:', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal Server Error');
    }
  }
});

// Node's server.keepAliveTimeout defaults to 5000ms and is never overridden
// otherwise. A client that reuses a kept-alive connection right as, or just
// after, the server tears down that idle socket gets a silent connection
// failure with no distinguishing error on either side (nodejs/node#59193).
// This is a raw TCP/HTTP-level issue, not browser-specific, and real
// interactive browsing (multi-second gaps between requests while looking at
// artwork or lists) easily produces the idle gap that triggers it.
// headersTimeout must be greater than keepAliveTimeout per Node's own docs.
server.keepAliveTimeout = 120000; // 2 minutes
server.headersTimeout = 121000;

async function start() {
  const config = getConfig();
  const port = config.port;

  // Try loading cached library first for instant start
  const loaded = scanner.loadFromCache();
  if (!loaded) {
    // Initial scan in background
    scanner.scanLibrary(false);
  } else {
    // Refresh check in background
    setTimeout(() => {
      scanner.scanLibrary(false);
    }, 1000);
  }

  server.listen(port, config.host, () => {
    const ips = getLocalIpAddresses();
    printBanner(`http://${ips[0] || 'localhost'}:${port}`, ips, port);
  });
}

if (require.main === module) {
  start();
}

module.exports = {
  server,
  start,
  AUTH_USER,
  AUTH_PASS
};
