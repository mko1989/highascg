# WO-1007 — Previs: LED walls without the dark panel-seam grid
**Area:** godot-client
**Status: DONE (09.11 — owner's client relaunched; screenshot shows the walls without seams, only the test card's own cell borders)**

Owner, 09.11: "the previs is adding a grid of black lines (to indicate panels) to the led wall and i dont want that."

## Investigation

- `godot/client/features/previs/stage_builder.gd` `_build` gives every Stage-builder `led_wall` the LED shader with:
  - `seam_px` 1.5: a dark line at every panel edge;
  - `pixel_grid` 0.6: dark gaps between LEDs, faded out with distance (`led_screen.gdshader`).
- Narvil's walls are Stage objects `led_wall_1` / `led_wall_2` (tied to the MVR walls, 128 px panels), so the seams
  drew a 128 px grid over the picture.
- MVR VideoScreens (`mvr_scene.gd`) never set either parameter.

## What was done

- `stage_builder.gd`: `seam_px` set to 0 for LED walls.
- The per-LED `pixel_grid` (visible only up close) stays.

## What was verified

- Godot suite 26144 / 0; `run-client.sh --check` boots clean.
- On the owner's client, relaunched on Previs: the walls show the test card with no extra seam lines. The remaining
  lines are the card's R×C cell borders, which are content.
