**Status: IN PROGRESS (2026-10-21) — T1 GDTF parser + T2 `/api/fixtures/types` DONE (offline suite + real files on the box); T3 patch (server, Godot model, previs Fixtures patch sheet) + T4 DMX engine / sACN DONE (offline, loopback wire test with a real Robin LedPOINTE file, GUI on the box) — owner rig check pending; T5 previs fixtures + beams DONE (offline + box: real Robin models, 48 fixtures at 50 fps, a real gobo projected); T6 programmer DONE (offline + box: pick in 3D / list / groups, intensity, colour, wheels, gobos, point at floor); T7–T10 open. The follow slice of T3/T4/T9 landed via WO-616 T11 (2026-10-19, generic profile, Art-Net). Parent: [WO-607](./607_WO_godot_previs_native_3d.md). Supersedes the scope of [WO-180](./180_WO_GDTF_FIXTURE_IMPORT_EXPORT.md) for real fixtures (WO-180 stays for pixel-map GDTF export). Related: [WO-612](./612_WO_previs_mvr_import.md) (MVR fixtures reference GDTF), [WO-614](./614_WO_previs_stage_builder.md), [WO-616](./616_WO_previs_tracking_openfollow_cameras.md) (follow), [WO-31](./31_WO_STAGE_AUTOFOLLOW_PTZ.md).**

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

- [x] T1 GDTF parser (server, JS): zip + `description.xml` → normalized JSON (modes, channels with
      offsets/coarse-fine, logical attributes, channel functions + physical ranges + defaults, geometry tree,
      beams, wheels); tests with 3 real files from GDTF Share (moving head spot, wash, LED par) stored in
      `tools/fixtures/gdtf/` (license check: GDTF Share files are manufacturer-published; keep small ones).
- [x] T2 `/api/fixtures/types` (upload/list/get/delete; store under the media/data dir, `.stignore` checked).
- [x] T3 Patch model in the project (`project.fixtures.patch`), address-collision check, universe usage map; Godot patch sheet UI. (2026-10-21)
- [x] T4 DMX engine + encoder (attribute physical value → DMX incl. 16-bit, defaults for untouched
      channels), Art-Net/sACN via `dmx-output.js`; per-universe enable; wire test: loopback sACN/Art-Net
      receive asserts exact channel bytes.
- [x] T5 Godot fixture visualisation: GDTF geometry (glb; 3DS via WO-612 loader), Axis animation, beams
      (SpotLight3D + volumetric fog), gobo projector textures from wheels; perf budget (≥ 50 fps with 48 fixtures).
      (2026-10-21 — additive cones instead of volumetric fog, see the T5 section)
- [x] T6 Programmer UI: select fixtures (previs click / sheet), intensity, colour (RGB/CMY/CTO from
      available attributes), position (pan/tilt or "point at" floor click), zoom, gobo; groups. (2026-10-21)
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

## T1 + T2 — GDTF parser and fixture-type store (2026-10-21)

### Investigation
- Test corpus: the 8 real `.gdtf` files from the owner's MVR set (scratchpad `mvr-work/midsize/`: Robin LedPOINTE,
  Astera FP3 Hyperion Tube, Elation Pulse Panel, …). **Not committed** — GDTF Share files are manufacturer content;
  the committed test uses a synthetic `tools/fixtures/gdtf/test-spot.xml` covering every case found in the real ones.
- What the real files need beyond the spec summary above:
  - **DMX values are "value/bytes"** (`32768/2`, `255/1`) and must be scaled to the channel's resolution
    (bytes = number of offsets). Shift by whole bytes, but an all-ones value stays all-ones (`255/1` → 65535 at 16 bit).
  - **ModeMaster overlap**: Pan and "Pan 360 Shortcut" both start at DMX 0 on the same channel, on different
    branches of a mode-master channel. A function's `to` is the next function's `from` − 1 *within the same
    (modeMaster, modeFrom, modeTo) branch*, not the next function overall.
  - **Pixel fixtures** place one template geometry many times via `GeometryReference` + `Break DMXOffset`; the
    DMX channel names the template (`Geometry="Main RGB"`) and must be instanced per reference at
    offset + DMXOffset − 1 (Hyperion: 32 px × 165 modes).
  - **Virtual channels** have `Offset=""` (no DMX slot; a virtual per-pixel dimmer).
  - `InitialFunction` is `Geom_Attr.Attr.FunctionName` (function names may contain dots).
  - **Elation Pulse Panel 60CH has two channels at offset 12 in the file itself** — kept as written and reported
    as a mode warning, not "fixed".
  - Some pixel modes have footprint > channel count (stride-4 layout with gaps) — that is the file's layout.
