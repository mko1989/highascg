# WO-1101 — Game World step 1: one shared room — the three browser games see each other

**Area:** web-client, engine
**Status: DONE (16.11.26, box: 5-min soak + headless Firefox views of all three games; real phones not yet)**

Owner, 16.11.26: "can the game world be a shared space between games. so someone is throwing tomates while another is
driving thru the stage etc" — proposed two steps (1: seeing each other, this WO; 2: affecting each other, WO-1102); the
owner: "send agents for step 1 and 2".

Related: WO-1074 / WO-1076 / WO-1082 (RC cars, opt-in modules, bots), WO-1081 / WO-1083 (Stage Skirmish), WO-1089
(Stage Salad), WO-1090 / WO-1098 (the shared venue bake), WO-1099 (house lights level), WO-1102 (step 2).
Contract: [game-world-contract](../notes/game-world-contract.md).

## 1. Investigation

### What the three games already share
- **One bake.** `modules/toy-skirmish/server/sk-kit.js` and `modules/stage-salad/server/salad-kit.js` resolve the RC
  module as an INSTALLED sibling and reuse `rc-scene.js` `createSceneBaker` — same `rev`, same cached GLB under
  `~/.highascg/cache/rc-game/`, same Godot frame (metres, Y up, yaw 0 faces −Z). So a position from one game's room is
  already a position in the others' rooms: no transform is needed, only a common unit (room metres).
- **Client kit.** Skirmish and Salad import RC client files from `/game/sk/kit/…`, `/game/salad/kit/…` (world.js,
  stage-fx*.js, interp.js, join-code.js …). All three pages carry the same import map (`three` →
  `/vendor/three/build/three.module.js`, e.g. `modules/rc-game/client/index.html:20-24`), so a model module imported
  from ANOTHER game's path uses the page's three.js — the owning game's model code can be reused at run time without
  copying it.
- **Model code** (all take a scale or are life-size): `rc-game/client/car-model.js:83 createCarModel({ color, name, tag,
  tagScale, scale })`, `toy-skirmish/client/soldier-model.js:97 createSoldierModel({ … scale })`,
  `stage-salad/client/veg-models.js:116 vegMesh(THREE, id)`, `slingshot-model.js:38 createSlingshot(THREE, …)`,
  `avatar-model.js:87 createAvatarModel(THREE, { look, height, label, quality })`.

### Who knows which positions (the server must referee step 2, so this decides what the world can see)
- **RC** (`rc-room.js`): physics runs in each browser (and in `rc-room-bots.js` bots, which run the client's own
  `bot-brain.js` behind a virtual socket `conn.botSink`, `rc-room-bots.js:94`); the room keeps each player's last
  reported car `p.car = [x, y, z, yaw, v, st, fx]` (`rc-room.js:carState`, ≤ 20 Hz) and relays `w` at 15 Hz only while
  something moved (`worldTick`, `moved()`).
- **Skirmish** (`sk-room.js`): soldiers are client-simulated too; the room keeps `p.pos [x, z]` (metres — the sanitiser
  compares with the arena `rect` in metres and slacks in `u × X.u`, `sk-room.js:220-225`), `yaw`, `alive`,
  `protectUntil`, `held`; `w` at 20 Hz when changed. Hitscan fires are accepted by `sk-combat.js` from the server's
  positions — a server-side ray exists for step 2.
- **Salad** (`salad-room.js`, `salad-shots.js`): the ONLY server-authoritative motion. Flights are stepped from the
  room's 30 Hz tick with `flight.js` `stepFlight(f, venue, opts)`; `opts.hitTest` (the avatar) and `opts.extra` (more
  colliders — today the umbrellas) already exist (`stage-salad/client/flight.js:131-153`). So a car or soldier can be
  handed to a flight as an extra sphere collider and the existing bounce / splat code decides the contact.
  Avatars: `presenters.wire(t)` → `[tid, x, y, z, yaw, height, flags]`; slingshots: `venue.slots[p.slot]` + `p.aim`.

### Rooms are pure; services own sockets
Each game has a pure room (`createRcRoom` / `createSkRoom` / `createSaladRoom`: injected clock, timers, `send`) and a
service (`rc-game.js` / `sk-game.js` / `salad-game.js`) that owns the sockets, the token-bucket rate limit and
`parseMessage`. A world layer can be attached at the service (enable / disable) and read the rooms through small
accessors — the rooms need not change their wire.

