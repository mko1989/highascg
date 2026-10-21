**Status: IN PROGRESS (2026-10-21) — T1 GDTF parser + T2 `/api/fixtures/types` DONE (offline suite + real files on the box); T3 patch model + T4 DMX engine / sACN DONE server-side (offline + loopback wire test with a real Robin LedPOINTE file) — T3's Godot patch sheet, T5–T10 open. The follow slice of T3/T4/T9 landed via WO-616 T11 (2026-10-19, generic profile, Art-Net). Parent: [WO-607](./607_WO_godot_previs_native_3d.md). Supersedes the scope of [WO-180](./180_WO_GDTF_FIXTURE_IMPORT_EXPORT.md) for real fixtures (WO-180 stays for pixel-map GDTF export). Related: [WO-612](./612_WO_previs_mvr_import.md) (MVR fixtures reference GDTF), [WO-614](./614_WO_previs_stage_builder.md), [WO-616](./616_WO_previs_tracking_openfollow_cameras.md) (follow), [WO-31](./31_WO_STAGE_AUTOFOLLOW_PTZ.md).**

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
- [ ] T3 Patch model in the project (`project.fixtures.patch`), address-collision check, universe usage map; Godot patch sheet UI. **Server side + Godot model twin done 2026-10-21; patch sheet UI open.**
- [x] T4 DMX engine + encoder (attribute physical value → DMX incl. 16-bit, defaults for untouched
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
