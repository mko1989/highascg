# WO-269 — Shape overlay: stop the 5 Hz identical-payload log flood

**Status:** Implemented (owner acceptance A269.1 pending)
**Priority:** HIGH (owner report 2026-07-18, todos18.07.26 — "logs flooding the highascg logs, not good")

## Symptom (owner log 12:41)
`[Shape overlay] stdin line received: {"monitor":…,"rects":[],…}` repeating every ~200-300 ms, identical payload, indefinitely.

## Root cause (verified)
- The ~200 ms cadence is exactly `REPORT_DEBOUNCE_MS` (`client/lib/operator-gui-mode.js:27`).
- `preview-canvas-panel.js:327,354` reports compose cell rects on **every draw tick** (its live-preview poll loop), not on change; each report → `scheduleReport()` → a POST/DELETE to `/api/operator-gui/layout` every debounce window, even when the payload is identical (here: perpetually empty).
- Server side, every layout apply calls `updateShapeRects()` (`src/system/operator-gui-channel.js:297-309`) which writes a stdin line unconditionally (`operator-shape-overlay.js:87-110`).
- The helper logs EVERY stdin line by design (`tools/runtime/operator-shape-overlay.py:547`, WO-262 heartbeat), and the feeder mirrors helper stdout into the highascg log at info (`operator-shape-overlay.js:60-63`). Identical lines at 5 Hz × two logs = the flood.

## Fix — dedupe at three layers (defence in depth, each independently sufficient)
**T269.1 client** (`client/lib/operator-gui-mode.js`): cache the last successfully-sent serialized cell payload in `sendLayout`; skip the POST/DELETE when unchanged. `resendMergedNow()` (WS reconnect / server nudge / 60 s heartbeat) passes `force: true` — recovery paths must keep re-sending. Reset the cache in the test-reset helper.
**T269.2 feeder** (`src/system/operator-shape-overlay.js`): skip the stdin write when the serialized payload equals the last one written AND the helper process is alive (a respawn must always get the payload). `reapplyOperatorShapeOverlay` forces.
**T269.3 helper** (`tools/runtime/operator-shape-overlay.py`): keep WO-262's log-before-parse guarantee but compress repeats — when a line equals the previous one, count it and emit one `stdin line repeated ×N (suppressed)` summary when the payload changes or every 60 s. Diagnosability preserved (first occurrence always logged verbatim).
**T269.4 smokes** (`tools/smoke/smoke-wo269-shape-log-dedupe.test.js`, curated gate): client dedupe (same payload → one send; force → resend; changed → send), feeder skip logic via injected fake proc, helper repeat-compression logic as a pure python-side check is not offline-testable — assert the marker strings at source level instead.

## Constraints (standard)
LIVE box: no git, no service ops, no AMCP, no HTTP/WS to :4200/:5250, curated gate ONLY, `node --check` + repo eslint, <500 lines/file, tabs + JSDoc, honest checkboxes.

- [x] T269.1 client sendLayout dedupe + force paths
- [x] T269.2 feeder identical-payload skip (alive-guarded)
- [x] T269.3 helper repeat compression
- [x] T269.4 smokes in curated gate
- [ ] A269.1 (owner) live: idle operator GUI → shape-overlay lines stop repeating; kill the helper → it respawns and re-receives the payload; holes still restore after modals

## Work log

**2026-07-18 — implemented.**
- T269.1 `sendLayout(cells, {force})` caches `_lastSentJson` on success only (a failed POST clears it so the next attempt retries); identical non-forced payloads skip the HTTP round-trip entirely. `resendMergedNow` (WS reconnect, server nudge, 60 s heartbeat) forces. Cache reset added to `resetOperatorGuiModeStateForTests`.
- T269.2 feeder computes `alreadyRunning` BEFORE `ensureSpawned` (a lazy respawn always gets the payload) and skips the stdin write when `payload === _lastWrittenPayload`. `reapplyOperatorShapeOverlay` now passes `force: true` — a Caspar reconnect means a new consumer window that must be re-shaped even byte-identically. Cache cleared on write failure and in `stopOperatorShapeOverlay`.
- T269.3 helper counts unchanged repeats and emits `stdin line repeated xN (unchanged, suppressed)` on change or at most every 60 s; first occurrence of any new payload still logs verbatim before parse (WO-262 guarantee intact).
- T269.4 `tools/smoke/smoke-wo269-shape-log-dedupe.test.js` (8 source-level asserts across the three layers) in the curated gate.
- Root cause recorded for posterity: `preview-canvas-panel.js` reports cell rects on every draw tick; with the 200 ms debounce this produced an identical POST/DELETE → `updateShapeRects` → helper stdin line → two info logs, 5×/sec, forever. Note the flood also cost an HTTP request per cycle — T269.1 removes that too. Optional future cleanup: make the panel report only on actual rect change.