### Boundaries that must hold
- `tools/smoke/smoke-wo1076-rc-game-module.test.js:101` — "the core names nothing of the game": src/ and index.js may
  not match `rc-game|game/rc|/api/game\b|…`. A shared world therefore cannot live in `src/`.
- Skirmish and Salad already REQUIRE the RC module installed (kit). The owner's brief: no game may depend on another
  for the world; the world must be optional ("games still run alone exactly as today").
- Disable/enable of a module drops its server files from `require.cache` (`sk-kit.js release()`); salad's shared ESM
  stay in Node's ESM cache until a restart (WO-1089 caveat). A require-path singleton between modules would split when
  a module is loaded from `~/.highascg/modules` vs the checkout, or re-required after a disable.

### Load on this box
`~/.highascg/modules.json`: rc-game, toy-skirmish, stage-salad enabled; no `~/.highascg/modules/` — all three load from
the repo checkout (`modules/<name>`). A new module `game-world` is opt-in (no entry → disabled) and must be enabled with
`POST /api/modules/enable {"name":"game-world"}`.

## 2. Design (decisions, see the contract for numbers)
- **Placement:** a NEW opt-in module `modules/game-world/` (not a game, not core). It and the games meet only in a
  process-global registry `globalThis[Symbol.for('highascg.game-world/1')]` (`{ v, games, hub }`): each game registers
  a descriptor at module load (its host/state functions, page paths, model URLs) and attaches a room adapter while its
  session runs; the world module publishes `hub` while loaded. Nobody requires anybody; the core is untouched.
  Rejected: a shared file in the RC kit (would make the world part of a game, and every game already depending on RC
  for the bake would then also depend on it for the world); `src/` (core would name the games); a require-path singleton
  (splits across install locations / reloads).
- **Wire:** `wst` (once / on change) + `wv` (add / e / gone / fx tuples, rounded to 1 mm, ≤ 32 updates and ≤ 2.5 KB per
  message), sanitiser `client/world-wire.js` shared by server and client. Interest management per viewer: other games
  only, weighted distance, radius per game, cap by the client's quality tier (6 / 12 / 20), near 10 Hz / far 3.3 Hz.
- **Visitors in each client** are drawn with the owning game's own model module, loaded by URL at run time.
- **World pages** in the world module: landing ("pick your game"), world host (start / stop all, presenter safe,
  QR codes, house lights), world spectator (one room camera, ticker).

## 3. What was done
- **Contract first** (`work/notes/game-world-contract.md`, commit 4ff9146a), then the module (c741c169):
  `modules/game-world/` — `server/world-hub.js` (attach / detach, 10 Hz tick ONLY while ≥ 2 rooms are attached or a
  world page is open, per-viewer interest + `wst` / `wv`, quality caps), `world-interest.js` (radius rc 8 m / sk 4 m
  (+ airborne ≤ 6 m) / salad 30 m, avatars always first, near every tick / far every 3rd), `world-ents.js`,
  `world-wire.js` (one sanitiser for server and client), `world-service.js` + `routes-world.js` + `world-ws.js` (host
  API: enable / disable / start / stop / pause-everything (`safe`) / bots / lights / wall / house / events, the world
  page socket), `client/visitors.js` + `props.js` + `visitor-fx.js` (visitors drawn with the owning game's own model
  module, loaded by URL: `car-model.js`, `soldier-model.js`, `veg-models.js`, `slingshot-model.js`, `avatar-model.js`),
  `client/world-*.js` (landing, host page with QR codes, spectator with a ticker).
- **Each game** (f0173429 RC, c2d4f773 Skirmish, 98642972 Salad): `server/*-world.js` = the descriptor + room adapter
  (accessor copied from `world-link.js`, never a require), a `pause` host action (snapshot `paused` only while paused,
  timers shifted on resume), `wq` accepted by the sanitiser, `client/world-join.js` (imports `/game/world/visitors.js`
  on the first `wst` only — a game alone never loads it; messages queued while it loads; PAUSED banner). Alone the
  games are byte-identical: the adapters return nothing when `reg.hub` is null (smokes pin it).
