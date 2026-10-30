# WO-612 — Previs: import MVR scenes (e.g. from Capture) into the Godot stage

**Area:** godot-client, lighting
**Status: DONE — 🟡 Import implemented (2026-10-20) — server-side importer + Godot previs section, verified with 4 real grandMA3 MVR exports on the box. T7 MVR export DONE (2026-10-21, box-verified). T5 VideoScreen → live screen bindings DONE (2026-10-21, box-verified). Placement (Capture origins: Place row + Fit, auto-fit on import) DONE 2026-10-21 (box, real Capture file). Open: opening our export in Capture (owner). Parent: [WO-607](./607_WO_godot_previs_native_3d.md) (Godot previs). Related: [WO-180](./180_WO_GDTF_FIXTURE_IMPORT_EXPORT.md) (GDTF fixtures, research stage).**

Owner, 17.10: "can godot import mvr files from capture or only glb?"

## Investigation

### Short answer

Godot has **no MVR importer** (runtime import: glTF/GLB via `GLTFDocument`, FBX via `FBXDocument`). But an
MVR file is a ZIP with an XML scene description plus model files, and every building block exists in
Godot (checked headless on 4.6.3 and 4.7.2: `ZIPReader` (`open/get_files/read_file`), `XMLParser`
(`open_buffer`), `GLTFDocument.append_from_buffer`, `ArrayMesh`/`SurfaceTool`). So we can write our own
importer. **The one missing piece is a 3DS mesh loader**, and Capture-made MVR files will very likely need it.

### MVR format (spec: github.com/mvrdevelopment/spec `mvr-spec.md`, version **1.6**, DIN SPEC 15801)

- Container: ZIP (PKWARE 6.3.3), extension `.mvr`, root file **`GeneralSceneDescription.xml`**; every
  referenced file is inside the archive with a relative path.
- Coordinates: **right-handed, Z-up, 1 unit = 1 mm**; transforms are `<Matrix>{u}{v}{w}{o}` (4×3:
  three axis rows + origin). Godot is Y-up metres → convert basis + scale 0.001 on import.
- Geometry formats (Table 46): **3DS** (`.3ds`, 1 unit = 1 mm, "deprecated") and **glTF 2.0**
  (`.gltf`/`.glb`, "GLB packaging is recommended"); a `fileName` without extension means 3DS.
- Scene objects: `SceneObject`, `Fixture`, `Truss`, `Support`, **`VideoScreen`**, `Projector`, `Symbol` →
  `Symdef` (instancing), layers/classes, `Geometries` → `Geometry3D fileName`.
- Fixtures reference embedded **GDTF** files (`GDTFSpec`, DIN SPEC 15800). A `.gdtf` is itself a ZIP
  with `description.xml` and models in `models/3ds`, `models/gltf` (+ `_low` variants) and `models/svg`
  (`gdtf-spec.md` lines 132-157).
- **Video for previs is in the format itself:** `VideoScreen` has `Sources` → `Source type="NDI|File|CITP|CaptureDevice"`
  (+ `linkedGeometry` = the GDTF Display geometry whose texture is replaced); `MappingDefinition`
  (`SizeX/SizeY`, `Source`, `ScaleHandeling` = ScaleKeepRatio|ScaleIgnoreRatio|KeepSizeCenter) and
  per-object `Mappings/Mapping linkedDef` with **`ux/uy` (offset px), `ox/oy` (size px), `rz` (rotation°)**
  — i.e. exactly the "which part of which source on which surface" crop the WO-17 UV mapper models.
- **MVR-xchange** (same spec): live exchange of MVR between applications over TCP + mDNS
  (`_mvrxchange._tcp.local.`) or WebSocket — a later option for live sync with Capture/consoles.

### Capture specifics (UNVERIFIED for our version — needs a real file from the owner)

- Capture forum (capture.se/Support/Forum/aft/9394): Capture staff said Capture reads glTF/GLB geometry
  but **not when embedded in MVR**; importing a Vectorworks MVR with glTF geometry failed with
  "format unsupported (only 3DS is supported)", and exporting with Vectorworks' "legacy 3ds" option fixed
  it. ⇒ Capture's own MVR export very likely embeds **3DS** geometry. To confirm with one real
  Capture-exported `.mvr` (unzip + list `GeneralSceneDescription.xml` and the model extensions).

