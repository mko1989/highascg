# WO-767 — Imported MVR: MAC Aura PXL heads drawn ~1000× too big (GDTF glb in mm), pick boxes swallow every click, Layers eye can't hide them

**Status: IN PROGRESS (25.10) — offline-verified (smoke 4/0, test:ci 3336/0, Godot 21760/0, client boot check); node restart + client relaunch + live look pending**

Owner 25.10:
> whats wrong with the imported mvr. there is like a huge building around the scene, its coliding with anything i try
> to select. none of the layers in the inspector can disable it...

## Investigation

1. **The "building" is the 14 MAC Aura PXL heads.** Their GDTF (`projects/_gdtf/87d69e37fbe1.gdtf`, GDTF Share
   rid159073) ships `models/gltf/base.glb`, `yoke.glb` and `head.glb` authored in **millimetres** with no node scale:
   yoke.glb measures 409.9 units across, while `description.xml` declares the Yoke model as 0.4099 m. glTF is metres by
   definition, so each head drew about 400 m wide.
2. Robe's mm meshes carry a node `scale: 0.001` and render correctly. So the extent has to be measured **through the
   node transforms**; raw accessor min/max would wrongly flag them.
3. **"Colliding with anything I select."** `fixtures_3d.gd _body_box` built each head's pick box from its mesh AABBs,
   so every Aura got a box hundreds of metres wide, and `hit()` returned it before anything behind it.
4. **"None of the layers can disable it."** The Inspector's Layers eyes go to `mvr_scene.gd set_hidden_layers`, which
   only hides the static MVR models. Patched heads are drawn by `fixtures_3d.gd`, which never heard about hidden layers.
5. **Every GDTF checked.** A sweep of every stored GDTF through the fixed route changed only the Aura PXL
   base/yoke/head (383.755→0.384, 409.936→0.410, 288.120→0.288 m). No other type moved.
6. The owner's project (`mhp_harder`) needs no repair: `hidden_layers: []`, 199 patched fixtures, none disabled. The
   size is fixed when the model is served, not in project data.

## What was done

- `src/stage/glb-units.js` (new): `glbExtent(json)` walks the default scene through the node matrices (TRS or matrix).
  `fixGlbUnits(buf, declaredM)` decides a file is mm in one of two ways:
  - with a declared size: extent / declared between 300 and 3000;
  - without one: extent over 20 m, larger than any fixture body.

  It then wraps the scene roots in one node `highascg_mm_to_m` scaled 0.001 and re-writes the JSON chunk (space-padded),
  leaving the BIN chunk untouched. The bytes are only rewritten when the file is mm.
- `src/api/routes-fixture-types.js` `/model`: glb members go through `fixGlbUnits` with the declared size. The declared
  size (`declaredSize`) is the largest `size` over the GDTF models whose `file` is this mesh's stem.
- `src/stage/mvr-store.js`: glb members read from the GDTFs packed inside an MVR go through the same fix, without a
  declared size (that path has no description at hand).
- `godot/client/features/previs/mvr_scene.gd`: a `hidden_layers_changed` signal and a `hidden_layers()` getter.
  `fixtures_3d.gd` follows the signal: a head whose MVR layer is hidden is made invisible, and `hit()` skips invisible
  roots. As a guard against another broken mesh, `_body_box` ignores any mesh AABB over 10 m, so one bad model can never
  blanket the scene for picking again.

## What was VERIFIED

- `tools/smoke/smoke-wo767-glb-mm-units.test.js` 4/4 (added to the curated list). It covers:
  - the real Aura yoke scaled to 0.41 m;
  - a Robe-style mm mesh with node scale 0.001 left untouched;
  - the no-declared-size fallback;
  - the GLB stays parseable, with the BIN chunk identical.
- Full sweep of every stored GDTF: only the Aura PXL models changed (item 5).
- `npm run test:ci` 3336 pass / 0 fail, Godot 21760/0, `run-client.sh --check` boot OK, 500-line check 0 over, eslint
  0 errors.
- **Pending:** node restart + client relaunch. Then live: `/api/fixtures/types/87d69e37fbe1/model?path=models/gltf/yoke.glb`
  extent ≈ 0.41, the Aura heads at true size in the previs, selecting through them, and the Layers eye hiding patched
  heads. Owner QA.
