# WO-1082 — Games draw the real venue models (the venue .glb, textures, the carpet)

**Area:** web-client, engine
**Status: IN PROGRESS (15.11.26 — Part 1 verified on the box: baked scene carries the venue .glb meshes + textures, carpet seen in both games' screenshots; Part 2 RC expansion follows)**

Owner, 15.11: *"the 3d models in game seem to be not the additional glb models but some generic ones. for instance the
carpet is not in the games etc."*

Both games (RC, WO-1074; Stage Skirmish, WO-1081) use one scene baker, `modules/rc-game/server/rc-scene*.js`; the
skirmish loads it through `modules/toy-skirmish/server/sk-kit.js` and serves the same GLB.

## Investigation

- The previs draws the room from the MVR **merged with the project's Capture venue export** (`project.previs.mvr.venue_glb`,
  WO-1003, `godot/client/features/previs/mvr_venue.gd`): objects matched by Capture uuid swap their MVR geometry for the
  .glb meshes; .glb-only meshes are extras on their Capture layer; materials and textures come from the .glb.
- The baker never read that file. Before this WO (`git show 03f3026b:modules/rc-game/server/rc-scene.js`):
  - line 67 `const parts = rec?.scene ? G.visibleParts(rec.scene, inp.cfg) : []` — MVR parts only;
  - line 133 `venueGlb: inp.cfg.venue_glb ? 'ignored' : null` — the bake even reported that it skipped the venue.
  - `rc-scene-mesh.js sceneGlb` wrote positions + one `baseColorFactor` per colour: no UVs and no images.
  So the game showed the MVR's own generic geometry in flat layer colours — "some generic ones".
- Client side, a second gap: `modules/rc-game/client/world.js cheapMaterials` copied every glTF material into a Lambert
  material **without `map`**, so a textured GLB would also have shown plain colours.
- Live project ("Narvil IDE 11.2026") venue .glb: 3301 objects match the MVR by uuid; 852 meshes exist only in the .glb
  (layers Klimat ledowy 561, Krata na dole 199, Reżyserka 2 37, no layer 53, Parkiet 1, Dioda 8 x 4 1); 853 of its
  meshes are LINES primitives (mode 1); 18 distinct images (multi-MB PNG/JPEG); the carpet is material "Dywan 2"
  (textured). The tablecloth "Obrus" alone is 75 k textured triangles with per-face UVs (cannot be welded) — kept
  textured it cost 4.9 MB and pushed the budget planner to a 5 cm cell (208 k triangles, everything blobby).
- Flat things: the carpet top is y 0.8238, the dance floor (hall floor) 0.839. In the toy band (floor … +0.06 m) a
  rug or floor tile would mark occupancy and become a wall for a 3 cm-high car.

## What was done

- **Venue merge in the baker** — `modules/rc-game/server/rc-scene-venue.js` (new): `parseVenue` (nodes with Capture
  uuid / layer / world matrix chain, materials with colour, image, UV set and `KHR_texture_transform`, templates per
  mesh) and `venueParts` (the WO-1003 rules: swap by uuid, fixtures and bound screens keep their MVR parts, extras on
  their layer, hidden layers / objects stay hidden, no layer tint). `flattenHeavyTextures`: a textured material over
  8000 triangles is drawn in its picture's mean colour (Obrus, `<LightGray>1`, one unnamed). `venueLines`: the line
  work welded into one LINES primitive.
- **Textures** — `rc-scene-tex.js` (new): images re-encoded by **ffmpeg in a child process** (the event loop never
  decodes a 4032 px PNG), JPEG unless the PNG has alpha, ≤ 1024 px, the largest halved until the sum is ≤ 1.5 MB,
  identical images once. Mean colour by ffmpeg `scale=1:1:flags=area`.
- **GLB writer** — `rc-scene-glb.js` (new): one node / mesh `rc-scene`, textured primitives with TEXCOORD_0 and named
  materials (REPEAT sampler, mipmaps), LINES as mode 1. `rc-scene-mesh.js`: clustering / instancing carry UVs and
  material; byte cost counts UVs.
