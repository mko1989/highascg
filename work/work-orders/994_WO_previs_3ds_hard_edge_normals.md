# WO-994 — Previs models look low quality: 3DS meshes shaded with one averaged normal per vertex (blobby edges, starburst table tops)
**Area:** godot-client, lighting
**Status: DONE (07.11.26, verified on the served GLBs and in before/after renders of the Narvill table set and a GDTF head; all 197 stored 3DS meshes convert; suite 5526 pass / 0 fail; the on-glass check in the Godot client is still to do, because the active project has no MVR)**

Owner, 07.11: *"Can we get better model rendering? The added quality change gave nice reflections etc, but the models
still look very low quality."* Then: *"There is a narwil MVR that has a lot of models including chairs and tables.
They are all white (or whitish)."* WO-892 covered the renderer (AA, SSAO, SSR, shadows). This WO covers the meshes.

## Investigation

- **The scene:** `projects/_mvr/a6348e82b04e.mvr` "Narvill Pozytywni Serock", used by the `narvil` project.
  - It was made with Capture 2025.1.15 and holds 108 `.3ds` meshes and 5 GDTF files.
  - The "Stoły" layer is 720 objects, which is 45 table sets of 16 meshes each.
- **Why they are white.** The colour isn't lost here; the file never had any.
  - A chunk survey of all 108 meshes (`scratchpad/mvrq/chunks.js`) finds only `4D4D 3D3D 4000 4100 4110 4120`.
  - There are no `AFFF` material chunks, no `4130` face-material groups, no `4150` smoothing groups and no `4140` UVs.
  - The scene XML has no `<Color>`.
  - So every face gets glb-write's default 0.7 grey (`src/stage/glb-write.js` `material()`), which reads as white.
  - Per-layer colours (WO-641, Previs → layer colour) are the existing way to colour such a file. They were not
    changed here.
- **Why they look low quality: the normals.**
  - `src/stage/mvr-3ds.js` handed glb-write positions and indices only.
  - glb-write then computed `smoothNormals` (`glb-write.js:18`): one area-weighted average normal per vertex index.
  - Capture shares one vertex between every face meeting there, including across 90° edges.
  - Of the 22 032 vertices in the 108 meshes, **13 522 (61 %) sit on an edge sharper than 45°**
    (`scratchpad/mvrq/stats.js`). All of them got a diagonal normal.
  - Effect: box edges shade as soft blobs, chair backs smear, and a round table top (a triangle fan) shows a radial
    starburst of light and dark wedges.
  - Mean deviation of a corner normal from its own face's normal, over the 3DS meshes without smoothing groups:
    **36.0°**.
- **GDTF 3DS bodies are different.** 24 of the 197 stored 3DS files (all fixture models) carry `4150` smoothing
  groups.
  - Example: `P10_head.3ds` puts all 6412 faces in group 1 and marks its hard edges by splitting vertices (7144
    vertices for 6412 faces).
  - Index-shared averaging already looked right on those.

## What was done

- **`src/stage/mesh-crease.js`** (new) — `creaseNormals(positions, indices, { smoothing, angleDeg })` produces
  per-corner normals:
  - Faces that share a vertex index are neighbours; a corner's normal is the **angle-weighted** sum over its joined
    neighbours.
  - With 3DS smoothing groups: two faces join when their masks share a bit; mask 0 is flat (3DS semantics).
  - Without them: two faces join when they meet at under 40°. A 16-sided cylinder (22.5°) stays smooth, a box
    (90°) stays sharp, and an 8-sided prism (45°) goes faceted.
  - A vertex is split on output wherever the corner normals differ.
  - **Why angle weighting, not area weighting:** a quad cut into two triangles pulls an area-weighted normal towards
    its own facet, so the seams of a cylinder were off-radial.
  - **Why no position weld:** the first version welded by position so that already-split vertices would smooth
    across. It smeared the GDTF head, whose splits are its hard edges. A vertex the file itself split now always
    stays hard.
- **`src/stage/mvr-3ds.js`:**
  - Reads `4150` into `obj.smoothing`.
  - Runs one crease pass per object over the faces of every material group, so a seam between two materials keeps
    its shading. Each primitive is a slice of that pass's indices, with explicit `normals`.
  - Faces with out-of-range indices are now dropped one by one. Before, the whole group was dropped.
- Both MVR set pieces (`mvr-store.js asGlb`) and GDTF fixture bodies (`routes-fixture-types.js`) go through
  `threeDsToGlb`, so both get this. GLB members keep their own normals.
- **`tools/smoke/smoke-wo994-mesh-crease.test.js`** (6 tests, added to the curated list in `offline-test-files-3.js`)
  covers:
  - the cube: 24 corners, axis normals, pointing outward;
  - cylinder at 16 and 8 sides;
  - file-split vertices staying hard in group 1;
  - radial normals with angle weighting;
  - smoothing groups: mask 0 vs a shared bit;
  - no NaN from degenerate faces;
  - the converter wiring.

## What was VERIFIED

- **All stored meshes.** 197 / 197 3DS files from `projects/_mvr/*.mvr` and `projects/_gdtf/*.gdtf` (including GDTFs
  nested in MVRs) convert without error, in 236 ms total.
  - Mean deviation of a corner normal from its face:

    | 3DS meshes | before | after |
    |---|---|---|
    | without smoothing groups | 36.0° | **2.6°** |
    | with smoothing groups (GDTF) | 15.9° | 16.5° (angle vs area weighting) |

  - Narvill: 22 032 vertices become 38 951 after the splits; the GLB total is 1.48 MB; all 108 convert in 70 ms.
- **Renders.** A z-buffer rasteriser (`scratchpad/mvrq/raster.py`) uses the same NORMAL attribute Godot's
  GLTFDocument reads.
  - `scratchpad/mvrq/table-before-after.png`: one placed Narvill table set (16 meshes). Before, the table top shows a
    starburst and the chair edges are smeared. After, the top is flat and the chair edges are crisp.
  - `scratchpad/mvrq/fixture-before-after.png`: `P10_head.3ds`. It is unchanged apart from slightly crisper bevels.
    The welded first version was blotchy here and was dropped.
- **On the box.** After a node restart, `GET /api/stage/mvr/a6348e82b04e/mesh?key=mvr:0x2215EFDF.3ds` serves 218
  vertices for 169 faces; the source has 105 vertices. The new normals are live.
  - The mesh cache is in memory per node process, so a restart is all a deploy needs. The client has no disk cache.
- **Suite.** `run-offline-tests.js`: 5534 tests, **5526 pass, 0 fail**. An earlier run that overlapped the node
  restart had one assertion failure that did not repeat.
  - eslint, prettier, max-file-lines and unwired-exports gates are clean.
  - `check-require-integrity` flags only the box's untracked Syncthing `*.sync-conflict-*` project files.
- **Not done:** the on-glass view in the running Godot client. The active project (`a&s`) shows no MVR. Seeing it
  means opening `narvil` → Previs or Live 3D, which changes the operator's live show, so it was left to the owner.

Rollback: revert the `mvr-3ds.js` hunk (positions without `normals` fall back to glb-write `smoothNormals`), then
restart node.
