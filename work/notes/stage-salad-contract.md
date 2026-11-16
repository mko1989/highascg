# Stage Salad — slingshot vegetables at the presenter's avatar (WO-1089)

Contract between the server and the browser client. Owner, 15.11.26: "new game idea. when a presenter is on stage and
there is his avatar representing him, id like to be able to shoot vegetables at the avatar from a large slingshot. also
multiplayer with the same idea as rc and skirmish. the game loosely based on angry birds".

**Originality.** Only the genre idea is taken (pull back, aim, release, a ballistic arc). Everything else is our own and
about the event itself: the room, the stage, the presenter's friendly "pebble person" avatar (WO-1086), vegetables. No
birds, no pigs, no block towers, no names / characters / level designs / art / sounds / UI of any existing game.

Read `work/notes/rc-game-contract.md` (frames, the baked scene, §2.6 live lights / LED wall pictures) and
`work/notes/skirmish-game-contract.md` §0–§1 (module rules, the kit) first; they hold here unless this note differs.
**Unlike the other two games this one is at REAL scale**: every length is metres in the Godot frame; the scene's toy
`scale` is ignored.

## 0. Hard rules (same as RC / Skirmish)

- The game never puts anything on a screen by itself: no AMCP, no look, no layer, no project write. A web page, an API,
  a socket. The spectator view is only a web page an operator MAY route to a screen.
- An opt-in module `modules/stage-salad/` (name `stage-salad`, title "Stage Salad"), off by default; inside it a
  session the host enables. Disabled = holds nothing (no room, timers, sockets, leases, tracking polls).
- Public (no API password) only while a session runs: page, `state`, `scene`, `scene.glb`, the socket. `host` always
  needs normal auth.
- Client: plain ES modules, no build step, three.js from `/vendor/three/`, URLs only `/api/game/salad/`,
  `/game/salad/`, `/vendor/three/` (no CDN, fonts, asset or audio files; procedural models, WebAudio blips; no
  `http(s)://` string in client source). User text only via `textContent`.
- The presenter is shown only as the generic avatar (never camera pixels, never a face). Reactions are slapstick and
  friendly: splats in the vegetable's colour that fade, a wobble, a duck, a cabbage-leaf hat. No injury, no blood, no
  "knocked out", nothing humiliating on a big screen. The host's **presenter-safe pause** stops every shot at once.
- 500 lines per file. Server: CommonJS `'use strict'`, tabs, no semicolons.

## 1. Module layout, what is shared

```
modules/stage-salad/module.json, register.js
modules/stage-salad/server/   salad-*.js, routes-salad.js
modules/stage-salad/client/   index.html, *.js, *.css   (package.json "type": "module")
```
- **Kit (the RC module, a sibling that must be INSTALLED, not enabled)** through `server/salad-kit.js`, exactly as
  Skirmish's sk-kit.js: the scene baker (the venue GLB + floors; same rev and cache as the other games — no second
  bake), live lights / LED wall pictures (rc-lights / rc-video, lease id `stage-salad`), the static-file server, the
  2 KB cap and the name / colour cleaners. Client kit files come from `/game/salad/kit/<file>` (world.js, stage-fx*.js,
  interp.js, join-code.js + vendor QR, fullscreen.js, mesh-util.js). Nothing under modules/rc-game or
  modules/toy-skirmish is edited.
