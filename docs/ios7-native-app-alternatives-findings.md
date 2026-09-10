---
name: ios7-native-app-alternatives-findings
description: Jailbreak feasibility and native/sideloading client alternatives for real iPhone 4 / iOS 7.1.2 units in 2026, researched against this project's own REST API and its already-confirmed TLS/root-CA limitation.
metadata:
  type: project
  run_id: ios7-playback-fix-20260909-221742-e215
  phase: 4
---

# iOS 7 / iPhone 4: native-app and jailbreak alternative-path findings

Written by Phase 4 of the `ios7-playback-fix` run, as a standalone research deliverable independent
of the web-app bugfix phases (1-3, see `lore/ios7-audio-streaming-findings.md`). Answers two
questions the project owner asked: (A) is jailbreaking these two real iPhone 4 / iOS 7.1.2 units realistic in
2026, and (B) is there an existing native client (Apple's own Home Sharing, or an old third-party
app) that could sidestep needing this project's own web client entirely, or that could be pointed
at this project's REST API. Nothing in server.js, lib/streamer.js, public/js/app.js, or any
infra config was touched; this is research only.

**Index:** [1. Method and caveats](#1-method-and-caveats) ·
[2. Task A: jailbreak feasibility findings](#2-task-a-jailbreak-feasibility-findings) ·
[3. Task B: native/sideloading alternative findings](#3-task-b-nativesideloading-alternative-findings) ·
[4. Ranked list of all realistic paths](#4-ranked-list-of-all-realistic-paths-most-feasible-first) ·
[5. Proposal for the project owner](#5-proposal-for-the-project-owner-not-implemented)

## 1. Method and caveats

Every load-bearing factual claim below was gathered via live WebSearch/WebFetch calls and, where
noted, direct `curl` requests made from this machine this session (2026-09-10), not recalled from
training data. Every claim is tagged `[CONFIRMED: source]` (a source actually retrieved this session
says this, or it was directly observed via a live request) or `[INFERENCE: reasoning]` (a reasonable
conclusion built on confirmed facts, or on general/well-established background knowledge, but not
itself stated verbatim by a retrieved source; the reasoning given for each is what should be judged,
not the tag alone). Where a search produced ambiguous or contradictory results, both sides are
reported rather than picking one.

Two tool-level caveats worth flagging up front:
- `WebFetch` silently upgrades `http://` URLs to `https://` and returns TLS errors as its own error
  string (e.g. "certificate has expired") rather than telling me what the *plain-HTTP* endpoint
  does. Where this mattered (Cydia repos, which real 2013-era clients hit over plain HTTP), I
  cross-checked with a direct `curl` call from Bash instead, and note which method produced which
  result.
- Several sources (`theapplewiki.com`, `checkra1n.com`) returned `403 Forbidden` to `WebFetch`
  directly; where this happened I either used a different retrievable page/domain for the same fact
  or relied on `WebSearch`'s synthesized summary of that page, flagged accordingly below.

## 2. Task A: jailbreak feasibility findings

### 2.1 What actually targeted iOS 7.1.2 on iPhone 4

- **evasi0n7**: untethered jailbreak for iOS 7.0-7.1 (all devices except Apple TV), released
  2013-12-22, iPhone 4 included in its device list. **Apple's iOS 7.1 release patched every
  exploit evasi0n7 relied on**, so it does not work on 7.1.2 at all.
  [CONFIRMED: theapplewiki.com/wiki/Evasi0n7 (via WebSearch synthesis), corroborated by
  redmondpie.com/jailbreak-ios-7.1-update-apple-patches-evasi0n7-jailbreak/]
- **Pangu** (the original Pangu Team tool, not the modern "Pangu8" rebrand of an unrelated Chinese
  search engine): untethered jailbreak first released 2014-06-23 for iOS 7.1-7.1.x, explicitly
  listing iPhone 4 in its supported-device list, and updated within days of Apple's 2014-06-30
  release of iOS 7.1.2 to add full 7.1.2 support on both Windows and Mac.
  [CONFIRMED: iclarified.com/42008/pangu-untethered-jailbreak-confirmed-working-on-ios-712,
  iphonewired.com/jailbreak/411135/]
- **p0sixspwn**: targets iOS 6.1.3-6.1.6, not 7.1.2. Not relevant to this device's actual firmware.
  [CONFIRMED: theapplewiki.com/wiki/P0sixspwn via WebSearch synthesis]
- **sn0wbreak**: a semi-tethered jailbreak built specifically for iPhone 4 (GSM, Rev-A, and CDMA
  variants) on iOS 7.0-7.1.1, explicitly credits geohot's **limera1n** bootrom exploit, requires a
  host running Mac OS X 10.7+. Its own README lists 7.1.2 support as GSM-only ("iOS 7.1.2 (11D257)
  (iPhone3,1 (GSM) only at the moment)"), which is the exact firmware/variant that matters for these
  two real devices only if they are the GSM model; Rev-A and CDMA units are covered up to 7.1.1 but
  not confirmed for 7.1.2 by this same README. Its GitHub repo's last substantive activity is
  2014-2015 (a v1.2.1 release whose own changelog says "Changing domain"); it is a real,
  historically-working, iPhone-4-specific tool but is dormant/unmaintained today.
  [CONFIRMED: github.com/sn0wbreak/sn0wbreak, fetched directly this session]
- **limera1n / A4 bootrom**: limera1n is a bootrom-level exploit (geohot) covering "all A4 and below
  devices," with iPhone 4 GSM/CDMA as its newest covered hardware. A bootrom exploit is permanently
  unpatchable in software because it lives below the point where iOS itself can be updated to fix
  it. [CONFIRMED: github.com/ExploitsJB/limera1n, theiphonewiki.com/wiki/Limera1n via WebSearch
  synthesis] This is the historical basis for sn0wbreak above, but by itself limera1n only enables
  DFU-mode-level access/tethered-boot; the untethered iOS-7.1.2-era jailbreaks (Pangu, and the
  actively-maintained tools below) layer their own separate userland/kernel exploits on top of, or
  independent of, this bootrom-level access.

**checkm8/checkra1n and the A4 question, verified rather than assumed:** checkra1n's own current
site states it is a "Jailbreak for iPhone 5s through iPhone X" (A7-A11), with no mention of the A4
chip or iPhone 4 anywhere on the page [CONFIRMED, direct fetch this session: checkra.in]. Secondary
sources (AppleDB/wiki, via WebSearch synthesis) describe a slightly wider historical range down to
A5 (iPhone 4S, iPad 2, iPad mini 1). Both the primary source and every secondary source agree on one
point: **the A4 chip (iPhone 4) is below checkm8/checkra1n's floor and is not covered by it under
either version of the claimed range.** [CONFIRMED via convergence of checkra.in + AppleDB/wiki
summaries] checkm8 is a bootrom exploit like limera1n, but a different, later one specific to the
A5-through-A11 SecureROM; it does not extend backward to A4.

### 2.2 Currently-maintained tools that DO cover iOS 7.1.2 on iPhone 4 today

Beyond the historical tools above, two actively-maintained, modern projects specifically target
this exact firmware range and are confirmed reachable right now:

- **Aquila** (`github.com/staturnzz/aquila`): "iOS 4.3 - 7.1.2 untethered jailbreak for all
  [32-bit] devices." iPhone 4 is a 32-bit device inside that stated range (not name-checked
  individually in the README, but unambiguously covered by the version range given the well-known
  32-bit-only nature of iOS 7.1.2-era A4/A5 hardware). Requires a **64-bit Windows or macOS**
  host computer (an ordinary current machine, not a legacy one). Its release history shows active
  maintenance, with the most recent release (v2.1.1) fixing an AppSync-related install bug, and its
  2.1 release changelog explicitly lists "Added support for iOS 4.3.x and iOS 7.0-7.1.2 (32bit
  only)" as a deliberate, named feature. [CONFIRMED, direct fetch this session: github.com/staturnzz/aquila and
  github.com/staturnzz/aquila/releases] The GitHub API confirms the calendar dates directly
  (`api.github.com/repos/staturnzz/aquila/releases`): 1.0 published 2025-06-07, 2.0 published
  2026-03-02, 2.1 published 2026-03-09, 2.1.1 published 2026-03-22, with the repo itself last pushed
  2026-03-22 and not archived [CONFIRMED, direct fetch this session].
- **Lyncis** (`lyncisjb.com`): "Untethered WebKit Jailbreak for iOS 7.1-7.1.2 (32bit)." This is a
  **browser-only** exploit: the device navigates to the site in Mobile Safari itself, taps
  "Jailbreak," and the device reboots jailbroken. No host computer is required at all, which
  sidesteps the "will the tool's binary even run on a current desktop OS" problem entirely, because
  there is no desktop binary. [CONFIRMED, direct fetch this session: lyncisjb.com, corroborated by
  ios.cfw.guide/using-lyncis/ (github.com/cfw-guide/ios.cfw.guide project, a currently-maintained
  modding-guide wiki)] I independently verified the domain is live with a raw `curl`
  request this session (`HTTP 200`), separate from the WebFetch summary, specifically to rule out a
  parked-domain false positive (see 2.3 for why that check matters).

Both tools are **untethered** (the exploit runs once; the device boots normally and stays
jailbroken afterward), and both appear on `ios.cfw.guide`, a currently-maintained community wiki
(its source, `cfw-guide/ios.cfw.guide`, is a live GitHub project), not an abandoned historical page.
However, the wiki's own pages disagree on Aquila's exact ceiling. The per-device firmware-selection page
for iPhone 4 (`ios.cfw.guide/get-started/iPhone-4.html`) lists exactly two iOS 7 rows: **7.1-7.1.2
routes to Lyncis**, and Aquila is listed only up to **7.0.6**
[CONFIRMED, direct fetch this session]. Aquila's own install page on the same wiki
(`ios.cfw.guide/installing-aquila/`), its GitHub repo description ("iOS 4.3 - 7.1.2 untethered
jailbreak"), and its 2.1 release changelog ("Added support for iOS 4.3.x and iOS 7.0-7.1.2 (32bit
only)") all claim 7.1.2 support [CONFIRMED, direct fetch this session]. This is an internal
inconsistency on `ios.cfw.guide` itself, not a fabrication on this document's part: the
per-device page under-states Aquila's own claimed ceiling. Given Aquila's GitHub repo and release
notes are the primary source and agree with each other, this document treats Aquila as covering
7.1.2 as claimed, while flagging that the wiki's per-device page does not corroborate that specific
number.

### 2.3 Site/tool reachability in 2026 (live-checked this session, not assumed)

Directly verified via `curl` from this machine (raw HTTP/HTTPS status, no WebFetch upgrade):

| URL | Result | Meaning |
|---|---|---|
| `http://evasi0n.com` | `200`, but content is a domain-squatted online-gambling review site, not the original evad3rs page | Original evasi0n site is dead/repurposed [CONFIRMED, direct fetch this session] |
| `http://evasi0n7.com` | `000` (no connection) | Dead [CONFIRMED, direct curl this session] |
| `https://en.pangu.io` | `000` (no connection) | Dead [CONFIRMED, direct curl this session] |
| `https://www.pangu8.com` | `200` at the network layer, but `403` to content-fetching (likely anti-bot WAF) | Reachable but I could not verify what it currently shows or whether it is the genuine original Pangu team site; **unconfirmed**, do not treat as a trustworthy download source without further manual verification |
| `https://github.com/staturnzz/aquila` | `200`, content matches an active jailbreak project | Alive [CONFIRMED] |
| `https://lyncisjb.com` | `200`, content matches the jailbreak tool described above | Alive [CONFIRMED] |
| `https://cydia.akemi.ai` (AppSync Unified's maintainer repo, per WebSearch) | `HTTP 522` via WebFetch, and a full connection timeout (`000`) via direct `curl` | **Dead/unreachable right now** [CONFIRMED, direct fetch + curl this session] |
| `http://apt.saurik.com/` | `200`, directory index confirmed (Cydia's own core-package host) | Alive [CONFIRMED, direct fetch + curl this session] |
| `http://apt.thebigboss.org/repofiles/cydia/` (current recommended BigBoss default-repo URL, per multiple 2025-2026 how-to guides found via WebSearch) | Plain-HTTP `curl`: `403 Forbidden` (server responds, but blocks this request/lists nothing); HTTPS via WebFetch: `certificate has expired` | Server is up but in a degraded state either way; **not confirmed working as a real Cydia source today**, and its HTTPS certificate is confirmed expired this session [CONFIRMED for both individual observations; the underlying cause of the 403 over plain HTTP is not confirmed] |

Third-party mirror/download sites for the historical tools (`tweak-box.com`, `techglobex.net`,
`softradar.com` and similar) turned up repeatedly in search results but were not fetched or
verified for trustworthiness in this session; these are exactly the kind of unofficial
repackaged-binary sites that carry real malware risk, and none is treated as a citable source here.
[Explicitly not verified; flagged rather than silently used]

### 2.4 Does jailbreaking already-installed 7.1.2 need Apple's signing servers?

**No, not for the jailbreak step itself, and the underlying mechanism was checked rather than
assumed** (the tool-specific conclusion below is the well-grounded inference noted at the end of
this section). Apple's own
signing infrastructure (SHSH blobs verified against Apple's TSS/"signing" servers) gates
**installing/restoring a specific firmware image via IPSW**: "Updates and restores can only be
completed if the version of iOS is being signed by Apple's TSS Signing Server," and downgrading
requires "compatible SHSH blobs... an unsigned IPSW file... and the device placed in DFU mode."
[CONFIRMED: drfone.wondershare.com/ios-downgrade/how-to-uses-shsh-blobs.html,
cellularnews.com/mobile-operating-systems/how-to-downgrade-ios-using-shsh2-blobs/, both describing
the same TSS/SHSH mechanism consistently] None of Aquila, Lyncis, Pangu, sn0wbreak, or evasi0n7 are
installing a new firmware image at all: they run a userland/kernel exploit chain against the OS the
device is **already booted into**, which is a functionally different operation from a restore. No
single source explicitly states "Aquila/Lyncis do not contact Apple's servers" in those words, so
the specific claim that these particular tools skip Apple's infrastructure is
**[INFERENCE: well-grounded]**, built on the confirmed general SHSH/TSS mechanism above plus the
confirmed fact that these two devices are not being restored to a different firmware, only
jailbroken in place. This distinction matters directly for these two real devices: Apple has long
since stopped signing iOS 7.1.2 for **fresh restores**, but that is irrelevant here since both units
are already running 7.1.2 in production.

### 2.5 Cydia's own repository ecosystem in 2026

Mixed, and confirmed via live checks rather than assumed dead or alive wholesale:
- `apt.saurik.com` (hosts Cydia's own installer packages) is confirmed alive and serving a
  directory index today [CONFIRMED, section 2.3].
- The default BigBoss repo, which ships pre-added on every jailbroken device via Cydia, is in a
  confirmed degraded state: expired HTTPS certificate, and the plain-HTTP path (which is what an
  actual iOS-7-era Cydia client would use, since Cydia predates enforced HTTPS-only repos) returned
  `403` rather than a Packages listing when checked directly [CONFIRMED, section 2.3]. Whether a
  real Cydia client (with different request headers than `curl`) succeeds where this check did not
  is **not confirmed either way**.
- **AppSync Unified**, the specific tweak needed to install unsigned/ad-hoc/expired-signature `.ipa`
  files (the mechanism that would matter most for task B's sideloading paths below), is distributed
  from source at `github.com/akemin-dayo/AppSync` ("Unified AppSync dynamic library for iOS 5 and
  above," so it does cover iOS 7) [CONFIRMED: WebSearch result summary of that repo], but its
  associated Cydia repo (`cydia.akemi.ai`, the URL commonly given for adding it inside Cydia) is
  confirmed dead right now (section 2.3). A live substitute exists: the GitHub Releases API for that
  same repo (`api.github.com/repos/akemin-dayo/AppSync/releases`) returns release `116.0`
  (published 2025-01-20), including an `iphoneos-arm` `.deb` artifact (the armv7 build correct for
  iPhone 4's 32-bit A4 CPU) alongside an arm64 build for newer devices
  [CONFIRMED, direct fetch this session]. Whether that specific `.deb` actually installs cleanly via
  Cydia's "install local .deb" path (or an equivalent sideloading route) on a real 7.1.2 device was
  **not tested against a device this session**: the distribution point exists and is reachable, but
  the install itself is unconfirmed either way.
- Cydia's own store/purchasing backend was permanently shut down in December 2018 (unrelated
  PayPal-fraud vulnerability); Saurik stated at the time that free package downloads via existing
  repos would keep working, which is broadly consistent with `apt.saurik.com` still being up today.
  [CONFIRMED: wccftech.com/cydia-store-for-jailbroken-devices-is-officially-shutting-down-heres-what-you-should-know/,
  idownloadblog.com/2018/12/16/cydia-store-shut-down-faq/]

### 2.6 Honest realistic-feasibility verdict for these two specific devices

**Jailbreaking is realistically achievable in 2026**, but not turnkey. The correct, currently-live
tools are **Aquila** (github-hosted, actively released, needs an ordinary modern 64-bit computer)
or **Lyncis** (a live website, needs nothing but the device's own Safari), not the historical
evasi0n7 (patched, and its domain is now a gambling site anyway) or the original Pangu binaries
(their canonical site's authenticity could not be confirmed this session; third-party mirrors carry
unverified trust). The jailbreak step itself does not depend on Apple's signing servers being
reachable or willing to sign anything (section 2.4). What is genuinely fragile is everything
**downstream** of the jailbreak: the default BigBoss repo is in a visibly degraded state, and
AppSync Unified's maintainer-listed Cydia repo (`cydia.akemi.ai`) is confirmed dead, though its
GitHub Releases page is a confirmed-reachable substitute (section 2.5). So getting from
"jailbroken" to "able to install an arbitrary sideloaded app" comes down to one concrete, checkable
remaining step: whether that GitHub-hosted `.deb` actually installs on a real 7.1.2 device, which is
untested rather than unresolved-and-unreachable.

## 3. Task B: native/sideloading alternative findings

### 3.1 Home Sharing / DAAP: does a hobbyist server actually work with the stock Music app?

**No: this is a confirmed dead end, not an ambiguous one.** `owntone-server` (the current name for
`forked-daapd`) documents outright: **"Apple Home Sharing cannot be supported by forked-daapd"**,
and separately, **"Apple does not allow AirPlay receiver apps"** on iOS, which forecloses the
obvious workaround. [CONFIRMED: github.com/owntone/owntone-server (README, fetched via WebSearch
synthesis of the 24.1-27.4 README revisions), corroborated by community discussion at
community.home-assistant.io/t/you-need-to-try-forked-daapd-.../266407] The underlying reason: Apple
changed its DAAP implementation starting with iTunes 7.0 specifically to prevent third-party
clients/servers from interoperating with it, and has only ever licensed the DAAP spec itself to
selected partners (Roku is the example given). [CONFIRMED: WebSearch synthesis of
discussions.apple.com/thread/4967024 and github.com/sfeakes/forked-daapd README] The practical
consequence stated by the owntone-server project itself: the *only* way to listen to an
owntone-server library on an iOS device today is to open the DAAP network stream in a **third-party
player app** (VLC, MPoD) directly, not through Apple's native Music app or its Home Sharing feature
at all. [CONFIRMED: same owntone-server README] This means the hoped-for "zero custom code on the
iPhone side" option **does not exist**: Apple's Music app will not talk to a non-Apple/non-iTunes
DAAP host regardless of what the hobbyist server implements.

### 3.2 Old iOS-era clients that could theoretically point at this project's API

- **iSub** (Subsonic client): source is on GitHub in multiple lineages
  (`github.com/aaronbrethorst/iSub-Music-Streamer`, the original 2010-era "final bug fix" release,
  which states in its own README "All code... copyright Ben Baron 2010, all rights reserved";
  `github.com/jamescochran/iSub` and `github.com/einsteinx2/iSub`, both described in search results
  as GPLv3-licensed Swift rewrites). **These two licensing claims are inconsistent with each other
  across forks** and I did not resolve the discrepancy further this session
  [flagged: INFERENCE that the licensing differs by fork/era, not independently reconciled]. I found
  no archived, installable old iOS-7-compatible `.ipa` binary for iSub specifically (not searched
  for on archive.org directly, only inferred from the general "Legacy iOS App Archive" existing;
  see 3.2 VLC entry below). iSub speaks Subsonic's own REST API, which is a completely different,
  independently-documented contract from this project's bespoke `/api/songs`, `/api/stream/:id`
  etc. (server.js:131-192). Pointing iSub at this project would require **real code changes**
  (rewriting its network layer to this project's endpoint shapes and its cookie/`?st=` auth scheme,
  server.js:111-118, server.js:315-359), not configuration. [INFERENCE: based on directly reading
  this project's own API shape plus the well-established fact that Subsonic defines its own
  separate REST contract; I did not open iSub's source to confirm exactly how hard-coded its
  networking layer is]
- **VLC for iOS**: old versions genuinely existed for the right era; the VideoLAN project's own
  archive lists versioned builds from 2.1.0 (2013-09-11) through 2.3.0 (2014-05-12)
  [CONFIRMED: get.videolan.org/vlc-iOS/, via WebSearch], and VLC was pulled from the App Store
  around the iOS 8 launch (September 2014) before reportedly returning in 2015
  [CONFIRMED: techcrunch.com/2015/02/16/vlcs-media-player-for-ios-sneaks-back-into-the-app-store/].
  A 2.1.1-for-iOS-5.1 build is preserved on the Internet Archive, and a broader
  **"Legacy iOS App Archive"** collection (`archive.org/details/legacyiosapparchive`, 702 files) is
  explicitly described as "IPA files that can be installed on jailbroken legacy iOS devices with
  AppSync installed" [CONFIRMED, direct fetch this session], directly connecting to section 2's
  jailbreak findings: this only becomes usable once AppSync Unified is actually working (still
  untested on-device per 2.5). VLC genuinely supports opening a raw network stream by URL (HLS/MMS/RTSP, and
  general HTTP per VideoLAN's own "Streaming for the iPhone" wiki page)
  [CONFIRMED: wiki.videolan.org/Documentation:Streaming_HowTo/Streaming_for_the_iPhone], so pointing
  an old VLC build at one specific `/api/stream/:id?st=<token>` URL from this project would be
  **configuration only, zero code changes**, but VLC has no concept of this project's song list,
  artist/album browsing, or search (server.js:131-182); it could only ever play one manually-entered
  URL at a time, not replace the browsing UI.
- **"Retune"/TunesRemote as an iOS DAAP client**: **could not be verified as a real thing matching
  the task's description.** The only "TunesRemote" found is explicitly an **Android** DACP/iTunes
  remote-control app (`dacp.jsharkey.org`), not iOS, and not a streaming client. The only "Retune"
  GitHub account found (`github.com/retune-app`) is an unrelated, currently-active AI
  voice-cloning affirmation app with no connection to DAAP, Subsonic, or iOS-7-era software.
  [Explicitly not found; flagged rather than asserted]. This path is dropped from the ranked list
  below rather than padded in.
- **Old Plex iOS app**: legacy binaries are genuinely preserved (e.g. "Plex 8.45" on
  archive.org, and active Plex-forum threads about restoring older iOS builds via iMazing or
  Charles Proxy specifically to keep working on old iOS versions)
  [CONFIRMED: archive.org/details/plex-8.45_202505, forums.plex.tv threads cited in search results].
  However, Plex's client talks to **Plex Media Server's own protocol and Plex.tv-issued
  authentication**, not a generic pluggable REST API; pointing an old Plex client at this project
  would mean running an actual Plex Media Server instance instead of this project's own server, a
  fundamentally different proposal (replace the server, not adapt the client), and out of this
  research task's scope. [INFERENCE: based on general, well-documented Plex architecture; not
  independently verified against a specific old Plex iOS binary's source this session]

### 3.3 Building and sideloading a NEW native app today

**Modern Xcode cannot target iOS 7 at all, verified rather than assumed.** The current shipping
Xcode (Xcode 27) enforces a deployment-target floor of **iOS 15**; the source states "the new floor
is iOS 15" and "the compiler stops with the error above instead of building for an OS Apple no
longer supports."
[CONFIRMED: bleepingswift.com/blog/deployment-target-supported-range-xcode-27,
corroborated by github.com/DataDog/dd-sdk-ios/issues/2978 ("Support Xcode 27: raise minimum iOS
deployment target to 15")] This floor has been rising steadily and is not new to this year: Xcode 12
dropped iOS 8 (floor iOS 9), Xcode 14 dropped everything below iOS 11, and by Xcode 13 the
deployment-target dropdown's own listed range was already "15.0 to 9.0"
[CONFIRMED: developer.apple.com/forums/thread/691201, developer.apple.com/forums/thread/711222,
via WebSearch synthesis of Apple Developer Forums threads].

**Legacy toolchain that would be required:** community-reported developer-forum threads describe
that **Xcode 8.x** (2016-era) still allows a deployment target of iOS 7.0 if typed in manually
(it is not in that version's preset dropdown, whose lowest listed preset is iOS 8, but the raw
`IPHONEOS_DEPLOYMENT_TARGET` build setting accepts 7.0 and produces an app Apple's own review
process was reported to have accepted at the time)
[CONFIRMED via named developer-forum reports, not an official Apple specification document:
developer.apple.com/forums/thread/52848, developer.apple.com/forums/thread/50410]. Xcode 8.x itself
requires an old macOS host (contemporary with El Capitan/Sierra), which is itself an increasingly
hard-to-source legacy environment, though not independently re-verified in this session beyond the
forum reports cited.

**Obstacles beyond the compiler, all real and stacking on top of each other:**
- A free Apple Developer ("personal team") signing certificate issues provisioning profiles that
  expire after **7 days**, capped at 3 apps signed at once
  [CONFIRMED: news.ycombinator.com/item?id=36023322, dev.to/1_king_0b1e1f8bfe6d1/..., both describing
  the same current free-account limits], meaning a sideloaded app must be re-signed and reinstalled
  roughly weekly forever, or a paid Apple Developer Program membership used instead for year-long
  certificates [CONFIRMED, same sources].
- This project's own README **already independently confirmed** (not something this phase is
  asserting fresh) the general mechanism: "Outdated root SSL/TLS certificates on iOS 7 cause HTTPS
  connection failures to modern web services" (README.md:36). This project's own task history
  documents the same mechanism applied to a specific, live instance of it in this exact deployment:
  "iOS 7's outdated root CA store cannot reliably do modern TLS to Cloudflare's edge"
  (`.tasks/ios7-playback-fix.task.md:93-94`). Apple's own code-signing/provisioning-profile
  validation and App Store infrastructure is exactly the same kind of modern-TLS-only HTTPS
  endpoint, and general sources on iOS 7 SSL failures describe the identical root cause (outdated/
  expired root CAs, naming "Let's Encrypt IdenTrust DST Root CA X3" as one concrete expired case)
  causing App-Store-adjacent install/certificate failures on old iOS
  [CONFIRMED for the general root-cause mechanism: blog.jjhayes.net/wp/2021/11/13/fix-old-iphone-4-4s-ios-7-ssl-certificate-errors/].
  Whether the *specific* Apple provisioning-validation endpoints a freshly-sideloaded app would need
  to reach are affected was not independently tested against a live device this session
  [INFERENCE: strongly suggested by the confirmed general mechanism and this project's own
  already-confirmed instance of it, not separately re-confirmed for Apple's own servers
  specifically].

### 3.4 Honest realistic-feasibility verdict, Task B

Home Sharing to a hobbyist DAAP server is a **confirmed non-starter**, not a maybe. Adapting an old
open-source client is possible in principle but every concrete candidate found either needs real
code changes (iSub/Subsonic), only supports a single manually-entered stream URL with no library
browsing (VLC), or requires replacing this project's server entirely with different server software
(Plex). Building a brand-new native app is blocked by the current Xcode floor and would require
reviving a decade-old toolchain, then very likely re-hitting this project's own already-confirmed
iOS-7 TLS/root-CA problem on Apple's own infrastructure this time, plus a recurring weekly
re-signing burden on a free account.

## 4. Ranked list of all realistic paths, most feasible first

Each entry states what it depends on and whether that dependency is confirmed alive, confirmed
dead, or unconfirmed, per the findings above.

1. **Jailbreak via Aquila** (github.com/staturnzz/aquila): depends on a modern 64-bit
   Windows/macOS host (confirmed always available today) and GitHub itself (confirmed alive,
   actively releasing). Does not depend on Apple's signing servers (section 2.4). No re-signing
   cycle, no Xcode. Result: a jailbroken device with Cydia, not yet a streaming solution by itself.
2. **Jailbreak via Lyncis** (lyncisjb.com): depends on that single website (confirmed alive via
   direct curl this session) and the device's own Safari; needs no computer at all. Slightly lower
   than Aquila only because it is a single website (one point of failure) rather than a
   version-controlled, actively-released GitHub project.
3. **Cydia's own core packages via apt.saurik.com**: confirmed alive; needed as the base for
   anything installed post-jailbreak (Cydia itself, AppSync, etc.).
4. **VLC (old build) as a manual single-track network-stream player, pointed at this project's
   `/api/stream/:id?st=<token>` URLs**: configuration only, zero code changes to the client;
   depends on (a) one of the jailbreaks above, (b) AppSync Unified actually working to install an
   unsigned old `.ipa`, where the maintainer's Cydia repo (cydia.akemi.ai) is **confirmed dead**
   but a live substitute exists (the GitHub Releases artifact, section 2.5, untested on-device), and
   (c) locating a usable old VLC `.ipa` (the "Legacy iOS App Archive" on archive.org is a
   confirmed-existing candidate source, content not individually verified for VLC by filename this
   session). Real, with one confirmed-reachable-but-untested dependency rather than a fully blocked
   one.
5. **BigBoss default Cydia repo**: confirmed degraded (expired HTTPS cert; plain-HTTP check
   returned 403 rather than a package listing) rather than confirmed dead; usable only if a real
   Cydia client succeeds where this session's raw checks did not, which is unconfirmed either way.
6. **New native app with a legacy Xcode 8.x toolchain on an old macOS host**: technically
   documented as possible for the compile step (community forum reports, not an Apple spec page),
   but stacks three separate confirmed/likely fragile dependencies: sourcing a decade-old macOS+Xcode
   environment, a recurring 7-day free-account re-sign cycle (or a paid account), and probable
   collision with this project's own already-confirmed iOS-7 TLS/root-CA failure mode when the
   device itself talks to Apple's modern-TLS provisioning infrastructure (inference, not directly
   retested here). Ranked below the jailbreak paths because it requires reviving more independently
   fragile infrastructure (an obsolete developer toolchain) for a payoff (a "native app") that,
   confirmed in 3.1, cannot even use Apple's own Home Sharing shortcut and would just be reimplementing
   this project's existing web client as a compiled app.
7. **Adapting iSub (Subsonic client) to this project's API**: source available, but requires real
   code changes (different REST contract), and no verified iOS-7-compatible old binary was found;
   would additionally need one of the sideloading paths above (or the legacy-Xcode path) to get onto
   the device at all.
8. **Home Sharing to a hobbyist DAAP server (owntone-server or similar)**: **not ranked as a viable
   path at all.** Confirmed dead end per section 3.1 (Apple explicitly blocks third-party DAAP
   interoperation with Home Sharing since iTunes 7.0). Listed here only to state explicitly that it
   was investigated and ruled out, not omitted by oversight.
9. **Old Plex client pointed at this project**: not a real "point an old client at this project's
   API" path at all once you account for Plex's own server protocol; would mean running Plex Media
   Server instead of this project, a different project. Not pursued further.
10. **"Retune"/TunesRemote as an iOS DAAP client**: dropped entirely: could not verify this exists
    as described (TunesRemote is Android-only; "Retune" resolves to an unrelated modern app). Not
    included as a real path; flagged as unconfirmed rather than silently omitted.

The historical evasi0n7 and original-Pangu-binary routes are not included as independent ranked
entries above item 1-2: evasi0n7 is confirmed not to work on 7.1.2 at all (section 2.1), and the
original Pangu site's current authenticity could not be confirmed this session (section 2.3), so
Aquila/Lyncis are the correct 2026-current recommendation for the jailbreak step specifically.

## 5. Proposal for the project owner (NOT implemented)

If the goal is a native, non-Safari playback surface on these two specific iPhone 4 units rather
than continuing to refine the existing Mobile-Safari web client (Phases 1-3 of this run), the only
path this research found with no *code*-level blocker is the sequence below. Every step's
infrastructure (Aquila, Lyncis, apt.saurik.com, the AppSync GitHub Releases page, the archive.org
legacy-app archive) is confirmed reachable today; the sole remaining unknown is whether AppSync
actually installs on a real device (step 3), which is an on-device test, not something resolvable
by more live requests:

1. Jailbreak each device with **Aquila** (a computer is available; this is the actively-maintained,
   GitHub-hosted option) or **Lyncis** (if avoiding a computer step is preferred).
2. Confirm Cydia can reach `apt.saurik.com` for its own core packages (confirmed reachable as of
   this session).
3. Attempt to install **AppSync Unified**. The maintainer's own Cydia repo (`cydia.akemi.ai`) is
   confirmed dead right now, but its GitHub Releases page (`github.com/akemin-dayo/AppSync/releases`,
   release `116.0`, `iphoneos-arm` `.deb`) is confirmed reachable and appears to be the correct
   32-bit build for iPhone 4 (section 2.5), untested against a real device. **Whether that `.deb`
   actually installs is the real go/no-go gate for the whole proposal** and would need to be
   confirmed (or found broken, in which case this proposal is not viable) before anything else here
   is worth attempting.
4. If AppSync installs successfully, obtain an old VLC-for-iOS `.ipa` (the "Legacy iOS App Archive"
   on archive.org is a confirmed-existing, jailbreak-oriented source; a specific VLC file within it
   was not individually verified this session) and sideload it.
5. Use this project's existing, already-shipped session-token mechanism (`GET /api/session-token`,
   server.js:111-118) to obtain a `?st=` token, and manually enter one or more
   `http://<host>/api/stream/:id?st=<token>` URLs into VLC as network streams.

This would give a native (non-Safari) player for individually-chosen tracks only: it would **not**
replace this project's browsing/search/library UI (server.js:131-182), since VLC has no knowledge of
this project's song/artist/album model. Given that limitation plus the untested AppSync install gate
in step 3, this is presented as an option for the project owner to weigh against simply
continuing to harden the existing Mobile Safari client, not as a recommendation either way.
