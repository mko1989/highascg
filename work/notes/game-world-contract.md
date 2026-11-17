# Game World — the three games share one room (WO-1101 seeing, WO-1102 affecting)

Owner, 16.11.26: "can the game world be a shared space between games. so someone is throwing tomates while another is
driving thru the stage etc" → step 1 (the games see each other), step 2 (the games affect each other): "send agents for
step 1 and 2".

Read first: `rc-game-contract.md` (frames, the bake, §2.6 live lights, §3 toy scale), `skirmish-game-contract.md` §0–§1,
§3, §5, §7, `stage-salad-contract.md` §0–§9. Their hard rules hold here: nothing on a screen by itself, opt-in, holds
nothing while off, plain ES modules / three.js from `/vendor/three/`, no CDN / fonts / asset or audio files, user text
only through `textContent`, 500 lines per file, CommonJS `'use strict'` / tabs / no semicolons on the server, original
content only (no names, characters, art or level designs of existing games).

**Every cross-game length is in ROOM METRES in the Godot frame** (Y up, yaw 0 faces −Z). Scales stay as they are: cars
and soldiers are toys (scene `scale` s = 0.1: a car ≈ 6 × 3.5 cm, a soldier 5.5 cm tall), vegetables, slingshots and
the presenter's avatar are life-size. A cabbage bigger than a car is part of the fun.

## 0. Where it lives (and why)

| Piece | Where | Knows |
|---|---|---|
| Game World service | NEW opt-in module `modules/game-world/` (name `game-world`, title "Game World"), `server/world-*.js` | entity KINDS (`car`, `soldier`, …), never a game module's files |
| Registry ("the link") | a process-global object `globalThis[Symbol.for('highascg.game-world/1')]` = `{ v: 1, games: Map, hub: null }`, created lazily by whoever comes first (`server/world-link.js` in the world module; each game has its own 15-line copy `*-world-link.js` — a copy, not a require) | nothing |
| Game adapters | each game's own server file (`rc-world.js`, `sk-world-link.js` + `sk-world.js`, `salad-world.js`): what the game publishes, how it applies an effect | its own game only |
| Visitors (client) | `modules/game-world/client/visitors.js` + `props.js` (+ helpers): draws foreign entities with their OWN game's model code, loaded by URL | kinds + model URLs handed over by the server |
| World pages | `modules/game-world/client/` — landing "pick your game", `?host=1` world host, `?spectate=1` world spectator | the registry's game list |

Why: (1) **no game requires another game** — the three games never `require` the world module or each other for this
(the RC kit stays exactly what it was), the world module never `require`s a game; they meet only in the process-global
registry, whose key is versioned. A `Symbol.for` key is one per process even when a module is loaded from two places
(repo checkout vs `~/.highascg/modules`) or re-required after a disable — a require-path singleton would split there.
(2) **The core names no game** — and no world either: nothing in `src/` changes; the world is an ordinary opt-in
module (`/api/game/world/*`, `/game/world/*`). (3) **Alone = unchanged**: a game whose registry has no `hub` (world
module off / not installed) does exactly what it did — no timer, no field, no byte; with the hub but no foreign
entities, no `wv` / `wst` is ever sent either.

### 0.1 Registry contract (version 1)

```js
const KEY = Symbol.for('highascg.game-world/1')
const reg = (globalThis[KEY] ||= { v: 1, games: new Map(), hub: null })
```
- A game module registers ONE descriptor at load (register.js) and deletes it in `onShutdown`:
  `reg.games.set('rc', desc)`; ids are `rc`, `sk`, `salad` (short codes the games already use in their URLs).
- `desc = { id, title, order, paths: { play, spectate, host, state, kit }, models: { kind: url }, host(body) →
  { status, body }, state() → object, room() → adapter | null }` — `host` / `state` are the very functions the game's own
  routes call (POST `/api/game/<id>/host` body; GET state); `room()` is non-null only while the game's session is enabled.
