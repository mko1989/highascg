# WO-521 — Zoom meeting module: per-participant channels, strictly opt-in

**Status: PLAN ONLY (13.08.2026 — no code written, by owner instruction: *"for now I just want it to be a wo. no actual work put into it."*)**
**Priority:** Medium (new capability, no on-air risk while unbuilt)
**Source:** owner 13.08: *"tell me if it's possible to use [CoreVideo's] parts to connect to a zoom meeting, send video and audio to the meeting and also receive individual zoom participants"* + *"the work flow I'd like is creating a channel for each zoom feed, for instance I need to have 2 different participants available as well as screen sharing from zoom. so 3 channels that I can choose which participants video appears on which channel"* + *"I want this to be a module that is opt in and installable only when user wants so nothing in highascg depends on it."*
**Reference:** `work/references/CoreVideo-main` (MIT, github.com/iamfatness/CoreVideo)
**Related:** WO-30 (optional-module registry), WO-265 (module static mounts), WO-121 (v4l2 input — the closest existing "external process feeds a channel" pattern)

---

## 1. Is it possible? Yes for receive, no for send — CoreVideo is receive-only

Read from the reference, not assumed:

| requirement | CoreVideo | evidence |
|---|---|---|
| Join a Zoom meeting | ✅ | `engine/src/main.cpp` — "IPC loop, SDK auth/join/webinar, spotlight tracking" |
| Receive **individual participants** | ✅ | `engine-video.cpp/h` — `IZoomSDKRenderer` → named shared memory (I420), per user |
| Screen share as its own feed | ✅ | `engine-share.cpp/h`, separate path |
| Per-participant **audio** | ✅ | `engine-audio.h:46` `onOneWayAudioRawDataReceived(AudioRawData*, uint32_t user_id)`, with an `isolate_audio` flag per target |
| **Send** video/audio **into** the meeting | ❌ **absent** | grep for `setExternalVideoSource`, `IZoomSDKVideoSource`, `IZoomSDKVirtualAudioMic`, `sendAudioRawData` → **zero hits**. The `virtualCam` symbols in `sidecar/` are OBS's own virtual camera, not Zoom's. |

So the owner's three asks split cleanly: **join + receive is reuse; send is new development** against Zoom's virtual video/audio source APIs, with nothing in the reference to start from.

## 2. Why the architecture suits us

CoreVideo already puts **all SDK access in a child process** (`ZoomObsEngine`) and the OBS plugin has *no SDK linkage* — it reads frames over IPC + named shared memory. We would **discard the OBS plugin entirely** and write a HighAsCG-side reader against the same boundary. The reusable surface is five files in `engine/src/`.

That process split is also what makes the opt-in requirement cheap: the SDK, its licence obligations and any crash live outside the playout process.

## 3. The blocker: Linux is unsupported upstream

README:107, verbatim: Linux is *"Source build only, unsupported — no official packages. CI compiles and unit-tests only the cross-platform C++ with the plugin/engine/sidecar all **OFF**; it never links against Qt6, OBS, or the Zoom SDK on Linux."* `CMakeLists.txt:187` guards the SDK on `if(WIN32 …)`; there is an `elseif(UNIX)` branch and a Unix-socket IPC path, so it *configures*, but the SDK has never been linked on Linux here.

**This is not a port, it is the first Linux build of that engine.** Zoom does ship a Linux Meeting SDK; supplying it and doing the CMake/SDK wiring is ours. MIT licence, so no legal obstacle to reuse.

## 4. Opt-in: use the existing mechanism, do not invent one

`src/module-registry.js` (WO-30) already provides exactly the guarantee the owner asked for:

> *Core code never imports from `src/previs/` … directly. Instead, each optional module ships a single `src/<name>/register.js` … If the module's directory has been deleted, the require throws and is swallowed; the rest of the app continues booting normally.*

`tryLoad` (`module-registry.js:52`) wraps the require in `try/catch` and returns `false` on failure. `plugin-manager.js:167` `loadEnabledPlugins` skips anything not `enabled`, and `enablePluginNow` / `disablePluginNow` toggle at runtime without a restart. `GET /api/modules` tells the web client which bundles to dynamic-import.

