# WO-1090 — Game scenes keep the MVR meshes' own pictures; patched heads are their real GDTF models and follow the beams

**Area:** web-client, engine
**Status: DONE (16.11.26 — offline bakes of Hilton + Narvil (digests / tracks unchanged), 10 new smoke tests + 425 game smokes green, live re-bake (BAKE_VERSION 9) and headless-Firefox screenshots of RC, Skirmish and Stage Salad against the previs on :0; head models measured following the streamed beams 8/8)**

Owner, 16.11 (follow-up to WO-1082): *"in the game the textures for carpet and focus heads load generic look instead
of the one that is already in previs"*. Active show *90C PGRP Hilton Wawer* (MVR `1a25c72c40b8`, no venue .glb):
the room skins (Dywan, Ściany, Boazeria, Zasłony, Sufit, Żyrandole) are textured .glb files inside the MVR; the
front truss (Fronty) carries 8 × ADJ Focus Profile, patched from the MVR.

## 1. Investigation

**Root cause A — the bake threw the MVR meshes' materials away.** WO-1082 kept pictures only for the *venue .glb*
path (`modules/rc-game/server/rc-scene.js` used the textured writer only when `venue?.model`). Every MVR-archive
mesh went through `readTemplate` (`modules/rc-game/server/rc-scene-mesh.js`), which reads positions + the base colour
factor only: UVs, images, emissive and doubleSided were dropped. Hilton has no venue file, so its carpet, walls,
wood, curtains and ceiling were flat colours. Evidence (offline bake of the live project at HEAD before this WO):
GLB 216 384 B, 0 textures, no `TEXCOORD_0`. The archive files themselves carry JPEGs over world-metre UVs, REPEAT
(carpet UVs −3.81…3.75 × −6.93…8.62), emission on curtain (0.15) and ceiling (0.6), chandeliers `doubleSided`.

**Root cause B — the heads were the MVR's grey static parts, not the previs rig.** The bake drew a patched fixture
from the MVR (`gdtf:<file>:<member>` → `mvr-store.mesh` → `threeDsToGlb` *without* `fixtureBody`, so glb-write's
default grey 0.7) at the MVR pose and never moved it. The previs draws a patched head from the GDTF rig
(`gdtf-store.visual(typeId, mode).rig`, `GET /api/fixtures/types/<id>/model` = `threeDsToGlb(buf, { fixtureBody: true })`
→ black body) at `pose_xform(patch pose)` · node chain · `mesh_xf`, tinted by `fixture_colors[typeId]` else the MVR
layer colour (`godot/client/features/previs/fixtures/fixtures_3d.gd _build`, `fixtures_3d_model.gd`), hides the MVR
object it came from (`mvr_scene.gd set_patched`) and turns pan/tilt with the live values. On Narvil all 90 fixtures were
dropped by the budget (planBudget drops fixtures first), so no heads at all.

The chandeliers (Żyrandole) are in the project's `hidden_layers`; the previs does not draw them, so neither does the
game (checked: unhidden, they bake textured, doubleSided, emissive 0.7 — 571 kB GLB).

## 2. What was done

- `rc-scene-rich.js` (new): an MVR mesh file with a picture or glow is read with the venue reader (`parseVenue`:
  UVs, KHR_texture_transform, images) and flattened into one template whose prims carry their material key; mirrored
  node transforms swap the winding. The venue's rules apply: a material drawn on more than TEX_MAX_TRIS triangles
  (counting instances) gets its picture's mean colour; all pictures share the 1.5 MB texture budget (re-encode,
  size cap) with the mean-colour fallback when one is left out. A file without pictures keeps the flat path byte for byte.
- `rc-scene-venue.js`: material records also carry emissive (+ picture), doubleSided, roughness, metallic.
- `rc-scene-glb.js`: textured materials write doubleSided as authored, roughness/metallic, emissiveFactor/Texture;
  REPEAT samplers with trilinear mips; moving head parts get GLB nodes of their own (`extras { rcHead, rcAxis }`).
- `rc-scene-fixtures.js` (new): every enabled patched fixture whose type + mode has a rig is its rig's meshes, read as
  the model route reads them (3DS with the black fixture body, .glb unit-fixed), at `poseXf(pose)` · chain · mesh_xf,
  tinted like the previs; on a hidden MVR layer it is not drawn; the MVR object it was patched from is replaced. Pan
  and tilt (on the chain above the first beam) split the parts into `<id>|pan` / `<id>|tilt`; the scene JSON gains
  `heads` (axes at rest + rest beam direction), `rig` (counts) and `materials` (texture bytes) — additive fields.
- `rc-scene-mesh.js`: `planFixtures` — heads are planned *after* the room in what it left: each fixture at the finest
  cell (2 mm…8 cm clustering) under min(FIX_MAX_TRIS = 1500, fair share), cheapest first (a 12-triangle LED bar leaves
  its share to the moving heads); vertex compaction after clustering (Narvil heads were 121 B/triangle before).
