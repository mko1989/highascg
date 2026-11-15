# WO-1082 — Games draw the real venue models (the venue .glb, textures, the carpet)

**Area:** web-client, engine
**Status: DONE (15.11.26 — on the box: venue .glb + carpet in both games (screenshots); 3 cm occupancy band; 5- and 6-bot races run live to results; banner screenshot; 213 RC smokes + offline 9-bot runs on all 11 live tracks)**

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

## Part 2 — RC expansion and the WO-1083 findings

### Investigation

- Open / deferred items read from `modules/rc-game/README.md`, `work/notes/rc-game-contract.md`,
  `work/notes/rc-game-live-wiring.md` and WO-1074: **no bots** (a lone player races nobody; the contract's
  "free-roam / race only"), the gantry always said "STAGE SPRINT", the join address showed twice (status line + phase
  line, `loop.js updateBoard` → `setStatus(phaseLabel(G))`), a lap toast stayed visible under the results card, the LED
  wall picture had no mipmaps (speckles far away). Still open from WO-1074 and NOT done here: the free-roam hint over the
  gantry, cameras through tall objects, the lit rig, peer walls.
- **Finding 2 of the WO-1083 agent (flat decor = wall):** the baked `occ` band started 5 mm over the floor
  (`rc-scene.js`: `lo: 0.05 * scale`). The FLAT_DECOR rule already skipped triangles whose top is ≤ 3 cm, but a
  triangle that is part of something taller and dips into the 5 mm … 3 cm range (a wall foot, a skirting, a sloped
  plate's low end) still blocked down there. The carpet itself added no occupancy (Part 1 count) — so the RC game was
  not blocked by it, but the band and the drive rule (a step ≤ 0.3 u is driven over) disagreed.
- **Finding 1 of the WO-1083 agent (black slab over the `stage` arena):** it is not baked geometry. A scan of the
  baked GLB over the stage arena (x −7.31 … −1.31, z −9.14 … −1.16) finds only the grey stage deck (y 1.42) and light
  grey truss (12 m²) — nothing large and dark. The slab is the LED wall picture quad `led_wall_2` (role `pgm1`,
  centre [−4.5, 3.5, −5], 5 × 4 m, vertical, facing +z) from the kit's stage-fx (`rc-video.js` + client
  `stage-fx-wall.js`). It is added to the scene root, not to `world.statics`, so the skirmish cut-away plane does not
  apply (`modules/toy-skirmish/client/sk-world.js:3-6` deliberately leaves "LED wall pictures" uncut). It is black
  because programme 1 is black (quads stay hidden until their first frame). The WO-1083 evidence in
  `work/notes/wo1083-evidence/spotlight-banquet-spectator.jpg` is the banquet arena; the dark expanse there is the
  patterned carpet texture (the real venue material, "Dywan 2").

### What was done

- **Occupancy band** (`rc-scene.js`, commit 1605062a): `createOcc(f, { cell: 0.3 * scale, lo: FLAT_DECOR * scale,
  hi: 0.6 * scale })` — the band starts at the flat-decor height (3 cm live), matching the ground rule; BAKE_VERSION 6
  (new rev). Shape of the scene JSON unchanged for `sk-scene.js`.
- **Race bots** (commit db89befb): `client/bot-brain.js` (new, pure ESM) drives a car with the client's own
  `physics.js`, `item-play.js`, `standings.js`, `items.js`, `protocol.js` — steer to a look-ahead point on the centre
  line plus a lane, corner speeds × skill, a launch press in the start window, item use after 0.8–3.3 s (shield 0.3 s),
  back to the last checkpoint when stuck 2.5 s or off the ribbon 4 s. `server/rc-room-bots.js` (new): each bot is a
  virtual socket (`conn.botSink`) that joins the room like a browser and sends the same `s` / `box` / `use` / `hit`
  messages through `room.handle` — the referee, the 20 Hz cap, the lap minimum and the item rules treat it like anyone.
  One 30 Hz timer (2 × 1/60 s steps per bot) runs only while bots exist. The room flags `bot` from the conn only (a
  socket cannot claim it). Host action `bots { count 0–9, level easy | normal | hard }` (`rc-game.js`: 400 outside the
  range, 409 unless lobby / results); host panel − / + and a level select; the list shows "bot". Why server-side:
  bots must race when nobody else is connected, and the same code as the browser keeps them honest.
- **WO-1074 polish** (commit 88cb442f): `track-deco.js bannerText` — the gantry shows the track name (capitals, ≤ 18
  characters cut at a word, smaller font over 12; empty → STAGE SPRINT); `loop.js` — the join line once; `hud.js` —
  the lap toast is cleared under the results card; `stage-fx-wall.js` — mipmaps on the LED wall picture.
- Finding 1: **nothing changed in the bake** — the slab is the skirmish's own uncut screen. Recommended fix for the
  skirmish owner (WO-1083 area, not edited here): hide or clip stage-fx screens that stand inside the active arena's
  footprint (or put them under the clipping plane like `world.statics`), or skip arenas that cross a screen.

### What was VERIFIED to work

- Offline: `smoke-wo1082-rc-bots.test.js` (5 tests: flagged bots race and the room referees 2 laps; a bot-only race
  ends in results; item boxes claimed and items used; room size 10 holds, no fake bot flag, bounds; host-action source
  guards) + `smoke-wo1082-rc-venue-glb.test.js` (7 tests, now with a sloped plate: free below 3 cm, blocked above;
  mutation back to the 5 mm band fails it; and the polish test). All RC smokes (wo1074 + wo1082): **213 tests, 0 fail**.
  Lint, prettier, file lines clean.
- Offline on the live scene JSON: occupancy hall 60 055 → 59 090 blocked cells, stage 2003 → 1995, **0 newly
  blocked**; the same 11 tracks (hall-tunnel 20.5 → 20.7 m). **9 bots finish all 11 tracks**, close spreads
  (hall-tunnel 19.2–23.1 s), ≈ 2–4 ms CPU per simulated second for 9 bots.
- **On the box** (node restarted under the lock): 5-bot race on hall-tunnel, spectator screenshot looked at — bots in
  the tunnel, leaderboard on lap 2/2. Validation live: count 99 → 400, bots mid-race → 409. 6-bot `hard` race on
  hall-weave, 2 laps, watched over a WebSocket spectator: results 49.9–53.9 s, best laps 24.4–26.1 s; 29 box claims,
  16 item effects, 12 hazards, 11 spins. Whole node process 40.2 % of a core over the race (a noisy baseline with other
  agents' work running was 51.9 %) — the bots' own cost is small, as offline.
- Gantry screenshot (`work/notes/wo1082-evidence/rc-gantry-banner.png`, dev camera): banner reads "UNDER THE TABLES",
  the join line shows once, six bots on the grid with their own leaderboard.
- Left as found: RC disabled (bots 0), Skirmish disabled; test Xvfb / Firefox stopped.
- NOT verified: phone / real-GPU frame rate of the ≈ 9 MB scene; event-loop stalls during the bake; the mipmapped
  wall picture by eye (programme black during the test).
- Seen, not mine: `smoke-wo1081-sk-server-bots` fails ("bot 5 walked 13 u") with and without the band change; it
  passed before 489851a1 (WO-1083 Spotlight) — for the skirmish owner.