## Design

```
MvrImporter (GDScript, Godot client; WO-607 previs)
  ZIPReader(.mvr) → XMLParser(GeneralSceneDescription.xml)
  walk Layers/ChildList: SceneObject | Truss | Support | VideoScreen | Fixture | Symbol(→Symdef)
    Matrix (mm, Z-up) → Transform3D (m, Y-up)
    Geometry3D fileName → .glb/.gltf: GLTFDocument.append_from_buffer ; .3ds / no ext: Loader3DS
    Fixture → GDTFSpec: nested ZIP (ZIPReader opens paths only → write to user://tmp first) →
              prefer models/gltf/*.glb, else models/3ds/*.3ds (low-poly variants for big rigs)
  VideoScreen → previs screen: Sources/Mappings → (HighAsCG source, uv crop) binding
  → PrevisModel (same persisted form as WO-17 models: binary in /api/previs/models + metadata)
Loader3DS (~300 LOC, pure, unit-tested): chunk reader (MAIN 0x4D4D → EDIT 0x3D3D → OBJECT 0x4000 →
  TRIMESH 0x4100: VERTICES 0x4110, FACES 0x4120, MAPCOORDS 0x4140, LOCAL_MATRIX 0x4160; materials
  0xAFFF), mm units, → ArrayMesh via SurfaceTool (+ generate_normals)
```

Source mapping for `VideoScreen`: `type=File` value = a media path → play/route it; `type=NDI` → an NDI
input; HighAsCG-specific values (proposal) `highascg:pgm1`, `highascg:prv1`, `highascg:ch5` → the
WO-597 video surfaces. Unknown sources stay unbound (operator picks in the previs inspector).

## Tasks