- The world module sets `reg.hub = hub` when it loads and `null` in its `onShutdown`. Games read `reg.hub` when they need
  it (never cache it across ticks). Every call into the hub / an adapter is wrapped in try/catch by the caller: a
  failing world never breaks a game.

### 0.2 Room adapter (each game, while its session is enabled)

```js
adapter = {
  id,                              // 'rc' | 'sk' | 'salad'
  entities(t) → [Ent],             // its live dynamic entities NOW (room metres) — cheap, no allocation storms
  viewers() → [{ key, kind, p: [x,y,z] | null, cap }],  // joined sockets: kind 'player' | 'spectator'; p = own car / soldier / pouch
  send(key, msg),                  // to one viewer, on the game's existing socket (bots: their virtual socket)
  toAll(msg),                      // to every joined socket of this game
  board() → { phase, endsAt, top: [{ name, color, score, label }] ≤ 3, players, bots },   // ticker
  apply(effect) → boolean,         // WO-1102: a cross-game effect on one of its entities (§6); false = not applicable
  bonus(pid, kind) → boolean,      // WO-1102: small bonus to a causer in this game (§6.3)
  pools?() → [{ x, z, y, r }],     // live light pools on the floors (any game with lights; §6 R9)
  area() → { rect: [minX, minZ, maxX, maxZ], y } | null,   // where this game is played now (rain R8; the world camera)
  pause(on),                       // world presenter-safe / pause (§4)
}
```
`Ent` (hub-internal, never sent as is):
`{ k, id, p: [x,y,z], yaw, v?: [vx,vy,vz], c: '#rrggbb', n: name, f: flags, s: sub, h?: hitRadius, life?: msLeft, bot? }`.

| k | from | p | yaw | v | c / n | f (bits) | s |
|---|---|---|---|---|---|---|---|
| `car` | rc | car origin on its ground | car yaw | — | player colour / name | 1 boost, 2 drift, 4 spin, 8 shield, 16 air (the RC `fx`) | — |
| `soldier` | sk | feet on the arena floor | aim yaw | — | team or player colour / name | 1 moving, 2 dead, 4 protected, 8 surge, 32 stunned | held weapon id |
| `veg` | salad / world | centre | 0 | m/s | veg colour / thrower | 1 world rain | veg id (`tomato`…`peas`) |
| `sling` | salad | slot base (hall floor) | aim yaw | — | player colour / name | — | pull 0…1 ×100 (int) |
| `av` | salad | feet | facing | — | top colour / label | the salad `av` flags (1 walk, 2 lost, 4 stand-in, 8 umbrella) + 16 duck + 32 step | height cm (int) |
| `splat` | salad / world | on the floor | 0 | — | veg colour | 1 slick (a slippery patch, WO-1102 R2) | radius mm (int) |

Per game the adapter caps what it publishes: rc ≤ 10 cars, sk ≤ 10 soldiers, salad ≤ 30 vegetables in flight (newest),
20 slings, 3 avatars, 12 splats (newest).

## 1. Wire format (version 1) — server → game clients, on the game's own socket

Only sent while the world is on AND the viewer has at least one foreign entity in interest (or had one, to remove it).

```
{ t: 'wst', v: 1, on: true, client: '/game/world/visitors.js', models: { car: '/game/rc/car-model.js', … },
  scale: 0.1, safe: false, affect: 'on'|'soft'|'off', games: [{ id, title, phase }] }
```
— once when the viewer's first foreign entity appears, again when any field changes; `{ t: 'wst', v: 1, on: false }`
when the world goes away (the client drops every visitor).
```
{ t: 'wv', v: 1, ts: <server ms>,
  add:  [[w, k, g, c, n, s], …],        // new for THIS viewer: w = world id (int), k kind, g game id, c colour, n name ('' when tags are off), s sub
  e:    [[w, x, y, z, yaw, f, vx, vy, vz], …],  // updates; vx… only for k = 'veg' (else the tuple ends at f)
  gone: [w, …],                          // left the viewer's interest or the world
  fx:   [[w, kind, ms, c], …] }          // WO-1102 one-shot visuals on a visitor (§6.4)
```
- Numbers: positions / velocities rounded to 1 mm (3 decimals), yaw to 0.001 rad; `f` and `s` integers or short
  strings (`s` ≤ 12 chars, `[a-z0-9_-]`); `c` `#rrggbb`; `n` the game's already-cleaned name, ≤ 16 chars. The world ids
  `w` are the hub's (a game's own ids never leak across: `(g, k, id)` → `w`, freed 30 s after the entity is gone).
