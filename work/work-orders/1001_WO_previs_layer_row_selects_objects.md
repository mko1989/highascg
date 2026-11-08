# WO-1001 — Previs Layers: clicking a layer row selects the objects on that layer
**Area:** godot-client
**Status: DONE (08.11 — Godot suite + boot check; the on-glass click in the owner's GUI is still to do)**

Owner, 08.11: "clicking on the layer in layers in the inspector should select the object its refering to."

## Investigation

- **The Layers list only works one way.** Selecting an object in the 3D view lights the row of its layer.
  - Code: `mvr_section.gd` `_light_layers()` (from WO-647/678) → `color_rows.gd` `highlight()`.
  - A click on a row did nothing. The row is a PanelContainer with a name Label, a colour swatch, ↺ and an eye
    (`color_rows.gd` `_row`). Only the three buttons had handlers.
- **There are two selections, and a layer can feed both:**
  - **MVR objects**, held by the screens tool (`mvr_screens.gd` `_sel`). Each entry is a wall:
    `{uuids, frame, toward}`. A 3D click turns the object into its wall with `mvr_screen_model.gd` `cluster` (the
    touching objects of the same model; a Capture LED wall is one object per panel) and orients the frame towards the
    camera.
    - `objects_picked` makes the Position card follow (`move_targets.gd:32`).
  - **Patched heads**, held by `fixture_selection.gd` `Sel.shared()` with ids `mvr-<uuid>`. A patched fixture's
    MVR object is hidden while the rig draws its head (`mvr_scene.gd` `_show`), but it stays a child that carries
    its `layer` meta.
- `mvr_scene.gd` cannot be loaded in the headless test runner: it references the `Api` autoload ("Identifier not
  found: Api"). So the layer lookup sits in the pure helper file `mvr_screen_model.gd`.
- `mvr_section.gd` was at the 500-line limit.

## What was done

- **`color_rows.gd`:** new signal `row_clicked(name, add)`.
  - A left click on a row (its name or the space around it) emits it; ctrl or shift sets `add`. The swatch, ↺ and
    eye keep their own clicks.
  - Only rows of a list that has something connected get the hand cursor and the "Click: select the objects on …"
    tooltip, so the fixture Body-colour rows stay plain.
  - An empty layer's row (WO-706, disabled) has nothing to select.
- **`mvr_screen_model.gd`:**
  - `on_layer(nodes, layer, all)` returns the uuids of the objects on a layer: the visible ones, or with `all` the
    hidden patched ones too.
  - `layer_walls(items, uuids, taken)` returns the layer's walls, as if each object had been ctrl-clicked. It clusters
    among the layer's own objects only, so a touching object on another layer is not pulled in. Walls already
    selected are skipped.
- **`mvr_screens.gd` `select_layer(layer, add, patched, picked)`:**
  - The layer's visible objects become the wall selection. Each frame faces the 3D view's camera
    (`scene.get_viewport().get_camera_3d()`, else downstage).
  - The layer's heads patched from this scene become the fixture selection.
  - With `add`, both selections keep what was already selected.
  - It calls `picked` (the section's `objects_picked.emit`) when walls were selected.
- **`mvr_section.gd`:** one line connects the rows to `select_layer`. The Export tooltip `if` was folded onto one
  line to stay at 500.

## What was VERIFIED

- **Godot:** `--test` **26126 passed, 0 failed**. New `test_previs_model_tint.gd`
  `test_layer_row_click_selects_its_objects` covers:
  - a click emits, a shift-click adds, and an empty layer emits nothing;
  - the tooltip shows only when something is connected;
  - `on_layer` returns the visible objects, and with `all` the hidden ones too;
  - `layer_walls` makes touching panels one wall and a far panel its own, ignores a neighbour on another layer, and
    skips walls that are already selected.
- `--check` boot OK (no script errors). The smokes that read these files (WO-706, WO-785) pass 7/7. No file is over
  500 lines.
- **Not yet on glass.** The active project ("narvil", the Capture scene `405f970d98a2`) has layers to try it on. A
  click in the owner's GUI needs pointer automation, which is asked for first.
