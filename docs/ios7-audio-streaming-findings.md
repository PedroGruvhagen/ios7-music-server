---
name: ios7-audio-streaming-findings
description: Period-accurate Mobile Safari/AVFoundation HTML5 audio streaming research, cross-referenced against server.js/lib/streamer.js/public/js/app.js, for the iOS 7 / iPhone 4 playback skip-storm bug.
metadata:
  type: project
  run_id: ios7-playback-fix-20260909-221742-e215
  phase: 1
---

# iOS 7 / iPhone 4 skip-storm: streaming spec research + code audit

Written by Phase 1 of the `ios7-playback-fix` run. Covers: period-accurate documentation on
Mobile Safari / AVFoundation HTML5 `<audio>` streaming requirements (2006-2013), cross-referenced
against the actual current code with file:line citations, a ranked list of concrete deviations,
and the Chrome-emulation question. Phase 2 implements fixes; Phase 3 verifies against real
`journalctl` output and writes the completion report.

**Index:** [1. Method and a data-quality caveat](#1-method-and-a-data-quality-caveat) ·
[2. Period documentation findings](#2-period-documentation-findings-confirmed-vs-inference) ·
[3. Code deviations, ranked by plausibility](#3-code-deviations-ranked-by-plausibility-as-the-skip-storm-cause) ·
[4. The Ringer/Volume clue](#4-the-ringervolume-clue) ·
[5. Can Chrome emulate iPhone 4 / iOS 7 Safari's media stack?](#5-can-chrome-emulate-iphone-4--ios-7-safaris-media-stack)

## 1. Method and a data-quality caveat

Historical/spec research was delegated to a research subagent (model Sonnet 5, WebSearch/WebFetch)
tasked with finding period-accurate Apple/WebKit documentation and reliable secondary sources, and
explicitly tagging every claim `[CONFIRMED: source]` or `[INFERENCE: no period source found]`.
Section 2 below is a condensed version of its report; the tagging is preserved. Code
cross-referencing (section 3) and the Node.js-specific `keepAliveTimeout` research were done
directly against the files in this repo, citing file:line, and verified with a live command run
where possible rather than asserted from memory (see the `npm test` finding in 3.2, which was
actually executed, not assumed).

**Caveat on stability of citations:** `server.js`, `public/js/app.js`, and `lib/streamer.js` are
all currently dirty (uncommitted changes), for two distinct, separately-timed reasons.

1. Pre-existing at the start of this phase (per `.tasks/ios7-playback-fix.task.md:37-41`, the
   problem statement written before Phase 1 began): `server.js`'s auth-rejection branch already
   carried the `AUTH REJECTED for media request` diagnostic block, and `lib/streamer.js`'s
   `streamAudio()` already carried its own diagnostic logging (10 lines at the top of the
   function, `lib/streamer.js:19-28`, plus 1 more in the file-not-found branch, `:30`). Both were
   already deployed live and flagged as skip-storm diagnostics awaiting a `journalctl` capture,
   not something this phase introduced or that is unrelated to the bug; see section 3.2's citation
   of the `AUTH REJECTED` block below.
2. Landed mid-phase, after this research began (confirmed via `git diff` content):
   `server.js` gained a new per-request `console.log('REQ', ...)` line, and `public/js/app.js`
   gained an XHR-timeout/retry-UI patch inside `ajax()` and `loadLibrary()`. The task file
   (`.tasks/ios7-playback-fix.task.md:71-104`) confirms the source: this run's own orchestrator
   made these two specific edits directly while Phase 1 ran in the background, live-diagnosing a
   separate, already-identified bug (both real iPhone 4 units stuck on "Loading music library" due
   to a Cloudflare-tunnel/TLS routing issue, unrelated to the skip-storm this document covers).
   This is not a second autonomous run and not the project owner editing directly.

Line numbers below were re-verified against the working tree as of **2026-09-09T20:36Z**, after
all of the above landed. Phase 2 should re-grep for the cited functions rather than trust exact
line numbers blindly if further edits have landed since.

## 2. Period documentation findings (confirmed vs. inference)

### 2.1 Content-Length / chunked Transfer-Encoding
- Apple's own "Creating Video for Safari on iPhone" doc frames byte-range support as *the*
  critical server requirement and gives a `curl --range 0-99` test as the compliance check, but
  does not state a bare Content-Length requirement in those exact words.
  [CONFIRMED: developer.apple.com/library/archive/.../CreatingVideoforSafarioniPhone.html]
- Per the WHATWG HTML media spec (in force, unchanged in relevant part, across the iOS 6/7 era):
  if a resource's size is not known/bounded, `duration` must report `Infinity`; with no data
  loaded, `NaN`. This is the documented mechanism for a chunked/no-Content-Length response
  producing an unbounded/NaN duration client-side. [CONFIRMED (spec mechanism)]
- No period-accurate primary source was found stating outright that AVFoundation *refuses to
  play* (as opposed to mis-reporting duration for) chunked audio with no Content-Length.
  [INFERENCE: plausible given AVFoundation's general Range/size-probing behavior in 2.2, not
  itself confirmed]

### 2.2 HTTP Range-request behavior AVFoundation expects
- Apple's own doc states outright: **"HTTP servers hosting media files for iOS must support
  byte-range requests, which iOS uses to perform random access in media playback,"** with
  `curl --range 0-99` as the test. [CONFIRMED: developer.apple.com, same doc as 2.1]
- Steve Souders' April 2013 investigation (period-accurate, squarely in the iOS 6/7 window)
  documents the exact request pattern for HTML5 media on iOS: a minimal probe
  `Range: bytes=0-1` answered with `206 Partial Content`, a `bytes=0-[filesize-1]` request often
  terminated early by the client, and a separate ranged request for trailing container metadata,
  all issued by a distinct `AppleCoreMedia` user agent, not the Safari browser UA, on separate TCP
  connections. [CONFIRMED, period-accurate: stevesouders.com/blog/2013/04/21/html5-video-bytes-on-ios/]
- Multiple technical sources (not period-dated, but describing a WebKit-lineage mechanism that
  predates and postdates iOS 7) confirm that responding `200` instead of `206` to a Range request,
  or omitting `Accept-Ranges`/`Content-Range` correctly, causes Safari-family playback to fail
  outright, while Chrome/Firefox tolerate the deviation. [CONFIRMED for the mechanism, not
  period-dated: philna.sh/blog/2018/10/23/service-workers-beware-safaris-range-request/,
  stephencharlesweiss.com/safari-streaming-video/]

### 2.3 MIME-type strictness
- Apple's "Audio and Video Tag Basics" doc (same period generation, last substantively revised
  2012-12-13) lists supported iOS formats as: low-complexity AAC, MP3, **AIF**, WAVE, and
  baseline-profile MPEG-4 video. [CONFIRMED: developer.apple.com/.../AudioandVideoTagBasics.html]
- Ogg Vorbis was **never supported natively on iOS Safari** through the entire iOS lifetime up to
  Safari 18.4 (support arrived far later than iOS 7). [CONFIRMED via caniuse.com/ogg-vorbis]
- FLAC had **no native iOS decode support at all during the iOS 7 era.** [CONFIRMED as background
  fact of iOS format history, general secondary sourcing]
- No period-accurate primary source enumerating exact required `Content-Type` header strings
  beyond the format list above was found; the widely-cited `audio/x-m4a` vs `audio/mp4` MIME
  mismatch behavior is sourced only from non-period, non-Apple community reports. [INFERENCE for
  exact header strings; CONFIRMED only that AIF/WAVE/MP3/AAC are the native iOS format list]

### 2.4 Autoplay / user-gesture requirements
- Apple's own period doc ("iOS-Specific Considerations," part of the same guide) states
  outright: **"On iOS Safari, preload and autoplay are disabled... JavaScript `play()` and
  `load()` methods are inactive unless triggered by user action,"** for `<audio>`, `<video>`, and
  Web Audio alike. [CONFIRMED, period-accurate: developer.apple.com/.../Device-SpecificConsiderations.html]
- WebKit's own blog retrospectively confirms the rule predating and including iOS 7: a qualifying
  gesture means `.play()` is called **synchronously inside a direct handler** for
  `touchend`/`click`/`dblclick`/`keydown`; an indirect trigger (e.g. from another event listener's
  callback, or from a `setTimeout`) does **not** qualify, even if a real user gesture happened
  earlier in the call chain. [CONFIRMED, official WebKit source: webkit.org/blog/6784/new-video-policies-for-ios/]
- iOS 7 predates the Promise-based return value of `.play()`. No period source was found stating
  precisely whether a blocked non-gesture `.play()` call under iOS 7 fires an `error` event, is a
  silent no-op, or something else. [INFERENCE: Apple's own wording ("inactive") reads as a silent
  no-op rather than an `error` event, but this is inferred from phrasing, not confirmed by a direct
  statement of the failure mechanism]

### 2.5 Concurrent connection limits per host
- No period-accurate (2010-2013) primary source pinning an exact per-host connection limit for
  Mobile Safari was found; the commonly-cited Browserscope reference table is no longer live.
  General (non-iOS-specific, non-period-dated) sources describe 6 connections/host as the
  standard adopted broadly across that browser generation. [INFERENCE: plausible background, not
  iOS- or period-confirmed]

### 2.6 Keep-Alive / connection reuse for streamed media
- No period-accurate documentation was found describing iOS Safari's handling of long-held
  Keep-Alive connections for streaming media specifically. [Explicitly not found]
- This repo's own server runtime (Node.js `http.createServer`, not an iOS-side fact) is,
  however, directly checkable: Node's own official docs confirm `server.keepAliveTimeout`
  **defaults to 5000ms**. A Node.js core issue filed against exactly this default, closed as
  "not planned" (nodejs/node#59193), describes the resulting failure mode in the reporter's own
  words: **"Difficult-to-reproduce API failures and silent drops,"** and **"It took us over a
  year to diagnose a network issue caused by this silent but critical default"** with no server
  or client-side error message pointing at the cause.
  [CONFIRMED, current Node.js behavior: nodejs.org/api/http.html; CONFIRMED, direct quotation:
  github.com/nodejs/node/issues/59193]
  This is cross-referenced against actual server code in section 3.1 below.

### 2.7 Hardware mute/ringer switch effect on `<audio>` (the "Ringer vs Volume" clue)
- See section 4 below for the full discussion and code cross-reference.
- Multiple technical sources (a cited WebKit engineer's explanation reported secondhand, an
  open-source project's documentation, Apple Developer Forums) are consistent: **web content in
  Safari/WKWebView cannot set or query `AVAudioSession` category**: that control exists only for
  native apps. Safari's own default category for a plain `<audio>` element is described as
  "ambient," which by design is muted by the hardware ringer/mute switch. [CONFIRMED as a
  mechanism from non-period, non-Apple-primary sources: github.com/feross/unmute-ios-audio,
  developer.apple.com/forums/thread/24464]
- No period-accurate (2013) Apple/WebKit primary source states this mechanism in those exact
  terms for iOS 7 specifically. [INFERENCE for period-accuracy; the mechanism itself is
  consistently reported across multiple eras/sources]

### 2.8 Other iOS7-era quirks matching "error fires almost immediately, real hardware only"
- The `error` event + `MediaError.code` (`MEDIA_ERR_NETWORK`, `MEDIA_ERR_SRC_NOT_SUPPORTED`) is
  the standard, spec-defined mechanism (predates iOS 7) by which a Range/Content-Type/MIME
  mishandling in 2.1-2.3 would surface to `public/js/app.js`'s own error handler. [CONFIRMED,
  general mechanism: developer.mozilla.org/.../MediaError, html.spec.whatwg.org/multipage/media.html]
- No specific WebKit-bug-tracker-documented issue matching this exact symptom for the iOS 7
  timeframe was found. [Explicitly not found; see section 3 for the evidence-based ranking
  instead]

## 3. Code deviations, ranked by plausibility as the skip-storm cause

A key piece of evidence shapes this ranking: the bug reproduces on **all four** real surfaces
tested, including **real desktop Chrome on Mac** (Blink media stack, not WebKit/AVFoundation),
not just the three WebKit-family surfaces (Safari/Mac, iPhone Safari, iPhone Home Screen icon).
Any theory that depends on an AVFoundation- or WebKit-specific quirk **cannot**, by itself, explain
the real-Chrome reproduction. Theories that operate below/outside the browser's own media/codec
layer (TCP connection reuse, server-side auth logic, HTTP-level response codes) fit that
constraint; theories requiring WebKit-specific parsing or gesture-policy behavior do not, on their
own, and are ranked lower **as a sole explanation**, though they remain real, citable defects worth
fixing and may compound whichever mechanism causes the first error in a session.

### 3.1 [HIGH] Node.js `keepAliveTimeout` default (5000ms) never overridden. `server.js:513-533` (`start()`), `server.js:529` (`server.listen(...)`)

`server.js`'s `start()` function calls `server.listen(port, config.host, ...)` (`server.js:529`,
re-verified against the current working tree) with no
`server.keepAliveTimeout` or `server.headersTimeout` set anywhere in the file. Node's documented
default (`keepAliveTimeout: 5000`) closes an idle kept-alive socket 5 seconds after the last
response finishes; per nodejs/node#59193 (section 2.6), a client that reuses that socket right as
or after the server destroys it gets a **silent connection failure with no distinguishing error on
either side.**

This fits the observed pattern better than any WebKit-specific theory: it is browser-agnostic (a
raw TCP/HTTP-level issue, so it explains real-Chrome reproduction as well as real-Safari), and it
plausibly explains why a raw endpoint sweep or a fast automated test would **not** reproduce it:
neither naturally produces the >5s idle gap between requests that real interactive browsing
(loading artwork images, browsing lists, pausing between song choices) does before the `<audio>`
element's connection is reused for the next track. Directly verified on the machine running this
phase (`node --version`, `node -e "console.log(require('http').globalAgent.keepAlive, ...timeout)"`):
Node's global `http.Agent` is keep-alive by default with a 5000ms idle timeout on this runtime, so
`test/test_server.js` (section 3.2) *does* reuse connections. It fails to exercise this class of
bug not because it opens fresh connections, but because it fires its requests back-to-back with no
multi-second idle gap between them, so it never sits idle long enough to hit the server's 5000ms
`keepAliveTimeout` window in the first place. Not
independently verified against real hardware in this phase (no journalctl capture yet; that is
Phase 3's job); ranked highest because it is the only candidate that is simultaneously (a) a
confirmed, cited, currently-true fact about this exact codebase (the setting really is absent),
(b) mechanistically capable of an intermittent, silent, near-immediate connection failure, and (c)
consistent with the cross-browser + automation-immune reproduction pattern.

### 3.2 [HIGH] Auth-rejection path returns HTTP 200 `text/html` (the login page) for a failed media request. `server.js:478-495`

```js
if (!hasValidSession(req, earlyUrl)) {
  ...
  const html = renderLoginPage(null);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ... });
  res.end(html);
  return;
}
```

This branch applies to every request except a `POST /login` (handled just above it at
`server.js:473-476`), including `/api/stream/*` and
`/api/artwork/*`. An `<audio src>` pointed at a URL that returns `200 text/html` (an HTML login
page) instead of audio bytes will fail to decode essentially instantly, a textbook
`MEDIA_ERR_SRC_NOT_SUPPORTED`. The `?st=` token fallback (`isValidSessionToken` at
`server.js:315-322`, `hasValidSession` at `server.js:351-359`) was already added and is believed to close the main
cookie-less-media-request race described in the task's problem statement, but this branch itself
still has no defense-in-depth: any edge case that makes `isValidSessionToken` return false for a
media request (clock/process restart timing, a stale cached `?st=` token surviving past a session
secret rotation, multiple processes with divergent secrets, etc.) degrades silently into "serve
HTML disguised as a 200 success to a media element," which is as close to worst-case as an audio
failure mode gets.

**Direct evidence this phase actually gathered, not assumed:** `test/test_server.js` was run
(`node test/test_server.js`) as part of this phase's investigation. **It currently fails at Test 1
(static file delivery)** with `AssertionError: index.html body should contain app structure`,
because `makeRequest()` (`test/test_server.js:12-34`) never sends a cookie or `?st=` token, so
every request in that suite, including the Range-request assertions in "Test 7" that are supposed
to validate exactly the streaming mechanics in section 2.2 above, actually receives the login page
back. **This means the project's own automated test suite cannot currently verify streaming
correctness at all**: it silently tests against login-page HTML, not real audio bytes, for every
endpoint including `/api/stream/`. This is independent, directly-verified evidence (not
speculation) that automated checks in this repo have a structural blind spot for exactly this
failure mode, and it directly weakens confidence in the task's separately-reported "sweep of all
787 songs found zero failures" claim: the sweep script itself was not found in this repository, so
its authentication methodology (did it send valid cookies/tokens on every request? for the full
duration of a real run?) could not be verified here. If that sweep script also used a
single/short-lived valid credential across a long, and possibly slow, run, it faces the same
un-verified assumption.

Diagnostic logging already added (uncommitted) at `server.js:482-487` (`AUTH REJECTED for media
request`) targets exactly this branch, indicating it was already under live suspicion before this
phase began. Phase 3 should pull `journalctl` output specifically for these lines.

### 3.3 [MEDIUM] FLAC/OGG transcode path: `Transfer-Encoding: chunked`, no `Content-Length`, and total lack of Range-request support. `lib/streamer.js:105-166`, headers at `lib/streamer.js:140-145`

Already flagged and known per the task's problem statement. Confirmed as a genuine spec violation
per section 2.1-2.2: Apple's own documentation makes byte-range support the single most emphasized
server-side requirement for iOS media, and this branch never even inspects `req.headers.range`:
if AVFoundation issues its `bytes=0-1` probe against a FLAC/OGG track, the server ignores the
Range header entirely and returns `200` with unbounded chunked encoding, which section 2.2's
sources confirm is a hard-failure pattern for Safari-family clients (`200` where `206` was
expected). Ranked below 3.1/3.2 for **this specific bug** because the task states it was
"confirmed NOT to prevent playback in one live test," and because it cannot by itself explain
failures cascading through native-format (MP3/M4A) tracks, which the skip storm also affects.
Still a real defect Phase 2 must fix regardless (task's Phase 2 deliverables already mandate this).

### 3.4 [MEDIUM] `.aiff` is a MIME-mapped extension but is missing from the native-format allowlist. `lib/streamer.js:5-14` vs. `lib/streamer.js:16`

```js
const MIME_TYPES = { ..., '.aiff': 'audio/aiff', ... };   // line 11
const NATIVE_IOS7_EXTENSIONS = new Set(['.mp3', '.m4a', '.mp4', '.aac', '.wav']);  // line 16
```

Apple's own documentation (section 2.3) lists **AIF** as one of the natively iOS-playable formats,
alongside AAC/MP3/WAVE, but `NATIVE_IOS7_EXTENSIONS` omits `.aiff`, meaning valid AIFF files are
unnecessarily routed through the same broken chunked-transcode path as FLAC/OGG (section 3.3),
compounding that defect for the subset of the library that is AIFF. Scope-limited to however many
of the 787 library files carry a `.aiff` extension (not determined in this phase; Phase 3's sweep
should report a per-extension breakdown).

### 3.5 [LOW-MEDIUM] No concurrent-connection/host-pool tuning; artwork + stream requests share a host. `public/js/app.js` (`mediaUrl()` defined at line 34, called at lines 267, 394, 402, 433, 505, 547, 582, 636, 739 for both the active `/api/stream/` URL and artwork `<img>` sources across the artist/album/search rendering functions), `server.js` (no `Agent`/connection-limit configuration; plain `http.createServer`)

A real page-driven session fires off many concurrent `mediaUrl('/api/artwork/...')` image requests
to the same host as the active `/api/stream/` connection while browsing lists, on top of the
`ajax()` calls to `/api/songs`, `/api/artists`, `/api/albums`. Research (section 2.5) found no
period-accurate iOS-specific numeric per-host connection limit, so this is flagged as the weakest-
cited candidate on the list, included because the task explicitly asked for a look at
"a concurrent-connection or keep-alive issue", but per section 2.5 it should be treated as an
untested hypothesis, not a documented fact.

### 3.6 [LOW as a sole explanation, but likely a compounding factor] Auto-advance calls `.play()` from non-gesture contexts. `public/js/app.js:855-857` (`ended` handler) and `public/js/app.js:859-865` (`error` handler, `setTimeout` call at `:862-864`)

```js
audio.addEventListener('ended', function() {         // line 855
  playNext();                                          // line 856
});                                                     // line 857
audio.addEventListener('error', function(e) {          // line 859
  console.error('Audio playback error:', e);            // line 860
  setTimeout(function() {                                // line 862
    if (state.isPlaying) playNext();                      // line 863
  }, 2000);                                                // line 864
});                                                          // line 865
```

Per WebKit's own documented gesture-policy rule (section 2.4), a `.play()` call from a `setTimeout`
callback, or from any handler that isn't itself a direct, synchronous `touchend`/`click`/
`dblclick`/`keydown` handler, does not qualify as a user gesture on iOS/WebKit, even though the
*user's original* tap to start playback did. This is a real, citable defect for the WebKit-family
surfaces: once *any* error occurs on *any* track (whatever the true cause, 3.1, 3.2, or 3.3), the
entire rest of the auto-advance chain runs from non-gesture contexts and could be silently blocked
by this policy on Safari/iOS, which is consistent with "cascades through the whole library" once
started. Ranked lowest as a **sole** cause because Chrome's autoplay/Media-Engagement-Index policy
is documented to be materially more permissive about non-synchronous gesture chains than WebKit's
"must be synchronous inside the direct handler" rule, so gesture policy alone does not explain why
real Chrome/Mac (which should tolerate a `setTimeout`-triggered `.play()` once the user has
engaged with the page) reproduces the same cascading skip storm. Most likely role: an amplifier
that turns one bad track (from 3.1/3.2/3.3) into a cascade on WebKit-family surfaces specifically,
not the root cause on its own, and not sufficient to explain the Chrome reproduction by itself.

## 4. The Ringer/Volume clue

User observation: with the iPhone 4's physical side switch while music is stopped, the on-screen
volume HUD shows "Ringer"; while audio is (attempted to be) playing, it shows plain "Volume" with
no distinct name.

Per section 2.7, the mechanism this matches (the HUD label reflecting whichever audio
category/route is currently active) is a **standard, page-agnostic iOS system behavior**, not
something specific to this app or to a bug in it. The observation that the label ever changes to
"Volume" at all is actually informative in the other direction from how it might first read: it
indicates the OS *did* establish some form of active audio route/session for the `<audio>` element
at some point (otherwise the switch would presumably stay in its default "Ringer" state indicating
no active media route), which is mildly evidence **against** a theory where the media element never
gets far enough to attempt playback at all, and mildly evidence **for** a theory where playback
genuinely starts, then fails a couple of seconds in (matching 3.1's connection-reuse-on-buffering
theory, or 3.2/3.3's Range-handling theories, all of which allow an initial connection/response to
succeed before failing). No period-accurate source was found describing this HUD-label mechanism
in iOS-7-specific terms, and no code-level lever exists for it regardless: per section 2.7, web
content cannot set or query `AVAudioSession` category from Mobile Safari at all. **This is a real
observed clue worth keeping in mind, but per the task's own instruction not to over-index on it: it
does not point to a specific fixable line of code, and Phase 2 should not invent a stub "fix" for
it.** If Phase 3's `journalctl` capture coincides with a real-device reproduction, worth noting
whether the HUD state correlates with the skip timing, but that is observational, not something
this codebase can control.

## 5. Can Chrome emulate iPhone 4 / iOS 7 Safari's media stack?

**No, not with the fidelity needed to reproduce this class of bug.** This was researched, not
assumed:

Chrome DevTools' own official documentation states device mode is explicitly **"a first-order
approximation of how your page looks and feels on a mobile device"** and is explicit that **"you
don't actually run your code on a mobile device. You simulate the mobile user experience from your
laptop or desktop,"** further stating outright that **"there are some aspects of mobile devices
that DevTools will never be able to simulate"** (citing CPU architecture as its own example).
[CONFIRMED, official source: developer.chrome.com/docs/devtools/device-mode]

Device mode changes the reported viewport, device pixel ratio, User-Agent string, touch event
synthesis, and can apply network throttling, all **on top of** the same desktop Chrome
process, using Chrome's own native Blink/Chromium networking and media pipeline underneath. It
never launches or substitutes WebKit/AVFoundation. The official documentation does not contain a
single sentence stating "the media pipeline/codec support is not emulated" in those exact words;
that specific claim, while consistent with and a direct logical consequence of the documented
"approximation only, real hardware never simulated" principle, could not be found verbatim.
[INFERENCE for the exact wording; CONFIRMED for the general principle it follows from]

This is corroborated by the run's own observed evidence, not just the documentation: this bug
reproduces on **real desktop Chrome on the same Mac** (section 3's framing), meaning the
WebKit-vs-Blink distinction is not even the operative one here. The actually operative distinction,
per the task's own framing, is that Chrome **DevTools automation** does not reproduce it while
manually-driven real Chrome does. Device/media-stack emulation fidelity is therefore not the
correct explanation for that specific gap at all (device emulation was never going to differ from
real Chrome's own media stack, since both run the identical Blink engine); the automation-vs-real-usage gap is far better explained by section 3.1/3.2's theories (automation likely does not
reproduce the idle-then-reuse connection pattern, and/or authenticates differently than a real
browsing session does), which is exactly why they are ranked highest above. In short: Chrome
device emulation cannot validate anything about AVFoundation-specific behavior (sections 2.2-2.4,
3.3, 3.6) regardless of iPhone UA/viewport presets, but it was also never going to explain the
real-Chrome-vs-automated-Chrome gap either, since that gap has nothing to do with WebKit at all.
