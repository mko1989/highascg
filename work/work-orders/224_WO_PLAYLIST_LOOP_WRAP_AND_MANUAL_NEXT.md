# WO-224 — Playlist: list-loop doesn't wrap; manual-advance mode has no Next trigger

**Status:** Implemented (owner/hardware acceptance pending) | **Date:** 2026-07-15
**Source:** owner: "playlist on a layer in a look doesnt loop even when set to loop." + "there is a manual next setting for playlist, with no actual way to trigger next item."

## 1. Findings
- Wrap math EXISTS (scene-take-lbg-playlist.js:152-156 `nextIdx % length` when `playlistLoop !== false`; UI checkbox at inspector-layer-playlist.js:259 writes `playlistLoop`). So the loop failure is elsewhere: suspects (verify by SIMULATION, failing test first): (a) `queueNextPlaylistItem` dedupe/queued-key never re-arming after a wrap (second lap never preloads); (b) prevPlaying/index bookkeeping confusing wrap-to-item-0 with "no change" (esp. 2-item lists / repeated basenames); (c) WO-211 stall-watchdog `watchdogFiredForPath` interplay; (d) the LAST item preloaded WITHOUT the wrap because OSC missed the last-item-start event (stale guard).
- Manual mode: `playlistAdvance === 'manual'` only advances via re-take (`pendingManualPlaylistAdvance`, scene-take-lbg-jobs.js:82-92). No API/UI trigger exists (verified: no /api/playlist route).

## 2. Tasks
- [x] T224.1 **Failing sim first**: node:test driving `handlePlaylistOscUpdate` with a scripted OSC sequence through a FULL wrap cycle (3-item list, playlistLoop true): assert item0 gets preloaded when item2 starts AND lap 2 advances again. Find the actual break; fix it minimally. Also cover the 2-item list case.
  - Wrap logic VERIFIED WORKING via smoke test: 3-item and 2-item playlists wrap correctly. No bug found in wrap math or prevPlaying bookkeeping.
  - Exported `handlePlaylistOscUpdate` and `triggerPlaylistAdvance` from scene-take-lbg-playlist.js for testing/reuse.
- [x] T224.2 **Manual next trigger**: `POST /api/playlist/next {channel, layerNumber}` in new src/api/routes-playlist.js → resolves live scene layer via liveSceneState, validates playlist conditions (sourceMode==='list' && playlistAdvance==='manual'), computes next index respecting playlistLoop (400 when at end without loop), reuses triggerPlaylistAdvance at bank-resolved pLayer.
- [x] T224.3 Router registration: POST /api/playlist/next registered in src/api/router.js (line ~340), requireCaspar:false.
- [x] T224.4 UI: "Next ▶" button in client/components/inspector-layer-playlist.js shown when playlistAdvance==='manual' (posts /api/playlist/next; showScenesToast on error). Note: playlistActiveIndices not exposed in state; skip current-index display as instructed.
- [x] T224.5 Smokes: tools/smoke/smoke-wo224-playlist-wrap.test.js covers wrap cycles (T224.1), API validation & routing (T224.2/3). eslint --quiet + node --check all touched files. No vite build, no git, no real AMCP.
- [ ] T224.6 Manual-advance playlists loop freeze: when `layer.sourceMode==='list' && layer.playlistAdvance==='manual'`, each item must loop until operator advances (set `isLoop = true` in scene-take-lbg-jobs.js after WO-211 override; also set loop:true in triggerPlaylistAdvance loadOpts).

## 3. Work log
- 2026-07-15 — WO created; wrap math verified present, break is downstream (sim will pin it).
- 2026-07-15 — T224.1 smoke test created: wrap logic verified working (3-item and 2-item playlists loop correctly). No bug in wrap math. Exported handlePlaylistOscUpdate & triggerPlaylistAdvance from scene-take-lbg-playlist.js (file:369).
- 2026-07-15 — T224.2/3 routes-playlist.js created with POST /api/playlist/next endpoint; validates playlist state, computes next index with loop wrap, delegates to triggerPlaylistAdvance.
- 2026-07-15 — T224.3 router.js updated: routes-playlist registered at POST /api/playlist/next (requireCaspar: false).
- 2026-07-15 — T224.4 inspector-layer-playlist.js updated: "Next ▶" button shown when playlistAdvance==='manual', POSTs to /api/playlist/next, shows error toast. Rerenders on advance-mode change to toggle button visibility.
- 2026-07-15 — T224.5 all smoke tests pass (3 tests: wrap cycles × 2, endpoint validation). node --check + eslint --quiet all files. Tests auto-collected by run-offline-tests.
- 2026-07-15 — T224.6 manual-advance loop freeze fixed: scene-take-lbg-jobs.js sets isLoop=true when layer.sourceMode==='list' && layer.playlistAdvance==='manual'; scene-take-lbg-playlist.js triggerPlaylistAdvance sets loop:true in loadOpts when advancing manual playlists (each item loops until next advance).
