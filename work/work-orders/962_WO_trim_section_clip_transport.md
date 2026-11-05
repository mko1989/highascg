# WO-962 — Trim section: clip transport buttons
**Area:** godot-client
**Status: DONE (5.11, verified: Godot unit tests, node smoke, GUI e2e --air on a throwaway Caspar)**

Owner: "trim inside layer inspector is missing clips transport buttons."

## 1. Investigation

- The web look inspector had a transport row in WO-570 (`client/components/inspector-media-transport.js`): play/pause, a
  scrub bar and "set in / out from the playhead". The playhead-capture part is what Trim in / Trim out above the slider
  already do in Godot (WO-813: they store the slider position). Godot's `clip_trim_section.gd` had the slider (PRV scrub via
  `POST /api/scene/layer-scrub`, WO-813/WO-790) but no transport buttons.
- Server: scrubbing exists (`routes-scene-layer-scrub.js`, PRV only, PGM never touched). Pause/resume exist only as
  `/api/pause` / `/api/resume` that need a raw channel the Godot client does not know for a look's PRV copy, and the layer-scrub
  route already resolves that channel and the "this look is on PRV with this clip" check. So play/pause went into that route.
- Icons: prev / next / play / pause exist (`assets/ui/icons`); a plain frame step needed two new triangles.

## 2. What was done

- `clip_trim_model.gd`: `jump_ms(layer, dur, JUMP_IN|JUMP_OUT, fps)` (in point; last frame before the out point, never before in)
  and `step_ms(cur, ±1, dur, fps)` (one frame, clamped to the clip).
- `clip_trim_section.gd`: a transport row under the slider: jump to in (prev icon), back a frame (step_back), play/pause
  (icon follows state), forward a frame (step_fwd), jump to out (next icon). Moves go through the slider, so they use the same
  paced PRV scrub as a drag. Play/pause posts `layer-scrub` with `transport: "pause"|"resume"`; off PRV the status line says so
  (the scrub note) and the icon stays. Disabled while the clip length is unknown. Trim in/out/reset behaviour unchanged.
- `routes-scene-layer-scrub.js`: optional `transport: 'pause'|'resume'` (no `ms`), after the existing PRV checks, runs
  `amcp.pause/resume` on the PRV channel and `playback-tracker.recordPause/recordResume`. Additive; scrub unchanged.
- New icons `step_back.svg`, `step_fwd.svg`: a small bar plus triangle (`◀|`, `|▶`). The first draft's `step_fwd` was the same
  triangle as Play; the parent session redrew both after viewing the screenshot.

## 3. Verified

- Godot `test_wo962_trim_transport.gd` (jump/step targets) in the full suite: 0 failed; `run-client.sh --check` boot OK.
- `tools/smoke/smoke-wo962-layer-transport.test.js` (2 tests) + the WO-787 smoke: pass.
- GUI e2e `20_wo962_trim_transport` (`--air`, real throwaway Caspar): look staged on PRV, Trim opened, jump out (clip time > 3 s),
  pause (button turns into Play, Caspar layer `paused=true`), jump in (< 0.1 s), forward x3 (0.05-0.2 s) and back x1 on the paused
  clip, play (`paused=false`, time advances). 9/9 passed; screenshots looked at (row fits the Inspector column).
- Re-run after the icon redraw: e2e 9/9 again. The cropped row shows five distinct icons: `|◀` `◀|` `▶` `|▶` `▶|`.
- The smoke is curated in `tools/ci/offline-test-files-2.js`.
- Known limit: the play/pause icon follows only this section's own presses (a fresh stage is assumed to play), so a pause
  done elsewhere can leave it out of step.

Owner QA: open a clip layer's Trim on the box with the look on PRV and press each button.
