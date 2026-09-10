# 🎵 ios7-music-server

A zero-dependency home-network music server and web player, purpose-built to turn an old **iPhone
4 / iPhone 4S (iOS 7.1.2)** into a dedicated audio player over your own Wi-Fi. The server is plain
Node.js with no npm dependencies; the client is strict ECMAScript 5, since anything from ES6
onward (arrow functions, `let`/`const`, template literals, `fetch`, `Promise`) fails silently on
real iOS 7 Mobile Safari (WebKit 537.51.2) and takes the whole page down with it.

It also works fine as a plain LAN music player from any modern browser — the ES5/iOS-7 constraint
just means it never needs a build step, a framework, or a bundler to do that.

## Why this exists

Old 30-pin iOS devices like the iPhone 4 (Apple A4, 512MB RAM, iOS 7.1.2) are durable, well-made
hardware with a real headphone jack and a decent DAC, but:

- The App Store no longer serves them; no Spotify, Apple Music, or anything current.
- Modern web apps (React/Vue/anything bundled for ES6+) crash on iOS 7's WebKit with a syntax
  error before they render anything.
- iOS 7's root CA store is old enough that HTTPS to most of the modern web fails outright.

This project sidesteps all of that: it's a small HTTP server on your own machine, serving your own
music library, over plain HTTP on your own LAN, to a client written for the browser engine that
actually exists on the device.

## Features

