# WO-703 — Preset stage marks from the tracking grid

**Area:** lighting
**Status: DONE (23.10.26: Godot 21197/0, smoke-wo700 14/14, boot check OK; button press = owner QA)**

Owner 23.10: "we need a prebuilt marks similar to what the camera calibration has. but just 6 8 points around the
stage and dead center."

## Investigation

- The camera calibration's floor points come from the tracking grid `project.previs.tracking.grid`
  (`tracking_model.gd` `grid_corners`: DSR (−x, −y), DSL, USL, USR; stage left = +X, downstage = −Y). The default is
  `GRID_DEFAULT` 10 × 6 m centred at Y 3.
- The box's live grid is 6 × 3 m, centred at X 0, Y 3, so the corners are (±3, 1.5) and (±3, 4.5). The owner's
  hand-placed Marks 1–4 (≈ ±3, 1.7 / 4.6) are those corners, which supports the choice.
- Lighting marks are `project.fixtures.marks` `{id, name, x, y, z}` (WO-700, `F.normalize_marks`).

## What was done

- `follow_model.gd` `preset_marks(grid, marks)`: 9 marks, clockwise from DSR: DSR, DSC, DSL, SL, USL, USC, USR, SR,
  then **Centre**. The 4 corners plus 4 edge middles are the "8 points around the stage"; Centre is the "dead
  center". Each is at the grid's z, rounded to mm.
  - A preset name that is already in the list is skipped, because that mark may have been measured; pressing the
    button again adds nothing.
  - New ids follow the highest existing id.
- `calibrate_fold.gd`: a **Preset marks** button between Place mark and Remove mark. It reads the grid through
  `T.normalize(previs.tracking)`, the same normalizer the camera calibration uses, and saves through `_persist`.
- The edit was written so the file compiles at every step, because the owner's GUI runs from the live tree.

## Verified

- Godot `run_tests.gd` **21197 passed, 0 failed**.
  - New test `test_preset_marks_follow_the_tracking_grid`: names and order, corner / centre positions, ids, a
    measured "Centre" is kept, a repeat press adds nothing, and the offset grid plus z are used.
- `smoke-wo700` **14/14**, including the WO-703 source pins. `run-client.sh --check` boot OK.
- Owner QA: Lighting → Calibrate heads → **Preset marks**. Expect 9 marks named DSR…Centre on the grid. Then tape
  the real spots (or adjust X / Y to the tape) and pin them with "Beam is on <mark>".