- `add` always precedes the first `e` of that `w` (in the same message). An entity whose fields did not change since
  it was last sent to this viewer is not repeated. `gone` = removal, nothing implicit.
- Size: ≤ 32 updates and ≤ 2560 bytes per message (lowest-priority updates wait for the next tick).
- **Sanitiser** (`client/world-wire.js`, a pure ES module also `require()`d by the server smokes): `decodeWv(msg)` drops
  anything malformed — unknown `v`, non-finite numbers, |coord| > 500 m, |v| > 60 m/s, unknown kind, bad colour —
  entity by entity, never throws, returns `{ ts, add, e, gone, fx }` of clean tuples; `encodeWv` is its exact inverse
  on clean input (round-trip smoke).

Client → server (optional, on the game's socket, intercepted by the game service before its room, only while the world
is on): `{ t: 'wq', n: 6|12|20 }` — the visitor cap of the client's quality tier (Low 6, Medium 12, High 20). Anything
else / no message → 12. The game's existing rate limit and 2 KB cap apply.

### 1.1 Interest management (hub, per viewer, every world tick)

- **World tick** 10 Hz, ONLY while ≥ 2 rooms are registered or a world-page socket is open; otherwise no timer at all.
- Candidates = every entity of the OTHER games (+ world rain), never the viewer's own game.
- Priority = `dist / weight` (horizontal metres from the viewer's `p`; a viewer without `p` — a spectator — uses the
  room centre with every weight × 0.5 so it sees the most important, spread out): weight `av` 6, `veg` 4, `car` 2,
  `soldier` 2, `splat` 1.5, `sling` 1. Interest radius by the viewer's game: rc 8 m, sk 4 m (+ anything airborne ≤ 6 m),
  salad 30 m (the whole room), spectators unlimited. `av` always qualifies (the presenter is global).
- Hard cap per viewer `min(cap, 20)` (`cap` from `wq`, default 12); the world spectator page 80.
- Rate: near (≤ ⅓ radius or `veg`) every tick (10 Hz), the rest every 3rd tick; a `veg` is sent with its velocity so
  the client extrapolates the arc between updates.
- The hub keeps per viewer only `{ sent: Map(w → key), tickN }`; a viewer that disappears from `viewers()` is forgotten.
- Measured target (WO verification): ≤ 3 KB/s per phone at the default cap with three full games; with the world off,
  0 extra bytes.

## 2. What clients draw (`client/visitors.js` + `props.js`)

`createVisitors(THREE, scene, opts)`; `opts = { view: 'rc'|'sk'|'salad'|'world', scale, quality, tags, floorY(x, z),
camY(), cutY?: (x, z) → y | null }`. API: `ingest(wst | wv)`, `update(serverNow, dt, camera)`, `effect(fx)`,
`setQuality(q)`, `patches()` (§6 R2: live slick patches `[{ x, y, z, r, until }]`), `count()`, `dispose()`.

- **Models are the owning game's own code**, imported lazily by URL from `wst.models` (`car` → RC `createCarModel`,
  `soldier` → Skirmish `createSoldierModel`, `veg` → Salad `vegMesh`, `sling` → Salad `createSlingshot`, `av` → Salad
  `createAvatarModel`). `props.js` is the one place that knows each model's signature and the size it is built at
  (cars / soldiers at the scene scale, the rest life-size). A model module that fails to load → a neutral stand-in
  (coloured capsule of the right size), never an exception in the game loop. URLs are accepted only when they start
  with `/game/` and contain no `..`. The game pages share one import map (`three` → `/vendor/three/…`), so every model
  uses the page's three.js.
