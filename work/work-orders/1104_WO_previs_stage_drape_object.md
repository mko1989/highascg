# WO-1104 — Previs: "Drape" (kotara) as a stage object type — procedural pleats, skirt under a screen, in MVR export and the games

**Area:** godot-client, mapping, web-client
**Status: IN PROGRESS**

Owner 16.11 (verbatim): "add kotara or rather drape as a usable addable obj"

Context: in the active project "90C PGRP Hilton Wawer" the lead hand-built a black pleated skirt under the LED wall (to hide
its legs) as an object of the project's MVR, layer "Kotara" (15.1 × 1.0 m, floor y 0.239 → 1.239, pleats 0.125 m deep at
x 12.555…12.680 in front of the wall face x 12.7, centred z 3.5, facing −X). Its pleat profile and fabric texture were
lifted from the venue's own curtain in the client's room model — content we may not redistribute — so the object type
must generate everything itself.

## Investigation

### Where stage objects live and flow (project.previs.stage.objects)

| Place | What it does with stage objects | Drape impact found |
|---|---|---|
| `godot/client/features/previs/stage_objects.gd:7,43-47` | `TYPES := ["led_wall","tv","projection"]`; `normalize` turns **any unknown type into `led_wall`** and always adds a `source` (role + crop) | a drape must be a known type or every client rewrites it into a 10×6 LED wall on the next autosave |
| `stage_builder.gd` `_build` / `_process` / `sync_holds` / `_apply_source` | builds meshes per type; **every** object's `source.role` is polled every 0.5 s and held as a VideoSurfaces surface | a drape has no picture — it must not hold or poll a surface |
| `stage_builder.gd` `pick` (≈ line 107) | a click picks the nearest object whose **world AABB** (global_transform × local AABB) the ray hits, before the MVR click (`move/select_rule.gd:31`) | a rotated object's world AABB is much larger than the object; a skirt right under a wall must not swallow clicks meant for the wall / the MVR "click an LED wall to map" flow (`mvr_screens.gd:16,66`) |
| `stage_builder.gd` `front_yaw` | Fit's yaw from all visible objects' facing | screens only (a drape says nothing about where the pictures face) |
| `stage_panel.gd` `_fill_add_menu` / `_on_add` / `FIELDS` / `_build_inspector` | menu ids 0-2 = `S.TYPES[id]`, 100+ destinations (`S.TYPES[(id-100) % 3]`), 200+ templates; inspector always shows Source + crop rows | add id 3 = drape keeps 0-2 and the destination maths; no Source rows for a drape |
| `tracking/aim_model.gd:33 audience` | "where is the audience": every visible stage object's facing, weighted by width | a 15 m skirt would weigh 3× a 5 m screen — **decision: only screens count** (a drape may hang sideways as a masking leg) |
| `view_presets.gd:30 stage_box` | frames the visible stage objects + grid | a drape is part of the stage people look at: it stays in the framed box (audience still from screens only) |
| `tracking/tracking_model.gd:136 candidate_points` / `object_corners` | calibration points: each object's picture corners | a drape's corners are real, visible marks — kept (size_m gives them) |
| `mvr_model.gd:257 drop_scene`, `mvr_screens.gd` | walls mapped from an MVR are `led_wall` objects tagged `mvr` | unaffected |
| `src/engine/project-client-slices.js:15` | `previs` is a CLIENT_OWNED slice, stored verbatim; there is **no server-side stage-object normaliser** (`rg previs src/` — only console-match shifts positions, pixel-map reads `led_wall` only) | nothing drops a drape on the server; a test pins it |
| `src/stage/mvr-export.js:150` | exports `led_wall/tv/projection` as `VideoScreen`s, everything else `skipped` | drapes were dropped from the .mvr |
| `modules/rc-game/server/rc-scene-geom.js:114 stageObjectBoxes` (bake for RC, Skirmish, Salad — `sk-kit.js`/`salad-kit.js` reuse `rc-scene.js`) | every visible object becomes a cabinet box + a picture face; **an unknown type falls through to w = h = 1** | a drape would have baked as a 1 × 1 m black box with a blue "picture" |
| `modules/rc-game/server/rc-video.js:38 SCREEN_TYPES` | the games' live pictures | already screens-only |
| `src/fixtures/pixel-map-propos*.js` | `led_wall` only | unaffected |

### Floor under a screen (for the skirt)

- Stage objects carry no floor. The tracking grid's `z_offset` is the stage deck (Hilton: 0.639, grid x 9.55…12.55) — the
  wall at x 12.7 stands **behind** the deck edge, on the lower level 0.239, so the grid is the wrong answer there.
- `mvr_scene.gd:282 pick` already ray-casts the visible MVR/venue meshes' triangles (`mvr_screen_model.gd:55
  ray_distance`, cached TriangleMesh per mesh). A ray straight down in front of the screen's face finds the visible floor
  under it (venue floor, carpet, deck) — used for the skirt, with the grid / 0 as the fallback without a scene.

### Hand-built reference (projects/_mvr/697914c17a24.mvr, `kotara.glb`)

4080 vertices / 4056 triangles, one textured double-sided material (mean colour sRGB 9,6,9 — near black), folds 0.125 m
deep, roughly 0.2-0.3 m fold to fold. Not reused (venue-derived); it is the visual bar the new object must meet.
