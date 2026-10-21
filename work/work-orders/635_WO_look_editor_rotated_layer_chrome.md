**Status: DONE (2026-10-21) — Godot --test 20611/0, offline 3073/0; box: Look 1 L10 at 29.5° — frame, label, handles on the picture, edge drag resizes along the layer's width.** Parent: [WO-600](./600_WO_godot_port_live_core.md) (F — Godot look editor).

# WO-635 — Look editor: a rotated layer's frame/handles stay axis-aligned

Owner 21.10: "when rotation is applied on a layer in a look, the content rotates but the border from godot doesnt".

## Investigation

- The picture: Caspar rotates a look layer about its own centre — `src/engine/scene-layer-rotation-amcp.js:8-9,45-46`
  sends `MIXER ANCHOR 0.5 0.5` then `ROTATION <deg>` (client/lib/scene-layer-rotation-amcp.js: "Look-layer rotation
  uses compose-style center pivot"). The web compose draws the same way (`scenes-compose.js:280`
  `rotate(deg)` on the layer box; `preview-canvas-draw-stacks.js:121-125` translate to the fill centre, rotate,
  translate back), and so does the Godot look thumbnail (`look_thumb.gd:67-70`, Transform2D about the fill centre).
- The Godot look editor's overlay (`godot/client/features/live/look_editor.gd` `_draw_frame`, lines 185-204) draws
  each layer's outline, `L# name` label, crop rect and the selected layer's 8 handles with plain `draw_rect` at
  `_fill_rect(fill)` — `rotation` is never read in the file. So over the live PRV picture the content turns, the
  chrome does not.
- Input has the same gap: `_begin_drag` hit-tests handles and layer bodies against the unrotated rect
  (`_handles(r)`, `_fill_rect(...).has_point(at)`), and `_frame_input` feeds screen-space deltas to `C.edge_resize` /
  `C.crop_delta`, which work in the layer's own axes — on a layer turned 90° dragging the right edge would grow it
  vertically.

## Fix plan

- One transform per layer: rotation (degrees, positive = clockwise on screen, as CSS/Caspar) about the fill-rect
  centre; the overlay draws each layer's chrome under it.
- Hit tests map the pointer through its inverse (handles, layer pick); resize/crop deltas are rotated into the
  layer's axes. Move stays screen-space (FILL x/y is the unrotated box's position, the pivot moves with it).

## What was done

- `godot/client/features/live/compose_math.gd` — `layer_xform(r, deg)`: rotate `deg` (clockwise on screen) about the
  rect's centre, the same pivot as Caspar's `MIXER ANCHOR 0.5 0.5` and `look_thumb.gd`. It lives here (autoload-free)
  so the headless test runner can load it; `look_editor.gd` needs `Store`.
- `godot/client/features/live/look_editor.gd`
  - `_deg(l)` reads the layer's `rotation`.
  - `_draw_frame`: each layer's outline, label, crop rect and handles are drawn under
    `draw_set_transform_matrix(C.layer_xform(r, deg))`, reset to IDENTITY after — the chrome turns with the picture.
  - `_begin_drag`: handles are hit-tested at `layer_xform(...).affine_inverse() * at`; the layer pick does the same, so
    clicking beside a turned box no longer grabs it. The drag stores `deg`.
  - `_frame_input`: resize and crop deltas are rotated by −deg into the layer's axes before `edge_resize` /
    `crop_delta`; move stays screen-space (FILL x/y is the unrotated box, the pivot moves with it).
- Why not rotate the whole overlay: layers have different angles and the canvas border must stay upright.

## What was VERIFIED

- `godot/client/tests/test_look_editor_rotation.gd` (new): centre fixed; at 90° the right-edge handle point (300,100)
  of a 200 × 200 box at 100,0 lands at (200,200) (clockwise); the inverse maps back; a point beside the turned box
  misses; 0° = IDENTITY. Godot `--test` 20611 pass / 0 fail, `--check` boots; offline suite 3073 pass / 0 fail;
  no file over 500 lines.
- Box, owner's "Look 1" (main 1 → PRV), L10 "1. Główne Tło…HAP.mov" at rotation 29.5: before, an upright frame over
  a turned picture; after, outline, `L10` label and the 8 handles sit on the turned picture's corners and edges.
  Dragging the right-edge handle outward along the turned edge grew Width 1699 → 1935 (Height follows, aspect lock);
  the layer was typed back to 161 / 225 / 1699 × 595 afterwards.
- Owner QA: crop handles on a rotated layer (`Crop`), and a rotated layer near the canvas edge.
