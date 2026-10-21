# WO-659 — Live view toolbar icons: clock for Times, cube for 2D / 3D

**Status: DONE (2026-10-21, `--check` OK; box screenshots: 2D shows □ + clock, 3D shows the 3-face cube)**

Owner 21.10: "a clock icon for the times button in 2d view, for 3d 2d a cube thats either only one side is visible or
3. should be extremly simple".

## Investigation

- `godot/client/features/live/live_tab.gd` `_view_switch()` built text buttons: the view toggle wrote "2D" / "3D"
  in `set_view()`, Times wrote "Times". Icons come from `assets/ui/icons/*.svg` via `app/ui_icons.gd` (runtime
  raster, no import). The existing `timer.svg` is a stopwatch (crown on top) — the owner asked for a clock.

## What was done

- New icons: `clock.svg` (circle + two hands), `cube_face.svg` (one square = one side of the cube = 2D),
  `cube.svg` (isometric hexagon, three visible faces = 3D). README.txt notes them.
- `live_tab.gd`: Times button uses the clock icon; `set_view()` swaps the toggle's icon (cube_face / cube) instead of
  its text. Tooltips kept (Times tooltip now starts "Times:"); both buttons `FOCUS_NONE`.

## What was VERIFIED

- `run-client.sh --check` boot OK.
- Box: relaunched; 2D toolbar shows □ · clock · Auto; clicked the toggle → 3D shows cube · Fit · Lights; toggled back.
