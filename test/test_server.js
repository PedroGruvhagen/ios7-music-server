const http = require('http');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

// server.js refuses to start without these; the test suite provides its own
// throwaway credentials so it never depends on a real deployment's secret.
process.env.MUSIC_AUTH_USER = process.env.MUSIC_AUTH_USER || 'test-user';
process.env.MUSIC_AUTH_PASS = process.env.MUSIC_AUTH_PASS || 'test-password';

const { server, start, AUTH_USER, AUTH_PASS } = require('../server');
const scanner = require('../lib/scanner');
const { getConfig } = require('../lib/config');

const TEST_PORT = 8999;

// Set by login() once the test server is up; makeRequest() attaches it to
// every request automatically unless the caller passes its own Cookie
// header (see Test 7b, which needs a genuinely unauthenticated request).
let sessionCookie = null;

function makeRequest(path, headers = {}) {
  return new Promise((resolve, reject) => {
    const finalHeaders = Object.assign({}, headers);
    const hasCookieHeader = Object.keys(finalHeaders).some(h => h.toLowerCase() === 'cookie');
    if (sessionCookie && !hasCookieHeader) {
      finalHeaders['Cookie'] = sessionCookie;
    }
    const req = http.request({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: path,
      method: 'GET',
      headers: finalHeaders
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks)
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// Real POST /login against the running test server, matching the actual
// login flow in server.js (form-encoded body, 302 + Set-Cookie on success).
// Without this, every request in this suite -- including the Range-request
// assertions meant to validate /api/stream/ behavior -- silently receives
// the 200 login-page HTML back instead of real audio bytes.
function login() {
  return new Promise((resolve, reject) => {
    const body = 'username=' + encodeURIComponent(AUTH_USER) + '&password=' + encodeURIComponent(AUTH_PASS);
    const req = http.request({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        if (res.statusCode !== 302) {
          reject(new Error('Login failed: expected 302 redirect from POST /login, got ' + res.statusCode));
          return;
        }
        const setCookie = res.headers['set-cookie'];
        if (!setCookie || !setCookie.length) {
          reject(new Error('Login returned 302 but no Set-Cookie header was present'));
          return;
        }
        // Strip "; Path=/; Max-Age=...; HttpOnly" etc, keep just "name=value"
        sessionCookie = setCookie[0].split(';')[0].trim();
        resolve();
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function runTests() {
  console.log('--- Starting iPhone 4 Music Server Automated Tests ---');

  // Start test server on TEST_PORT
  await new Promise((resolve) => {
    server.listen(TEST_PORT, '127.0.0.1', () => {
      console.log(`Test server running on port ${TEST_PORT}`);
      resolve();
    });
  });

  console.log('\n[Auth] Logging in test client via POST /login...');
  await login();
  console.log('✓ Test client authenticated, session cookie acquired.');

  try {
    // 1. Test Static Files
    console.log('\n[Test 1] Testing static HTML & asset delivery...');
    const indexRes = await makeRequest('/');
    assert.strictEqual(indexRes.statusCode, 200, 'index.html should return 200');
    assert.ok(indexRes.headers['content-type'].includes('text/html'), 'index.html should have text/html MIME');
    assert.ok(indexRes.body.toString().includes('iOS 7'), 'index.html body should contain app structure');

    const cssRes = await makeRequest('/css/style.css');
    assert.strictEqual(cssRes.statusCode, 200, 'style.css should return 200');
    assert.ok(cssRes.headers['content-type'].includes('text/css'), 'style.css should have text/css MIME');

    const jsRes = await makeRequest('/js/app.js');
    assert.strictEqual(jsRes.statusCode, 200, 'app.js should return 200');
    assert.ok(jsRes.headers['content-type'].includes('javascript'), 'app.js should have javascript MIME');

    console.log('✓ Static assets serving passed.');

    // 2. Test Scanner & Library Indexing
    console.log('\n[Test 2] Scanning library at ~/Music/mp3...');
    await scanner.scanLibrary(false);
    const status = scanner.getStatus();
    console.log(`Scanner found: ${status.totalSongs} songs, ${status.totalArtists} artists, ${status.totalAlbums} albums`);
    assert.ok(status.totalSongs > 0, 'Should find at least 1 song in ~/Music/mp3');

    // 3. Test Status API
    console.log('\n[Test 3] Testing /api/status...');
    const statusRes = await makeRequest('/api/status');
    assert.strictEqual(statusRes.statusCode, 200);
    const statusJson = JSON.parse(statusRes.body.toString());
    assert.ok(Array.isArray(statusJson.ips), 'status should return local IP list');
    assert.ok(statusJson.totalSongs > 0, 'status should report songs');
    console.log(`✓ Status API verified. LAN IPs detected: ${statusJson.ips.join(', ')}`);

    // 4. Test Songs API
    console.log('\n[Test 4] Testing /api/songs...');
    const songsRes = await makeRequest('/api/songs?limit=5');
    assert.strictEqual(songsRes.statusCode, 200);
    const songsJson = JSON.parse(songsRes.body.toString());
    assert.ok(songsJson.songs.length > 0, 'Should return songs list');
    const firstSong = songsJson.songs[0];
    console.log(`✓ First song: "${firstSong.title}" by "${firstSong.artist}" (format: ${firstSong.format})`);

    // 5. Test Artists & Albums API
    console.log('\n[Test 5] Testing /api/artists & /api/albums...');
    const artistsRes = await makeRequest('/api/artists');
    assert.strictEqual(artistsRes.statusCode, 200);
    const artistsJson = JSON.parse(artistsRes.body.toString());
    assert.ok(artistsJson.length > 0, 'Should return artists');

    const albumsRes = await makeRequest('/api/albums');
    assert.strictEqual(albumsRes.statusCode, 200);
    const albumsJson = JSON.parse(albumsRes.body.toString());
    assert.ok(albumsJson.length > 0, 'Should return albums');
    console.log(`✓ Found ${artistsJson.length} artists and ${albumsJson.length} albums.`);

    // 6. Test Search API
    console.log('\n[Test 6] Testing /api/search...');
    const searchRes = await makeRequest('/api/search?q=' + encodeURIComponent(firstSong.title.substring(0, 3)));
    assert.strictEqual(searchRes.statusCode, 200);
    const searchJson = JSON.parse(searchRes.body.toString());
    assert.ok(searchJson.songs.length > 0, 'Search should find songs');
    console.log(`✓ Search returned ${searchJson.songs.length} matching songs.`);

    // 7. CRITICAL TEST: HTTP Range Requests for iOS 7 Safari
    console.log('\n[Test 7] Testing HTTP 206 Range streaming (Critical for iOS 7 Safari)...');
    
    // Find an MP3 song to test
    const mp3Song = scanner.songs.find(s => s.format === 'mp3') || firstSong;

    // Test Safari probe header: Range: bytes=0-1
    const rangeRes1 = await makeRequest(`/api/stream/${mp3Song.id}`, { Range: 'bytes=0-1' });
    assert.strictEqual(rangeRes1.statusCode, 206, 'Should return HTTP 206 Partial Content for bytes=0-1');
    assert.strictEqual(rangeRes1.headers['accept-ranges'], 'bytes', 'Accept-Ranges must be bytes');
    assert.ok(rangeRes1.headers['content-range'].startsWith('bytes 0-1/'), 'Content-Range must match bytes 0-1/<total>');
    assert.strictEqual(rangeRes1.body.length, 2, 'Should return exactly 2 bytes');
    console.log(`✓ Safari probe Range: bytes=0-1 passed (Content-Range: ${rangeRes1.headers['content-range']})`);

    // Test standard offset range: Range: bytes=1000-4999
    const rangeRes2 = await makeRequest(`/api/stream/${mp3Song.id}`, { Range: 'bytes=1000-4999' });
    assert.strictEqual(rangeRes2.statusCode, 206);
    assert.ok(rangeRes2.headers['content-range'].startsWith('bytes 1000-4999/'));
    assert.strictEqual(rangeRes2.body.length, 4000);
    console.log(`✓ Range: bytes=1000-4999 passed (Received 4000 bytes).`);

    // 7b. CRITICAL TEST: unauthenticated media requests must get a loud 401,
    // never the 200 text/html login page (an <audio>/<img> element decoding
    // that response fails almost instantly with no useful signal).
    console.log('\n[Test 7b] Testing loud 401 (not HTML) for unauthenticated media requests...');
    const unauthRes = await makeRequest(`/api/stream/${mp3Song.id}`, { Cookie: '' });
    assert.strictEqual(unauthRes.statusCode, 401, 'Unauthenticated media request should return 401');
    assert.ok(!String(unauthRes.headers['content-type'] || '').includes('text/html'),
      'Unauthenticated media response must not be text/html');
    console.log(`✓ Unauthenticated /api/stream/ request correctly returned 401 (Content-Type: ${unauthRes.headers['content-type']}).`);

    // 8. Test FLAC / Non-native format transcoding if available
    const flacSong = scanner.songs.find(s => s.format === 'flac');
    if (flacSong) {
      console.log(`\n[Test 8] Testing live transcoding for FLAC song: "${flacSong.title}"...`);
      const transcodeRes = await makeRequest(`/api/stream/${flacSong.id}`);
      assert.strictEqual(transcodeRes.statusCode, 200);
      assert.strictEqual(transcodeRes.headers['content-type'], 'audio/mpeg');
      assert.ok(transcodeRes.body.length > 1000, 'Transcoder should output valid MP3 stream bytes');
      const contentLength = parseInt(transcodeRes.headers['content-length'], 10);
      assert.ok(!isNaN(contentLength) && contentLength > 1000,
        'Transcoded response should carry a real numeric Content-Length header > 1000');
      assert.strictEqual(transcodeRes.headers['transfer-encoding'], undefined,
        'Transcoded response must NOT use chunked Transfer-Encoding');
      console.log(`✓ FLAC live transcoding passed (${transcodeRes.body.length} MP3 bytes received, Content-Length: ${contentLength}).`);

      // 8b. Range support on the transcode path (proves the temp-file +
      // serveFileWithRangeSupport design actually answers Range requests).
      console.log(`\n[Test 8b] Testing HTTP 206 Range support on the FLAC transcode path...`);
      const flacRangeRes = await makeRequest(`/api/stream/${flacSong.id}`, { Range: 'bytes=0-1' });
      assert.strictEqual(flacRangeRes.statusCode, 206, 'Should return HTTP 206 Partial Content for bytes=0-1 on transcoded output');
      assert.strictEqual(flacRangeRes.headers['accept-ranges'], 'bytes', 'Accept-Ranges must be bytes');
      assert.ok(flacRangeRes.headers['content-range'].startsWith('bytes 0-1/'), 'Content-Range must match bytes 0-1/<total>');
      assert.strictEqual(flacRangeRes.body.length, 2, 'Should return exactly 2 bytes');
      console.log(`✓ FLAC transcode Range: bytes=0-1 passed (Content-Range: ${flacRangeRes.headers['content-range']})`);
    } else {
      console.log('\n[Test 8] No FLAC file found in library, skipping live transcoding test.');
      console.log('[Test 8b] Skipped (no FLAC file found).');
    }

    // 9. Test Artwork Extraction
    const songWithArt = scanner.songs.find(s => s.hasArtwork);
    if (songWithArt) {
      console.log(`\n[Test 9] Testing artwork extraction for "${songWithArt.title}"...`);
      const artRes = await makeRequest(`/api/artwork/${songWithArt.id}`);
      assert.strictEqual(artRes.statusCode, 200);
      assert.strictEqual(artRes.headers['content-type'], 'image/jpeg');
      assert.ok(artRes.body.length > 500, 'Artwork should be non-empty image');
      console.log(`✓ Artwork extraction passed (${artRes.body.length} bytes JPEG).`);
    } else {
      console.log('\n[Test 9] No song with artwork found, skipping artwork test.');
    }

    console.log('\n=============================================================');
    console.log('🎉 ALL TESTS PASSED! SERVER & CLIENT ARE PRODUCTION READY! 🎉');
    console.log('=============================================================\n');

  } finally {
    server.close();
  }
}

runTests().catch(err => {
  console.error('\n❌ Test failed with error:', err);
  process.exit(1);
});