- Size: the Hyperion parse is 7.5 MB of JSON (165 modes), so the API serves summaries and one mode per request.
  Parse time ≤ 181 ms for every file.

### What was done
- `src/fixtures/gdtf-dmx.js` — modes → channels `{geometry, break, offsets, res, attribute, default, highlight,
  initial, functions[{name, attribute, from, to, default, physFrom, physTo, wheel, modeMaster, modeFrom, modeTo, sets}]}`,
  footprint = highest break-1 offset. Pure.
- `src/fixtures/gdtf-parse.js` — archive (unzipper) → `{name, shortName, manufacturer, fixtureTypeId, dataVersion,
  modes, geometry (Axis/Beam tree; GeometryReference kept as `ref` for the viewer to instance; wiring/inventory
  dropped), models, files, wheels (CIE colour, media), attributes}`. Reuses the WO-612 xml2js helpers and
  `gdtfMatrix`.
- `src/fixtures/gdtf-store.js` — `projects/_gdtf/<sha1-12>.gdtf` + `.json` (content-addressed: re-importing the same
  file is the same type; ids are hex-only, so no path traversal). Test-isolated through `projectsRoot()`. Synced to
  peers like the rest of `projects/` — content-addressed and append-only, so a peer cannot revert it.
- `src/api/routes-fixture-types.js` — `GET/POST /api/fixtures/types`, `GET /api/fixtures/types/<id>[/mode?name=|/file?path=]`,
  `DELETE /api/fixtures/types/<id>`; multipart via the WO-612 `readUpload` (now exported). One line on router.js:488.
- `tools/smoke/lib/zip-stored.js` — a stored-ZIP builder for tests (the WO-612 test keeps its own copy, unchanged).
- Note: query strings decode `%20`, not `+` (`parseQueryString`, box-wide); both clients send `%20`. Not changed —
  a box-wide `+` → space decode could break hand-built paths that contain a literal `+`.

### What was VERIFIED
- `tools/smoke/smoke-wo615-gdtf.test.js` — 6 tests: value scaling, 16-bit offsets/defaults, mode-master branches,
  channel sets with ranges, virtual channel, duplicate-offset warning, pixel instancing, geometry tree, wheels, store
  (content id, list/describe/mode/member/remove, traversal), routes with a real multipart upload + bad upload.
  Offline suite 3030 pass / 0 fail; lint ≤ 216; prettier, line limit, unwired exports, API contract (regenerated) green.
- All 8 real files parsed via a scratch script; one offset collision, the Pulse Panel's own.
- Box (node restarted): `curl -F file=@"Astera LED Technology@FP3 Hyperion Tube.gdtf"` → id `9d0e29135cc2`, 165 modes
  (`1: RGB` 3 ch … `4: DIM RGB` 4 ch, no warnings); list → 1 type; describe 150 KB (wheel "Virtual ColorWheel",
  5 archive files); `mode?name=4%3A%20DIM%20RGB` → Dimmer @1 + pixel channels; `file?path=thumbnail.png` → 200
  image/png 75 430 B; DELETE → ok, `projects/_gdtf` empty again.

## T3 + T4 — typed patch entries, DMX engine, sACN (2026-10-21)

### Investigation
- The WO-616 T11 follow engine (`src/fixtures/follow-engine.js`) already owns what T4 needs: per-(destination,
  universe) 512-byte frames at 44 Hz, change-or-1 s-refresh sending, self-loop refusal, WO-632 read-through.
  A second engine sending the same universes would fight it, so typed fixtures join **that** patch and engine.
