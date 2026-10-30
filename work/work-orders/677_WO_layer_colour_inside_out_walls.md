# WO-677 — Previs: a layer colour shows MVR models inside out (only the inner walls, see-through)

**Area:** godot-client
**Status: DONE (22.10, Godot 20947/0; box: before/after screenshots of the owner's "Pabianice Final Patch" MVR)**

Owner, 22.10: *"the imported mvr seems to have inverted model walls when i change color of default layer which covers
most of models it only colors the inside walls making it weridly semi transparent."*

## Investigation

- MVR meshes reach Godot as GLB written by the server. `src/stage/glb-write.js:56-61` gives every material
  `doubleSided: true`, which Godot imports as `CULL_DISABLED`. Many MVR / 3DS meshes are wound inside out. With
  culling off, that never showed.
- A layer colour (WO-641) replaces the mesh material with a new `StandardMaterial3D`
  (`godot/client/features/previs/model_tint.gd` `apply`). Its `cull_mode` was the default `CULL_BACK`. On an
  inside-out mesh, Godot culled the outer faces and drew only the far inner walls, so models looked hollow and
  see-through.
- Box, before the fix: the owner's project colours 8 layers black, including "Default Layer". In the 3D view the stage
  deck was missing (only the two side edges drew). The speaker stacks and truss showed their insides.
- Not a server or import bug: the model's own materials were right because they are two-sided.

## What was done

- `model_tint.gd`: the tint material is now `CULL_DISABLED`, matching the GLB's own materials. Godot flips the normal
  on back faces of a two-sided material, so inside-out faces are also lit correctly.
- Rejected: re-winding meshes on the server. A mesh can't reliably be identified as inside out, and the model's
  own look already relies on two-sided materials.
- `tests/test_previs_model_tint.gd`: asserts the tint material is two-sided.

## What was VERIFIED

- Godot tests 20947 / 0.
- Box: the GUI was relaunched on the owner's project, Previs tab, with "Pabianice Final Patch" and the layer
  colours unchanged. The stage deck, speaker stacks and side walls now draw as solid black models. The before
  screenshot showed them hollow.
- Owner QA: colour the Default Layer again and look around the models from several sides.
