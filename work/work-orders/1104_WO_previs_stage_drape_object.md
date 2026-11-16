# WO-1104 — Previs: "Drape" (kotara) as a stage object type — procedural pleats, skirt under a screen, in MVR export and the games

**Area:** godot-client, mapping, web-client
**Status: DONE (16.11.26 — Godot 29337 / 0, smoke-wo1104 5 / 5; on glass on Hilton Wawer: Add ▾ Drape / edits / drag / Duplicate / Delete / Skirt under; before-after shots at house 100 / 35 %; RC / Skirmish / Salad bake the drape and a car stops at it)**

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

### Floor finding, found on glass

The first skirt landed at y 0.319, not 0.239: the wall's legs (`nogi.glb`, layer "Dioda", x 12.6…13.2) have an 8 cm
base rail 0.239…0.319 along the whole wall, drawn without an underside — a ray straight down in front of the face meets
its top first. A skirt hides exactly such things, so "first face down" is the wrong floor.

## What was done

**Object type `drape`** (`stage_objects.gd`): `{id, type:"drape", name, size_m:[w,h], color:"#rrggbb", fullness (%),
pleat_m, position, rotation, visible}`; defaults 6 × 4 m, `#151515`, 60 %, 0.25 m; normalise clamps size 0.1…100 m,
fullness 0…200 %, pleat 0.08…2 m, a bad colour → default; a drape never gets (and loses) a `source`. `is_screen()` =
led_wall / tv / projection. Colour presets Black / Dark grey / White / Navy / Burgundy + a picker (`drape_ui.gd`).

**Geometry** (`drape_geometry.gd`, JS twin `src/stage/drape-geometry.js`, same numbers pinned in both test suites):
2n+1 fold nodes across the width (n = width / pleat), widths ±15 % and depths 70–100 % from an FNV-1a seed of the id
(stable across loads and machines, different per duplicate), half-cosine between nodes, the amplitude solved by bisection
so the cloth length = width × (1 + fullness); fullness < 0.5 % = flat molton. Rows of the mesh taper the folds slightly
towards the hem (1 / 0.95 / 0.88). Samples per fold by render quality Low 3 / Medium 4 / High 6 / Ultra 8 (rebuilt on a
quality change), at most 4000 columns. COLOR.r carries how far forward each column is.

**Material** (`drape.gdshader`): spatial, `cull_disabled` (double-sided, back faces use the inverted fold term),
Burley diffuse, roughness 0.9, specular 0.2, fold ambient occlusion 0.75 from COLOR.r (smoothstep, 0.4 under lights),
a velvet RIM sheen, faint vertical grain noise in metres. Not emissive: house lights dim it with the room (ambient + sun),
the rig's SpotLights light it. No textures, nothing from the venue.

**Panel** (`stage_panel.gd`): Add ▾ → "Drape" (at the orbit point, on the floor under it, facing the camera, yaw snapped to
5°), and with a screen selected "Skirt under <name>" (`skirt_under`: width = the face's span + 2 × 5 cm, from the floor up
to the screen's bottom edge, 2 cm in front of its most forward edge plus the folds' back depth, fullness 50 % / pleat
0.2 m ≈ 10 cm deep, black, named "<screen> skirt"; a screen on the floor says there is no room). Template "LED wall
5 × 3 m + black skirt to the floor". Inspector: Width, Height, Fullness %, Pleat spacing m, Colour, the info line
"W × H m · N pleats, X mm deep · Y m of cloth"; no Source rows. Position card / drag / nudge / Duplicate / Array… /
Delete / visibility / WO-1100 deselect are the shared code paths. Delete now also clears the 3D selection box (it stayed
behind for every type — found on glass).

**Floor** (`mvr_scene.floor_below` + `drape_ui.floor_from_hits`): 5 rays down along the skirt line collect every face they
meet; a thin piece (≤ 12 cm between its top and its bottom face, or its mesh's bottom when it has no underside: a brace, a
base rail, a carpet) is passed through, the first thick top face is the floor, else the lowest thin bottom; median of
the rays; fallback the tracking grid's deck when the point is over it, else 0.

**Not a screen**: `aim_model.audience` (and so View presets, tracking camera aim) uses screens only; Fit's `front_yaw`
screens only; a drape holds no VideoSurfaces surface and is skipped by `_apply_source`/`sync_holds`/the source poll;
`view_presets.stage_box` still frames drapes (they are stage people see). The MVR click-to-map works on MVR objects; a
stage drape is picked as a stage object first (select, not map). Picking now tests each mesh's box in its own frame, so
a skirt under a wall never takes the wall's / the MVR map's clicks.

**Server**: `previs` is a client-owned slice stored verbatim — nothing to change, a smoke pins it. `mvr-export.js`:
drapes → `SceneObject`s on a "Drapes" layer, a GLB of their pleats (normals, material `drape`, double-sided, linear
colour); report gains `drapes`; re-imports as scenery (`kind: SceneObject`, no `screen`). Games: `rc-scene-drape.js`
draws each visible drape's pleats at Low sampling in its colour (black lifted to 0.012 linear), placed by the shared
`objectXf`; `stageObjectBoxes` skips drapes (they baked as 1 × 1 m boxes); `BAKE_VERSION` 10. Its triangles cross the
car band, so the occupancy / obstacle grids block it in RC, Skirmish and Salad.