- **Box fixes** (4ed60537), each found only on the box:
  - the hub accepted only string / number viewer keys, but the games pass their `ws` objects → every viewer was
    dropped (first 5-min soak: 0 world bytes). Object keys now get a stable serial (WeakMap); hub smoke pins it.
  - `wst.scale` came from the first registered game; with Salad (life-size `scale: 1`) first, and Salad's client
    passing `scale: 1` itself, soldiers were drawn 10× (evidence 04). Now the scale of a game that brings a car /
    soldier model, and Salad's client takes `wst.scale`.
  - RC `area()` read track points as [x, z]; scene tracks are [x, y, z] → rain fell beside the track. Fixed + smoke.
  - The spectator camera sat 30 m out at the 7 m ceiling of the ballroom (a white frame, evidence 01): it now frames
    the stage edge from ≤ 14 m, 1 m under the ceiling, clamped inside the hall.
- Curated CI list: 11 `smoke-wo1101-*` + 2 `smoke-wo1102-*` files (`tools/ci/offline-test-files-3.js`); the three
  client-static smokes allow `/game/world/` imports (a documented extension, nothing loosened).
- **Contract deviations** (as built): world pages are always served (they show "no game running" until one is);
  bonuses are paid only for control-loss effects; rain / spotlight do nothing unless the tick runs (≥ 2 rooms);
  name tags blank at Low; the spectator has no live light beams; fade applies only to moving visitors; a splat's
  `until` = first seen + 8 s on the client.

## 4. What was verified
- **Tests:** 11 WO-1101 smoke files 115 / 115 (world: logic 18, client-static 11, visitors 6, hub 13, interest 9,
  service 10, static 7; games: rc 10 + 9, sk 12, salad 10) + the 3 game client-static smokes 27 / 27. Full offline
  suite 7086 tests: 7078 pass, 0 fail of mine (the 1 fail = check-wos stale INDEX from another session's untracked
  WO-1104, cleared when the index is rebuilt). Gates: script-paths, max-file-lines, unwired-exports,
  `index.js --no-http`, lint, format:check, npm-audit, licences all exit 0.
- **Box, 5-min soak** (node 7, all three games with bots rc 3 / sk 4 / salad 3, one scripted player per game + a
  world page socket, restarts every 30 s, RC on `stage-oval`): node CPU **11.0 %** of one core with the world vs
  **13.5 %** with the world module disabled (120 s, same games) — no measurable cost (noise between game phases).
  Per-client bytes/s (world + game): rc 2407 + 1872, sk 843 + 2338, salad 1897 + 2562; world page 5283. Alone:
  rc 665, sk 2182, salad 2201 game bytes/s, 0 world bytes. `wv` 9.9 / 5.2 / 9.9 per s; entities per `wv` mean 5.3 /
  2.7 / 4.2, max 24 / 14 / 18. Hub: 3191 ticks, 11186 messages, 0 errors.
- **Low vs High** (60 s, `wq` 6 vs 20 side by side): rc 1733 vs 2408 B/s (mean 3.8 vs 5.6 entities per `wv`),
  salad 847 vs 1397 B/s; Low throttles as designed.
- **Headless look** (private Xvfb :77, throwaway firefox-esr profiles, both TERMed; `work/notes/wo1101-evidence/`):
  02 / 03 the world spectator — stage, presenter avatar, car labels on the stage, slingshots in the hall, a cabbage /
  a carrot in flight, soldier labels, the board strip of all three games and the ticker "The presenter made way for
  Bot Nitro Nell's car"; 05 / 06 / 06b the Salad slingshot view — RC cars crossing the stage in front of the
  presenter, toy soldiers at toy size, red / green splats on the stage; 07 the RC spectator — soldiers on the far
  stage, the life-size presenter, splat patches on the oval; 08 the RC car cam — the presenter walks across the track
  in front of the car; 11 a toy soldier passing the car cam; 09 an RC car driving through the Skirmish arena; 10 a
  potato flying over the Skirmish arena (overhead view). Honest judgement: from the Salad and world views the toys
  are tiny (true 1:10 scale) and the name tags cover most of a car body; NOT captured: a vegetable close to a car in
  the car cam (40-frame burst at the start line, none in frame).
- NOT verified: real phones, owner play, more than one human per game.
