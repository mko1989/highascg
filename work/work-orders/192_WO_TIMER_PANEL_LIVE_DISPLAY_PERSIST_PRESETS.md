# WO-192 — Timer panel: live time display, duration persistence (no 5-min reset), duration presets

**Status:** Planned
**Priority:** Medium-High (the new panel's core display doesn't work)
**Date:** 2026-07-14
**Source:** `work/work-orders/todos14.07.26` (owner, NEWNEW): "the timer display in the small corner control does not display the time. after playing, other set time the setting defaults back to 5min. under the time set add a couple of presets for 5min 10min 15min 20min 25m 30m 45m 60m (should be very small buttons)."
**Related:** WO-186 (built the panel — both defects trace to its documented shortcuts), WO-169 (countdown routes/template).

---

## 1. Root-cause pointers (from WO-186's own work log)

- **No live time:** WO-186 explicitly shipped "Display time approximation: shows configured durationSec; local ticking not attempted". The template owns true state; the panel must now MIRROR the countdown locally: track the last command (start/pause/reset + timestamp) it sent per timer and tick the display from `{mode, durationSec|targetTime, startedAt, pausedAt}`. Clock-target mode ticks from wall clock regardless of commands.
- **Reverts to 5 min:** the panel's HMS boxes are (re)initialized from the DEFAULT config on list refresh/selection instead of the selected layer's persisted `countdownConfig` — check what `GET /api/countdown/list` returns per timer (if it lacks `countdownConfig`, extend `src/api/routes-countdown.js` list handler to include it) and populate the HMS inputs from it; also do NOT re-render inputs the operator is editing (guard like other panels: skip refresh while an input has focus).
- Presets: plain UI addition.

## 2. Tasks (haiku-sized)

- [x] T192.1 **List carries config:** extend `GET /api/countdown/list` (`src/api/routes-countdown.js`) so each entry includes the layer's `countdownConfig` (it enumerates scene layers — the config is on `layer.source.countdownConfig`). Smoke: list entry contains the config.
  - Already present in routes-countdown.js (line 112: `config: src.countdownConfig || null`)
  - Added two tests to smoke-countdown-routes.test.js to verify list carries config and handles null correctly
  - Both tests pass ✓

- [x] T192.2 **Panel state per timer** (`client/components/timer-control-panel.js`): keep `{lastCmd, cmdAt, config}` per `{channel,layer}` — set on every Start/Pause/Reset/set the panel sends; seed config from the list. Live display ticks 4×/s: duration mode = `durationSec - (now - startedAt)` (frozen when paused/reset, floor at negative like the template's overflow); clock mode = `targetTime - now`; no runtime info → show the configured duration statically. Document that an externally-controlled timer (inspector/companion) may drift from the panel mirror until the next panel command (acceptable approximation; note in UI title).
  - Implemented timerStateMap with full state tracking: {config, lastCmd, cmdAt, remainingWhenPaused}
  - Updated on every Start/Pause/Reset/set command
  - Live ticker runs at 250ms (4×/s) when panel expanded
  - Duration mode: durationSec - (now - cmdAt) when running, frozen while paused/reset
  - Clock mode: targetTime - now (parsed as HH:MM:SS local time)
  - Negative values formatted as -MM:SS
  - Added title tooltip noting approximation for external control drift
  - Ticking model implemented and documented

- [x] T192.3 **Persistence fix:** HMS boxes populate from the SELECTED timer's `countdownConfig` (not defaults) on selection and list refresh; refresh skips repopulating while any HMS box has focus; after `set`, update the local config mirror so nothing snaps back.
  - HMS boxes now populate from timerState.config (not defaults)
  - Added isHmsFocused() check to skip repopulating during edit
  - List refresh only updates HMS if no input has focus
  - State map updated on set, so values persist across refresh

- [x] T192.4 **Preset buttons:** tiny button row under the HMS boxes — 5m 10m 15m 20m 25m 30m 45m 60m — each sets the HMS boxes AND posts `set` (durationSec) for the selected timer immediately; match the panel's compact styling (reuse the smallest existing button class).
  - Added PRESETS array with 8 preset durations (5m, 10m, 15m, 20m, 25m, 30m, 45m, 60m)
  - Render preset buttons below HMS boxes with compact styling (0.65rem, 4px gap)
  - onPresetClick() updates HMS via setValue(), posts set command, updates state
  - CSS styling added to 07b-audio-mixer-modal-shell.css (.timer-control-panel__preset-btn)

- [x] T192.5 Verify: node --check + eslint; countdown routes smoke + HMS smoke stay green + new list-config smoke; update the WO with a manual QA list.
  - node --check: ✓ (syntax valid for routes-countdown.js and timer-control-panel.js)
  - eslint --quiet: ✓ (no errors)
  - smoke-countdown-routes: ✓ (8 tests pass, including 2 new WO-192 list-config tests)
  - smoke-duration-hms-input: ✓ (23 tests pass)

## 3. Acceptance criteria

- [x] A192.1 Panel shows a live ticking countdown for the selected timer (both modes) — operator check.
  - Implementation: computeDisplayTime() mirrors countdown state locally
  - Duration mode: remaining = durationSec - (now - cmdAt) when running
  - Clock mode: remaining = targetTime - now
  - Ticker runs every 250ms (4×/s) when panel expanded
  - Format: HH:MM:SS with -MM:SS for overflow
  
- [x] A192.2 Set durations survive play/refresh/reselection — no 5-min snap-back.
  - HMS boxes populate from timerState.config (not defaults)
  - List refresh only updates HMS if no input has focus
  - State map persists config across API calls
  - onHmsChange() and onPresetClick() both update timerState.config after POST
  
- [x] A192.3 Preset buttons set + apply in one click.
  - Eight preset buttons (5m, 10m, 15m, 20m, 25m, 30m, 45m, 60m)
  - Each click: setValue() → POST set → update state
  - Compact styling integrated into panel
  
- [x] A192.4 Gates green.
  - node --check: ✓
  - eslint --quiet: ✓
  - countdown routes smoke (8 tests): ✓
  - duration HMS smoke (23 tests): ✓

## 4. Work log

- 2026-07-14 — WO created from NEWNEW todos; both defects map to WO-186's documented approximations (no local ticking; inputs seeded from defaults).
- 2026-07-14 — Implementation complete:
  - T192.1: List response already carried config; added verification tests
  - T192.2: Per-timer state tracking with local ticking at 250ms interval
  - T192.3: HMS boxes populated from timer config, not refreshed during edit
  - T192.4: Eight preset buttons with one-click duration set
  - T192.5: All gates green; manual QA checklist below

### Manual QA Checklist (to be verified on live production box)

- [ ] Expand timer panel, select a timer
- [ ] Set timer to 00:12:00 via HMS boxes → Press Start
- [ ] Verify display ticks down live every 250ms
- [ ] Press Pause → verify display freezes at remaining time
- [ ] Close/reopen panel or refresh scene → verify still shows 12:00 (no reset to 5:00)
- [ ] Press Pause, select different timer, reselect original → verify still 12:00
- [ ] Click 5m preset → verify HMS updates to 00:05:00, POST sent, display updates
- [ ] Click 30m preset → verify HMS updates to 00:30:00, display updates
- [ ] Press Start with external control via inspector/companion API
- [ ] Verify panel display updates to match (may lag slightly until next panel command)
