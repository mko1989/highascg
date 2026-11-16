# WO-1101 — Game World step 1: one shared room — the three browser games see each other

**Area:** web-client, engine
**Status: IN PROGRESS**

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
(in progress)

## 4. What was verified
(in progress)
