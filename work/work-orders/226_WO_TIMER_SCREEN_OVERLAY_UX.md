# WO-226 — Timer as a per-screen overlay: icon next to screen label/FTB, full inspector (size/position/fade), compact controls next to audio; drop ≠ look

**Status:** Implemented (owner/hardware acceptance pending) | **Date:** 2026-07-15
**Source:** owner: "the timer was supposed to be added as a screen overlay, that is either on or not. when dropped into screens looks list it shouldnt create a look but a timer icon next to screen label and ftb, which opens its inspector with all settings as well as size and position and button to fade in fade out. there also needs to appear the compact timer controls next to audio."
**Builds on:** WO-210/219 server model (band 980-989, /api/timers/*, opacity lifecycle) — server largely READY; this is UX relocation + two server extensions.

## Design
- **Drop → assign, not look:** dropping a timer/countdown source onto a screen's looks column (scene-list-column.js / its drop handlers) must NOT create a look; instead POST /api/timers/assign for that screenIdx (create instance if payload has none) and show the icon.
- **Per-screen timer icon** in the deck column header next to the screen label and the FTB button (scene-list-column.js:64+ FTB area): visible when that screen has ≥1 assigned timer; colored by state (on air/visible vs hidden). Click → **timer inspector** (modal or side panel, reuse inspector-group styling): all countdown settings (reuse the settings form from timer-control-panel-settings-form.js), PLUS **size** (timerFontSize) and **position** (the template's position options; if free x/y placement is wanted, note that the countdown template positions via its own config — extend config with offsetX/offsetY % if cheap), PLUS **Fade in / Fade out** buttons.
- **Fade:** extend POST /api/timers/visible with optional `fadeFrames` (default 0) → server emits `MIXER <ch>-<layer> OPACITY <0|1> <fadeFrames> linear` (band-guarded as before).
- **Compact transport next to audio:** small start/pause/reset + on/off cluster rendered beside the compact audio mixer (audio-mixer-panel mount area; the existing bottom-right panel remains the full view) for the ACTIVE screen's timers.

## Tasks
- [x] T226.1 Server: fadeFrames on /api/timers/visible (+ smoke).
- [x] T226.2 Drop-to-assign path in the deck column (find its drop handler; countdown template payloads and panel-timer payloads both route to assign; toast confirms; NO look created).
- [x] T226.3 Icon + state coloring in the column header next to FTB; click opens inspector.
- [x] T226.4 Timer inspector (settings form reuse + size/position + fade in/out buttons wired to fadeFrames).
- [x] T226.5 Compact transport cluster next to audio mixer.
- [x] T226.6 eslint/gate/smokes; orchestrator builds. A226.1 owner check of the full flow.
  - eslint --quiet + node --check clean on all touched files. Curated offline gate (tools/ci/run-offline-tests.js, now including smoke-wo226-timer-overlay.test.js): 227 tests, 225 pass, 0 fail, 2 pre-existing skips (unrelated, require live server). Orchestrator vite build intentionally NOT run (per task scope — orchestrator's job); no git commits, no restarts, no AMCP mutation performed.
  - A226.1 (owner check of the full flow) is NOT done — needs a human to click through drop → icon → inspector → fade → compact transport on the live box.