- **Baker** `rc-scene.js`: reads the venue file through `src/media/project-files` (`setSceneCtx` from `rc-game.js` /
  `register.js`), `dropped.venueGlb` = `used` | `missing` | `unreadable` (anything short of a parsed file falls back to
  the plain MVR bake), new `venue` stats block, BAKE_VERSION 5; the venue file name + size + mtime and the texture
  budget are in `rev`, so a new export re-bakes.
- **Flat decor never blocks:** a triangle whose top is ≤ `FLAT_DECOR` (0.3) × scale (3 cm live) above a floor does not
  mark occupancy (`rc-scene.js onTri`). Carpets, rugs, floor graphics are driven over; a 10 cm step still blocks.
  No z-fight: the carpet sits 15 mm under the dance-floor top and the game draws the .glb's own surfaces as they are.
- **Client** `world.js`: the cheap Lambert copy keeps `map` (and `flatShading`). `dev-hook.js` (new, `?dev=1` on
  127.0.0.1 only): a fixed camera for verification screenshots.
- Shape of the scene JSON unchanged for `sk-scene.js` (floors, occ, heights, glb, gz, rev, scale); `venue` is additive.
  **No file under `modules/toy-skirmish/` was edited** — the skirmish gets the real room through the shared baker.
- Contract `work/notes/rc-game-contract.md`: budget (≤ 400 k triangles, 7.5 MB geometry + 1.5 MB textures ≈ 9 MB,
  ≈ 4.6 MB gzipped — was "≤ 8 MB, no textures"), the venue rules, the flat-decor rule.
- Why not ship the venue .glb as-is: 3392 objects, multi-MB images and unwelded 75 k-triangle cloths do not fit a
  phone; and the game needs the merged result (occupancy, floors) anyway.

## What was VERIFIED to work

- Offline: `tools/smoke/smoke-wo1082-rc-venue-glb.test.js` (6 tests, synthetic Capture-like GLB: textured carpet,
  wood floor slab, fixture, table in a group on a layer, hidden layer, LINES; rug 2 cm + step 10 cm): swap / extras /
  hidden, textures + UVs + REPEAT in the output GLB, lines, carpet and rug not obstacles, step and table blocked,
  missing / unreadable fallback, rev follows the venue file, budget halving, real ffmpeg encode + mean colour.
  Mutation check: `FLAT_DECOR = 0` makes the rug assertion fail. RC + skirmish smokes (wo1074, wo1081, wo1083, wo1082):
  303 tests, 0 fail. Lint, file lines, unwired exports clean.
- Offline bake of the live project: venue `used`, 3301 swapped, 852 extras, 18 textures 1.45 MB, 385 618 triangles at a
  2 cm cell, GLB 8 954 372 B (4.57 MB gzipped) — was 382 001 / 7 229 492 B / 3.0 MB. Floors unchanged (hall 0.839,
  stage 1.42); the same 11 track ids. Hall occupancy with the venue but without the flat rule = the MVR bake's
  (61 291 cells): the carpet adds no obstacle. With the flat rule: hall 60 055, stage 2003 (was 4392 — flat stage
  decks no longer block).
- **On the box** (node restarted under the restart lock): rev `405f970d98a2-d841e6d4a2` → `405f970d98a2-cdfc245934`,
  `dropped.venueGlb "used"`, `meshesFailed 0`, bake 27 s. GLB: node `rc-scene`, 57 primitives, 18 JPEG images;
  materials include `Dywan 2` (carpet, 204 triangles, textured), `Drewno_Podloga` (210), `Truss` (710), and a LINES
  primitive with 1510 segments. `/api/game/sk/scene`: same rev, its own glb URL, `venue.swapped 3301`, 8 arenas, same
  8 954 372 B GLB.
- Screenshots looked at (Firefox ESR on Xvfb, WebGL): RC spectator — textured parquet dance floor and riser labels;
  RC fixed camera over the hall (`work/notes/wo1082-evidence/rc-carpet.png`) — the patterned carpet, tables and chairs,
  textured truss, lattice wall, stage; Stage Skirmish spectator (`work/notes/wo1082-evidence/sk-spec.png`) — the same
  patterned carpet and lattice wall around the arenas.
- NOT verified: event-loop stalls during the 27 s bake (encodes are in a child process, geometry yields with
  `setImmediate`, but not measured); frame rate of the ≈ 9 MB textured scene on a phone or real GPU.