**Hilton Wawer**: snapshot `~/.highascg/wo1104/hilton-before.json` (file) + `hilton-before-api.json` (GET /api/project);
in the GUI: layer "Kotara" hidden (eye in MVR scene → Layers), then wall selected → Add ▾ → "Skirt under Dioda P3 15 x 3 m"
→ `drape_1` 15.1 × 1.0 m, `#151515`, 50 % / 0.2 m, position [12.63, 0.239, 3.5], rotation [0, −90, 0]. The MVR file is
untouched. Revert: delete the skirt and show "Kotara" again in the GUI, or copy the snapshot back over
`projects/90c_pgrp_hilton_wawer.json` and reload the project.

## What was VERIFIED

- **Godot**: `tests/test_stage_drape_wo1104.gd` 15 tests (76 asserts in `HIGHASCG_TEST_ONLY=test_stage_drape`): defaults /
  normalise, twin numbers, pleats / profile / cloth length, mesh bounds and triangle budget per tier, seeded stability,
  skirt at the origin and under the Hilton wall (back 12.68, front > 12.555 — behind the deck edge 12.55), TV + floor median,
  duplicate / array / template, audience + view presets, builder draws a drape without a surface, pick in the object
  frame, Delete clears the box, floor through legs / rail / carpet but not a deck. Full suite **29337 passed, 0 failed**
  (the run exits 134 on quit — glibc "corrupted size" — also on a clean HEAD export: not this WO, see WO-676).
- **Node**: `tools/smoke/smoke-wo1104-drape.test.js` 5 / 5 (twin numbers; a web save without previs keeps the drape; MVR
  export → re-import as a SceneObject on "Drapes", matrix round trip < 1e-4, mesh served; bake parts = pleats not a box,
  placed like the previs; bake: exactly the drape's triangles added, an obstacle where it stands, the toy occupancy
  blocked at 5 points across, free floor 2 m in front / behind). `smoke-wo612-mvr-export` (report gains `drapes: 0`),
  `smoke-wo1074-rc-server-scene`, `smoke-wo614-project-client-slices`, `smoke-wo1074-rc-server-http` (boundary list gains
  `src/stage/drape-geometry` for rc-scene-drape.js) pass.
- **On glass** (the one GUI, relaunched under `flock -o /tmp/highascg-gui.lock`, Caspar steady): Add ▾ → Drape landed on
  the deck at the orbit point (11.13, 0.647, 3.5) facing the camera; Width 8 / Height 3 / Fullness 100 / Burgundy typed and
  clicked → "8.00 × 3.00 m · 32 pleats, 204 mm deep · 14.1 m of cloth", saved to the project; drag moved it 3.4 m, arrows
  nudged 5 cm; Duplicate placed "Drape 2" beside it with its own folds (206 mm); Delete removed both (box gone after
  the fix). Skirt under the wall: first 0.92 m tall on the legs' rail → fixed → 15.1 × 1.0 m on 0.239.
  `work/notes/wo1104-evidence/gui_*.jpg`.
- **Before / after** (`--probe-drape`, same three cameras, Ultra, house 100 / 35 %; `ab_*.jpg`, left = hand-built
  "Kotara", right = the drape): pleats readable at stage distance, black (the new cloth is darker: band mean 7 vs 12
  sRGB; fold contrast std/mean 0.60 vs 0.51), the legs hidden, no z-fighting with the wall bottom or the deck edge at
  x 12.55 (edge camera). A follow beam on a test person lights the skirt (`ab_close_100.jpg`). Judgement: as good at
  stage distance; up close the hand-built folds have crisper edges (its texture), ours are softer, more like molton.
- **Games** (private Xvfb :118 + throwaway firefox-esr profile, both TERMed; each game enabled → checked → disabled, a
  temporary 6 × 4 m test drape on the deck, deleted after): bake rev `697914c17a24-bd61f80190`, 263 897 triangles; the
  stage occupancy grid blocked on 23 / 23 rows along the drape (RC, Skirmish); in the RC page the game's own physics
  (`moveHorizontal` + `collideObstacles`) drove a car at it from the audience side at z 1.5 / 3.5 / 5.5 — stopped at
  x 11.02–11.05 (fold fronts 10.98, back 11.28), never through. Drawn and shaded in RC and Salad (`game_rc.jpg`,
  `game_salad.jpg`), the Skirmish top view shows its pleat line on the deck (`game_sk.jpg`).

**Not verified**: Salad's scene carries no occupancy grid (vegetables fly), so "an obstacle" there is the drawn mesh
only; the car test drove the physics functions in the page, not a player with a phone; Array… on a drape on glass (the
shared dialog; tests only); the template on glass; the MVR export opened in another tool (our importer only); a drape
under a curved wall (face span = chord).
