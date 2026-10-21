**Status: DONE pending owner check (2026-10-21; was IN PROGRESS since 2026-10-21) — T1–T5 done (UV mapper, model load + saved screen tags, `led_screen.gdshader` used by the stage builder and MVR scenes, live shm sources with leases); T6 done without the key shortcuts (owner: the right-click menu replaces them); T7 done as the Live tab Standard ↔ 3D switch (WO-621 N6) — the pop-out window is deferred (one monitor on the box, no owner request); T8 (UV drag editor, a deferred WO-17 idea) not requested — parked. Owner checks: see the checklist (WO-607). Parent: [WO-593](./593_WO_godot_client_port_epic.md). Supersedes the three.js renderer of [WO-17](./17_WO_3D_PREVIS.md) once accepted (WO-17 keeps its history; its data model and server API are reused). Depends on: WO-596 (shm textures), WO-597 (`video-surfaces` for PGM/PRV), WO-599 (foundation).**

# WO-607 — Previs in Godot: native 3D stage with live channel textures

Owner, 17.10: "i like godot for the native 3d previz which i wanted to include in the future and
this future might be now." Previs is **the reason** for choosing Godot (WO-593), so it is
scheduled early (right after the foundation + live core), not last.

## Investigation — what previs is today (web, three.js)

Module (WO-30 optional-module pattern): `src/previs/` (register 74, `routes-models.js` 271,
`types.js` 107 LOC) + `client/components/previs-*` + `client/lib/previs-*` + `client/assets/modules/previs/entry.js`
= **4,916 LOC** (`wc -l`, 2026-10-17). Gate: `HIGHASCG_PREVIS=1` or `config.features.previs3d`.
three.js `^0.185.1` (`package.json:116`), served from `node_modules/three` at `/vendor/three/`
when installed (`src/bootstrap/modules.js:19-24`) — so previs works only where `npm run
install:previs` was run (the July doubt in `NATIVE_GUI_PROPOSITIONS.md` §1 is resolved: it is an
optional dependency, not dormant code).

Shipped (WO-17 checkboxes `:181-305`): glTF/GLB drag-drop + file picker, server persistence of
model binaries (`/api/previs/models`), mesh list + "screen" tagging (`userData['highascg.screen']`),
per-mesh source selector **PGM / PRV**, emissive LED glow (`MeshStandardMaterial.emissiveMap` =
video), camera presets (Front/Top/ISO + saved views, 500 ms cubic fly-to), keys `1-9 F G W Esc`,
grid/axes/wireframe toggles, 2D/3D toggle on the PGM compose cell, `previs:pgm-mode-changed`
event for WO-19/WO-31. Open: UV/virtual-canvas **drag editor** (`previs-uv-editor.js`, 211 LOC,
deferred), zones (WO-31), "Channel N" sources.

Video source today: the **WebRTC PGM `<video>`** from `client/lib/webrtc-client.js`
(`POST /api/go2rtc/webrtc?src=…` → local go2rtc) wrapped in `THREE.VideoTexture`
(`client/lib/previs-video-texture.js:1-17`), one binding per source shared by all meshes
(`previs-stream-sources.js`, refcounted). Optional CPU downscale to a `CanvasTexture`
(`getMaxVideoLongEdge`). → encode/decode latency, browser-capped resolution.

Pure, directly portable logic (no three.js/DOM): `client/lib/previs-uv-mapper.js` (382 LOC,
`computeContentBounds`, `computeScreenUV`, `computePanelUV`, `ledPanelSizeMeters`, `rotate2D`, own
`__selfTest()` at `:284`), `previs-texture-crop.js` (83), data shapes in `src/previs/types.js`
(`LEDWallConfig`, `LEDPanel`, `ScreenRegion`, `IrregularScreenConfig`, `ContentMappingStrategy
= stretch|fit|panel_uv`).

⚠️ **Persistence trap:** mesh tags, camera presets and UI toggles live in browser **`localStorage`**
(`client/lib/previs-state.js:313-332`, WO-17 `:252,:275`); only model binaries + metadata are on
the server. A Godot client cannot read Firefox's localStorage → migrate to server-side storage
first (T1), or every owner setup is lost at cutover.

## Why Godot is the right tool here (desk-verified on 4.6.3)

