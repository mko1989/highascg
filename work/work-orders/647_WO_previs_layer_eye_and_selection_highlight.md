# WO-647 — Previs Layers: an eye per layer, and the 3D selection lights its layer row

**Area:** godot-client
**Status: DONE (2026-10-21; Godot 20696/0, box: a 3D click lights the layer row, the eye hides / shows the layer and saves it)**

Owner, 21.10: *"3d previs lacks a highligth of an item selected in 3d to the list in layer colors. next to color
there should be an eye for hidding the layer."*

Builds on [WO-641](./641_WO_previs_model_colours.md) (layer colours) and
[WO-640](./640_WO_previs_side_column_into_inspector.md) (the Inspector folds).

## Investigation

- Layer colours (`features/previs/color_rows.gd`, WO-641) were rows of name / colour / reset. Nothing tied them to the
  3D view.
- Hiding a layer lived in a separate "Layers" MenuButton of check items in `mvr_section.gd` (`_layers`, `_fill_layers`,
  `_toggle_layer`, writing `previs.mvr.hidden_layers`). So there were two lists of the same layers, one per job.
- A 3D click selects through `mvr_screens.gd` (`scene.pick` → `_sel`, then `refresh()`). It knew the picked object
  uuids but no layer. `mvr_scene.gd` had the layer per object only inside its build code.

## What was done

- `color_rows.gd`:
  - an optional eye per row (`eyes = true`; `assets/ui/icons/eye.svg` / `eye_off.svg`, toggle button);
  - `visibility_toggled(name, shown)`;
  - `fill(…, hidden)` sets the eyes;
  - `highlight(names)` frames the matching rows in the accent colour and scrolls the first one into view. Lit and
    unlit rows have the same margins (`_row_box`), so lighting a row never moves the list (box finding, below).
- `mvr_section.gd`:
  - the separate Layers menu is removed; the fold is "Layers", one list for colour and visibility;
  - an eye edits `hidden_layers` and saves (so Ctrl+Z, WO-642, covers it);
  - the screens' `selection_changed` → `highlight(M.layers_of(uuids, scene.layer_of))`.
- `mvr_scene.gd` `layer_of(uuid)`; `mvr_model.gd` `layers_of(uuids, layer_of)` (distinct, in order).
- `mvr_screens.gd`:
  - `selection_changed(uuids)` on every refresh;
  - the "Selected: …" line adds " — layer X".
  - Both callers guard a null `scene`. `--check` caught that on boot: `Invalid access to property or key 'layer_of'
    on a base object of type 'Nil'`.

## What was VERIFIED

- Godot `--test` 20696 passed, 0 failed. `test_previs_model_tint.gd::test_layer_rows_eyes_and_highlight` covers:
  - the eye state from `hidden`;
  - the toggle signal;
  - only the selected layer lit;
  - lit and unlit rows the same size.
- `--check` boot OK.
- Box (21.10, 20:45, Pabianice Final Patch, 418 objects):
  - Clicking a truss selects it (yellow), and the **Default Layer** row lights up. After the margin fix the rows
    below no longer jump.
  - The Default Layer eye hides the trusses, stage and walls and shows the closed eye. The project file then has
    `hidden_layers: ['Default Layer']`.
  - Clicking the eye again shows them again (`[]`).
- Not seen on the box: the " — layer X" suffix on the Selected line (test-covered via `layers_of`). A hidden object
  that was selected keeps its selection frame; owner QA whether that should clear.
