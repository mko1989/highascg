**Status: DONE (2026-10-21) — Godot --test 20650/0 + --check; box: layer colours set, shown, saved in the project and reset. Owner QA: a fixture type's Body colour on the live rig.**

# WO-641 — Previs model colours (MVR layers, GDTF fixture types); "Visualise console" renamed

Owner, 21.10: *"i should be able to change at least colors of the models, some of the heads got black from gdtf but
most of the scene is default whiteish"*. Also: *"does the previs takes artnet input? it should."* and *"visualise
console is a very misleading title. change it to artnet/scan input"* (read as sACN).

## Investigation

- **Art-Net input already exists** (WO-615 T7), behind the misleadingly named "Visualise console" switch in previs →
  Fixtures (`fixtures_section.gd:96`). With it on, `src/fixtures/follow-service.js:176` takes each typed fixture's
  frame from the console input (`dmx-input.js` `inputFrame`, Art-Net via the shared :6454 tap, sACN on
  `fixtures.dmx.sacn_port`) instead of the programmer, and the engine sends nothing on those universes. On the box
  it is off (`GET /api/fixtures/dmx` → `visualise:false`). Only the name was the problem.
- **Colours**: the materials in the GLBs the server serves (`/api/fixtures/types/<id>/model?path=…`, dumped for every
  type on the box):
  - Robin 600 LEDWash: baseColor 0.003 (its GDTF really is black).
  - Focus Profile, Pixel Line, Sharpy Plus: 0.7 / 0.98 grey. The 3DS models carry no usable material, so they get
    `src/stage/glb-write.js:57`'s default `[0.7, 0.7, 0.7]`.
  - MVR scene geometry gets the same default.
  - Nothing in the client could change any of it. `mvr_scene.gd` and `fixtures_3d.gd` instance the GLBs as they are.

## What was done

- `features/previs/fixtures/fixtures_section.gd`: the switch is now **"Art-Net / sACN input"**, with a plain tooltip.
- `features/previs/model_tint.gd` (new): colour maps `{name → "#rrggbb"}`.
  - `apply(root, color)` gives each mesh its own matte material as `material_override`. Each mesh needs its own:
    a Glow fixture's body is lit through its material (`fixtures_3d.gd` `_light`).
  - It keeps the mesh's previous override and restores it when the colour is cleared. The stored value is wrapped
    in an array, because `set_meta(k, null)` erases the key (the unit test caught it).
  - It skips meshes tagged `no_tint`: a bound VideoScreen's picture surface, a fixture's lens, cone and selection
    box.
- `features/previs/color_rows.gd` (new): rows of "name · swatch · ↺".
  - Dragging previews, closing the picker saves, and ↺ goes back to the model's own colour.
  - `fill()` with unchanged names only updates the swatches, so the open picker survives the reload its own save
    triggers.
- MVR: `mvr_section.gd` adds a collapsible "Layer colours" list, saved as `project.previs.mvr.layer_colors`.
  `mvr_scene.gd` `set_layer_colors` tints each object by its layer, also on load.
- Fixtures: `fixtures_section.gd` adds a "Body colour" row for the type picked in the type list, saved as
  `project.previs.fixture_colors[typeId]`. `fixtures_3d.gd` tints bodies on build and re-tints on project_changed
  without a rebuild.
- `previs` is a client-owned project slice (`src/engine/project-client-slices.js:11`), so web autosaves keep the
  new keys.
- Not done: no server-side material fix. A 3DS model without materials has nothing to read, and a black GDTF is
  the maker's model. Per-object colours are not done; layers and types cover the ask.

## What was VERIFIED

- `tests/test_previs_model_tint.gd` (3 tests): hex parse and maps, tint → own material per mesh, `no_tint`
  untouched, restore to the original incl. a null override (failed before the wrap fix), rows kept on same names,
  ↺ clears. Godot `--test` 20650 passed, 0 failed; `--check` boot OK; line limit 0 over.
- Box (client relaunched, Previs):
  - The Inspector lists 20+ MVR layers with swatches.
  - "Ściany boczne" → #c03030 was saved: `previs.mvr.layer_colors = {"Ściany boczne": "#c03030"}` in
    `projects/godot_test.json`, and the swatch and ↺ updated. Those objects are off-view or replaced.
  - "Default Layer" → #3050c0 turned the trusses and set pieces blue in the 3D view (screenshot). Patched fixtures
    stayed as they were.
  - ↺ on both restored the grey models (screenshot), and `layer_colors` is `{}` again.
- **Owner QA:** Fixtures → pick a type → Body colour on the live rig (unit-tested, not driven on the box); the
  Art-Net / sACN input with a real console (WO-615's open rig check).
