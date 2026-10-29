# WO-803 — Companion: screen's main layer with remaining time and progress bar (display only)

**Status: OPEN (29.10) — display only, no actions**

Owner, 29.10:
> companion module highascg feedback with main layer from a screen with remaining time and progress bar. preset buttons for above. display only, no actions.

## What is wanted

- A **feedback** (display only, no action) that draws a button showing a screen's **main layer** (PGM):
  the remaining time as text and a progress bar.
- **Presets** for those feedbacks: one button per screen (and per the main layer slot), ready to drop onto
  a Companion page. They carry feedbacks only — no `steps` with actions.

## Investigation (29.10, read-only)

- Module: `companion-module-dev/companion-module-highpass-highascg` (version 1.0.10 is the last packaged
  build, WO-791).
- Feedbacks live in `src/feedbacks.js` (look PGM/PRV feedbacks at ~line 330–361 use
  `affectedProperties: ["png64"]` and return a PNG data URI converted to raw base64 — the image path to
  reuse for a progress-bar button).
- Presets: `src/presets/` (one file per family, e.g. `look-preset-presets.js`, `screen-timer-presets.js`);
  `src/presets.js` assembles them.
- Data on the server: `src/osc/osc-state.js` already tracks per-layer **remaining and progress** from
  `file/time` (WO-252 fills gaps from AMCP INFO). The module does not expose it yet.
- The module polls HighAsCG (`src/bridge/*-poller.js`, e.g. `screen-timer-poller.js` polls
  `GET /api/timers/list`). A poller for the PGM layer state is the same pattern.
- Variables: `src/variables.js` (timeline remaining at lines 56–69) is the pattern for text variables.

## Plan

1. **Server:** expose per screen, for the PGM main layer: `{ layer, clip name, remainingSec, durationSec,
   progress 0..1 }`. Use the existing `osc-state` values; no new CasparCG call. Route under `/api/...`
   (check the router order — earlier wildcards swallow later routes; curl the new route on the box).
2. **Module poller:** a `pgm-layer-poller` (same pattern as the screen-timer poller) keeps the values, with
   a change check so feedbacks only redraw on change.
3. **Feedback** `pgm_layer_progress` (option: screen): draws the button with the screen label, remaining
   `mm:ss` text and a bar at the bottom (PNG via the existing image path). `isVisible` only; no actions
   (`actions` not defined for this feedback).
4. **Variables:** per-screen `pgm_remaining`, `pgm_progress` for button text if the owner wants them.
5. **Presets:** one preset per screen, using the feedback, styled like the look presets. No `steps`.
6. Packaged as module 1.0.11; test file added beside `test/screen-timers.test.js`.

## Acceptance

- With a clip playing on a screen's PGM, the Companion button shows remaining `mm:ss` and the bar moves;
  it stops on pause and clears on clear/take-out.
- Pressing the button does nothing (no action). Presets have no actions.
- Module tests green (`npm test` in the module dir; 81/81 was the WO-791 baseline).

## Verified

_(none yet)_
