**Status: DONE (2026-10-17, verified on the shop dev box with a real PGM output on DP-7) — T1–T6 implemented + verified; T7 (MVR round trip) moved to [WO-612](./612_WO_previs_mvr_import.md) where the MVR reader/writer lives. Owner QA: interactive pass on the box. Parent: [WO-607](./607_WO_godot_previs_native_3d.md). Related: [WO-615](./615_WO_previs_fixtures_gdtf_patch_dmx_out.md), [WO-616](./616_WO_previs_tracking_openfollow_cameras.md), [WO-617](./617_WO_previs_2d_mode_and_surface_refcount.md) (2D views, drag-move).**

# WO-614 — Previs stage builder: standard LED walls, TVs, projection — bound to channels

Owner, 17.10: "id like an easy way to create standard stages in 3d previz. led walls, tvs, projections,
connected to channels. led walls from a simple panel width heigth px width heigth, quantity."

## Investigation

- Today a stage only exists if someone models it in a DCC tool and uploads a GLB (WO-17/WO-607:
  `GET/POST /api/previs/models`, mesh tagging by name heuristic `LED_Screen_*` + manual toggles,
  `godot/client/features/previs/previs_stage.gd:55-88`). Nothing creates geometry from numbers.
- The data model for LED walls already exists, unused by any builder: `src/previs/types.js`
  `LEDWallConfig { pixelPitch, panelWidth, panelHeight, panelsWide, panelsHigh }`, `LEDPanel`,
  `ScreenRegion { canvasX/Y/Width/Height, worldWidth/Height, position, rotation, sourceStream }`
  (aligned with Show Creator, WO-17). The UV mapper (`previs_uv_mapper.gd`, ported + tested in WO-607)
  already computes per-panel UV rects (`compute_panel_uv`, `led_panel_size_meters`).
- "Connected to channels": HighAsCG already knows every output raster — `screenDestinations`
  (`config/screen_destinations.json`, mode/width/height/fps/mainScreenIndex) and the channel map
  (`getChannelMap`) — and WO-597 serves channel pictures as shm surfaces (`/api/video-surfaces`,
  roles `opgui`, `pgm1…4`, `prv1…4`, leased on demand). So a stage object only needs
  `{ surface role, crop rect in that raster }`.
- Persistence trap from WO-607 T1 applies: previs state must live on the server, not in client
  storage. Stage objects belong to the **show** (they describe the venue the project plays into), so
  they travel in the project document (`project.previs.stage`), written through ProjectSync autosave.
  To check in T2: `normalizeProjectPayload` (server + `core/state_store.gd`) keeps unknown keys.

## Design

### Object types (all metric: metres, degrees; stage frame X = stage left, Y = up, Z = downstage — Godot Y-up)

| Type | Operator enters | Derived |
|---|---|---|
| `led_wall` | **panel px W×H, panel size mm W×H, panels wide × high**, optional curve °/panel, base: flown/ground | wall size m, total px, pixel pitch (warn if X≠Y pitch), panel seams, default crop = full destination raster |
| `tv` | diagonal (inch), aspect (16:9 default), resolution, portrait/landscape, bezel mm, mount (stand/wall/truss) | screen size m, cabinet box |
| `projection` | screen W×H (or diagonal + aspect), front/rear, projector throw ratio (+ lens shift %) | projector position = throw × width in front of (or behind) the screen, frustum gizmo |
| `camera` (WO-616) | position/rotation/FOV or solved | frustum, live video plane |

Common fields: `id, name, type, position[3], rotation[3], source { role, rect{x,y,w,h} }, visible, locked`.
Built-in panel presets (generic, by pitch — all exact divisions of 500 mm): 500×500 P2.6 (192×192),
500×500 P2.9 (168×168), 500×500 P3.9 (128×128), 500×1000 P3.9 (128×256), 500×500 P4.8 (104×104).
User presets saved alongside (`previs.panelPresets`).

### "Connected to channels"
- **Create from destination:** pick a screen destination → LED wall/TV/projection pre-filled so its
  total px matches the destination raster, `source.role` = that destination's PGM surface, rect = full.
- Several objects can share one raster (tiled / carved screens, WO-509): each gets its own rect;
  default placement packs rects left→right in raster order.
- Render: one `Texture2DRD` per role (WO-596) shared by every object on it; per-object material with
  `uv1_scale/offset` from the rect (same convention as `previs_uv_mapper.uv_rect_to_godot`).
- LED look: shader with panel seams at panel boundaries and an optional pixel grid at the pitch
  (WO-607 T4 `led_screen.gdshader`); projection: emissive with a brightness factor; TV: emissive + bezel.

### UI (Godot previs tab)
"Add ▾" → LED wall / TV / Projection / From destination…; object list; inspector with the table's
fields (live geometry update); move/rotate gizmo (snap 0.1 m / 5°); duplicate; array (n copies at
spacing) for TV rows; templates: "Ground stack centre wall + 2 side walls", "Two IMAG screens L/R".

## Tasks

