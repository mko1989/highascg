# src/show-timers — sweep 29.10.2026 (batch 095)

Files: 6 · lines: 381 · findings: 0 BUG-HIGH, 0 BUG, 1 DEAD, 0 RISK, 5 QUALITY

Method: every file read in full; cross-checked against src/osc/osc-state-layer.js (`_lastOscAt`), router-dispatch.js (route mount) and smoke-wo734-show-timers.test.js. Context: WO-734.

## src/show-timers/companion-vars.js
- `OK`
## src/show-timers/main-video.js
- `DEAD` src/show-timers/main-video.js:77-79,110 — the `TIMER_BAND` (980–989) and `BORDER_LAYER` (998) exclusions can never fire: the candidate layers are first restricted to `[10,99]` or `[110,199]` (line 107), so a layer in 980–998 is already out. Proof: the filter at 110 is `n >= lo && n <= hi && !(980..989) && n !== 998` with `hi <= 199`. Harmless, but the header comment ("the timer band, the border layer … are skipped") describes behaviour that comes from the range, not from these constants.
## src/show-timers/presentation-clock.js
- `OK`
## src/show-timers/show-timers-routes.js
- `QUALITY` src/show-timers/show-timers-routes.js:41 (readFileSync in `handle`) — `widget.js` is read synchronously from disk on every request and served `no-store`; trivial size, but it runs on the event loop of the playout node for every page load. Read once at require time (or cache by mtime).
## src/show-timers/show-timers-service.js
- `QUALITY` src/show-timers/show-timers-service.js:78,90 — `stop()` is never called by anything (`rg -n "_showTimers|createShowTimers" src index.js` → only show-timers-routes.js and the smoke), and the 1 Hz poller, started by the first page request, keeps hitting Companion (`/api/connections` every 30 s, variables every second per OSCPoint connection) for the life of the process even with no page open. It is `unref`'d, so shutdown is unaffected; it is the documented design ("keeps going"), listed here only because there is no off switch if Companion is retired.
- `QUALITY` src/show-timers/show-timers-service.js:68 — an exception inside `tick()` (as opposed to a Companion error, which clears `presentations`) keeps the previous `presentations` array, whose `elapsed_s` then stands still while `companion.ok` is false.
## src/show-timers/widget.js
- `QUALITY` src/show-timers/widget.js:63 — polls every 500 ms (+ round-trip) for as long as the page is open, with no `document.hidden` pause and no back-off on non-OK/failed responses; a phone left on the intake/audio page keeps the node answering ~2 req/s. The server snapshot is cached, so cost is small, but a 1–2 s interval would carry the same information (the clock itself is 1 s resolution).
- `QUALITY` src/show-timers/widget.js:42,45 — a missing `remaining_s` (null from an unparsable `mediaRemaining`) renders as `−0:00` instead of being hidden.