**Design rules for this module, all enforced by that boundary:**

1. Everything lives under `src/zoom/`, entered only through `src/zoom/register.js`.
2. **No core file may `require` anything under `src/zoom/`** — add a CI guard asserting this (a grep test in the curated list; the repo already pins architecture facts this way).
3. Not in `package.json` `dependencies`. Any npm need goes in `optionalDependencies` with an `install:zoom` script, mirroring the `install:previs` / `--include=optional` precedent.
4. **The native engine binary and the Zoom SDK are NOT shipped.** Absent by default; a separate installer step fetches/builds them. The module must report "not installed" cleanly rather than throw.
5. Disabled by default. Deleting `src/zoom/` must leave the box booting and on air with no trace.
6. No config-schema changes in core: module settings live under one namespaced key the module owns.

## 5. Proposed shape (for review, not built)

```
ZoomObsEngine (child process, owns Zoom SDK)
   └─ named shm, one region per feed (I420 video + PCM audio)
        └─ src/zoom/  ← the module
             ├─ register.js        descriptor: onBoot/onShutdown, /api/zoom/*, ws 'zoom:'
             ├─ engine-process.js  spawn/supervise/restart the engine (run.sh precedent)
             ├─ shm-reader.js      shm → frames
             ├─ feed-router.js     feed ↔ Caspar channel assignment
             └─ zoom-config.js     credentials, meeting, per-feed mapping
```

**Getting frames into Caspar.** Preferred first cut: an **ffmpeg producer per feed**, the same shape the v4l2 bridge already uses (WO-121/WO-399) — the engine writes to a shm/pipe/UDP endpoint and Caspar consumes it on a dedicated input channel. That reuses a path this box already runs in production rather than inventing a producer.

**The owner's 3-channel workflow** maps directly: 2 participants + share = 3 feeds = 3 dedicated input channels, with "which participant appears on which channel" as an operator assignment. CoreVideo already models this (`AssignmentMode` in its plugin), and HighAsCG already has the UI idiom — DeckLink inputs get dedicated host channels and are chosen per destination.

## 6. Open questions — answer before any code

1. **Zoom entitlements.** Raw data access is a Meeting SDK app entitlement tied to the signed-in account. README warns standard accounts are capped near **30 Mbps** incoming, Enhanced Media / HBM near **100 Mbps**; at 4–6 Mbps per 1080p feed, 3 feeds fit comfortably — but *does the owner's Zoom account actually have raw-data access?* Everything else is moot if not.
2. **Does the Linux Meeting SDK expose the same raw-data APIs** at the same version? Unverified.
3. **Send-into-meeting: needed in v1?** It is the only part with zero reuse. Splitting it to a later phase makes v1 dramatically smaller.
4. **Audio routing.** Per-participant isolated audio exists; how should it reach the mixer — per-feed channel audio, or discrete strips?
5. **Credential storage.** CoreVideo stores tokens in plaintext on Linux with a logged warning (README:342). Not acceptable here without a decision.

## 7. Phasing suggestion

- **P0 — spike, throwaway:** build `engine/src/` against the Linux Meeting SDK, join a meeting, dump one participant's I420 to a file. Answers §6.1 and §6.2, and is the only honest way to size the rest. Nothing integrated.
- **P1 — receive:** module skeleton + engine supervision + N feeds → N Caspar input channels + assignment UI.
- **P2 — send:** virtual video/audio source into the meeting. New development.
- **P3 — polish:** reconnect handling, ISO recording, interpretation channels (CoreVideo has all three; port only if wanted).

## 8. What was NOT done

**No code.** Owner instruction. No files created under `src/zoom/`, no dependency added, nothing registered. This WO is the investigation and the plan.

Also not done: verifying §6.1/§6.2, which need the owner's Zoom account and a Linux SDK download. Every estimate here is conditional on those.

## 9. Work log

- 2026-08-13 — Reference read and assessed: receive-only confirmed by grep, Linux unsupported upstream confirmed from README/CMake, opt-in design mapped onto the existing WO-30 registry rather than a new mechanism. Plan only, per owner.
