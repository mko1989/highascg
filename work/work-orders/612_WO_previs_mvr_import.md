**Status: 🟡 Import implemented (2026-10-20) — server-side importer + Godot previs section, verified with 4 real grandMA3 MVR exports on the box. Open: T5 (VideoScreen → screen bindings), T7 (MVR export), a real Capture file (owner). Parent: [WO-607](./607_WO_godot_previs_native_3d.md) (Godot previs). Related: [WO-180](./180_WO_GDTF_FIXTURE_IMPORT_EXPORT.md) (GDTF fixtures, research stage).**

# WO-612 — Previs: import MVR scenes (e.g. from Capture) into the Godot stage

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

- [~] T1 (answered with 4 grandMA3 exports from MVR-Stash; a Capture export is still on the owner checklist) Get one real Capture-exported `.mvr` (and the Capture version) → confirm geometry format(s), fixture GDTF content, whether VideoScreens/Mappings are written.
- [x] T2 `Loader3DS` + tests (fixture `.3ds` files incl. one from the Capture sample).
- [x] T3 `MvrImporter`: scene objects, transforms, symbols, glTF + 3DS geometry; import report (counts, skipped objects).
- [x] T4 Fixtures via GDTF (geometry only; DMX/beam simulation is a later WO, shared with WO-180).
- [ ] T5 VideoScreen Sources/Mappings → previs screen bindings + UV crops.
- [x] T6 Persistence (own store `projects/_mvr/`, not `/api/previs/models`): store the `.mvr` via `/api/previs/models` (allow the extension) + parsed metadata.
- [ ] T7 Export the WO-614 stage (LED walls / TVs / projection = `VideoScreen` + generated glb geometry, `Sources`/`Mappings` from each object's role + crop) via `ZIPPacker` (moved here from WO-614 T7).
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

## Open

- T5 VideoScreen `Sources`/`Mappings` → WO-614 screen bindings (sources are parsed; nothing binds yet).
- T7 MVR export of the WO-614 stage.
- A real **Capture** export (owner checklist) — Capture writes 3DS (vendor forum); the 3DS path is tested with
  synthetic files and the 3DS members of the MA3 GDTFs only.
- No beams / DMX simulation (WO-615 / WO-180).