- [x] T1 `features/previs/stage_objects.gd` — pure model: normalize/validate each type, derived values
      (size, pitch, px, seams, projector pose), panel presets; headless tests.
- [x] T2 Persistence: `project.previs.stage` via ProjectSync autosave (+ server keeps the key; smoke);
      web client ignores it (no web UI).
- [x] T3 `stage_builder.gd` — Node3D generation (cabinet/box + screen quad, curved walls as N panel quads,
      projector frustum), material per object, bound to `VideoSurfaces` roles + rect.
- [x] T4 Inspector + list + add menu + "from destination" (reads `screenDestinations` + channel map).
- [x] T5 Gizmo (move/rotate, snap), duplicate/array, templates.
- [x] T6 LED shader: seams + pixel grid (shared with WO-607 T4).
- [→] T7 (moved to WO-612) MVR round trip: WO-612 import maps `VideoScreen` → these objects; export stage → MVR `VideoScreen`s.

## Acceptance

- A 10×6 wall of 500×500 mm / 192 px panels is created in < 30 s from the numbers alone: 5.0 × 3.0 m,
  1920×1152 px, P2.6, showing PGM live with correct crop; survives reload/restart (server-persisted).
- "From destination" for each configured screen destination produces a correctly sized, live object.
- Two objects sharing one raster show the right halves.

## Investigation addendum — a web autosave erased the stage
`client/lib/project-state.js:83-100` `exportProject` rebuilds the payload from a fixed key list
(scenes, programOutput, timelines, multiview, placeholders) → the next web save/autosave dropped
`project.previs`. Fixed on the server (any stale/remote client is covered): `src/engine/project-client-slices.js`
keeps a client-owned slice the payload omits; wired into `/api/project/save` + `/autosave`.

## What was done (2026-10-17)

| File | What |
|---|---|
| `godot/client/features/previs/stage_objects.gd` | pure model: defaults/clamps, pixels, size, pitch (+ non-square flag), curved column edges (chord = panel width), TV from diagonal/aspect/portrait, projector pose (throw, shift, rear), crop UV, presets, `from_destination` (→ `pgm<N>` role, full raster) |
| `…/led_screen.gdshader` | emissive picture with crop, AA panel seams + LED pixel grid fading with distance (also WO-607 T4) |
| `…/stage_builder.gd` | per-object nodes: LED strip per panel column (flat/curved) + cabinet back, TV + cabinet, projection screen + projector + frustum; shared VideoSurfaces texture per role, crop re-derived when a raster changes |
| `…/stage_panel.gd`, `previs_tab.gd`, `previs_stage.gd` | Stage section: Add ▾ (LED/TV/projection/from destination), list, inspector, duplicate/delete; persists via ProjectSync; echo-safe reload (canonical JSON); frames the stage on first load; `--probe-stage-add` dev flag |
| `src/engine/project-client-slices.js` + handlers | server keeps `previs` when a payload omits it |

## What was VERIFIED

- Headless: `test_stage_objects` 42 + `test_stage_builder` 12 checks → suite **141/0** on 4.7.2.
- Server keeps `project.previs` through autosave (probe POST/GET/restore, rev 340-341).
- Box (RTX PRO 4000, Caspar 2.5.1, operator channel → shm): 4 objects seeded into the server project
  (flown 10×6 P2.6 wall, curved 6×4 P3.9 side wall on the left half, 65" TV on the right half,
  projection with frustum) load in the client with live video, seams and curve correct (screenshots).
- UI write path: `--probe-stage-add=1` → autosave rev 343 → object present on the server.
- Web-shaped autosave after the guard (rev 345) → all 4 objects still stored. Smoke 5/5 (CI list).
- Not yet: interactive owner pass (typing in the inspector), from-destination on a multi-screen box,
  gizmo, MVR round trip.

## Finish (2026-10-17, second pass)

Done: templates (`three_walls` carved L|C|R, `imag_lr`, `tv_row`) with crops fitted to the role's real raster
(`_role_raster`: screen destination behind pgm/prv N, else texture size); Array…/Duplicate along the object's own
axis; default role = first PGM surface with a channel; from-destination for all three types; 2D plan shift-drag
rotate; keys (Delete, Ctrl+D, arrows 5/50 cm, Q/E 5/15°, F); 3D click-pick (ray vs object boxes) + selection box;
GLB picker holds only with loaded screens. `run-client.sh --check` (headless boot, fails on script errors) added to
CI after a parse error in `stage_2d_view.gd` passed the unit runner.

Verified on the box after the owner added a screen (PGM+PRV destination `dst_mvcvbk52_1` on DP-7 via the
device-view API → channels 1 PGM / 2 PRV / 3 operator shm): template through the menu path → 3 walls on pgm1,
crops 0-384 | 384-1536 | 1536-1920 × 576; real XTEST keys moved Side R +0.10 m and turned −20° → −15°
(persisted); real 3D click selected "Centre LED"; headless 179/0.
Bug found + fixed during verification: templates assumed a 2560×768 canvas — on a 1920×1080 PGM the right wall's
crop started past the picture edge.
