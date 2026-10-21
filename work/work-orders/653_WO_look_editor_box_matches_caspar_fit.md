**Status: DONE (2026-10-21; Godot 20718/0, box: the L11 box hugs the clip, Geometry 785, 262, 1528 × 611)**

# WO-653 — Look editor: a layer's box is ~1.7× wider than what Caspar shows

Owner, 21.10: *"something is still wrong with layer math, gui vs caspar. in caspar it displays correctly yet in gui
its almost twice as width."*

## Investigation

- Box screenshot, 21:18 (Look 1, L11 selected):
  - The editor box runs x 680–1370 px of the frame; the clip in the PRV picture under it runs 680–1090.
  - The left edges match; only the width is off.
- The project:
  - Canvas `programResolutions[0]` = 3072×1024.
  - L11: `contentFit: 'native'`, `aspectLocked: true`, fill `scaleX 0.8394 · scaleY 0.5969` = 2579×611 canvas px (4.2:1).
  - The clip (`/api/media`): `projects/dtlodz/00. Intro MAIN loop_HAP.mov`, 2560×1024 (2.5:1).
- The server (`src/engine/scene-native-fill.js`):
  - `mapContentFitToStretch`: aspect locked + `native` → `'none'`.
  - `calcMixerFill` `'none'` / `'fit'`: `fitScale = min(lw/cw, lh/ch)`. The clip is drawn at its own aspect INSIDE the
    fill, anchored top-left: 611 × 2.5 ≈ 1528 px wide. That is what PGM / PRV show.
- The Godot editor (`look_editor.gd _fill_rect(l.fill)`) drew, hit-tested and resized the raw fill. Any fill whose
  aspect differs from its clip's shows a wider (or taller) box than Caspar. The Geometry fields showed the raw
  2579 × 611.

## What was done

- `features/live/layer_fit_math.gd` (pure): `stretch_mode` + `shown_fill`, a port of `mapContentFitToStretch` +
  `calcMixerFill` with the authoring canvas = the target channel. Media only; route://, templates and live sources
  keep the raw fill, as on the server.
- `features/live/look_editor_fit.gd`: the clip size per source, asked once from `POST /api/scene/layer-fit` (the
  server's own probe, which the layer inspector already uses).
- `look_editor.gd`: the box, its handles, the hit test, the snap candidates and the Geometry fields all use the
  shown fill. A drag starts from the shown box, so the first move or resize stores the box Caspar shows. The stored
  fill then has the clip's aspect, and the mismatch is gone for good.
- `look_editor.gd` is held at 500 lines (two one-line functions, one header line).

## What was VERIFIED

- Godot `--test` 20718 passed, 0 failed. `test_layer_fit_math.gd` covers:
  - the box case: 2579×611 fill + 2560×1024 clip → 1528×611, x / y kept;
  - each mode: unlocked / stretch → raw; fill-h; fill-v; unknown size: native → raw, fit → 16:9;
  - route / template / route:// media → raw.
- `--check` boot OK.
- Box (21.10, 21:23, DP-0; after the owner stepped away, since they were working on the screen at first):
  - Look 1 in the editor: the L11 box and its handles sit on the clip's own edges (before: 1.7× wider).
  - Geometry reads X 785, Y 262, Width 1528, Height 611 (before: 2579 × 611).
