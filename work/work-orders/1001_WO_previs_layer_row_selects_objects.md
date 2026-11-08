# WO-1001 — Previs Layers: clicking a layer row selects the objects on that layer
**Area:** godot-client
**Status: DONE (08.11 — Godot suite + boot check; real mouse on the owner's GUI: Narvil's two Dioda walls selected by their Layers rows and mapped onto PGM/PRV 1 at P3.9, test card seen on both)**

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
- **The first version, tried with the real mouse on Narvil, split each wall into about 70 "walls".** Clicking "Dioda 8 x 4"
  listed 7.00 × 4.02 m (112 objects) three times, plus 7.00 × 0.27 m bars, 0.05 × 4.00 m legs, and 0.26 × 1.86 m and
  0.40 × 0.84 m parts.
  - Capture draws each panel as several objects of different models, plus rigging. `cluster` is per model, so every
    part type and every bar became its own wall, and Map would have built an LED screen for each one.
  - Dioda layer contents: 4 meshes × 112 for "8 x 4" (14 × 8 panels = 7 m; the layer's name says 8), and 4 × 80 for
    "5 x 4m" (10 × 8).
- **Map then fell back to P4.8.** Capture draws Narvil's 500 mm panel 502.9 mm tall. `panel_mm_for` takes the drawn cell, so
  P3.9 gave 128 × 129 px, and 8 rows (1032 px) overflowed the destination's 1024. Map picked the coarsest pitch: a
  2496 × 840 px canvas.

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
  - `layer_walls(items, uuids, taken, min_face = 4)` (rewritten after the mouse run) returns `[{uuids, also}]`:
    - A wall is a connected group of the layer's objects, of any model. Only the layer's own objects count, so a
      touching object on another layer is not pulled in.
    - Its face (`uuids`, which give the frame and the panel count) is the group's largest same-model `cluster`, the
      same set a 3D click on a panel picks. The rest of the group goes in `also`.
    - A group whose face has fewer than 4 objects (a leg, a bar) is not a screen: it joins the largest wall's `also`.
      With no wall on the layer at all, each group stays its own entry.
    - Walls already selected are skipped.
  - `panel_mm_for`: a drawn panel within 2% of the preset's size counts as the preset (Narvil's 502.9 mm → 500).
- **`mvr_screens.gd` `select_layer(layer, add, patched, picked)`:**
  - The layer's visible objects become the wall selection. Each frame faces the 3D view's camera
    (`scene.get_viewport().get_camera_3d()`, else downstage).
  - The layer's heads patched from this scene become the fixture selection.
  - With `add`, both selections keep what was already selected.
  - It calls `picked` (the section's `objects_picked.emit`) when walls were selected.
  - `also` rides along everywhere: the info line counts it, `selection_changed` (Layers highlight, Position card)
    includes it, a ctrl-click on a rigging part toggles its wall, and Map hides it with the wall.
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
- **After the rewrite:** `--test` **26131 passed, 0 failed**, with a 2 m wall (4 face + 4 body parts, a bar, a lone
  leg) giving one wall; the face is the 4 panels, and the bodies, bar and leg are `also`; a panel on another layer stays
  out. `test_mvr_screen_model.gd` covers 502.9 mm becoming 500 for the 500 mm preset only.
- **Real mouse on the owner's GUI** (owner, 08.11: "You can do Tests with mouse"; xdotool on `:0`, screenshots, then
  the pointer put back):
  - **First run:** the Dioda 8 x 4 row gave about 70 walls (the bug above).
  - **After the fix:** clicking "Dioda 8 x 4" gave "Selected: 7.00 × 4.02 m (518 objects) — layer Dioda 8 x 4".
    Ctrl-clicking "Dioda 5 x 4m" added "5.00 × 4.02 m (362 objects)".
  - **Map onto PGM/PRV 1 (3328 × 1024 → pgm1):** "Mapped 2 walls onto pgm1: canvas 3072 × 1024 px", with the 880 MVR
    objects hidden.
    - Stage objects: `led_wall_1` 14 × 8 panels, 128 px, crop x 1280 w 1792; `led_wall_2` 10 × 8, crop x 0 w 1280.
      Both are 1024 high and face the audience (rotation 0).
    - Before the panel fix the same Map gave 104 × 105 px panels and a 2496 × 840 canvas. That map was undone through
      autosave (the previs slice put back from the backup) before the re-run.
  - **Front camera with the test card on:** the panel grid and crosshair span both walls. The test card was switched
    off again afterwards.
  - The mapping stays in the project. The owner asked for it ("map my destination to the two dioda LED screens").
- **Open for the owner:** the file draws "Dioda 8 x 4" as **7 m** (14 panels). 3328 px = 26 × 128 means 16 + 10
  panels, so the real wall is probably 8 m. If so, set LED wall 1 to 16 × 8 in the Stage panel, and its crop to
  x 1280, w 2048.
