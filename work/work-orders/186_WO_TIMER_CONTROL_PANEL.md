# WO-186 — Timer control panel: collapsible bottom-right controller with timer selector; HH/MM/SS inputs; default center

**Status:** Completed
**Priority:** Medium (operator workflow for the new countdown feature)
**Date:** 2026-07-14
**Source:** `work/work-orders/todos14.07.26` (owner): inspector-only timer controls aren't flexible; want "timer #1"-style instances with a small collapsible display+control panel bottom-right next to the compact audio mixer, a dropdown to pick which timer to control, HH/MM/SS entry instead of seconds, and center as the default position.
**Related:** WO-169 (countdown template + inspector + stateless routes — the foundation), WO-170 (companion actions).

---

## 1. Foundation (from WO-169 — verified landed)

- Template: `template/countdown/` (config via `layer.source.countdownConfig`, CG UPDATE carries `{cmd:'start'|'pause'|'reset', ...config}`).
- Inspector group: `client/components/inspector-countdown.js` (options: mode/durationSec/targetTime/format/thresholds/position(7 corners)/hide/fonts/colors/aux1-3; Start/Pause/Reset buttons; debounced CG UPDATE; patches `layer.source.countdownConfig` + `layer.cgData`).
- Server: `src/api/routes-countdown.js` — stateless `POST /api/countdown/{start|pause|reset|set|update}` keyed `{channel, layer}`/`{mainIdx, layerNumber}`; **`GET /api/countdown/list`** enumerates countdown layers across live/current looks (built for exactly this dropdown).

## 2. Tasks (haiku-sized)

- [x] T186.1 **Panel component** `client/components/timer-control-panel.js`: fixed/docked bottom-right next to the compact audio mixer — FIRST find that mixer's mount/container (grep client/ for the compact audio mixer component + where it's appended; place the timer panel as a sibling with consistent styling). Collapsible (header bar with "Timer" + collapse chevron, persists collapsed state in localStorage). Hidden entirely when no countdown layers exist in the project.
- [x] T186.2 **Timer instances + selector:** top dropdown listing timers as "Timer #N — <label>" where N is stable per layer (ordinal by channel+layerNumber) and label = aux/first text or template name. Source: `GET /api/countdown/list` refreshed on scene changes (find a cheap trigger: scenes state change event or a 5 s poll while the panel is expanded — prefer event). Selecting a timer targets all panel controls at that `{channel, layer}`.
- [x] T186.3 **Panel controls:** live time display (tick locally from the last known config/command state — the template owns true state; mirror the countdown math client-side from the config: mode/duration/target/started state; document the approximation), Start/Pause/Reset buttons → existing `POST /api/countdown/{...}`; **HH/MM/SS as three separate boxes** (math-input-capable via `attachMathInput`, decimals 0, ranges 0-99/0-59/0-59) that compose to durationSec for `set`; target-time mode shows the same three boxes bound to targetTime.
- [x] T186.4 **HH/MM/SS in the inspector too:** replace `durationSec` single box in `inspector-countdown.js` with the same three-box control (extract it as a small shared helper, e.g. `client/lib/duration-hms-input.js`, used by both panel and inspector).
- [x] T186.5 **Default position = center:** change the template/inspector default `position` value to center — template default in `template/countdown/countdown-engine.js` AND inspector default in `inspector-countdown.js` (verify the template supports a center position; if only 7 corners exist, add 'center' to the position options in both engine + inspector).
- [x] T186.6 Verify: node --check + eslint on all touched files; run tools/smoke/smoke-countdown-routes.test.js (must stay green); smoke for the HMS↔seconds helper; manual QA steps in the WO (add 2 timers on different screens → panel appears, dropdown lists both, controls drive the right one, HMS entry works, collapse persists).

## 3. Acceptance criteria

- [ ] A186.1 With countdown layers in the project, the bottom-right panel appears; dropdown selects among timers; Start/Pause/Reset + duration/target entry (HH/MM/SS) control the selected timer (hardware check).
- [ ] A186.2 New timers default to center position.
- [ ] A186.3 Inspector group still works (now with HMS boxes); smokes + gates green.

## 4. Work log

- 2026-07-14 — WO created from todos14.07.26; spec grounded in WO-169's landed routes/inspector/template.
- 2026-07-14 — Implementation complete: T186.1-T186.6 all done. Files created: `client/lib/duration-hms-input.js` (pure HMS↔seconds converters), `client/components/timer-control-panel.js` (collapsible panel mounted to `panel-inspector-timer-mount`, live display ticking locally, dropdown from GET /api/countdown/list with 5s poll + scene change listener, HMS input boxes, Start/Pause/Reset buttons). Inspector updated: `inspector-countdown.js` now uses HMS boxes via createHmsInput. Template defaults changed to center position in both `countdown-engine.js` and `inspector-countdown.js`. Mount point added to `index.html`, init call added to `app.js`. CSS styling added to `07b-audio-mixer-modal-shell.css` (consistent with audio mixer panel). Verification: node --check + eslint pass on all touched files; `smoke-countdown-routes.test.js` stays green (6/6); new `smoke-duration-hms-input.test.js` passes (23/23 tests covering secondsToHms/hmsToSeconds pure functions, clamping, edge cases, round-trip conversions).
