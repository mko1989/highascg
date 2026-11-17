# WO-1110 — Previs at 15 fps with a 252-head rig: multi-cell fixtures drawn as batches (42 616 → 4 667 draw calls)

**Area:** godot-client, lighting
**Status: DONE (17.11.26 — measured in the owner's GUI on "gutmanny 26": 15 → 50 of 50 fps, render CPU 40.2 → 5.5 ms; cells seen lit through the previs output; Godot suite 30093 / 0)**

Owner 17.11, after the gutmanny 26 rig was patched and looks were recalled (WO-1107): "the client is now barely holding
up and dropping to 16fps. is this only the lighting? can we optimize it?"

## Investigation (owner's GUI, perf overlay F3 + `GET /api/health/keeping-up`)

- 15 / 50 fps, Frame 80.7 ms, Render cpu 40.2 ms · gpu 2.7 ms, **42 616 draw calls · 45 456 objects**; main thread at
  100 % of a core, GPU at a third. CPU-bound in the renderer's per-object work, not in shading.
- Not the light: every fixture released (`DELETE /api/fixtures/program`) → 15 fps. Not the picture: PGM empty → 16 fps;
  all 9 LED walls hidden → 14 fps. Quality Low (the owner had already switched) made no difference.
- The heads' models: the two fixture layers hidden (`hidden_layers` + "Default Layer", "Pixel Line 3P") → **50 / 50 fps**.
- Why (`GET /api/fixtures/types/<id>/rig`, `features/previs/fixtures/fixtures_3d.gd` `_build` / `_beam`): a rig node
  per GDTF geometry, and per Beam node a lens `MeshInstance3D` with its own `StandardMaterial3D` next to the cell's body
  mesh. Cell rigs: Robin 600 LEDWash 37 driven cells × 54 heads, Pixel Strobe 71 × 36, X-Dot Max 95 × 12, X-Dot 35 × 28
  → about 17 000 mesh instances for 252 heads, each drawn in the depth and the colour pass. The 88 single-beam heads
  (Quantum, Focus Profile, Vizi Beam) are 3–5 instances each.

## What was done

- `features/previs/fixtures/cell_batch.gd` (new): after a cell rig is built, the cells of one head that hang under the
  same moving part and share a mesh become one `MultiMeshInstance3D` each — lenses (grouped by shape), bodies (by mesh;
  a primitive body that glows gets the glow shader). A cell's light is its instance colour (rgb = colour, a =
  intensity; lens shader emission × 4 as before). Real beams (a cone or a spot light) and rigs under 4 cells are
  untouched. `plain()` holds the old per-material path.
- `fixtures_3d.gd`: `_build` calls `Batch.run` for cell rigs after the pick box is measured (so picking is unchanged);
  `_beam` hands the lens node over; `_light` writes through `Batch.light` / `Batch.plain`. Still 499 lines.
- `tests/test_cell_batch_wo1110.gd`: two batches under the moving part, counts, a real beam left alone, a small rig not
  batched, the unbatched lens path. (Instance colours / transforms cannot be read back under the headless renderer.)

## What was verified

- Owner's GUI after a relaunch, same project, same look: **50 / 50 fps, Frame 23.9 ms, Render cpu 5.5 · gpu 1.0 ms,
  4 667 draw calls · 6 616 objects**, "all keeping up".
- Picture (previs output through Caspar's preview channel, close on a hall truss, look "Gold beams"): LED wash cells
  lit blue per cell, profile beams and gobos as before.
- Godot suite 30093 passed, 0 failed; `--check` boot OK; 500-line check clean.

## Not verified

- A fixture type colour (Previs ▸ fixture colours) on a batched glowing primitive body: the batch is marked `no_tint`,
  so such bodies keep the default grey. Batched glb bodies keep the model's own materials.
- VR (`--xr`) and the Live tab's 3D view share the code; not looked at.
