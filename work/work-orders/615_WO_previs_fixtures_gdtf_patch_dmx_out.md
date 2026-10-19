**Status: OPEN (2026-10-17) — investigation + design written; the follow slice of T3/T4/T9 landed via WO-616 T11 (2026-10-19, generic profile, Art-Net); GDTF tasks not started. Parent: [WO-607](./607_WO_godot_previs_native_3d.md). Supersedes the scope of [WO-180](./180_WO_GDTF_FIXTURE_IMPORT_EXPORT.md) for real fixtures (WO-180 stays for pixel-map GDTF export). Related: [WO-612](./612_WO_previs_mvr_import.md) (MVR fixtures reference GDTF), [WO-614](./614_WO_previs_stage_builder.md), [WO-616](./616_WO_previs_tracking_openfollow_cameras.md) (follow), [WO-31](./31_WO_STAGE_AUTOFOLLOW_PTZ.md).**

# WO-615 — Previs fixtures: GDTF import, real patch, Art-Net / sACN output, live beams

Owner, 17.10: "does it support gdtf import of lighting fixtures? would be cool to add actual fixtures
with actual patch and way to artnet/sacn output."

## Investigation

### Answer: no GDTF support today
- `rg -il gdtf src client godot` → only false hits; [WO-180](./180_WO_GDTF_FIXTURE_IMPORT_EXPORT.md) is a
  July research plan for **pixel-map** fixtures (grid sampling), never started; [WO-612](./612_WO_previs_mvr_import.md)
  plans GDTF **geometry only** (models inside MVR fixtures).
- What exists and is reusable:
  - **DMX transmit**: `src/sampling/dmx-output.js` — Art-Net via `dmxnet` (`newSender`, per universe:destination)
    and sACN via `sacn` (`new sacn.Sender`), used by the pixel-mapping fixtures (`src/sampling/`, 1001 LOC).
  - **DMX receive**: `src/artnet/artnet-receiver.js`, `sacn-receiver.js`, `lighting-input-receiver.js`
    (lighting-desk input for borders etc.).
  - Caspar side: `artnet` + `pixel` consumers (video → DMX, carried in highascg-build-v1/v2) — video-driven, not fixtures.
- GDTF (DIN SPEC 15800, `gdtf-spec.md` in github.com/mvrdevelopment/spec): `.gdtf` = ZIP with
  `description.xml` + `models/{gltf,3ds,svg}` + `wheels/` images. Relevant XML:
  `FixtureType` → `Geometries` (tree: `Geometry`, `Axis` (pan/tilt rotation), `Beam` (LampType, BeamAngle,
  FieldAngle, LuminousFlux, ColorTemperature, BeamRadius), `Display`, `GeometryReference` for multi-instance
  heads) → `DMXModes/DMXMode` (`Geometry` root) → `DMXChannels/DMXChannel` (`Offset="1,2"` = coarse,fine;
  `Geometry`; `InitialFunction`) → `LogicalChannel Attribute="Pan|Tilt|Dimmer|ColorAdd_R|Zoom|Gobo1|…"` →
  `ChannelFunction` (`DMXFrom`, `Default`, `PhysicalFrom/PhysicalTo` e.g. pan −270…270°) → `ChannelSet`s.
  `Wheels/Wheel/Slot` (gobo images, colours).
- Godot has every building block: `ZIPReader`, `XMLParser`, `GLTFDocument` (3DS needs the WO-612 loader),
  `SpotLight3D` (`spot_angle`, colour, energy, `light_projector` for gobos), volumetric fog for visible beams.

## Design

```
                 ┌─────────── server (Node, always running) ───────────┐
 .gdtf upload ─► │ fixture-types store  /api/fixtures/types (zip + parsed JSON: modes, channels,
                 │                       channel functions, geometry tree, beams, wheels)
 patch (UI) ───► │ patch  project.fixtures.patch[]  {id, name, typeId, mode, universe, address,
                 │        protocol artnet|sacn, dest (bcast/unicast/multicast), invertPan/Tilt, pose}
 programmer ───► │ DMX engine 44 Hz: attribute values (physical units) → per-mode encoding
                 │   (coarse/fine, ChannelFunction ranges, defaults) → universe buffers
                 │   → dmx-output.js senders (Art-Net / sACN priority + CID)   ──► network
 console in ───► │ (optional) Art-Net/sACN receive → "visualiser" mode: patch decodes incoming DMX
                 └─────────────── WS: fixtures:state (attributes @ 30 Hz) ──────────────────────┘
                                         │
 Godot previs ◄──────────────────────────┘  GDTF geometry tree → Node3D; Axis nodes rotate with
   pan/tilt; Beam → SpotLight3D (colour, dimmer→energy, zoom→spot_angle, gobo→light_projector) +
   volumetric fog beams; selection, fixture sheet, programmer UI
```

