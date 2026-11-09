# WO-1004 — Previs: picking a head no longer scrolls the Inspector away from the Programmer
**Area:** godot-client
**Status: DONE (09.11 — Godot suite 26139/0 with a new layout test that fails on the old code; owner GUI picks it up on its next relaunch)**

Owner, 09.11: "when i select a different head in the previs the inspector goes back to top and i want it to stay on
programmer for instance."

## Investigation

- A head pick emits `fixture_selection.gd` `changed`. Among its listeners, `mvr_section.gd:121`
  `Sel.shared().changed.connect(_light_layers)` → `color_rows.gd` `highlight()` (WO-647/678: mark the layer rows of
  what is selected).
- `highlight()` then called `ensure_control_visible` on the first marked row, in the nearest ScrollContainer.
  - When WO-647 was written, the Layers list had a scroll of its own.
  - Since WO-948 the Layers fold sits directly in the 3D Inspector page. So the nearest ScrollContainer is the whole
    Inspector column (`app/inspector_panel.gd` `add_tab`).
  - Every head pick (with an MVR layer) therefore jumped the column up to MVR scene → Layers, far above
    Lighting → Programmer.
- `fill()` re-applies `highlight(_lit)` on every project reload, so a reload with unchanged marks scrolled too.

## What was done

- `godot/client/features/previs/color_rows.gd` `highlight()`: it still marks the rows every time. It scrolls only
  when both of these hold:
  - the marks changed, and
  - the rows' rect already intersects the scroll's visible rect.
- Effect:
  - When you are looking at Layers, the newly marked row is still brought into view (WO-647 intent).
  - When you are on the Programmer (or anywhere else), the column stays put.
- Alternative not taken: dropping the scroll for fixture-selection highlights only. An MVR-object pick from the 3D
  view would still have yanked the column, and the owner's ask is general ("stay on programmer").

## What was verified

- New test `tests/test_previs_model_tint.gd` `test_highlight_leaves_the_inspector_where_it_is`. It builds a real
  ScrollContainer layout (rows between a 1000 px block and a 2000 px "Programmer" block) and checks:
  - rows off screen → scroll unchanged;
  - rows on screen → the marked row is scrolled into view;
  - same marks again → no scroll.
- With the old `color_rows.gd` the test fails twice: 3974 → 1979, and a reload scrolled 1004 → 1853.
- With the fix, the full Godot suite is 26139 passed / 0 failed.
- Not live yet: the owner's running GUI loads the change on its next relaunch.