- `rc-scene.js`: BAKE_VERSION 9; the patch, fixture colours and the type files' stat are part of the revision.
  Obstacles, the occupancy grid and the height field never depend on how heads are drawn: a rig head is drawn only
  (`ghost`); an MVR fixture part (no rig found) is solid only when the pre-WO bake kept it too (everything fitting
  unsimplified). This keeps Narvil's and Hilton's occ / tracks identical.
- Client (`modules/rc-game/client`, shared by Skirmish and Stage Salad through their kit routes): `head-follow.js`
  (new) solves pan/tilt analytically so the head's beam meets the direction `stage-fx.js` draws for that light
  (pan outer, the tilt solution nearest the previous one) and sets the two node matrices; `world.js` keeps the
  emissive picture on "low" quality and turns on anisotropic filtering (8×) for the tiled pictures.

## 3. Verified

**Offline bakes of the live projects** (scale 0.1, `tools/smoke/lib/rc-live-scene`, HEAD baker vs new):

| show | GLB before → after | textures | heads (drawn / moving) | head triangles | occ / tracks |
|---|---|---|---|---|---|
| Hilton (MVR only) | 216 384 → 486 656 B | 0 → 5 (241 289 B; carpet 301 kB → 193 kB 1024 px) | 8 / 8 / 8, 1086 each | 8 688 | digest 3fa52fcbd1aa unchanged; 11 tracks; hall 0.241, stage 0.639 |
| Narvil (no venue) | 7 229 492 → 7 517 880 B | 0 | 90 → 78 drawn, 36 moving (were all dropped) | 17 638 | digest fbe3f9e7edb2 unchanged (occ 1117e8f8, tracks ff94781f, heights a4be0574) |
| Narvil (venue .glb) | 8 954 372 → 9 151 544 B | 18 (1 451 514 B) | 78 / 36 | 14 068 | digest 0afef1cfc106 unchanged |

Narvil with its venue is 9.15 MB, ~0.15 MB over the ≈ 9 MB contract (7.5 MB geometry + 1.5 MB pictures); the excess
is the heads' share of the geometry budget. Hilton's height field differs from before (its 8 static grey MVR heads stood
in it; rig heads do not) — tracks and occupancy are identical.

**Smokes:** `smoke-wo1090-rc-mvr-materials` (4: synthetic MVR textured GLB, tiling UVs ±3.75 × ±7.75, REPEAT, emissive
+ its picture, doubleSided, flat mesh stays flat, over-budget → mean colour without UVs) and `smoke-wo1090-rc-rig-heads`
(6: rig replaces the MVR object, 4 608-triangle head decimated under FIX_MAX_TRIS, type tint, pan/tilt nodes + axes,
a low head is no obstacle, budget water-filling, `solveHead` round trip) — in the curated list. All RC / Skirmish /
Stage Salad smokes (wo1074/1076/1081/1082/1083/1089/1090): 425/425 green after the fixes (`smoke-wo1074-rc-server-http`
allow-list extended for the read-only GDTF / pose / 3DS readers).

**Live (box):** node restarted, RC re-baked `1a25c72c40b8-d4f2bff6b6` (rig 8/8/8, 5 textures 241 289 B, 11 tracks).
Headless Firefox on a private Xvfb `:87` (throwaway profile), screenshots in
`/tmp/claude-1000/-home-casparcg/b8ff075d-eabe-4bed-9570-f2b4603d84a3/scratchpad/`:
- previs reference on :0 (read-only grab, tracking Camera view at X −5.62 Y −3.5 Z 5.7, pitch −16.9, yaw 90):
  `previs-a.png`; the same pose in the games: `rc-match.png`, `sk-match.png`, `salad-match.png` — carpet pattern,
  white pleated curtains, wood pilasters and the black Focus Profile heads (yoke + head) on the front truss match;
- `rc-heads.png`, `rc-heads-side.png` (heads close up and along the truss, coffered ceiling with its blue glow),
  `rc-carpet.png`, `rc-ceiling.png`, `rc-hall-back.png`, `rc-boazeria.png`, `salad-default.png`, `sk-default.png`;
- heads follow the beams: in the page all 8 heads bound, each tilt node's turned rest direction equals the streamed
  beam direction (e.g. head 1 (0.729, −0.387, 0.565) vs `lx` (0.729, −0.387, 0.565)); live texture state 5 maps,
  LinearMipmapLinear, REPEAT, anisotropy 8.

**Not verified / open:**
- Skirmish cuts the room above its arena by design (`toy-skirmish/client/sk-world.js` CUT_H), so its spectators see
  the carpet and the curtains' lower part but not the truss heads (beams still drawn) — that module was out of scope.
- The game is lit ~1.35× brighter than the previs (same hue; carpet mean 191/163/146 vs 135/113/99) — the games' own
  lighting, unchanged.
- Chandeliers only offline (the layer is hidden in the show); real phones; a 3DS-bodied type other than ADJ Focus Profile.