- **Engine on the server**, not in Godot: DMX must keep flowing when no client is open, and looks/TAKE
  (live core) must be able to recall fixture states. Godot is UI + visualisation.
- **Two sources of truth, one patch:** *Output mode* — HighAsCG generates the DMX (programmer, looks).
  *Visualiser mode* — an external console drives the rig; HighAsCG only decodes received DMX through the
  same patch for previs. Per universe choice (never output and visualise the same universe).
- **Looks integration (phase 3):** a look can store fixture attribute snapshots; TAKE crossfades them
  (LTP for position/colour, fade time from the look) — "media server with lighting".
- **Follow (with WO-616):** marker world position → per-fixture pan/tilt by inverse kinematics on the
  GDTF Axis chain (fixture pose + axis offsets, PhysicalFrom/To limits, invert flags), smoothing;
  replaces WO-31's Companion-only route for DMX fixtures.
- Safety: output starts **disabled** per universe; "Blackout/Release" master; sACN priority configurable
  (default 100); Art-Net unicast list or broadcast; rate-limited to 44 Hz; never send to a universe also
  received in visualiser mode.

## Tasks

- [ ] T1 GDTF parser (server, JS): zip + `description.xml` → normalized JSON (modes, channels with
      offsets/coarse-fine, logical attributes, channel functions + physical ranges + defaults, geometry tree,
      beams, wheels); tests with 3 real files from GDTF Share (moving head spot, wash, LED par) stored in
      `tools/fixtures/gdtf/` (license check: GDTF Share files are manufacturer-published; keep small ones).
- [ ] T2 `/api/fixtures/types` (upload/list/get/delete; store under the media/data dir, `.stignore` checked).
- [ ] T3 Patch model in the project (`project.fixtures.patch`), address-collision check, universe usage map; Godot patch sheet UI.
- [ ] T4 DMX engine + encoder (attribute physical value → DMX incl. 16-bit, defaults for untouched
      channels), Art-Net/sACN via `dmx-output.js`; per-universe enable; wire test: loopback sACN/Art-Net
      receive asserts exact channel bytes.
- [ ] T5 Godot fixture visualisation: GDTF geometry (glb; 3DS via WO-612 loader), Axis animation, beams
      (SpotLight3D + volumetric fog), gobo projector textures from wheels; perf budget (≥ 50 fps with 48 fixtures).
- [ ] T6 Programmer UI: select fixtures (previs click / sheet), intensity, colour (RGB/CMY/CTO from
      available attributes), position (pan/tilt or "point at" floor click), zoom, gobo; groups.
- [ ] T7 Visualiser mode (incoming Art-Net/sACN through the patch).
- [ ] T8 Looks integration (store/recall fixture states, TAKE crossfade).
- [ ] T9 Follow IK (consumes WO-616 markers). **First slice done in [WO-616 T11](./616_WO_previs_tracking_openfollow_cameras.md)** (2026-10-19): generic manual profile, `project.fixtures` patch, server engine `src/fixtures/` (ArtDmx sender, nearest-solution IK, hold on stale, master off by default, self-loop refusal). GDTF Axis chains replace the profile after T1.
- [ ] T10 MVR: fixtures from MVR (WO-612 T4) arrive patched (MVR carries `Addresses`, `GDTFMode`).

## Acceptance

- A real moving head `.gdtf` imports; its modes list matches the manual; patched at U1.001 it moves/
  colours/zooms on the real fixture via Art-Net **and** sACN (owner rig), and identically in previs.
- Visualiser mode mirrors a console's output on the previs rig in real time.
- Address collisions are refused; nothing is transmitted on a disabled universe (capture proves it).

## What was done / What was VERIFIED

Desk only (2026-10-17): codebase search for GDTF/DMX paths, spec structure; Godot API presence known from WO-612.

## Addendum (2026-10-17) — Perastage + camera calibration
- Perastage (GPL-3.0-or-later, see WO-612 addendum) is the natural *authoring* side: GDTF library with GDTF Share
  download and patch tables there, MVR → HighAsCG for real-time output/previs (Perastage is explicitly not a
  real-time DMX visualiser). Its `core/gdtf_description_reader` + `tests/gdtfloader_*` (channel modes, geometry
  roots, primitives) are reference material for T1.
- Fixture position calibration from the stage camera → WO-616 T13 (OpenFollow has no fixture model).