- Runtime glTF: `GLTFDocument.append_from_file()` / `append_from_buffer()` + `generate_scene()`
  ✔ present; `FBXDocument` ✔ present (FBX import at runtime — new capability vs three.js setup).
- Live video on a mesh: one `Texture2DRD` per source (WO-596) assigned to a
  `StandardMaterial3D.albedo_texture` / `emission_texture` — the same texture object the 2D UI
  uses; **one upload per frame per source** however many meshes show it.
- Native resolution, no codec: PGM at 3072×1728@50 straight from Caspar's mixer (WO-594), ≤ 1 frame.
- Real lighting/PBR, shadows, glow/bloom (`Environment`), shader-based LED pixel-grid look
  (pixel pitch from `LEDWallConfig`) — things three.js did only partially.

## Design

```
PrevisRoot (Node3D)                       autoload: VideoSurfaces (WO-596/597)
 ├─ StageModel  ← GLTFDocument (from /api/previs/models/<id>)
 │    └─ MeshInstance3D[*]  tagged "screen" → ScreenBinding
 ├─ ScreenBinding (per tagged mesh): source role (pgm1/prv1/pgm2/channel N)
 │      material = ShaderMaterial "led_screen.gdshader"
 │        uniform sampler2D video (Texture2DRD from VideoSurfaces.acquire(role))
 │        uniform vec4 uv_rect (from ported previs-uv-mapper)   uniform float pixel_pitch, glow
 ├─ OrbitCamera + CameraPresets (fly-to tween 500 ms cubic, as today)
 ├─ WorldEnvironment (glow, tonemap)   └─ Grid/Axes gizmos
UI (Control, same window): toolbar, mesh inspector, camera list, display toggles, scene settings
```

- Lives as a panel in the Godot client (2D/3D toggle on the PGM compose tile, as today) **and**
  can be popped out to its own window on any monitor (`Window`, `embed_subwindows=false`).
- `VideoSurfaces.acquire('pgm1')` → server `POST /api/video-surfaces/acquire` (WO-597 adds the
  shm consumer lazily, released 10 s after the last viewer). Signal lost → material shows the
  last frame dimmed + "NO SIGNAL" decal.
- UV mapping: `previs-uv-mapper.js` ported 1:1 to `previs_uv_mapper.gd` with its `__selfTest`
  cases as gdUnit4 tests (byte-for-byte same expected numbers).

## Tasks

- [x] T1 (20.10, see below) — **(web, before anything else)** move previs tags/presets/UI from `localStorage` to the
      server (per-model metadata under `/api/previs/models/<id>` or project); one-time migration
      on next web load. Smoke + owner check that the existing stage keeps its tags.