- `src/sampling/dmx-output.js` (the design's "existing senders") uses `dmxnet` + the `sacn` package — the box
  memory forbids dmxnet for this path (it broadcasts / loops into the box's own :6454 input). The WO-616 sender
  (`artdmx.js` ArtnetSender) is a plain ephemeral UDP socket, so sACN only needs an encoder: `sacn.js`, ~80 lines.
- Real heads (Robin Esprite / LEDBeam 150 / LEDBeam 350 / LedPOINTE): Pan and Tilt are 16-bit full-range functions
  (0…65535) with symmetric physical ranges (±270, ±225, tilt 131.8 → −131.8 — **falling**). So a GDTF head maps
  exactly onto the generic profile `{ch, fine, range, invert}` with range = |PhysicalTo − PhysicalFrom| and invert
  flipped by a falling range: the IK, the calibration jog and read-through stay untouched.
- Godot `follow_model.gd normalize_fixture` rebuilds each entry from known keys and the section saves
  `Store.project["fixtures"] = data.duplicate(true)` — without a twin change a Godot save would erase `typeId`,
  `mode`, `protocol` and the new `dmx` key.
- The box's lighting input (`src/artnet/lighting-input-receiver.js`) can run sACN on its patch universe (0–15) with
  multicast loopback on — an sACN universe with that number sent multicast (or unicast to a local address :5568)
  would feed the box itself.

### What was done
- `src/fixtures/gdtf-patch.js` (new): `applyType` (pan / tilt + channel list from a mode), `writeGdtf` (defaults
  first, programmed values second — a programmed channel beats its offset-sharing twin's default, the Pulse Panel
  case), `encodeValue` (physical number over PhysicalFrom…To, `{norm}`, `{dmx}`, `{set: name}`; the key's attribute
  picks the function, e.g. `Color1WheelSpin`), `normalizeDmx`.
- `src/fixtures/sacn.js` (new): E1.31 encode / decode, stable per-box CID, multicast 239.255.hi.lo:5568 or unicast.
- `follow-patch.js`: patch entries gain `protocol` ("artnet" | "sacn", sACN universes 1–63999, empty dest =
  multicast), `typeId`, `mode`; `normalizePatch(slice, { resolveMode })` attaches the mode; typed footprint = every
  slot of the mode (+ fixed); collisions are per protocol / destination / universe across typed and generic
  fixtures; new problems: type / mode not found, follows a marker without Pan / Tilt.
- `follow-engine.js`: typed fixtures write all channels every tick, pan / tilt from the aim only while following or
  held; programmer (`program` / `clearProgram` / `values`, in memory — looks persist them in T8); E1.31 for sACN
  universes; **gating**: a universe carrying a typed fixture is sent only while `fixtures.dmx.enabled` and the
  universe is listed (`"artnet:0"`, `"sacn:1"`); untyped universes keep the WO-616/631 rule.
- `follow-ik.js writeFixture(…, null)` writes only the fixed channels (typed, not aimed).
- `follow-service.js`: GDTF resolver, sACN self-loop refusal, `reload()`; `ctx.fixtureService` set by the tracking
  module; type import / delete reload the patch.
- `src/api/routes-fixture-dmx.js` (new): `GET /api/fixtures/dmx` (universe usage map), `GET /api/fixtures/dmx/frame`,
  `GET|POST|DELETE /api/fixtures/program`.
- Godot `follow_model.gd`: twin fields + `normalize_dmx`; `new_fixture(…, type_fp)` places the next typed fixture
  after its GDTF footprint.
- Not done: mode masters are not enforced; channels on DMX breaks > 1 are not output (counted in `gdtf.skipped`).

### What was VERIFIED
- `tools/smoke/smoke-wo615-dmx.test.js` — 8 tests: E1.31 layer lengths + the `sacn` package's own `Packet` parser
  reads universe / sequence / priority / name; derived pan / tilt; value encoding (pan 90° of ±270 → 43690, tilt
  falling, set, norm, dmx clamp, spin function by key, shared-offset twin); per-pixel keys; collisions typed vs
  generic, past 512, unknown type, follow without pan; engine gating (follow backup on → typed sACN silent; DMX
  master + listing → E1.31 out; both off → nothing); calibration hold aims a typed head; sACN self-loop refusal;
  routes; **loopback wire test** (Art-Net 127.0.0.1:6455 + sACN 127.0.0.1:5569, exact bytes).
  Existing follow / PSN / read-through / calibration smokes 142/142. Offline suite 3040 tests green after the
  contract fix (the generator only sees literal `routes.get(…)` calls); Godot 20460 pass, `--check` boot OK.
- Box (node restarted): the live patch (fx1 → 127.0.0.1:6455, output off) reports identically, now with
  `protocol artnet, moving true, slots 4`; `/api/fixtures/dmx` usage map → U0 1–4; uploading Robin LedPOINTE →
  journal `[follow] patch: …` reload; `POST /program {fx1, Dimmer 1}` → stored, generic fixture's frame unchanged,
  `live false`, 0 packets sent; DELETE program / type → empty, reload logged, `projects/_gdtf` empty.
- Real-file wire check (scratch script, the live store's LedPOINTE "Mode 1 - Standard 16 - bit", 39 ch): Pan 90° →
  170,170; Tilt −45° (135 → −135) → 170,170; Color1 set "Deep Red - Positioning" (16-bit 2304) → 9,0; Dimmer → 255,255;
  every other channel at its GDTF default; Art-Net U0 and sACN U7 @101 byte-identical.
- Owner check pending: a real rig over Art-Net **and** sACN (checklist once the patch sheet lands).

## T3 — Godot patch sheet (2026-10-21)

### What was done
- `godot/client/features/previs/fixtures/fixtures_section.gd` (new, previs side panel under "MVR scene"): fixture
  type picker (GET /api/fixtures/types), **Import GDTF…** (stream upload) / **Remove** (warns how many patched
  fixtures use it), mode picker ("name · N ch", ⚠ when the file has shared offsets), protocol (Art-Net / sACN),
  universe ("U"), count ("×"), **Add** → N fixtures at the next free addresses of that universe + destination,
  spread along X; the universe usage lines (GET /api/fixtures/dmx: "Art-Net 5 → 255.255.255.255:6454 · 78 / 512 ch ·
  2 fixtures · off"); **DMX output** master (confirmation first) and **Send ▾** (check the universes it sends).
  Writes the whole normalized `project.fixtures` slice and re-emits `Store.project_changed`, so the Follow list
  (the per-fixture editor) reloads.
- `fixtures_model.gd` (pure, tested): footprints (GDTF mode / generic profile), occupancy per (protocol, universe,
  destination), first free gap, `add_typed`, usage lines, universe toggle.
- `follow_section.gd`: the list shows "sACN " and "[mode]" for typed fixtures; a typed fixture hides the six pan /
  tilt channel / range rows (the server derives them); universe limits and label follow the protocol; sACN
  destination placeholder "empty = multicast".

### What was VERIFIED
- Godot tests 20478 pass (`test_fixtures_model.gd`: footprints, gaps, 13 × 39 ch fill a universe, usage, toggles),
  `--check` boot OK.
- Box GUI (owner project snapshotted first): LedPOINTE imported → section lists "Robe Lighting · Robin LedPOINTE",
  "Mode 1 - Standard 16 - bit · 39 ch"; U5 × 2 → **Add** → "Added 2 at 5.001, 5.040", autosaved; server
  `/api/fixtures/dmx` → Art-Net 5, fx2 1–39 + fx3 40–78, no problems; Send ▾ → Art-Net 5 checked →
  `dmx.universes ["artnet:5"]`, master off → `live false`, 0 packets; DMX output → confirmation shown → Cancel → still
  off; Tracking → Follow lists "LedPOINTE 1 U5.001 [Mode 1 - Standard 16 - bit]" and its form has no pan / tilt rows.
- Restore: the `fixtures` slice posted back on the current rev (the stale-rev guard refused the older snapshot, as
  designed) → equal to the snapshot; type deleted; `config/` byte-identical to the backup; ui.cfg restored.

## T5 — previs fixtures: rig, DMX decode, beams (2026-10-21)

### Investigation
- **GDTF models hang.** Building every real file's rig (8 types from the MVR test set) and composing the transforms,
  the beam of every type points along GDTF −Z with the base above it (Robin Esprite beam 0.72 m below the base,
  LedPOINTE 0.66 m, Pulse Panel, Fresnel, LEDBeam alike). So the GDTF model as-is is the patch's `hang: "truss"`,
  and positive Tilt (right-handed about the tilt Axis's X) swings −Z toward +Y — exactly follow-ik.js's frame
  (`f` = upstage at yaw 0). Positive Pan about Z sends it to −X, follow-ik's hung `g`. Standing (`floor`) is the
  same model turned 180° about stage Y (not X — about X would flip `f` to downstage). Yaw = rotation −yaw about Z.
  No extra offsets are needed between the IK and the drawing.
- **Mode masters need the master's resolution.** `ModeFrom="1/1"` was scaled to 2 bytes (256) for every function
  (`gdtf-dmx.js` assumed 2), but the Esprite / LedPOINTE masters are 1-byte channels, so a decoder comparing the master
  channel's raw value would never pick "Pan 360". Mode-master ranges are now rescaled to the master channel's own
  resolution after all channels are parsed (channels carry `name`: the DMX channel Name, else `<Geometry>_<Attribute>`,
  what `ModeMaster` refers to). All 42 mode-master functions in the real files resolve to a channel.
- **What lights a beam.** Real files put Dimmer / Shutter / colour on `Head` or `Base`, not on the Beam geometry, and
  pixel fixtures put the master dimmer on the bar and RGB on each cell. So a beam's scope = channels on the beam or
  any ancestor (in the instanced tree). Shutter sets are named "Closed" / "Close" / "Shutter closed" (survey of
  every Shutter1 function in the real files); strobe functions read as open. Pulse Panel 3CH patches only its CW
  cells: its RGB beams have no channel in scope and must stay dark (they read white before that rule).
- **Godot light facts found on the box.** (1) The default distance falloff (≈ 1/d) left a 5 m pool at ~10 % on the
  dark floor (invisible) — `spot_attenuation = 0`. (2) A `light_projector` on a shadowless SpotLight3D renders the
  light **black**: Godot projects through the shadow map. Screenshots: open gobo → pool, Gobo2 → nothing; with
  `shadow_enabled` → the Esprite's swirl gobo. (3) The previs Fit framed only the wall; fixtures behind the camera.

### What was done
- `src/fixtures/gdtf-dmx.js`: channel `name`; mode-master ranges at the master channel's resolution.
- `src/fixtures/gdtf-rig.js` (new): the mode's geometry flattened parent-first with GeometryReference instanced
  (reference name; template children `<ref>/<child>`, the same naming gdtf-dmx.js gives instanced channels), local
  transforms conjugated into Godot's frame (GDTF Z = Godot Y, same angle sign), meshes as WO-612 (glb, else 3ds,
  else a box of the model size with `mesh_xf`), Pan / Tilt axis nodes marked from the mode's channels.
- `src/fixtures/gdtf-visual.js` (new): `compileVisual` (per type + mode: beam scopes) and `decodeVisual` (DMX →
  axes in degrees; per beam intensity = dimmers in scope × additive level, 0 on a Closed shutter or with no channel
  in scope; colour = additive emitters normalised, else white, × CMY × colour-wheel slot (CIE xy → sRGB); zoom = Zoom
  physical else BeamAngle; gobo = first gobo wheel slot with media). Shared with T7.
- `gdtf-store.js` `visual(id, mode)` (cached rig + plan, cleared on remove); routes
  `GET /api/fixtures/types/<id>/rig?mode=` and `/model?path=models/(gltf|3ds)/…` (3ds → GLB, WO-612 converter);
  `follow-engine.js` `frameOf(fx)`; `follow-service.js` `visual()`; `src/tracking/register.js` WS
  `tracking:fixtures` (33 ms tick, on change) + `GET /api/tracking/fixtures` (first state for a client).
- Godot `features/previs/fixtures/fixtures_3d.gd` (new, mounted in the previs stage) + `fixtures_3d_model.gd`
  (pure: pose, axes, cone size, light budget, tint): builds each typed fixture from its rig (GLB meshes once per
  type, duplicated), poses it, turns axes and lights beams from `tracking:fixtures`. A beam = additive fading cone
  (shader: alpha falls off along the beam and toward the silhouette) + emissive lens + a SpotLight3D (no distance
  falloff, hard edge) while 64 lights last; gobos project the wheel image (`wheels/<media>.png`, mipmapped), with
  shadows on only for those (16 max); a rig with > 4 beams (pixel panel / bar) draws glowing cells only. Fit
  includes the fixture bodies (`previs_tab.gd`).
- **Not done, deliberately:** volumetric fog (the cones read better, cost nothing and do not haze the LED wall
  preview); prism / frost / iris / CTO / animation wheels are decoded nowhere yet; channels on DMX breaks > 1 are
  still not output (T4) so they are not drawn either; untyped (generic profile) heads stay drawn by the follow view.

### What was VERIFIED
- Offline: `tools/smoke/smoke-wo615-visual.test.js` 7/7 (rig order / axes / Godot-frame conversion / box sizing,
  GeometryReference instancing, decode of defaults / dimmer + wheel colour / pan / mode-master switching (PanMode 0 →
  ±270, 1 → ±180, other → none), pixel bar master × cell colour, Closed shutter, CMY, zoom, engine `frameOf`, store
  cache, `/rig` + `/model` routes). WO-615 smokes 21/21; offline suite 3047 tests, 3045 pass, 0 fail (2 skipped);
  `node index.js --no-http` boots; lint 216 (= cap), file lines, format, api-contract regenerated (`tracking:fixtures`,
  `/api/tracking/fixtures`). Godot: `test_fixtures_3d_model.gd` (pose + axes give the IK's beam directions for hung
  and standing heads, yaw 90, cell rigs, light budget, tint); 20497 pass, `--check` boot OK.
- Real files (decode, offline): Esprite / LEDBeam / LedPOINTE pan 45 / tilt 30 decode to 45.00 / 30.00; LEDBeam
  R 1 + its default W 65535 → [1, 0.5, 0.5] (correct: W defaults full); ~0.01 ms per fixture decode.
- Box (server restarted, GUI relaunched): imported LedPOINTE / LEDBeam 150 / Pulse Panel / Esprite; patched up to
  48 typed fixtures (sACN U7–U11 unicast 127.0.0.1:5569, **DMX output master off — 0 packets**), drove them through
  `/api/fixtures/program`. Seen in the previs: real GLB models (Esprite base / yoke / head), hung spots fanned by
  pan −60…+60, floor beams up in their RGB colours, pixel panels as glowing cells, positive tilt swinging the head
  upstage, the Esprite's real Gobo2 swirl projected on the floor. **48 fixtures / 704 beams: 50 fps (vsync cap),
  render cpu 1.0–1.5 ms / gpu 0.3–0.4 ms, also during a 25 Hz pan / tilt / colour sweep with 16 gobo spots**;
  server 12.7 % CPU during the sweep.
- Restored: fixtures slice identical to before, programmer cleared, all imported types deleted, `ui.cfg` identical,
  GUI back on tab 5.
- Owner QA: does a real head (and its gobo) match the previs — direction of pan / tilt included (checklist).

## T6 — the programmer (2026-10-21)

### Investigation
- **What the UI needs per fixture is in the patched mode, not the type summary.** `fx.gdtf.channels` (applyType) has
  each channel's initial function with its physical range and DMX default; the wheels (slot colour CIE, media) are
  in the stored type. Real Robin Esprite (Mode 1 Standard 16 bit): Dimmer, CMY, CTO 6500→3000 K, Zoom 50→5°, pan
  ±270, tilt ±131.8, two colour wheels and two gobo wheels. Its channel sets repeat slots ("Deep red" and
  "Deep red step", "Gobo1" and its shake sets) — 18 colour entries for 12 slots — so wheel entries are one per
  slot. Both colour wheels have an "Open/white", so the client keys wheel entries by attribute + name.
- **Point at reuses the follow IK exactly.** follow-ik.js `aim` returns degrees from the DMX centre and the follow
  output writes them with `invert` (patch flip XOR a falling range, gdtf-patch.js applyType). Mapping those degrees
  onto the function's physical range the same way gives physical = IK degrees for an unflipped head — the value the
  T5 previs draws. Offline: hung at 6 m, a point 3 m upstage → Pan 0, Tilt 26.57, and the T5 decode of the
  resulting DMX frame reads Head 26.57 back.
- **Mixing next to a colour wheel.** On the box, picking a colour with the picker on an Esprite whose wheel sat on
  "Deep red" went black: CMY cyan through a red filter (physically right; operator-wrong). The picker now also
  opens that fixture's colour wheels (first slot).
- **CTO / zoom "current" value.** An unprogrammed control has to show what the channel's GDTF default means
  (LEDBeam CTO: DMX 0 = 8000 K), not the slider's low end — `at` in each range.

### What was done
- `src/fixtures/gdtf-features.js` (new, pure): `features(fx, wheels)` (dimmer, ColorAdd_* / ColorRGB_* and
  ColorSub_* present, CTO / pan / tilt / zoom `{from, to, at}`, colour-wheel slots with sRGB via `cieToRgb`, gobo
  slots with media) and `aimValues(fx, target, values)` (IK nearest the current programmer pan / tilt → physical
  Pan / Tilt, null when unreachable or no axes).
- `follow-service.js` `features(ids)` / `aim(ids, target)`; `routes-fixture-dmx.js`:
  `GET /api/fixtures/program/features[?ids=]`, `POST /api/fixtures/program/aim {ids, target: [x, y, z]}` (PSN metres;
  400 on missing ids / non-numeric target). API contract regenerated (462 routes).
- Godot: `fixture_selection.gd` (one shared selection per client: pick / shift-pick, Point at state, `aim_at`);
  `fixtures_3d.gd` picks the nearest fixture body under a click (ray vs each fixture's rest-pose body box) and draws
  a yellow box on selected ones, and with Point at on turns a floor click (`fixtures_3d_model.gd floor_hit`, y = 0)
  into `aim_at`; `previs_tab.gd` offers the click to the fixtures before the stage builder (same line count).
  `programmer_section.gd` (under the Fixtures section): typed-fixture list (multi-select, synced with the 3D picks),
  All / None / Release / Release all / Groups ▾ (pick, Save selection as group…, Forget group ▸), and controls for
  what the selection has: Intensity, Colour (picker) + wheel swatches, CTO, Pan, Tilt, Point at, Zoom, gobo
  thumbnails (the wheel PNGs). Writes are coalesced to 20 Hz into `POST /api/fixtures/program`; a wheel pick goes only
  to the selected fixtures that have that slot. `programmer_model.gd` (pure): merge, colour → per-fixture values
  (RGB mix with other emitters off, else CMY, else the nearest wheel slot; mixing opens the wheels), wheel owners,
  groups. Groups live in `project.fixtures.groups` (`follow_model.gd normalize` keeps them, idempotent).
- **Deliberately not done:** programmer values stay in server memory (T8 looks persist them); no fan / spread
  tools and no per-pixel colour (cells take the fixture-wide ColorAdd values); Point at aims at the floor plane only.

### What was VERIFIED
- Offline: `tools/smoke/smoke-wo615-programmer.test.js` 4/4 (features of the synthetic spot and pixel bar, gobo /
  CTO / zoom / CMY and slot dedupe, aim → DMX → decode round trip, flipped head, nearest solution, routes and their
  validation, 503 without the engine); offline suite 3051 tests, 3049 pass, 0 fail (2 skipped); boot OK; lint 216,
  lines, format, unwired, contract. Godot `test_programmer_model.gd` (merge, colour per fixture type incl. wheel
  opening, owners, groups + normalize idempotent, selection, floor hit); 20524 pass, `--check` OK.
- Box (server restarted, GUI on the Previs tab; real Robin Esprite + LEDBeam 150, 4 hung + 4 standing on sACN U7 to
  127.0.0.1:5569, **DMX output master off — both universes `live=false` throughout**): a click in the 3D view
  selected one head (yellow box, list row in sync); All → 8 with the controls of both types (Esprite wheel swatches
  and its 18 real gobo thumbnails, CTO, pan / tilt, zoom); Intensity 100 %; Point at + a floor click → the four hung
  Esprites converged on the clicked spot (pan 29.9 / 10.1 / −12.3 / −31.5, tilt −52…−56), the standing LEDBeams to
  tilt 90 (floor level = horizontal, the IK's answer); red swatch + Gobo2 → only the Esprites took
  `Color1 Deep red` / `Gobo1 Gobo2` and projected the swirl in red; picker #ff8000 → Esprites CMY 0 / 0.5 / 1 with
  both wheels opened, LEDBeams R 1 G 0.5 B 0 W 0 — all orange in the previs; group "T6 all" saved into the project,
  recalled after None; Release → programmer empty, every beam i = 0; shift-click → 2 selected.
- Restored: fixtures slice identical to the snapshot (checked again after closing and relaunching the GUI), types
  deleted, programmer empty, `ui.cfg` identical, GUI back on tab 5.
- Owner QA: the programmer driving a real head (checklist).
