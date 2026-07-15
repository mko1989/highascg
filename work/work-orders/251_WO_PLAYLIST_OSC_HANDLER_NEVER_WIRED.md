# WO-251 — Playlist OSC advance handler was never subscribed (root cause of "doesn't loop")

**Status:** IMPLEMENTED (orchestrator direct fix, 2026-07-15 evening)
**Owner check:** A251.1

## Root cause (proven by git archaeology)
`handlePlaylistOscUpdate` (scene-take-lbg-playlist.js) — the OSC-driven machinery that detects the playing-file change, queues the NEXT item via LOADBG AUTO, wraps on `playlistLoop`, schedules image timers, and runs the T211.5 stall watchdog — was **never called from anywhere**. `git grep` at 80a2df5 (WO-211) and d8e4509 (WO-224) shows it existed only in its own module, the WO docs, and its own smoke test. WO-211/224's "sim-proven" wrap exercised the function in isolation; production behavior since the feature landed: play item 1, native handoff to the item 2 that take-time `setupLayerPlaylists` preloaded, then stop. Matches every owner report ("stuck", "doesn't loop even when set", "doesn't loop again").

Ruled out on live evidence: name matching is fine (normPath lowercases; OSC `file.name` arrives), the OSC handler signature matches appCtx, and the service is running current code (restarted 16:45).

## Fix
`src/bootstrap/osc-lifecycle.js`: the `oscState.on('change')` listener now dispatches `handlePlaylistOscUpdate(appCtx, snapshot)`, throttled to 4 Hz (advance detection needs ~seconds granularity, not every OSC tick), try/catch-guarded with a warn log.

## Tests
`tools/smoke/smoke-wo251-playlist-osc-wiring.test.js` (curated gate): grep-level wiring regression guard (import + dispatch call present) and a functional stub-OscState 'change' dispatch through `createOscLifecycle`.

## Related (separate WOs)
- The stall-watchdog leg of the handler ALSO needs `file.duration`, which the new binary omits (live-proven: `duration` undefined, `frameTotal` undefined on all playing layers) → WO-252 (INFO supplement → oscState duration).
- MV bars/digits dark = the same missing duration (WO-250 shipped the template un-clipping + a frameTotal fallback that cannot fire on this binary — WO-252 is the real feed).

- [x] Wiring + throttle + guard
- [x] Smoke in curated gate
- [ ] A251.1 (owner) after restart: multi-item auto playlist advances past item 2 and wraps when loop is set