- Zero npm dependencies (Node's built-in `http`, `fs`, `crypto` only)
- HTML5 `<audio>` streaming with real HTTP Range (`206 Partial Content`) support, including for
  formats that need on-the-fly transcoding (FLAC/OGG → MP3) via `ffmpeg`
- Cookie-based login (not HTTP Basic Auth — iOS 7 Mobile Safari doesn't reliably re-attach cached
  Basic Auth credentials to script-triggered XHR calls)
- A `?st=` session-token fallback for `<audio>`/`<img>` requests, since iOS routes those through a
  separate media process that doesn't carry the page's own cookie jar
- Songs / Artists / Albums / Search views, a queue, shuffle/repeat, and a persistent mini-player
- Album art extraction and caching
- A "Live" tab that relays audio AirPlayed in from another device (see below) — useful for
  streaming services with no iOS 7-compatible client, like Spotify

## Requirements

- Node.js (any reasonably current LTS)
- `ffmpeg` on your `PATH` if your library has FLAC/OGG files you want transcoded on the fly, or if
  you want the Live/AirPlay relay feature
- A music folder of MP3/FLAC/OGG/AIFF/WAV files, tagged well enough for the metadata reader to
  pick up artist/album/title

## Quick start

```bash
git clone https://github.com/PedroGruvhagen/ios7-music-server.git
cd ios7-music-server

# The login is a real credential gate, not a demo default -- pick your own.
export MUSIC_AUTH_USER="you"
export MUSIC_AUTH_PASS="a real password"

./start.sh
```

On first run it writes `config.json` (gitignored, see `config.example.json` for the shape) with a
default `musicDir` of `~/Music/mp3`. Edit `config.json` to point at wherever your library actually
lives, then restart.

The server prints the LAN URL(s) it's listening on when it starts. Open that URL from any browser
on your network, including Mobile Safari on the iPhone 4 itself, log in with the credentials you
set above, and you're in.

### Installing on the iPhone 4 as a full-screen "app"

In Mobile Safari, open the server's URL, tap the Share/Action icon, then "Add to Home Screen". iOS
7 launches it full-screen without the browser chrome, which is why the UI is built to look like a
native player rather than a web page.

One iOS 7 quirk worth knowing: a Home Screen web app can stay **suspended** in the background
across launches, meaning tapping the icon sometimes resumes the exact page state from last time
rather than reloading it, even after you've deployed a change. If something looks stale, force-quit
it from the app switcher first, then relaunch.

## Configuration (`config.json`)

| Field | Meaning |
|---|---|
| `musicDir` | Absolute path to your music library folder |
| `port` | HTTP port (default `8080`) |
| `host` | Bind address (default `0.0.0.0`, all interfaces) |
| `cacheDir` | Where extracted artwork and the session secret are cached |

Auth (`MUSIC_AUTH_USER` / `MUSIC_AUTH_PASS`) is environment-only, on purpose: the server refuses to
start without both set, so there's no shipped default credential to forget about.

`airplayPipe` is only used by the Live/AirPlay relay feature below; you can ignore it otherwise.

## Live: casting audio in from another device (e.g. Spotify)

There's no way to run a modern streaming app's client on iOS 7 itself (App Stores have long since
dropped support, and things like Spotify's Web Playback SDK require DRM support iOS 7's WebKit
doesn't have). The **Live** tab works around that legally, the same way any AirPlay speaker does:
a real, licensed app on another device (your current phone, a Mac, whatever) does the actual
decoding and playback, AirPlays the resulting plain decoded audio to this server, and this app
just relays that live audio onward to the iOS 7 device's own `<audio>` player.

Setup, once per server:

1. Install [Shairport Sync](https://github.com/mikebrady/shairport-sync) (an open-source AirPlay
   *receiver* — the same category of software real AirPlay speakers run), e.g. `apt install
   shairport-sync` on Debian/Ubuntu.
2. Configure it to write raw PCM to a named pipe instead of trying to drive real audio hardware.
   In `/etc/shairport-sync.conf`:
   ```
   general = { name = "My Music Server"; output_backend = "pipe"; ignore_volume_control = "yes"; };
   pipe = { name = "/tmp/shairport-sync-audio"; };
   ```
   `ignore_volume_control` matters: without it, playback volume is capped by whatever the AirPlay
   *sender's* own volume slider happens to be set to, which is usually much quieter than you'd
   expect. With it set, this server always receives full-level audio and playback volume is
   controlled purely on the receiving device.
3. If your server has a firewall, open AirPlay's ports to your LAN: `5000/tcp` (RTSP), `6001-6010/udp`
   (timing/control/data), and `5353/udp` (mDNS/Bonjour, for discovery).
4. Point `airplayPipe` in `config.json` at the same path as `pipe.name` above (defaults to
   `/tmp/shairport-sync-audio`, matching the example).
5. Start/restart `shairport-sync`, then restart this server. It spawns its own `ffmpeg` process to
   re-encode the pipe's raw PCM into a live MP3 stream, served at `GET /api/live/spotify` to any
   number of simultaneous listeners.

Then: AirPlay from your other device to this server (it'll show up under the `name` you set),
open the Live tab on the iOS 7 device, tap Listen.

## REST API

| Endpoint | Notes |
|---|---|
| `GET /api/status` | Library stats, server IPs/port |
| `GET /api/songs?limit=N` | Song list |
| `GET /api/artists`, `/api/artist/:id` | Artist list / detail |
| `GET /api/albums`, `/api/album/:id` | Album list / detail |
| `GET /api/search?q=` | Search across songs/artists/albums |
| `GET /api/stream/:id` | Audio stream, Range-aware |
| `GET /api/artwork/:id` | Album art, cached JPEG |
| `POST /api/rescan` | Re-scan the music folder |
| `GET /api/session-token` | Session token for `?st=` media URLs |
| `GET /api/live/spotify` | Live AirPlay relay stream (see above) |
| `GET /api/live/status` | `{ active, listeners }` for the live relay |

## Testing

```bash
npm test
```

Runs against a real instance on a local port with genuine cookie-based auth (not the login page),
covering the library scan, streaming (including Range requests and the FLAC transcode path), and
the auth-rejection behavior for media endpoints.

## Deeper technical background

`docs/ios7-audio-streaming-findings.md` and `docs/ios7-native-app-alternatives-findings.md` are
period-accurate research write-ups on iOS 7 / WebKit 537.51 HTML5 audio streaming quirks, and on
what's realistically achievable (jailbreak tools, native-app sideloading, Home Sharing/DAAP) if you
want to go further than a web app on one of these devices. Worth reading before you go chasing a
bug that turns out to be a known-era WebKit limitation rather than something in this code.

## License

[PolyForm Noncommercial 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0) — free for
personal, educational, and other noncommercial use. See `LICENSE`.