- Interpolation: 100 ms behind the newest update (as each game does natively); `veg` extrapolated ballistically from
  `p`, `v` (g = 9.81) up to 300 ms, then held; an entity not updated for 2 s fades out; `gone` removes it.
- Tags (name over the head) only at High / Medium and only for `car`, `soldier`, `sling`; Low: no tags, cap 6.
- **Skirmish's cut-away view** (`cutY` set: arena floor + 0.4 m, well under the 0.9 m follow camera): an object whose
  bottom is above `cutY` is not drawn; instead a soft dark shadow on the floor under it (radius grows as it comes
  down) and, for a `veg`, a thin ring in its colour (an incoming warning). Slingshots and the presenter avatar are
  drawn with the same clipping plane the room uses (only their feet / base show in the arena).
- Salad's audience view and RC's chase cam draw everything as it is; in RC a car's chase cam may be INSIDE a cabbage or
  a slingshot leg: visitors whose bounding sphere contains the camera are hidden for that frame.
- Budget: at most 20 visitors drawn (cap), splats ≤ 12, each model built once per `w` and reused; disposed on `gone`.

## 3. World pages and API (`modules/game-world`)

| What | URL |
|---|---|
| Landing — "pick your game" (the natural join address; the three choices with their state, a tap opens that game's player page) | `/game/world/` |
| World host (auth) | `/game/world/?host=1` |
| World spectator (one wide room camera, all games, ticker / leaderboard strip; the page an operator MAY put on a screen) | `/game/world/?spectate=1` |
| State | `GET /api/game/world/state` (public while ≥ 1 game session is enabled, else `{ on: false, games: [...] }` with auth) |
| Host | `POST /api/game/world/host` (normal auth always) |
| Feed for the world pages | WebSocket `/api/game/world/ws` (public while ≥ 1 game session is enabled; spectator only; ≤ 20 sockets) |

`state`: `{ on: true, v: 1, safe, affect: { rc, sk, salad }, house, lights, wall, events: { rain, spot } | null,
games: [{ id, title, enabled, phase, players, bots, endsAt, paths, joinUrl, top }], scene: { json, glb } | null, stats }` —
`scene` = the scene URLs of the first enabled game (all three bake the same scene: same rev); `stats` = hub counters
(ticks, entities, bytes sent per game, events per rule).

Host actions (body `{ action, … }`):
- `enable {game?}` / `disable {game?}` — one game's session or (no `game`) all registered games: calls each
  descriptor's `host({ action: 'enable' })`.
- `start {game?}` / `stop {game?}` — round / race / match start or stop, one or all (a game that refuses — no players,
  already running — is reported per game, the others still go).
- `bots {game, n}` — passed on in that game's own shape (rc `count`, sk / salad `n`).
- `safe {on}` — **presenter safe / pause everything** (§4).
- `lights {on}`, `wall {on}`, `house {level 0..1}` — passed on to every enabled game (WO-1099 house lights level).
- `affect {game, mode: 'on'|'soft'|'off'}` — WO-1102 "others can affect this game" (default `on`).
- `event {kind: 'rain'|'spot', secs: 5–60}` — WO-1102 shared events (§6 R8, R9); `event {kind: 'none'}` ends one.

The world feed (`/api/game/world/ws`): `{ t: 'hello', v: 1, state }`, then `wv` (no own-game exclusion, cap 80, no
`wq`), `wst`, `{ t: 'board', games: [...] }` 2 Hz, `{ t: 'xev', … }` (§6.4) — the world pages' only feed. Each game's
host page keeps working on its own; the world host only calls the same host functions.

## 4. Presenter safe / pause everything

ONE switch on the world host. `safe {on: true}`:
- Stage Salad: its own `safe` (presenter-safe pause: umbrella up, no firing, open flights cleared) — unchanged rule.
- RC and Skirmish get a new host action `pause {on}` (also accepted from their own host API): while paused the server
  drops `fire` / `hit` / `boom` / `pick` (sk) and `use` / `box` / `hit` (rc), freezes the phase clock (a countdown,
  race or match resumes with its deadlines and lap clocks shifted by the paused time), keeps positions frozen at the
  last report, and the state carries `paused: true` — **only while true** (absent otherwise, so a game alone sends
  byte-identical states). Clients show "Paused" and hold their own car / soldier still.
- World rain / spot events end; every cross-game effect stops (§6).
`safe {on: false}` undoes it in every game. A game enabled while the world is safe starts paused.

## 5. Costs and "alone = unchanged" (tests pin these)

- World module disabled / not installed: no game file reads `reg.hub` except on enable and in the paths that already run
  (a property read); no timer, no field, no message.
- World on, one game running: hub has no foreign entities → no world tick, no `wst` / `wv`.
- A game's `state` never gains a world field (only `paused: true` while paused).
- Smokes: each game's room driven by the same script with and without a registered hub that has no other room → the
  exact same sent messages (JSON text, in order).

---

# Step 2 — the games affect each other (WO-1102)

## 6. Rules (the world referee decides; no client reports its own cross-game hit)

The referee is `modules/game-world/server/world-referee.js`: **pure** (no I/O, no timers, no `Date.now`; clock and
`seed` injected, `mulberry32(seed)` for every chance). The hub feeds it entity snapshots and the games' contact
queries; it returns effects + bonuses that the hub delivers to the target / source adapters. Bots take part exactly like
players (their entities are entities; their effects go to their virtual sockets).

**Durations are game time lost**, `dur` below. A target whose game's `affect` is `off` is never a target (its entities
stay visible); `soft` = the visual only (decal, sparks, shadow) — never a loss of control, never knock-back, nothing on
the target's physics.

