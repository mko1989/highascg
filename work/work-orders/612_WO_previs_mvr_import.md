**Status: OPEN (2026-10-17) — investigation written; nothing implemented. Parent: [WO-607](./607_WO_godot_previs_native_3d.md) (Godot previs). Related: [WO-180](./180_WO_GDTF_FIXTURE_IMPORT_EXPORT.md) (GDTF fixtures, research stage).**

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

- [ ] T1 Get one real Capture-exported `.mvr` (and the Capture version) → confirm geometry format(s), fixture GDTF content, whether VideoScreens/Mappings are written.
- [ ] T2 `Loader3DS` + tests (fixture `.3ds` files incl. one from the Capture sample).
- [ ] T3 `MvrImporter`: scene objects, transforms, symbols, glTF + 3DS geometry; import report (counts, skipped objects).
- [ ] T4 Fixtures via GDTF (geometry only; DMX/beam simulation is a later WO, shared with WO-180).
- [ ] T5 VideoScreen Sources/Mappings → previs screen bindings + UV crops.
- [ ] T6 Persistence: store the `.mvr` via `/api/previs/models` (allow the extension) + parsed metadata.
- [ ] T7 Export the WO-614 stage (LED walls / TVs / projection = `VideoScreen` + generated glb geometry, `Sources`/`Mappings` from each object's role + crop) via `ZIPPacker` (moved here from WO-614 T7).
- [ ] Later: MVR-xchange client (live sync).

## What was done / What was VERIFIED

Desk only: spec read (MVR 1.6, GDTF folder layout); Godot API presence checked headless on 4.6.3 and 4.7.2.
Capture behaviour from a vendor forum thread — unverified on our files.