- [x] T1 (4 grandMA3 exports from MVR-Stash; 7 real Capture exports 2026-10-21 — 3DS, stub GDTFs, no VideoScreens) Get one real Capture-exported `.mvr` (and the Capture version) → confirm geometry format(s), fixture GDTF content, whether VideoScreens/Mappings are written.
- [x] T2 `Loader3DS` + tests (fixture `.3ds` files incl. one from the Capture sample).
- [x] T3 `MvrImporter`: scene objects, transforms, symbols, glTF + 3DS geometry; import report (counts, skipped objects).
- [x] T4 Fixtures via GDTF (geometry only; DMX/beam simulation is a later WO, shared with WO-180).
- [x] T5 VideoScreen Sources/Mappings → previs screen bindings + UV crops (`highascg:<role>` sources only).
- [x] T6 Persistence (own store `projects/_mvr/`, not `/api/previs/models`): store the `.mvr` via `/api/previs/models` (allow the extension) + parsed metadata.
- [x] T7 Export the WO-614 stage (LED walls / TVs / projection = `VideoScreen` + generated glb geometry, `Sources`/`Mappings` from each object's role + crop) via `ZIPPacker` (moved here from WO-614 T7).
- [ ] Later: MVR-xchange client (live sync).

## What was done / What was VERIFIED

Desk only: spec read (MVR 1.6, GDTF folder layout); Godot API presence checked headless on 4.6.3 and 4.7.2.
Capture behaviour from a vendor forum thread — unverified on our files.

## Addendum (2026-10-17) — Perastage (github.com/PeramatoG/Perastage), owner pointer from `next.md`

C++/wxWidgets desktop app, **GPL-3.0-or-later** (compatible with our AGPL-3.0-or-later; GPLv3 §13 —
keep its notices on anything ported), 122★, active. "Practical MVR and GDTF workflows": open/merge/edit/
export MVR, GDTF library + GDTF Share download, 2D/3D review, patch tables, PDF layouts, experimental OSC +
MCP. **Not a real-time DMX visualiser** (README) — that is exactly the gap WO-615 fills, so the two complement.
- **Workflow:** design/patch the rig in Perastage → export MVR → HighAsCG imports it (this WO) → live previs,
  DMX out, video on screens. Round trip back via our MVR export (T7).
- **Code to reuse:** `viewer3d/loader3ds.cpp` (529 lines; chunks 0x4D4D/0x3D3D/0x4000/0x4100/0x4110/0x4120/
  0x4140/0x4160/0xAFFF/0xA000 — the same set this WO designed; wx only for texture images) → port as the
  T2 `Loader3DS` with attribution. Also `core/gdtf_description_reader`, `core/gdtf_archive_reader`,
  `mvr/mvr_export_archive_writer` as references (tests in `tests/gdtfloader_*` give fixture cases).
- No `VideoScreen`/projector specific code found in its tree (2026-10-17) → screens from Perastage arrive as
  plain scene objects; our importer tags them by name/size until confirmed with a real file.

## What was done (2026-10-20)

Directive D (the node composes, every function is an endpoint) moved the importer to the **server**; Godot
only fetches ready GLB meshes and places them. The design above (GDScript importer) is superseded.

- `src/stage/mvr-scene.js` — `GeneralSceneDescription.xml` → layers + objects (`SceneObject`, `Truss`, `Support`,
  `VideoScreen`, `Projector`, `Fixture`, `Symbol` → `Symdef`, nested groups) with a flat list of parts
  `{mesh key, 12-number Godot transform}`; `VideoScreen` `Sources` are parsed and kept for T5. Import report:
  counts, missing GDTFs (→ 0.3 m box), missing files, unsupported nodes.
- `src/stage/mvr-gdtf.js` — fixture geometry from the GDTF tree of the patched DMX mode (`GeometryReference`
  expanded; beams / wiring / filters skipped); mesh = `models/gltf/<file>.glb`, else `models/3ds`, else a box
  of the model's L × W × H.
- `src/stage/mvr-math.js` — MVR `{u}{v}{w}{o}` (mm, Z-up) and GDTF 4×4 (m) → Godot (m, Y-up); glb meshes are
  glTF-frame (Y-up), 3DS meshes are mm Z-up. Handedness checked against the MVR-Stash screenshot.
- `src/stage/mvr-3ds.js` — own 3DS chunk reader (main/edit/object/trimesh/vertices/faces/smoothing, material
  colours) → GLB; `src/stage/glb-write.js` — GLB writer/reader, and `embedGlbImages`: glb meshes whose
  textures are separate files in the archive get them embedded (else all textures are dropped) — Godot's
  `append_from_buffer` has no base path and refuses the whole mesh over one external image.
- `src/stage/mvr-store.js` — `projects/_mvr/<sha1-12>.mvr` + `.json`; meshes read from the archive on demand
  (LRU 400).
- API (`src/api/routes-stage-mvr.js`): `GET /api/stage/mvr`, `POST /api/stage/mvr` (multipart, 300 MB),
  `GET /api/stage/mvr/<id>`, `GET /api/stage/mvr/<id>/mesh?key=`, `DELETE /api/stage/mvr/<id>`.
- Godot Previs → "MVR scene (WO-612)": picker, Import… (file dialog + streamed upload), Remove (confirm),
  Layers ▾ (hide/show per MVR layer); the choice is saved in the project (`previs.mvr` = id, name,
  hidden layers). The scene loads under the WO-614 stage; Fit frames it too.
- Tests: `tools/smoke/smoke-wo612-mvr-import.test.js` (5 tests: transforms, 3DS, image embedding, synthetic
  MVR + GDTF import, the routes) in the curated offline list; Godot `tests/test_mvr_scene.gd`.

## What was VERIFIED (2026-10-20, box)

- All 4 MVR-Stash grandMA3 exports (Basic Festival, Circle Stage, Messy Patch, Midsize w GP) import in
  0.2–0.5 s and every mesh key returns a valid GLB.
- Midsize w GP: 115 objects / 76 fixtures / 203 parts / 28 meshes; the front view matches the author's
  screenshot (guitarist stage right).
- GUI Import… with the file dialog → Circle Stage uploaded, listed, rendered. First try showed "Meshes that
  failed to load: 44" (the deck glbs reference `vsBlkDeckTexture.png` next to them in the archive) → fixed by
  `embedGlbImages`; after the fix all 60 meshes load and the deck texture shows.
- Fit frames stage + MVR scene; Remove → confirm → list empty, picker back to "— no MVR scene —", Remove and
  Layers disabled. Test scenes deleted afterwards; project back to no MVR scene.
- Gates: file lines, lint (217 ≤ 218), prettier, unwired exports, offline suite (2926 pass), Godot 16193 pass.

## T7 — MVR export (2026-10-21)

### Investigation

- The stage lives in the client-owned `project.previs.stage.objects` slice. The server reads it from the saved
  project (`loadFullProject`, as the follow service does), so the export has the same source the importer and
  autosave use.
- The importer (`mvr-scene.js`) places a glTF-frame mesh with `GODOT_FROM_MVR · m · MVR_FROM_GLTF`. The export
  writes geometry in the object's own frame and the matrix `MVR_FROM_GLTF · G · GODOT_FROM_MVR` (G = the Godot
  Node3D transform, YXZ Euler), so a re-import lands where the object was.
