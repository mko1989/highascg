# WO-948 — Previs Inspector: ordered by job, empty lists collapse, MVR rows only with a scene, unlabelled rows labelled

**Area:** godot-client
**Status: DONE (05.11.26 — Godot suite 25837/0, boot check OK, max-file-lines 0; deployed to the second dev box's client and looked at: before / after screenshots below) — owner QA**

Owner 05.11: *"also try to do a clean up and better organization of the inspector inside the previs tab."*

Related: [WO-640](./640_WO_previs_side_column_into_inspector.md) (the page in collapsible folds), [WO-699](./699_WO_previs_lighting_inspector_groups.md) (Lighting's own folds).

## 1. Investigation (the 3D-mode page on a fresh project, box 05.11)

Order was Position · Stage · MVR scene (with a Layers fold) · Lighting (Add fixtures, DMX output, Programmer, Calibrate heads) · Models · Live source · Camera · Screens (live texture) — `previs_tab.gd` `_build_panel`.

- **Blank space:** five lists kept a fixed height when empty — stage objects 110 px (`stage_panel.gd:63`), Models 120 (`previs_tab.gd:476`), live-texture Screens 120 (`:493`), Programmer heads 110 (`programmer_section.gd:45`), stage marks 140 / 96 (`rig_calibrate_fold.gd:50`, `calibrate_fold.gd:46`). On a fresh project most of the scroll was empty boxes.
- **Order against the job:** the view controls (Camera Front / Top / ISO, Live source) were at the very bottom; Models (stage content) sat under head calibration.
- **"Layers" swallowed four unrelated rows:** in `mvr_section.gd` the Layers fold came before the scene position X/Y/Z/turn + Fit, the "click an LED wall…" hint and the Patch fixtures / Art-Net / Unpatch row, so they read as layer content — and with no MVR scene loaded all of them showed, doing nothing.
- **Unlabelled:** the position row (prefixes only), Add fixtures' type / mode selects (an empty second dropdown when no type) and the protocol · U · × row.

## 2. What was done

- `features/previs/previs_ui.gd` (new): `fit_list` (an ItemList as tall as its rows up to a cap, refitted on redraw; empty = one thin line), `fit_scroll` (a ScrollContainer as tall as its content up to a cap), `caption`.
- `previs_tab.gd`: order **Position · View · Stage · Models · Screens (live texture) · MVR scene · Lighting**; "View" = the old Camera and Live source folds in one, each with a caption. Models / Screens fit their content.
- `stage_panel.gd`, `programmer_section.gd`, `rig_calibrate_fold.gd`, `calibrate_fold.gd`: their list fits its rows (8 / 8 / 6 / 5 max).
- `mvr_section.gd`: the Layers fold moved below the scene's rows; the position row captioned ("Scene position — stage left · upstage · up (m), turn (°)"); the position row, its caption, the map hint, the patch row and Layers are hidden until a scene is shown (`_scene_rows`, set on `_on_loaded`). Two long doc comments shortened to stay at the 500-line limit.
- `fixtures_section.gd`: captions "Fixture type" and "DMX mode · then protocol, universe and how many to add".
- No behaviour changed: same controls, same handlers, same folds' remembered open state (user://ui.cfg — "Camera" / "Live source" keys are now "View").

## 3. What was verified

- Godot suite **25837 passed, 0 failed**; `run-client.sh --check` boot OK; `check-max-file-lines` 0 (previs_tab / mvr_section at 500).
- **Box:** client restarted; Previs: View (Camera / Live picture captioned) on top, Stage note directly under its buttons, Models and Screens without boxes, MVR scene = picker + Import / Export + its note only, Lighting → Add fixtures captioned; Programmer and Calibrate heads without empty boxes.
- Not checked live: the page with an MVR scene, many fixtures and models loaded (the lists' caps) — owner QA.
