# WO-679 — Previs: right-click a head, hold and move to point the light

**Status: DONE (22.10, Godot 20962/0; box: right-drag on a Sharpy swung its beam right then left across the floor)**

Owner, 22.10: *"do a right click for pointing a head allow for holding down button and moving the light."*

## Investigation

- Pointing already existed as Programmer → "Point at" (WO-615 T6): a toggle, then a left click on the floor.
  `fixtures_3d.gd` `click` emits `sel.aim_at`, and `programmer_section.gd` `_aim` posts
  `/api/fixtures/program/aim {ids, target}`. The server aims through the follow IK (`src/fixtures/follow-ik.js`) and
  writes Pan / Tilt into the programmer. The heads redraw from the `tracking:fixtures` WS.
- That is one shot per click, and it needs the toggle. Nothing used the right mouse button in the previs 3D view:
  `previs_stage.gd` orbits on left and zooms on the wheel. `previs_tab.gd` `_on_3d_input` picks on a left click.
- `previs_tab.gd` was 488 lines, so the drag logic had to live in its own file.

## What was done

- New `features/previs/fixtures/aim_drag.gd`:
  - a right press on a fixture body starts a drag; a head outside the selection selects it alone, a head inside it
    keeps the selection, so a group can be aimed together;
  - mouse motion → floor hit (`F.floor_hit`) → aim the selection there;
  - one request in flight; moves meanwhile keep only the newest target, so a fast drag never queues stale aims;
  - release (after the last reply) emits `sel.aimed`;
  - a right press that misses every head is left to the stage;
  - the poster is injected (`post`), so the file loads in the `-s` test runner (no autoloads).
- `fixtures_3d.gd`: the body hit test is split out of `click` into `hit(cam, pos)`.
- `fixture_selection.gd`: `signal aimed`. `programmer_section.gd`: `sel.aimed` → `_on_selection` (the Pan / Tilt
  sliders follow the drag).
- `previs_tab.gd`: `aim_drag.input(...)` runs before the stage handles the event; `aim_drag.post` → `Api.post_json`.
- The drag only points the head. It does not open the dimmer: a dark head turns, but shows no beam.
- `tests/test_aim_drag.gd`: press, miss, left button, keep / replace the selection, release → `aimed`, newest target
  wins while busy.

## Follow-up 22.10 — "the right mouse click doesnt work on previs"

- The owner's attempt left only a "Point at" left-click result (status "Pointed 1 at -2.8 / 8.1 m"). Only one head
  had its dimmer up.
- On the owner's own camera view, an xdotool right-drag on that head worked: the spot landed on the cursor and the
  sliders followed (−62° / 64°).
- Likely causes:
  - a right-press beside a head's small body box (truss heads are a few pixels from the default view) fell through
    to the stage;
  - a dark head (dimmer 0) was dragged: it turned, but showed no beam.
- Made forgiving:
  - `fixtures_3d.gd` `near(cam, pos, px)`: a head counts within `NEAR_PX` = 28 px of its body centre on screen
    (right-drag only; the left click keeps the exact hit);
  - with a selection, a right press on the floor aims it there at once and the drag continues;
  - a press with nothing selected and no head near is still left to the stage.
- Verified:
  - Godot 20964 / 0;
  - box after relaunch, default Fit view: a right-drag starting on a truss head (`mvr-f565…`) aimed it (Pan
    −143° / Tilt −46°); a right press on the floor moved it again (−148° / −61°); test head released.

## What was VERIFIED

- Godot tests 20962 / 0, the 500-line limit is clean.
- Box, GUI relaunched on "Pabianice Final Patch", Previs 3D:
  - right-dragging the stage-front Sharpy (`mvr-4e51…`) changed its programmer Pan from 143.14 to 167.25;
  - with its dimmer up, screenshots mid-drag show the beam landing toward the cursor on the right, then on the
    left;
  - afterwards the test head was released (`DELETE /api/fixtures/program?id=…`); the other programmed head was left
    as it was.
- Owner QA:
  - right-drag a lit head and a selected group;
  - left-drag still orbits;
  - with DMX output on, the real heads follow.