- A stored-only ZIP writer already exists (`src/support/zip-store.js`), so no new dependency.

### What was done

- `src/stage/mvr-export.js` `buildStageMvr(objects, {name, rasterFor})`: one `VideoScreen` per visible
  `led_wall` / `tv` / `projection` (other types are counted as skipped).
  - Geometry: a GLB per object, built with the `stage_objects.gd` / `stage_builder.gd` math. LED wall = curved
    front strip plus a back strip at `depth_m`; TV = screen plus bezel cabinet; projection = screen plus the
    projector body at its throw.
  - `Sources/Source type="CaptureDevice"` carries `highascg:<role>` (the design's proposal).
  - Crops: an AUXData `MappingDefinition` per role (SizeX/Y = the role's live raster, else the crops' bounding box)
    and a per-object `Mapping` (ux/uy offset, ox/oy size, px).
  - UUIDs are hashed from the ids, so the archive is deterministic and a re-export updates the same objects in the
    receiving tool.
- `GET /api/stage/mvr-export` (`routes-stage-mvr.js`): an attachment `<project>.mvr` plus `X-MVR-Screens`. pgmN /
  prvN rasters come from `getChannelResolutionForChannel`. An empty stage returns 404 with a reason.
- Godot previs → MVR scene → **Export…**: save dialog, then the latest stage edit is flushed (`ProjectSync.flush`),
  then the bytes are fetched and written to the chosen file.
- Smoke `tools/smoke/smoke-wo612-mvr-export.test.js` (4 tests, curated list): archive layout, sources, crops,
  mapping definitions, determinism; a **round trip through the real importer** (every object back at its Godot
  transform within 1e-4, sources intact, meshes served); sizes; route headers and the empty-stage 404.

### What was VERIFIED (box)

- `curl /api/stage/mvr-export` on the live project gives `Untitled.mvr` with 1 VideoScreen ("Main LED (DP-7)",
  `{0,7000,1000}` mm = Godot (0, 1, −7)) and pgm1 at the live 1920×1080.
- GUI: Previs → Export… → save dialog → the file written in the scratchpad is byte-identical to the curl download.
  The status line reads "Exported the stage to …".
- Gates: lines, lint 216, prettier, unwired-exports, offline 2968 pass, `--no-http`, Godot 16473 pass.

## T5 — VideoScreen bindings (2026-10-21)

### Investigation

- An imported VideoScreen carries its picture as `Sources/Source`; a crop is a `Mapping` (ux/uy offset, ox/oy size)
  against an AUXData `MappingDefinition` (SizeX/Y raster). Foreign sources (a media server's own names, NDI names)
  mean nothing to this box, so only `highascg:<role>` binds — what our T7 export writes.
- A mesh can have many surfaces (screen + cabinet). The export now names the picture material `screen` and gives
  it UVs, so the binding paints that surface only; for other files the first surface is used.
- The live pictures are already shared per role by `VideoSurfaces` (WO-597), which the stage walls use.

### What was done

- `glb-write.js`: primitives may carry `TEXCOORD_0` and a material name. `mvr-export.js`: picture strips get UVs
  (u per column edge, v = 0 at the top) and the material `screen`.
- `mvr-scene.js`: `screenBinding()` → `obj.screen = {role, raster, rect}` for `highascg:<role>` sources (on the
  object or on its MappingDefinition); null for anything else.
- Godot `mvr_model.gd` `screen_uv()` / `screen_role()`; `mvr_scene.gd` puts the LED shader on the `screen`
  surface with the crop as `uv_rect`, holds the role in `VideoSurfaces` only while the previs is in 3D and shown,
  and refreshes the texture twice a second. The section summary says how many screens show channels.
- Smoke: round trip keeps `screen`; the GLB picture primitive has material `screen` + TEXCOORD_0; foreign sources
  stay unbound and a definition-only source binds. Godot `test_screen_binding_helpers`.

### What was VERIFIED (box)

- The live stage exported, re-imported as "T5_roundtrip": `GET /api/stage/mvr/<id>` →
  `screen {role pgm1, raster 1920×1080, full rect}`.
- GUI: picking the scene shows "1 video screen(s) show HighAsCG channels (3D view)." The MVR wall paints the live
  PGM over the stage wall (the cabinet grid of the stage wall disappears under it); "— no MVR scene —" brings the
  grid back. Test scene deleted, project back to no MVR scene.
- Gates: lines, lint 216, prettier, unwired-exports, offline 2969 pass, Godot 16479 pass.

## Placement + real Capture exports (2026-10-21)

### Investigation

- Owner report: "loaded [a Capture MVR] … it has problem translating the position of the whole model, its half way
  through the floor and to the right side. probably mismatch of 0,0,0." File: `Pabianice Final Patch.mvr`.
- World bounds of every part (Godot frame, scratch script over the stored scene + its 3DS members): x 3.18…22.56,
  y −2.37…4.14, z −9.66…11.02. The importer was right — the file's own origin sits 3–22 m to one side of the rig, with
  the venue floor 2.37 m below it. An MVR's origin is its author's; nothing in MVR says where "stage centre" is. Other
  Capture files: WEKTORY already on the stage (x −12…12, floor −0.02); ATM spans 100 m (venue model, floor −64 m).
- The 7 Capture exports answer T1: MVR 1.4, geometry **3DS only** (5 files; the forum note holds), no VideoScreens /
  Mappings / Sources, GDTFs mostly **stubs** (description.xml only, one empty geometry — WO-615 T10). Two MVR 1.5 files
  (SLUZEW, TAMOOS: no provider, fixtures only, no geometry) are from another exporter. Before this, stubs were reported
  as "No GDTF" although they are in the file.

### What was done

- `project.previs.mvr.place {x, y, z, yaw}` (stage frame: x stage left, y upstage, z up, m; yaw as a pose's) =
  `mvr_scene.gd` node transform (`mvr_model.gd placement`). Previs MVR section: a Place row (X / Y / Z / turn + Fit).
  **Fit** centres the visible content's footprint and stands its lowest point on our floor (`fit_place`, keeps the turn).
  **Import** fits by itself when the scene is off (`needs_fit`: footprint misses the origin, or lowest point > 0.5 m off
  the floor) and says so in the status; a scene already on the stage is left alone.
- Patched fixtures (WO-615 T10) are placed on patch and move by the same change on every Place edit (`replace_patch`,
  delta = old placement inverse, then the new one; the operator's own pose edits survive).
- Report: `gdtf_no_model` ("GDTF without a 3D model (shown as boxes)") apart from `missing_gdtf`.

### What was VERIFIED

- Godot `--test`: placement / inverse / patch shift / Fit (the Pabianice bounds → X −12.87, Y 0.68, Z 2.37; placed
  bounds centred at 0 with the floor at 0, also turned 90°; WEKTORY's bounds need no fit). Smoke: the stub GDTF lands in
  `gdtf_no_model`.
- Box, the owner's `godot_test` project (screenshots): before — towers through the floor; Fit → −12.88 / 0.68 / 2.37,
  the towers stand on their base plates, deck + LED wall centred; patched fixtures sit on the rig and follow a 90° turn
  (Focus Profile 402 pose = hand computation). Left at Fit, turn 0. Owner-QA: the front of the stage faces the right way
  for the owner's use (turn if not), ATM / other venues.

## Open

- Open our export in Capture / a console (owner): does the receiving tool honour the CaptureDevice source + Mapping?
- Capture GDTF stubs: no model, no pan / tilt — the real GDTF has to come from GDTF Share (WO-615).
- No beams / DMX simulation (WO-615 / WO-180).