- [x] T2 — `previs_uv_mapper.gd` + tests ported from `__selfTest` (pure).
- [x] T3 — model load (GLB/GLTF/FBX) from server, mesh list, tag/untag, selection outline.
- [x] T4 — `led_screen.gdshader` (uv_rect, emissive glow, optional pixel-grid at `pixelPitch`).
- [x] T5 — sources: PGM/PRV/Channel N via `VideoSurfaces`; refcount; NO SIGNAL state.
- [x] T6 — camera presets + keys `1-9 F G W Esc` + fly-to; display toggles; scene settings. *(21.10: presets, fly-to,
      toggles in ui.cfg done; the key shortcuts dropped — owner: "no need for intricate shortcuts in godot as we have
      the right click menu".)*
- [~] T7 — 2D/3D toggle on the PGM tile + pop-out window; `previs_mode_changed` signal for WO-19/31. *(21.10: the
      toggle is the Live tab's Standard ↔ 3D switch, WO-621 N6. Pop-out window deferred: one monitor on the box and no
      owner request. The signal had web-era consumers only.)*
- [ ] T8 — UV/virtual-canvas drag editor (the deferred WO-17 item) — natural in Godot 2D. *(21.10: parked — not
      requested; the stage builder's numeric crop fields cover mapping today.)*
- [x] **MVR scene import (Capture etc.) → [WO-612](./612_WO_previs_mvr_import.md)** (needs a 3DS loader; MVR
      VideoScreen Sources/Mappings map onto these screen bindings).
- [x] **Stage builder (LED walls / TVs / projection from numbers, bound to channels) → [WO-614](./614_WO_previs_stage_builder.md)**
- [ ] **Fixtures: GDTF, patch, Art-Net/sACN out, beams → [WO-615](./615_WO_previs_fixtures_gdtf_patch_dmx_out.md)**
- [ ] **Tracking: OpenFollow port, DeckLink/channel camera, two-camera fusion → [WO-616](./616_WO_previs_tracking_openfollow_cameras.md)**

## Acceptance

- The owner's existing stage model loads with all tags (after T1 migration).
- PGM (3072×1728@50) on the LED mesh at ≥ 50 fps on the operator monitor, ≤ 1 frame behind PGM.
- Closing previs removes the PGM shm consumer within ~10 s (journal shows one `REMOVE`).

## What was done (2026-10-17)

- `godot/client/features/previs/previs_uv_mapper.gd` — 1:1 port of `client/lib/previs-uv-mapper.js`
  (`compute_content_bounds`, `compute_screen_uv`, `compute_panel_uv`, `led_panel_size_meters`, `rotate_2d`)
  + `uv_rect_to_godot()` (mapper v=0 bottom → Godot `uv1_scale/offset`). Tests = the JS `__selfTest()`
  cases (`tests/test_previs_uv_mapper.gd`).
- `previs_stage.gd` — environment (linear tonemap: filmic washed the LED colours out in M0), floor,
  runtime glTF from bytes (`GLTFDocument.append_from_buffer`), name-heuristic screen tagging + manual
  toggles, emissive LED material with the live texture, orbit camera, Front/Top/ISO fly-to (500 ms cubic,
  as WO-17 T4.1), auto-frame to the model's AABB.
- `previs_tab.gd` — SubViewport stage + panel: models from `GET /api/previs/models`, download via
  `GET /api/previs/models/:id` (new `Api.get_bytes`), live source picker (`opgui`, `pgm1`, `prv1`…; runtime
  roles are leased through WO-597), camera presets, per-mesh screen toggles.

## What was VERIFIED

- JS baseline `__selfTest()` = `{passed:20, failed:0}`; GDScript port passes the same 20 checks + 3 new.
- Simulator with `HIGHASCG_PREVIS=1`: a GLB uploaded through the real `POST /api/previs/models` endpoint is
  listed, downloaded and rendered in the Godot client; `LED_Screen_Main`/`LED_Screen_Side` auto-tagged, live
  operator channel on both (screenshot 2026-10-17). Not verified: owner's real stage, PGM 3072×1728 surface
  on the box, tags persisted server-side (T1).

Earlier desk checks: file sizes (`wc -l`), WO-17 status lines, `GLTFDocument`/`FBXDocument`/`Texture2DRD`
presence in Godot 4.6.3 (headless ClassDB probe, WO-595).

## 2026-10-20 — T1 closed: screen tags in the project, nothing to migrate

**Investigation.**
- Read-only copy of the box's Firefox localStorage for `http://127.0.0.1:4200`: 16 keys. None of them is previs
  state (`tags` / `presets` / `ui`), the LED test card, placeholders or A/B hosts, so nothing has to be migrated.
- The server `previs` module (GLB model library, `/api/previs/models`) is not enabled on this box (`GET
  /api/modules` → tracking, cg-studio; `/api/previs/models` → 404), and `.highascg-previs/models` is empty.
- The owner's stage now lives server-side in the project: WO-614 stage builder `previs.stage` and WO-612 MVR. Godot
  camera presets are built in (Front / Top / ISO), and its UI toggles are in ui.cfg.
- The only Godot gap was the GLB "Screens (live texture)" checkboxes, which were never saved: every load re-ran the
  `screen` / `led` name rule.

**What was done.**
- `features/previs/glb_screens_model.gd` (pure): `saved()`, `is_screen()` (a saved list beats the name rule, an
  empty list means none) and `store()` → `project.previs.modelScreens[<model id>] = [sorted mesh names]`.
- The server keeps `previs` across web autosaves (`CLIENT_OWNED_SLICES`).
- `previs_tab.gd`: on model load, the saved tags are applied before the checkboxes are built; each toggle stores
  them and calls `ProjectSync.mark_dirty()`.

**What was VERIFIED.**
- `test_glb_screens_model.gd`: Godot tests 16459/0; the boot check is clean.
- **Not box-verified:** this box has no GLB library (module off, no models). Enabling it would mean changing
  `config/` and installing `three`, so it is on the owner checklist.