### Caps (every rule, enforced by the referee before an effect leaves it)
- **Immunity**: after any cross-game effect a target is immune to further control-loss effects for `imm` (car 3 s,
  soldier 4 s; the avatar's hop 10 s). Visuals still happen.
- **Per target**: total `dur` of cross-game effects ≤ 4 s in any rolling 60 s window; beyond it effects degrade to the
  visual only (property test: no target loses more than 4 s per minute).
- **Per source → target pair**: ≤ 3 effects with control loss in any rolling 60 s; beyond: visual only, no bonus.
- **Per source**: ≤ 12 bonuses in any rolling 60 s (property test: no source farms one target, nobody farms bonuses).
- Nothing while the world is `safe`; nothing in a phase where the target game freezes (rc countdown / results, sk
  countdown / results); rain / spot only in lobby / round / race / match phases of the receiving game.

### Rules

| # | Trigger (server) | Effect on the target (`dur`) | Causer bonus |
|---|---|---|---|
| R1 **Splat-hop** | a flying vegetable's swept sphere meets a car's hit sphere (centre p + (0, 0.025, 0), r 0.04 m) — tested inside Salad's own flight step through the hub's colliders (§6.1) | car: `hop` — a small hop (upward 6 m/s × s, the RC airborne path), speed × 0.6, steering kept; `dur` 0.6 s; splat decal in the veg colour on the car 4 s (splat veg) | salad: +15 points (round only) |
| R2 **Slick patch** | a splat vegetable (`tomato`, `cabbage`, `peas`) ends on `floor` / `stage` | a `splat` entity with flag 1 (slick): r tomato 0.15 m, cabbage 0.25 m, pea 0.06 m, 8 s; cars inside: grip × 0.55 and top speed × 0.85 (a slide, no spin); soldiers inside: speed × 0.75 + footprints for 3 s. Continuous, applied by each client to its own car / soldier from the patch list it gets (an environment, like a puddle — no hit is reported, nothing scored), `dur` 0 | none (no farming) |
| R3 **Bowled over** | a car's swept segment (previous → current, last 2 ticks) passes within 0.065 m (car r + soldier r 0.025) of a live, unprotected soldier at a car speed ≥ 0.4 m/s | soldier: `stun` 0.8 s (cannot move or fire — server drops its fire for 0.8 s, client holds it) + knock-back 1.5 u along the car's heading over 0.3 s; no damage; car: `bump` — speed × 0.8, `dur` 0.2 s | rc: a 0.4 s mini-boost (`boost`) |
| R4 **Sparks** | an accepted Skirmish hitscan `fire` whose ray (server position + yaw, muzzle height, range × u, shrunk by the arena's line of sight) passes within 0.04 m of a car | car: `wobble` — 0.25 s steering jitter ±8°, speed × 0.95; sparks | sk: `bonus` (§6.3) |
| R5 **Pea scatter** | a `peas` vegetable lands within 0.25 m of a live soldier | soldier: `scatter` — aim spread +6° for 1.5 s (client cone; the server's hit check already allows spread), `dur` 0.5 s | salad: +5 (round only) |
| R6 **Bounce** | `onion`, `cabbage`, `potato` meeting a car / soldier (R1's colliders, soldier: centre p + (0, 0.03, 0), r 0.025 m) bounce off it with their own restitution (Salad's flight step, a sphere collider tagged `car` / `soldier`); a splat vegetable ends on it | R1's `hop` on a car / `stun` 0.5 s on a soldier | salad: +15 |
| R7 **Make way** | a car within 0.6 m (horizontal) of the presenter avatar's feet, moving ≥ 0.3 m/s towards them, avatar not dodging, chance 0.5 (seeded) | avatar: `step` — the Salad dodge kind (0.4 m sideways away from the car, 0.7 s), friendly, no points either way; ≥ 10 s between car-caused steps per avatar, never while `safe` | none |
| R8 **Vegetable rain** (host event, 5–60 s, default 10 s) | the referee drops world vegetables (source `world`): 1.5 / s over each running game's play area (rc: around the race's track — its cars' bounding box + 1 m; sk: the arena rect; salad: the stage front), from 3 m above the floor, straight down + a little drift; they hit cars / soldiers (R1 / R3-style `hop` / `stun` 0.5 s) and leave slick patches (R2) | as R1 / R2 / R5 | none (source = world) |
| R9 **Spotlight bonus** (host event, 5–60 s, default 30 s) | every 2 s, an entity whose feet are inside a live light pool (adapter `pools()`: lights with intensity ≥ 0.3, the beam's floor hit ± its radius by zoom) | none | its own game's bonus, ≤ 5 per player per event |

R6 replaces "cabbage/onion bounce off cars" in the brief: a bounce also does R1 / stun (same caps). The brief's "the
presenter's umbrella / dodge visible to all" is §2 (`av` flags 8 / 16 / 32, drawn by every game).
**Dropped (and why):** a car driving through a slingshot (they stand on the hall floor among the audience seats, not
near tracks — rarely happens, nothing to see); soldiers shooting vegetables out of the air (hitscan vs a 4 s flight
makes it a lottery and would let Skirmish grief Salad's scoring).

### 6.1 Contact queries (synchronous, server)
- `hub.colliders(gameId)` → sphere colliders `{ k: 'sph', c, r, tag: 'car'|'soldier', w }` of the OTHER games' hittable
  entities at the moment (cars, live unprotected soldiers whose game's affect is not `off`). Salad passes them to
  `stepFlight` as `opts.extra` (its umbrella mechanism).
- `hub.contact({ g, pid, veg, p, v, tag, w })` → after a flight met a collider tagged `car` / `soldier`: the referee
  decides R1 / R6 (caps) and returns `{ end: true }` for a splat vegetable (the flight ends `land`, tag `car` /
  `soldier`) or `{ end: false }` (it bounced). A bounce changes the flight: Salad sends its clients
  `{ t: 'xb', id, n, i, p: [x,y,z], v: [vx,vy,vz], at }` (server ms) and they re-anchor that projectile there.
- `hub.landed({ g, pid, veg, p, tag })` → R2 patch / R5 scatter.
- `hub.patches(gameId)` → the live R2 slick patches `[{ x, y, z, r, until }]` (`until` in server ms) — the same patches
  the pages get as `splat` visitors, for a game's server-side players (WO-1106 A35). `[]` while safe, while the world
  tick does not run, for a game that is not attached, or while that game's affect is not `on` (a slide is a loss of
  control). RC: `rc-world.js patches()` → `rc-room-bots.js` hands them to every bot step as `world.patches` (once per
  tick; none → the step gets the very same world object as before).
- `hub.shot({ g, pid, o: [x,y,z], yaw, range, los(a, b) })` → R4 (Skirmish, at an accepted hitscan `fire`).
- R3 / R7 / R8 / R9 run in the hub's world tick (they need only positions).

### 6.2 Effects (hub → target adapter `apply(effect)`)
`effect = { k: 'hop'|'bump'|'boost'|'wobble'|'stun'|'scatter'|'step', g, id, dur (s), dir?: [dx, dz], c?: '#rrggbb',
soft: bool, by: { g, name } }`.
Each game turns it into one message to all of its sockets (others draw it; the owner applies the physics):
- rc: `{ t: 'xfx', k, id, dur, dir?, c?, soft?, by }` — the car `id`'s client (or bot) applies it in its own physics;
  `soft` = decal / sparks only.
- sk: `{ t: 'xfx', k, id, dur, dir?, soft?, by }`; the server drops that soldier's `fire` for `stun` (`p.stunUntil`).
  As built (amended): the server does NOT freeze the reported position — positions are client-simulated and a freeze
  would rubber-band the knock-back; the soldier's own client holds its input for `dur` and slides 1.2 u along `dir`
  over 0.3 s, inside the room's normal move clamp.
- salad (`step` on an avatar): `dir` = [dx, dz] the side to step to (away from the car's line); presenters.makeWay()
  steps 0.4 m along the stage's right axis on that side, 0.7 s, through the dodge path (`dodge` message as today).

### 6.3 Bonuses (hub → source adapter `bonus(pid, kind)`)
- **Salad**: +15 points per R1 / R6 hit, +5 per R5, +10 per R9 tick — in a round only (lobby: shown, not counted).
- **Skirmish**: score is the frag count in dm / tdm and the limit ends the match, so a cross-game bonus may not change
  it: every 3rd bonus gives +1 score, at most +2 per match (dm / tdm / spot alike); warm-up: shown only.
- **RC**: a 0.4 s mini-boost to the causer's car (R3, R9) — any phase in which cars drive; never more than 1 per 3 s.
Every bonus is also shown to the causer (`{ t: 'xbonus', kind, pts }` on its game's socket).

### 6.4 Events everyone sees
`{ t: 'xev', k: rule, by: { g, name }, to: { g, name }, p, at }` to the world pages and, for a game's own entity, in
its `xfx`; the world spectator's ticker shows the last ones ("Ola's tomato splatted Kuba's car").
Visitor visuals come in `wv.fx` (`[w, kind, ms, c]`: `splat`, `sparks`, `stun`, `hop`).

### 6.5 Determinism and tests
- `createReferee({ seed, now })` — every random draw from its own mulberry32; the same inputs → the same outputs.
- Unit test per rule (trigger, no trigger, soft, off, safe). Property tests (seeded random scripts, ≥ 200 runs): no
  target over 4 s / 60 s, no pair over 3 control effects / 60 s, no source over 12 bonuses / 60 s, immunity holds.
- A 5-minute soak (box): bots in all three games + scripted players + the tracking puppet; the hub logs every effect
  (`stats.events`), the WO carries the table per rule (count, mean / max `dur`, per-target worst minute).

## 7. Files and ownership

- `modules/game-world/module.json`, `register.js`, `server/world-*.js`, `routes-world.js`, its smokes
  `tools/smoke/smoke-wo1101-world-*.test.js` / `smoke-wo1102-referee-*.test.js`.
- `modules/game-world/client/**` (visitors, props, world-wire, pages) and `smoke-wo1101-world-client-*.test.js`.
- Game wiring (lead): each game's `register.js` (descriptor), a new adapter file per game, small hooks in the rooms /
  services / clients; their own contracts get a "§ Game World" paragraph.
- Nothing under `src/` changes. A side that needs this contract changed says so — it does not silently diverge.

## 8. As built (16.11.26) — where the code differs from the text above

- World pages are always served (they say "no game is running" until one is); the world feed is public only while a
  game runs.
- Bonuses are paid only for control-loss effects (hop / stun / scatter / wobble / bowl), never for a soft effect.
- Rain (R8) and spotlight (R9) need the world tick, i.e. ≥ 2 attached rooms or an open world page.
- Interest: avatars are always placed first; name tags are blank at Low (cap 6); fade applies only to moving visitors;
  a splat's `until` on the client = first seen + 8 s. The spectator has no live light beams.
- Viewer keys may be the games' socket objects (the hub serialises them); `wst.scale` is the toy scale of a game that
  brings a car / soldier model (never Salad's life-size 1); Salad's client draws visitors at `wst.scale`.
- The spectator camera frames the stage edge from ≤ 14 m, 1 m under the ceiling, inside the hall (not the whole room).

## 9. Resume after a reconnect — one design for the three games (WO-1106 B34)

The three game rooms (RC, Stage Skirmish, Stage Salad) share `modules/rc-game/server/rc-resume.js` (Skirmish and
Salad through their kits). The world wire is unchanged: a resumed player is the same entity id, so visitors and
effects simply carry on.

- `welcome` for a player carries `"resume": "<id>.<22 base64url chars>"` — 128 random bits per player entry, the same
  for the entry's life. It goes only to that player's own socket: never in a `state`, a broadcast or a world entity.
  Spectators and server bots get none.
- The page keeps it in memory and in sessionStorage (`resume`): a reload of the same tab resumes, a new tab is a new
  player. It sends it back as `"resume"` in its next player `join` (never a spectator join).
- A valid token for an entry whose socket is gone — or still open but silent (half-open) — gives that SAME player back
  (id, name, colour, team, slot, score / laps / kills), before any `full` check. The old socket is forgotten and closed
  with **4410** `resumed elsewhere`; its late close drops nothing. The welcome then also has `"resumed": true`.
  RC: `you.race = { lap, cp }` (the server's count); still racing when gone ≤ 20 s (the finish grace), else out of
  this race. Skirmish: respawns through the normal spawn, score kept. Salad: slot and score kept, its aim / shot
  counter start over, the reload restarts (never shorter than the longest vegetable's).
- No entry for it any more (lobby drop, lobby reset, kicked, a ghost whose seat a joiner took) → a normal join. A
  malformed token or a wrong secret for a live entry → a normal join counted on the socket's bad-message counter
  (> 20 → 1008). Constant-time compare; the id only picks the entry.
- Seats: a player who dropped mid-game keeps its seat (RC: its grid slot too); a joiner to a full room takes the
  longest-gone one's (RC: an unfinished racer's first) — that token is void, the line and score stay until the lobby.
  Lobby drops still leave at once (nothing to keep); in the lobby only the half-open take-over resumes.
- Pages: 4409 kicked forgets the token; 4410 → status `replaced`, no auto-reconnect, a "Playing on another page" card
  with "Play here" (rejoins with the token and takes the seat back). The lobby's change-name rejoin forgets the token
  (a new name is a new player). A resumed `welcome` does not rebuild the page as a new player (RC keeps its car model
  and takes the server's lap / checkpoint; Salad keeps its state, phase and flights); the A4 visitors reset stays.
