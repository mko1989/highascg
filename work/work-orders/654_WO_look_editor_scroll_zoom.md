# WO-654 — Look editor: scroll to zoom

**Status: DONE (2026-10-21, Godot tests 20729/0; box: 3 wheel notches zoom about the pointer, boxes track the PRV picture, 3 back = fit)**

Owner 21.10: "should be able to zoom in and out with a scroll in look's editor."

## Investigation

- Every editor rect (PRV video, layer boxes, handles, hit-tests, snap thresholds) derives from one function,
  `look_editor.gd _box()` — the letterboxed canvas rect inside `_frame`. Zoom/pan therefore only has to change `_box()`;
  drag maths already divide by `b.size`, so a drag at 4× moves the fill 4× finer.
- `look_editor.gd` sat at exactly 500 lines (CI limit), so the state and input handling go in a new pure helper.

## What was done

- New `godot/client/features/live/look_editor_view.gd` (RefCounted, pure): `zoom` (0.5×–8×, STEP 1.15 per notch),
  `pan`, `box(frame, canvas)`, `zoom_at(at, steps, …)` (keeps the canvas point under the pointer fixed; back at 1×
  snaps pan to 0 = centred), `input(event, …)`: wheel up/down, trackpad pinch (MagnifyGesture), middle-drag pans,
  middle double-click fits. Returns true for a view gesture so left-button layer drags are untouched.
- `look_editor.gd`: `_box()` = `_view.box(_frame.size, _canvas())`; `_frame_input` hands events to `_view.input` first
  and accepts them (the Live tab scroll never sees the wheel); `open()` resets the view. File still 500 lines.
- New `godot/client/tests/test_look_editor_view.gd` (11 assertions: fit, pointer-anchored zoom, recentre at 1×, clamps,
  wheel/middle-drag/double-click, left button and post-release motion not consumed).

Also in this unit (owner 21.10 "in layer inspector the toggles boxes are as wide as the drop downs"): the CheckBoxes
in `layer_inspector.gd` (`_check`), the aspect lock (`layer_geometry_section.gd`) and the media inspector mute get
`SIZE_SHRINK_BEGIN` — the GridContainer stretched them, and the theme's Button box made them look like empty
dropdowns. Same flag the timeline clip inspector already used. Box: Loop / Straight alpha / Mute / Aspect lock compact.

## What was VERIFIED

- `./run-client.sh --check` boot OK; `--test` 20729 passed, 0 failed.
- Box: Look 1 editor, 3 × wheel-up over the L11 box → zoomed about the pointer, the L11 box still on the clip;
  3 × wheel-down → back to the fit. Screenshots in the session scratchpad.
- Owner QA: middle-drag pan, pinch on a trackpad.
