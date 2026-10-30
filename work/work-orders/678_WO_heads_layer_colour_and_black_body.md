# WO-678 — Previs: moving heads follow their MVR layer colour, selection highlights the layer, black default body

**Area:** godot-client
**Status: DONE (22.10, Godot 20950/0, smoke-wo612 6/6; box: heads black, clicking a Sharpy highlights "5. Sharpy Plus")**

Owner, 22.10:
- *"cant find a layer that colors moving heads. there was suppose to be a highlight of a layer used on the selected
  model."*
- *"found that is per device and not in layers. the fixtures should have black body when not explicitly specified by
  gdtf."*

## Investigation

- **Heads ignored layer colours.** Fixtures patched from the MVR are drawn by
  `godot/client/features/previs/fixtures/fixtures_3d.gd`, with id `mvr-<uuid>`. The MVR scene's own fixture models are
  hidden. The layer tint (WO-641, `mvr_scene.gd` `set_layer_colors`) only reached the scene's meshes, so no layer
  could colour a head. The only colour control for heads was the fixture-type Body colour
  (`project.previs.fixture_colors`), which is what the owner then found.
- **No layer highlight for a selected head.** `mvr_section.gd` highlighted layers only from the screens'
  `selection_changed`. A fixture selection (`fixture_selection.gd` `Sel.shared()`) never reached it.
- **Grey / white bodies.** Fixture models are served by `src/api/routes-fixture-types.js` (model route), which
  converts 3DS to GLB through `src/stage/mvr-3ds.js` `threeDsToGlb`. Live dump of every fixture type on the box:
  - Focus Profile and Pixel Line 3DS have no material, so `glb-write.js` falls back to `[0.7, 0.7, 0.7, 1]`.
  - Sharpy Plus 3DS has 8 materials `mat0`…`mat7`, all `#FAFAFA`. That is an exporter placeholder, not a design
    colour.
  - Robin 600 and Pixel Strobe are GLB with explicit materials (dark blue-grey; 0.5 grey arms).

## What was done

- `mvr_scene.gd`: new signal `layer_colors_changed`, emitted by `set_layer_colors`.
- `fixtures_3d.gd`: `follow(scene)` takes the scene's `layer_of`, listens to `layer_colors_changed` and `loaded`, and
  re-tints. It also reads the layer colours from `project.previs.mvr` when a project arrives. `color_of(id)` picks the
  colour.
- `fixtures_3d_model.gd` `head_color`: the fixture-type colour wins. Otherwise an MVR head (`mvr-` id) takes its
  layer's colour. Otherwise the model keeps its own material. This is static, so it can be tested without autoloads.
- `previs_tab.gd`, `live_stage_3d.gd`: `fixtures3d.follow(mvr)` / `rig.follow(mvr)`.
- `mvr_model.gd` `fixture_uuids` + `mvr_section.gd` `_light_layers()`: layers are highlighted for the selected
  screens plus the selected MVR heads.
- `mvr-3ds.js`: `threeDsToGlb(buf, { fixtureBody: true })` turns an unspecified colour into `FIXTURE_BODY`
  (`[0.01, 0.01, 0.01, 1]`). Unspecified means no material, or a neutral light grey / white (r≈g≈b, ≥ 0.6).
  Only the fixture-type model route passes the option. MVR set pieces (`mvr-store.js`) keep their grey.
- Rejected:
  - Blackening GLB fixture models: their materials are explicit by construction.
  - A client-side default: it would lose the difference between "GDTF says white" and "GDTF says nothing".
- Tests:
  - `tests/test_previs_model_tint.gd` `test_heads_follow_their_layer`;
  - `tools/smoke/smoke-wo612-mvr-import.test.js` "WO-678": a real colour is kept; `#FAFAFA` and no material become
    black; a dark grey is kept; MVR meshes are untouched; the route passes the option.

## What was VERIFIED

- Godot tests 20950 / 0, `--check` OK.
- `smoke-wo612-mvr-import` 6/6, unwired-exports, the 500-line limit and eslint are clean.
- Box, server restarted, live dump: every 3DS part of Sharpy Plus, Focus Profile and Pixel Line is now
  `[0.01, 0.01, 0.01]`. Robin and Pixel Strobe GLB colours are unchanged.
- Box GUI relaunched on "Pabianice Final Patch", Previs tab:
  - truss and stage-front heads render black;
  - clicking a Sharpy on the stage front selects it and highlights and scrolls to the MVR layer "5. Sharpy Plus".
- Owner QA:
  - colour a heads' layer, e.g. "5. Sharpy Plus" red: heads without a fixture-type colour turn red;
  - a fixture-type Body colour still wins over the layer colour.