- **Shared pure ES modules in `client/`, also `require()`d by the server** (Node ≥ 22: require of an ES module):
  `veggies.js` (the ammo table), `flight.js` (the flight model), `venue.js` (the play frame, slots and colliders), `aim.js` (the aim solver: bots, the dev hook),
  `avatar-body.js` (the avatar's proportions and hit parts). One copy: server referee, bots and client prediction run the
  same code, so a smoke can prove they agree. **Caveat (measured 15.11):** Node keeps an ES module in its own loader
  cache even after its `require.cache` entry is dropped, so a module disable / enable reloads the server files but NOT
  these five — a change to them is live on the server only after a node restart (the browser gets it at once).

## 2. URLs (port 4200)

| What | URL |
|---|---|
| Player page | `/game/salad/` |
| Spectator | `/game/salad/?spectate=1` (wide stage camera + leaderboard, no buttons) |
| Host panel | `/game/salad/?host=1` |
| Kit files | `/game/salad/kit/<file>` (`.js`, `.mjs`, `.css`) |
| State | `GET /api/game/salad/state` |
| Host | `POST /api/game/salad/host` |
| Scene | `GET /api/game/salad/scene` (the RC bake without `tracks` / `occ` / `heights`, + `salad` venue + live `lights` / `screens`; 403 while off), `GET /api/game/salad/scene.glb` (the shared GLB; gzip; `?rev=` immutable) |
| Socket | WebSocket `/api/game/salad/ws` (also under `/instance/<id>`) |

Host actions: `enable`, `disable`, `start`, `stop`, `round {secs: 30–600}`, `bots {n: 0–8}`, `botlevel {level: easy|
normal|hard}`, `teams {on}`, `target {mode: 'auto'|'dummy'|'ids', ids?: [tid…]}`, `safe {on}` (pause / presenter
safe), `kick {id}`, `lights {on}`, `wall {on}`, `house {level 0..1}` (WO-1099 house lights slider, RC §2.6; `on` boolean still accepted = 1 / 0; state `house` is the number, default 1).

## 3. Frame and venue (`venue.js` — `buildVenue(sceneJson, live)`; the server puts the result in the scene as `salad`)

Godot / three.js frame: metres, Y up. Yaw θ about +Y; a launch direction for yaw θ and pitch φ is
`(−sin θ cos φ, sin φ, −cos θ cos φ)` (yaw 0 looks along −Z, as the RC cars).

- `hall` = the bake's `hall` floor `{y, rect}`; `stage` = its `stage` floor (the tracking grid). No stage floor → a
  synthetic stage 8 × 3 m, 0.4 m high, against the hall's far −Z end (flagged `synthetic`).
- **Front of the stage**: of the stage rect's 4 edges, the one whose outward normal points most towards the hall rect's
  centre (ties → the longer edge). `front = { c: [x, stage.y, z] (edge midpoint), f: [fx, fz] (unit, towards the
  audience), r: [rx, rz] (the audience's right = (fz, −fx)), half (half the edge length), depth }`.
  Hilton Wawer: stage x 9.55…12.55, z −4…11, y 0.639 → front edge x = 9.55, f = (−1, 0), half 7.5.
- **Slots** (20 slingshots, index order = fill order): rows at R = 9 m and 12.5 m from the front-edge midpoint along
  f (on the hall floor), 10 per row at arc angles ±(k + 0.5)·Δ, Δ = 1.7 m / R, alternating right / left from the
  centre; points clamped into the hall rect inset 1 m. Each slot `{ i, p: [x, hall.y, z], yaw (facing the stage-front
  centre), team: 0 left / 1 right of the room's centre line as the audience sees it }`. The pouch (launch point) is
  `pouch(slot) = p + (0, 1.25, 0)`.
- **Colliders** (what a vegetable bounces off — analytic, no physics engine; the RC bake's `occ` / height field are
  toy-scale bands ≤ 0.8 m above the floor and say nothing about an LED wall or a truss, so they are not used):
  `{ k: 'plane', n: [0,1,0], d, tag: 'floor' }` (hall floor), `{ k: 'box', min, max, tag: 'stage' }` (stage body),
  `{ k: 'obox', c, ax: [[3],[3],[3]], h: [hx,hy,hz], tag: 'wall' }` (each live `screens` entry: picture centre,
  Godot YXZ rotation, size × 0.12 m deep, centred 0.06 m behind the picture), `{ k: 'cap', a, b, r: 0.2, tag: 'truss' }`
  (lights grouped by height ±0.4 m: the farthest pair of each group with ≥ 2, 0.3 m above them, extended 0.4 m),
  `{ k: 'sph', c, r: 0.22, tag: 'truss' }` (each light, ≤ 40), the four hall walls and the ceiling
  (`bounds.max[1]`, at least hall.y + 4) as planes, tag `room`.
- `play`: the hall rect × [hall.y − 0.5, ceiling + 1] — leaving it ends a flight (`out`).

## 4. Ammo (`veggies.js` — the server and client tables are this one file)

| id | name | r (m) | speed min–max (m/s) | drag k | restitution | bounces | splat | reload (s) | pitch ° | points × | look |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `tomato` | Tomato | 0.045 | 7–17 | 0.018 | — | 0 | yes | 0.8 | 22 | 1.0 | red, green star top |
| `potato` | Potato | 0.05 | 6–13 | 0.006 | 0.25 | 2 | no | 1.2 | 34 | 1.2 | lumpy brown |
| `carrot` | Carrot | 0.03 | 9–20 | 0.008 | 0.15 | 1 | no | 1.0 | 12 | 1.3 | orange cone, spins |
| `cabbage` | Cabbage | 0.11 | 6–15 | 0.022 | 0.2 | 1 | yes | 1.6 | 30 | 0.8 | big green leafy ball |
| `onion` | Onion | 0.045 | 7–16 | 0.012 | 0.6 | 3 | no | 1.0 | 20 | 1.0 | gold, bank shot ×1.5 |
| `peas` | Pea burst | 0.018 ×5 | 8–17 | 0.02 | — | 0 | yes | 1.4 | 18 | 0.3 each | 5 peas, ±3° spread |

`speed = min + (power − 0.15) / 0.85 · (max − min)`, power 0.15…1. Every player may pick any vegetable; after a shot the slingshot
reloads for that vegetable's time.

## 5. Flight (`flight.js`, server-authoritative)

- Fixed step 1/120 s; `a = g − k·|v|·v`, g = (0, −9.81, 0); max 4 s.
- Contact = the vegetable's sphere against a collider: pushed out along the normal, `v ← v − (1 + e)(v·n)n`, tangential
  × 0.7. A `splat` vegetable ends at its first contact (`land`, the collider's `tag`); others end after `bounces`
  contacts, or when slower than 1.2 m/s after a contact (`land`). Out of `play` → `out`.
- Peas: 5 projectiles from one `fire`, yaw / pitch offsets from `mulberry32(seed)` (one draw each, uniform ±3°).
- **The avatar is tested by the server only** (swept segment of each step against the parts of every target at that
  moment, §6). First contact along the step wins: `hit` with `part`, point and target. Clients simulate the venue
  flight identically and stop at the server's `end`.

## 6. The presenter avatar (`avatar-body.js`, `salad-presenters.js`)

- **Source** (server, polled 10 Hz while a session runs and someone is connected): the tracking module's world persons
  (`GET /api/tracking/detections` in-process through the module registry → `world.persons`; the WO-1087 test puppet
  people are world persons too). PSN → Godot: `(x, floorY, −y)`; floorY = the stage's y inside the stage rect, else the
  hall's. Look = the person's own `traits` (puppet), else the first camera person (by `keys`) that carries `traits`;
  missing keys → the Godot NEUTRAL clay. Height clamped 1.2–2.2 m (default 1.75).
- Host `target`: `auto` = every tracked person (≤ 3, nearest the stage centre first), `ids` = those tids, `dummy` = the
  stand-in only. **No tracked person → the stand-in**: a neutral clay avatar labelled "Stand-in" at the stage's
  centre, 0.6 m behind the front edge, facing the audience, idling. A person lost mid-round stays 3 s where last seen
  (flag `lost`), then leaves; the stand-in comes back when nobody is left.
- Pose: feet eased at 8/s towards the tracked point (as the Godot avatar), facing = walking direction above 0.35 m/s,
  standing ≥ 0.8 s → turns to face the audience (`f`) at 3 rad/s (a presenter faces the room — the one change from the
  previs, which keeps the last facing).
- **Twin of the previs avatar** (godot/client/features/previs/tracking/person_avatar.gd, WO-1086): same unit frame
  (feet y 0, top UNIT_TOP 1.02, front +Z, the person's left +X; uniform scale height / 1.02), same parts, sizes,
  positions, colours (shoes = bottom × 0.45, blush = skin → (1, 0.45, 0.5) at 0.45), 0.3 self-light (person_avatar.gdshader). A smoke reads
  the Godot constants from the .gd text and checks the twin's table.
- **Hit parts** (unit frame, × height / 1.02): `head` sphere (0, 0.82, 0) r 0.19; `body` capsule (0, 0.36, 0)–(0, 0.60, 0)
  r 0.17 (torso + arms); `legs` capsule (0, 0.03, 0)–(0, 0.30, 0) r 0.12.
- **Dodge**: at a `fire` the server predicts the shot against the avatar's current pose + velocity; a predicted hit
  that lands ≥ 0.35 s later is dodged with chance 0.18 (seeded; ≥ 2.5 s between dodges per avatar): a head hit →
  `duck` (head and body sink 0.2 × scale for 0.75 s), else `step` (whole avatar 0.4 m sideways along r, away from the
  impact, 0.7 s). Announced with `dodge`, applied in the referee's own flight test.
- **Umbrella**: during a round each avatar raises an umbrella for 4 s every 25–40 s (seeded); a sphere r 0.5 × s at
  (0, 0.95, 0) × s, 0.12 m towards the audience — a vegetable that meets it bounces (`land`, tag `umbrella`; no
  points); legs stay open. In `safe` (pause) the umbrella is up and nothing can be fired.

## 7. Scoring

`points = round(base[part] × veg.points × distance × streak × bank)`: base head 100, body 50, legs 30; distance =
1 + clamp((d − 6) / 10, 0, 1) (d = horizontal launch → hit, m); streak = 1 + 0.25 × (consecutive hits − 1), max 2
(a shot that ends without a hit breaks it; a pea burst counts as one shot: hit if any pea hit); bank = 1.5 for an onion
that bounced before the hit. Lobby = practice: flights and reactions, nothing scored. Team mode: left / right halves
of the room (slot `team`), team score = the sum.

## 8. Rounds

`lobby` → host `start` (≥ 1 player, bots count) → `countdown` 3 s (no firing) → `round` (`secs`, default 90) →
`results` 12 s (no firing) → `lobby`. `stop` → lobby. Scores reset at `start`. Winner = top score (ties: more hits,
then fewer shots); team mode: the team with the higher sum. Max 20 players (bots count; a joining guest takes a bot's
place), 20 spectators.

## 9. Socket (JSON text frames ≤ 2 KB; per socket ≤ 30 messages/s, burst 30)

Client → server:
- `{ t: 'join', name, color, spectator }`
- `{ t: 'aim', a: [yaw, pitch], p: pull }` ≤ 10/s — others see the band stretch (`pull` 0…1)
- `{ t: 'fire', n, veg, a: [yaw, pitch], p: power }` — `n` the client's shot counter (increasing). The server checks:
  joined player, phase lobby / round, not `safe`, veg known, reload over (60 ms slack), ≤ 3 fires/s, yaw within ±55°
  of the slot's yaw, pitch −10°…70°, power 0.15…1 (outside → dropped, not clamped). The launch point is the server's
  slot pouch; a client never sends a position or a hit.
- `{ t: 'ping', c }` · `{ t: 'video', on }` (RC §2.6)

Server → client:
- `welcome { id, you: { id, name, color, slot, team, spectator }, state }` · `full` · `off`
- `state { state }` — on lobby / phase / roster / score / target / settings changes
- `w { ts, av: [[tid, x, y, z, yaw, height, flags]], sl: [[pid, yaw, pitch, pull]] }` 15/s while anything moved;
  av flags: 1 walking, 2 lost, 4 stand-in, 8 umbrella up
- `shot { id, n, veg, o: [x,y,z], a: [yaw, pitch], p, ts, seed }` — to everyone (the shooter too)
- `end { id, n, i, k: 'hit'|'land'|'out', p: [x,y,z], at, tag?, tid?, part?, pts?, streak?, bank? }` — one per
  projectile (`i` = pea index, 0 otherwise); `pts` only in a round
- `dodge { tid, kind: 'duck'|'step', from, until, dx: [x, z] }` · `umbrella { tid, from, until }`
- `me { ready, streak, score }` (server ms the slingshot is reloaded) · `countdown { startAt }` ·
  `results { order: [{ id, name, team, score, hits, shots, best }], teams: [l, r] | null, winner: { id } | { team } }`
- `pong`, `lxfull` / `lx`, binary wall pictures (RC §2.6)

`<state>`: `{ enabled, phase, startAt, endsAt, secs, teams, teamScores, bots, botLevel, safe, target: { mode, ids },
targets: [{ tid, name, puppet, dummy, lost, height, look: { top, bottom, skin, hair: [r,g,b], hair_len } }],
players: [{ id, name, color, slot, team, bot, connected, score, hits, shots, best }], spectators, maxPlayers,
joinUrls, sceneRev, venueRev, lights, wall, house }`. `venueRev` changes when the live screens / lights move the colliders:
clients refetch the scene JSON then.

## 10. Bots (server, `salad-bots.js`; aim through the shared `aim.js` solver)

Host `bots {n}` (0–8) adds virtual players (our own names, `bot: true`) that take slots like guests and fire through
the same referee. Aim: a solver over `flight.js` (the vegetable's pitch, power bisected so the arc passes the target's
body centre; higher pitch when out of reach); hard bots lead a walking target. Humanlike error: yaw σ and power σ by
level (easy 3.5° / 0.07, normal 2° / 0.04, hard 1.1° / 0.022) plus 0.15°/m with distance; a think time 1.8–3.2 / 1.2–2.4 /
0.8–1.6 s between shots. Never perfect: the error floor keeps every level's hit rate below 100 %. No bots → no bot timer.

## 11. Client look and controls

- Player camera behind and above the own slingshot (2.6 m back, 1.9 m up) looking at the stage front; after a shot it
  follows the vegetable for ≤ 1.6 s, then eases back. Spectator: a wide stage camera from the back of the room.
- Slingshot: an original big wooden Y-frame prop on a weighted base, the player's colour on the grips, a fabric band and
  a pouch holding the chosen vegetable, a small crate of vegetables beside it; others' slingshots show their pull.
- Controls — touch / mouse: press anywhere, drag down to pull (stretch = power), sideways to aim (pull left aims right);
  a dotted preview of the first ~0.5 s of the arc; release fires, a tiny drag cancels. Vegetable tray buttons; pitch ±
  with a small arc slider / wheel / W–S. Keyboard: ←→ aim, ↑↓ pitch, hold Space to pull, release to fire, 1–6 pick.
  Gamepad: left stick aim / pitch, hold RT to pull, release to fire, LB / RB cycle.
- HUD: vegetable tray with reload ring, power, score + streak, round clock, a small live leaderboard, banners
  ("SPLAT! +150", "Dodged!", "Umbrella!", "Paused — presenter safe"), results table; full-screen button; sound toggle.
- Effects budget: ≤ 30 live projectiles drawn, ≤ 12 splat decals per avatar (fade 6 s), ≤ 40 ground splats (fade 10 s).
  Kit quality tiers (`low` = Lambert, pixel ratio 1, no beams).

## 12. Files and ownership

Lead: this note, server/**, register.js, module.json, the shared pure modules (veggies / flight / venue /
avatar-body), smokes `smoke-wo1089-salad-*`, CI lists, the WO. Client agent: the rest of `client/**` and its smokes
`smoke-wo1089-salad-client-*`. A side that needs this contract changed says so — it does not silently diverge.
