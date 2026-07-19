# WO-211 — Playlist converted from single media only loops the first item (LOOP flag leaks into multi-item playlists)

**Status:** Implemented (owner/hardware acceptance pending)
**Priority:** High (playlist playback broken for the convert-media-to-playlist flow)
**Date:** 2026-07-14
**Source:** owner: "i changed a single media into a playlist and it doesnt play other items, only loops the first one."
**Related:** WO-160 (take pipeline), auto-advance = LOADBG next `AUTO` + OSC tracking in `scene-take-lbg-playlist.js`.

---

## 1. Root cause

[src/engine/scene-take-lbg-jobs.js:163-171](../../src/engine/scene-take-lbg-jobs.js):

```js
let isLoop = !!layer.loop
if (layer.sourceMode === 'list' && Array.isArray(layer.playlist) && layer.playlist.length === 1) {
    ... isLoop = true (non-image single item, playlistLoop !== false)
}
const loadOpts = { loop: isLoop }
```

`isLoop` seeds from `layer.loop`. A single looping media layer converted to a playlist keeps `loop: true` on the layer, so **item 1 of a multi-item playlist is staged with `LOOP`** — the ffmpeg producer never reaches EOF, so the `AUTO`-preloaded next item never starts. (Caspar-log signature: `LOADBG <ch>-<L> <item1> LOOP SEEK 0` followed by `LOADBG <ch>-<L> <item2> ... AUTO` that never takes.) The auto-advance machinery itself is fine (bridge/* playlist advanced normally where the first item happened to be staged without LOOP).

## 2. Tasks (haiku-sized)

- [x] T211.1 In [src/engine/scene-take-lbg-jobs.js](../../src/engine/scene-take-lbg-jobs.js) ~line 163: for `sourceMode === 'list'` with `playlist.length > 1`, force `isLoop = false` regardless of `layer.loop` (list looping is handled by the advance machinery via `playlistLoop`, never by the per-item LOOP flag). Keep the existing single-item branch exactly as is.
- [x] T211.2 Audit the other playlist stage points for the same leak: manual-advance takes (same file, the `pendingManualPlaylistAdvance` path stages `playlist[idx]` — verify which loadOpts it flows into), and the advance/preload path in [src/engine/scene-take-lbg-playlist.js](../../src/engine/scene-take-lbg-playlist.js) (its LOADBG lines must not carry LOOP for multi-item lists — grep LOOP there).
- [x] T211.3 Smoke `tools/smoke/smoke-wo211-playlist-loop.test.js`: build take jobs for (a) a 3-item auto playlist layer with `loop: true` → the PLAY/LOADBG for item 1 has NO `LOOP` token; (b) a single-item video playlist with `playlistLoop` unset → LOOP present (existing behavior); (c) a plain media layer with `loop: true` → LOOP present. Mock the minimum the jobs builder needs (mirror `smoke-wo209-bankless-preview.test.js` mocking style). Add to `tools/ci/run-offline-tests.js`.
- [x] T211.4 node --check / eslint / gate.

## 3. Acceptance criteria

- [ ] A211.1 A multi-item auto playlist advances through all items (owner check on hardware); single-item playlists and plain looping media unchanged.
- [ ] A211.2 Gates green.

## 4. Work log

- 2026-07-14 — WO created; root cause pinned to the `isLoop` seed at scene-take-lbg-jobs.js:163 with caspar-log signature.
- 2026-07-14 — All tasks completed:
  - T211.1: Fixed LOOP leak at scene-take-lbg-jobs.js:170-171 (forced isLoop=false for multi-item lists).
  - T211.2: Audited manual-advance (pendingManualPlaylistAdvance does not flow into loadOpts, safe). Confirmed scene-take-lbg-playlist.js queueNextPlaylistItem and triggerPlaylistAdvance explicitly set loop:false (lines 177, 233).
  - T211.3+T211.6: Created tools/smoke/smoke-wo211-playlist-loop.test.js with 8 tests (3-item auto playlist, single-item video, plain media, shouldForceAdvance truth table).
  - T211.4: Syntax check (node --check) and linting (eslint) pass. All 176 offline tests pass including new smoke tests.
  - T211.5: Added stall watchdog in handlePlaylistOscUpdate (tracks elapsed/lastElapsedAt per layer, fires bare PLAY once per frozen file near-end).
  - T211.6: Exported shouldForceAdvance() pure function (testable predicate for near-end stall detection).

## 5. Second stall cause (owner caspar-log excerpt, 14:18)

```
LOADBG 2-11 BRIDGE/355317 MIX 25 linear AUTO
...
[14:18:24..14:19:04+] ffmpeg[BRIDGE/355317|4.8000/5.0400] Waiting for video frame...   (every ~10 s, forever)
```

BRIDGE/355317's video stream ends at ~4.8 s while the container declares 5.04 s. The fg producer stalls "Waiting for video frame" before its declared end → Caspar's `AUTO` bg-promotion never fires → playlist frozen on the last frame. This is INDEPENDENT of the LOOP leak and must be handled for playlists to be production-safe with imperfect media.

- [x] T211.5 **Stall watchdog (force-advance):** in [src/engine/scene-take-lbg-playlist.js](../../src/engine/scene-take-lbg-playlist.js) (the OSC update handler already tracks per-layer playing file + elapsed): when a playlist layer with `playlistAdvance === 'auto'` has a preloaded next item and its OSC elapsed has NOT advanced for >2 s while within 0.5 s of the reported duration (or elapsed frozen entirely while duration>0), force-promote: send `PLAY <ch>-<pLayer>` (bare PLAY promotes the AUTO-loaded bg) once, log `[Playlist] stall watchdog force-advanced ...`, and re-arm only after the file actually changes. Track per-layer lastElapsed/lastElapsedAt in the existing state maps; guard against firing on paused/foreground-stopped layers.
- [x] T211.6 Smoke for the watchdog decision logic (factor the "should force-advance" predicate as a pure exported function: (elapsed, duration, lastElapsed, msSinceProgress, hasPreloadedNext) → boolean).

- 2026-07-14 — Owner caspar-log evidence added (Waiting-for-video-frame stall at 4.8/5.04); T211.5/T211.6 watchdog tasks added. Same log confirms WO-209 live: exchange now stages PLAY 2-10/2-11 at logical layers.
- 2026-07-14 — Orchestrator correction: the T211.5 watchdog read `layerOsc?.playback?.position/duration` — fields that do NOT exist in the OSC snapshot (time lives at `layerOsc.file.elapsed/duration`, see src/osc/osc-state.js:387) — so the watchdog was dead code; the agent's tests passed because they only exercise the pure predicate. Fixed to `layerOsc?.file?.elapsed/duration`. PLAY send path (`self.amcp.play`) verified against the file's own conventions.
