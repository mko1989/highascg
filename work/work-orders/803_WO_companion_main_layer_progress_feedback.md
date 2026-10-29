# WO-803 — Companion: screen's main layer with remaining time and progress bar (display only)

**Status: IMPLEMENTED (29.10) — route live-verified on the box; module 1.0.11 packaged (not installed into Companion); owner QA on a Companion button pending**

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

## Implementation (29.10, Opus)

### Findings

- The "main layer" already exists server-side: `src/show-timers/main-video.js` (WO-734) picks, per program screen, the
  topmost playing **non-looped** clip in the live bank (A 10–99 / B 110–199 via `ctx.programLayerBankByChannel`),
  skipping the timer band 980–989, border layer 998 and layers stale for 12 s — the same rules as the kiosk PGM timer.
  Its timing comes from `osc-state` (`file/time`, WO-252 INFO supplement). Reused as is; no new CasparCG call.
  Consequence: a screen showing only looped backgrounds reads "nothing timed" (`active: false`), like the kiosk timer.
- `src/api/router.js` was at exactly 500 lines; the route is registered on the existing `POST /api/screens/label` line
  (`; require('./routes-pgm-layer').register(routes)`). No GET wildcard before it covers `/api/screens/*`, and the
  dispatch pre-handlers (show-timers, shm, module hook, plugins) match exact other paths.
- `steps` is a required field of a Companion simple preset (`@companion-module/base` 2.1.0
  `CompanionSimplePresetDefinition.steps`). The presets carry one empty step `[{ down: [], up: [] }]` (the shape the
  existing display-only presets use) — no actions anywhere; the test asserts the flattened action list is empty.
- Drawing text into a PNG needs a font rasteriser the module does not have. The advanced feedback returns `text`
  (screen label + remaining) and `png64` (the bar only, drawn with `pngjs`, already a dependency) with
  `pngalignment: center:bottom` — the same png64 path as `look_compose_preview_image`.
- `state-sync` rebuilds actions/presets on a screen-count change but not feedbacks, so the new poller calls
  `updateFeedbacks()` when the server's screen count changes (feedback screen dropdown).

### What was done

Server (`/home/casparcg/highascg`):
- `src/api/routes-pgm-layer.js` (new, 68 lines): `pgmLayers()` + `GET /api/screens/pgm-layer` (`requireCaspar: false`,
  `Cache-Control: no-store`). Body `{ ok, serverNowMs, screens: [{ screen (0-based), label, channel, active, layer,
  clip, remainingSec, durationSec, elapsedSec, progress (0..1, = 1 − remaining/duration), paused }] }`, one entry per
  program screen; inactive screens carry `active:false`, nulls, `progress: 0`.
- `src/api/router.js`: registration appended to the screens/label line (file stays 500 lines).
- `docs/wiki/api/contract/http.md`: regenerated (`node tools/dev/gen-api-contract.js`; WO-598 smoke checks it).
- `tools/smoke/smoke-wo803-pgm-layer-readback.test.js` (new, 4 tests) + listed in `tools/ci/offline-test-files-2.js`.

Module (`companion-module-dev/companion-module-highpass-highascg`, 1.0.10 → **1.0.11**):
- `src/pgm-layers.js` (new): `formatRemaining` (mm:ss, h:mm:ss over an hour, rounded up), `barPixels`, `drawBarPng64`,
  `readbackView` (the change signature), `readbackStyle`, feedback **`pgm_layer_readback`** (advanced, option
  `screen` dropdown from `buildScreenDropdown`, no action/learn), per-screen variables
  `highascg_pgm_<n>_{remaining,progress,clip}` (n = 1..4).
  Live: label + remaining on dark red, red bar. Paused: amber + `PAUSED` line, amber bar. Nothing timed / cleared /
  taken out / server unreachable: dim `<label>\n--:--`, no bar.
- `src/bridge/pgm-layer-poller.js` (new): polls every 500 ms; redraws (`checkFeedbacks`) + sets variables only when the
  shown second, bar pixel (of 72), paused/active, clip or label changed — ≤ 1 redraw/s while playing.
- `src/presets/pgm-readback-presets.js` (new): section "HighAsCG · PGM readback", one preset per screen
  `pgm_readback_screen_<n>` named "PGM readback — <screen label>", feedback only, caption from the screen-label variable.
- Wired in `src/bridge/index.js`, `src/feedbacks.js`, `src/variables.js`, `src/presets.js`; `package.json` 1.0.11;
  `CHANGELOG.md` entry; `test/pgm-readback.test.js` (new, 11 tests).

## Verified

- Server offline suite: `node tools/ci/run-offline-tests.js` → tests 3419, pass 3417, fail 0, skipped 2 (includes the
  4 new WO-803 tests; the router test dispatches through the real `routeRequest`, so ordering is covered).
  `check-max-file-lines` 0 over; `check-unwired-exports` and `check-tdz-reads` exit 0; `npx eslint` on the touched
  files clean; `npm run format:check` clean. `check-require-integrity` / `check-script-paths` fail on pre-existing
  items unrelated to this WO (syncthing `*.sync-conflict-*` files under projects/, missing
  `tools/runtime/operator-shape-overlay.py`).
- Live on the box: node restarted with `kill -TERM $(systemctl show -p MainPID --value highascg)`. With "PK CLICK"
  playing on screen Dioda (ch 1, layer 12, cross-checked against `GET /api/show-timers`):
  `curl localhost:4200/api/screens/pgm-layer` → 200,
  `{"screen":0,"label":"Dioda","channel":1,"active":true,"layer":12,"clip":"PK CLICK","remainingSec":991.08,
  "durationSec":2858,"elapsedSec":1866.92,"progress":0.653,"paused":false}` and screen 1 "Proj" (ch 3)
  `active:false`; 3 s later `remainingSec` 988.08, `progress` 0.654.
- Module against the live route (scratch script driving `PgmLayerPoller` + the feedback callback, no Companion): 8 polls
  in 4 s → 4 redraws; `highascg_pgm_1_remaining` "13:31", progress "72", clip "PK CLICK"; button 0 text
  `Dioda\n13:31` with bar png, button 1 `Proj\n--:--` without bar.
- Module tests: `npm test` → 92/92 (81 baseline + 11 new). eslint + prettier clean on the new/touched files.
- Packaged with the module's own script `npm run package` (companion-module-build) →
  `highpass-highascg-1.0.11.tgz`, manifest version 1.0.11, `pgm_layer_readback` present in main.js. **Not installed
  into Companion.**

Not verified (owner QA): the button in a real Companion (render of text + bar, bar width on larger surfaces), the
paused colour and clear on take-out against a real pause/clear (covered by unit tests only — no pause/clear was done on
the live PGM).
