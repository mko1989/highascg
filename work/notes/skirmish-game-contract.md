# Stage Skirmish — toy-soldier top-down shooter in the show's room (WO-1081)

Contract between the server and the browser client. Owner, 15.11.26: "second game idea. also some logic for world as
the rc one, where players are small toy size soldiers, top down view, shooter. different weapons to pickup, deathmatch
or teams modes. counter strike / unreal tournament vibes but top down. also as a module. also the lights/video is live
from the room."

It is a top-down arena shooter in the genre sense only: every name, weapon, look and sound is our own — nothing is
copied from an existing game (no names, maps, characters, art or sounds of any real game).

Read `work/notes/rc-game-contract.md` first: frames, units, the baked scene, toy scale (§3), the occupancy grid and the
live lights / LED wall pictures (§2.6) are the SAME here and are not repeated.

## 0. Hard rules (same as the RC game)

- **The game never puts anything on a screen by itself.** No AMCP, no look, no layer, no Caspar channel, no project
  write. It serves a web page, an API and a socket. The spectator view is only a web page.
- Off by default; a module (`modules/toy-skirmish/`, name `toy-skirmish`, title "Stage Skirmish") that must be enabled,
  and inside it a session the host enables. Disabled = holds nothing (no room, timers, sockets, leases).
- Public (no API password) only while a session is enabled: the page, `state`, `scene`, `scene.glb`, the socket. `host`
  always needs normal auth.
- Client: plain ES modules, no build step, three.js from `/vendor/three/`, no URL anywhere in the client source except
  `/api/game/sk/`, `/game/sk/`, `/vendor/three/` (no CDN, no fonts, no asset files, no audio files — WebAudio blips,
  procedural looks; no `http(s)://` string at all, also no SVG namespace URL). User text only via `textContent`.
- 500 lines per file (CI). Server files CommonJS `'use strict'`, tabs, no semicolons (repo style).

## 1. Module layout and what is shared with the RC game

```
modules/toy-skirmish/module.json, register.js
modules/toy-skirmish/server/   sk-*.js, routes-sk.js      (server agent)
modules/toy-skirmish/client/   index.html, *.js, *.css    (client agent)
```
The RC module (`modules/rc-game/`) is a **sibling that must be installed** (not necessarily enabled); Skirmish reuses
its world code instead of copying it:

- Server: `server/sk-kit.js` resolves the sibling (`path.join(__dirname, '..', '..', 'rc-game')`, works in the checkout
  and under `~/.highascg/modules/`), calls its `server/host.js` `set(h)` when that host is still unset, and re-exports
  what Skirmish uses: `createSceneBaker` (rc-scene.js — floors, `occ`, height field, GLB, `scale`; its `tracks` are
  ignored), `createRcLights` / `rcLightsDeps` / `withLiveScene` (rc-lights.js), `createRcVideo` / `rcVideoDeps`
  (rc-video.js), the static-file server logic and the message size cap. Sibling missing → `register.js` throws
  `Stage Skirmish needs the "rc-game" module installed`.
- Client: the static handler serves `/game/sk/kit/<file>` from the sibling's `client/` directory (same safety checks as
  rc-static.js; `.js`, `.mjs`, `.css` only). The client imports kit files it can use unchanged (candidates: world /
  scene loading, `stage-fx*.js`, `occ.js`, `scale.js`, `mesh-util.js`, `audio.js`, `fullscreen.js`, `join-code.js` +
  vendor QR, `interp.js`). A kit file that is tied to the RC API or RC rules is NOT edited: copy-adapt it into
  `modules/toy-skirmish/client/` and say so in the file header.
- **Nobody edits anything under `modules/rc-game/`.** If a one-line export there would save a large copy, report it to
  the lead instead.
- The scene bake cache (`~/.highascg/cache/rc-game/<rev>.*`) is shared: same rev = same files.

## 2. URLs (port 4200)

| What | URL |
|---|---|
| Player page | `GET /game/sk/` |
| Spectator | `/game/sk/?spectate=1` (no buttons) |
| Host panel | `/game/sk/?host=1` (join address + QR, arena, mode, limits, bots, start / stop, lights / wall switches, kick) |
| Kit files | `GET /game/sk/kit/<file>` |
| State | `GET /api/game/sk/state` |
| Host | `POST /api/game/sk/host` |
| Scene | `GET /api/game/sk/scene`, `GET /api/game/sk/scene.glb` (as RC: 403 while disabled, gzip, `?rev=` immutable) |
| Socket | WebSocket `/api/game/sk/ws` (also under `/instance/<id>`) |

`host` actions: `enable`, `disable`, `arena {id}`, `mode {mode: 'dm'|'tdm'|'spot'}`, `limits {frags: 5–100, minutes: 1–30}`,
`bots {n: 0–6}`, `botlevel {level: 'easy'|'normal'|'hard'}` (WO-1083), `start`, `stop`, `kick {id}`, `team {id, team}` (move a player), `lights {on}`, `wall {on}`, `house {level 0..1}` (WO-1099 house lights slider, RC §2.6; `on` boolean still accepted = 1 / 0; state `house` is the number, default 1).

## 3. Units, sizes, numbers (both sides use exactly these)

`s` = the scene's `scale` (0.1 live). "u" = one unit = `s` metres. Everything with a length is in u here; times and
angles do not scale. A soldier at s = 0.1 is a 5.5 cm toy.

| Constant | Value |
|---|---|
| Soldier radius / height | 0.18 u / 0.55 u; muzzle and hit height 0.35 u above the floor |
| Run speed | 4.5 u/s (no sprint); acceleration to full speed in 0.12 s; no jumping |
| Health / armour | 100 / 0 at spawn; max 100 / 100; armour absorbs 60 % of a hit while it lasts |
| Respawn | 3 s after death, at the spawn farthest from enemies; 1.5 s spawn protection (ends on first shot) |
| Players | max 10 (+ bots count towards 10), max 20 spectators |
| State send | client → server ≤ 20/s; server → clients `w` 20/s while anything moved |

### Weapons (original names)

| id | Name | Kind | Damage | Fire interval | Range | Spread | Ammo: start / pickup / max | Notes |
|---|---|---|---|---|---|---|---|---|
| `pea` | Peashooter | hitscan | 14 | 0.30 s | 40 u | 1.5° | ∞ | everyone always has it |
| `rattler` | Rattler | hitscan | 9 | 0.085 s | 45 u | 4° | 0 / 60 / 180 | automatic |
| `scatter` | Scatter | hitscan × 8 pellets | 7 each | 0.85 s | 16 u | 14° cone | 0 / 8 / 32 | |
| `longshot` | Longshot | hitscan | 85 | 1.4 s | 120 u | 0° | 0 / 5 / 20 | passes through nothing; thin beam trail |
| `thumper` | Thumper | rocket 22 u/s, ≤ 4 s | 90 at centre → 0 at 4 u | 1.0 s | — | 0° | 0 / 4 / 16 | splash also hurts its owner (× 0.5) |

No damage fall-off except the Thumper's linear splash. Friendly fire is off in `tdm` (splash on the owner stays).
Dying drops nothing; a respawn starts with the Peashooter only.

### Pickups

| kind | Effect | Respawn |
|---|---|---|
| `rattler`, `scatter`, `longshot`, `thumper` | gives the weapon (or its pickup ammo when already held) | 15 s |
| `health` | +35 health (not taken at 100) | 20 s |
| `armour` | +50 armour (not taken at 100) | 30 s |
| `surge` | double damage for 20 s (announced to everyone) | 90 s, one per arena, absent in arenas under 30 × 30 u |

Pick-up radius 0.5 u (centre to centre). First claim wins.

## 4. Scene JSON additions (`GET /api/game/sk/scene`)

The RC bake's JSON without `tracks`, plus `arenas` (and the live `lights` / `screens` spliced in as in RC §2.6):

```json
"arenas": [{ "id": "stage", "name": "The Stage", "floor": "stage", "y": 1.42,
  "rect": [minX, minZ, maxX, maxZ],
  "blocks": [{ "x": 1.2, "z": -3.1, "w": 0.06, "d": 0.03, "h": 0.05, "yaw": 0, "c": 3 }],
  "spawns": [{ "x": 0.4, "z": -2.2, "yaw": 1.57, "team": 0 }],
  "pickups": [{ "id": 0, "kind": "rattler", "x": 1.0, "z": -2.0 }] }]
```
- An arena is a rectangle on ONE floor (real metres in the Godot frame, like everything in the scene JSON). Its edge is
  a wall (the client draws a low toy fence). Size 25–80 u per side.
- Solid for soldiers, bullets and rockets inside an arena = blocked cells of that floor's `occ` grid ∪ `blocks` ∪ the
  arena edge. `blocks` are generated toy building blocks (axis-aligned when `yaw` = 0; yaw only 0 or π/2; `c` = colour
  index 0–5; `h` ≥ 0.6 u so they stop bullets) that give cover where the room has none (an empty stage) — both sides
  rasterise them into the same grid: a cell is blocked when its centre lies inside the block's rectangle.
- **At least 3 arenas, at most 8**, deterministic per `rev`: one on the stage when there is a stage floor, the others
  on the hall floor (e.g. "Under the Tables", "Front of House", "The Aisle"), chosen where 8–40 % of the cells are
  blocked after adding blocks. No scene / no stage → generated arenas on the default hall with blocks only.
- Each arena: ≥ 10 spawns (≥ 6 u apart, ≥ 1 u from anything solid; `team` 0 / 1 = the two halves of the arena along its
  longer side, used in `tdm`; in `dm` all are used), every weapon at least once, 2–4 `health`, 1–2 `armour`, `surge`
  as in §3; pickups ≥ 4 u apart and ≥ 3 u from a spawn. All spawns and pickups lie in ONE connected free region for a
  soldier (free cells eroded by the soldier radius). `validateArena` checks every rule; an arena that fails is left out.

## 5. Who decides what

Movement and aiming are simulated in each player's browser (60 Hz, collision against the arena's solid grid — circle
vs blocked cells, slide along walls); the server relays and referees. **Health, armour, ammo, weapons held, kills,
deaths, score, pickups, respawns, teams and the phase machine are the server's.**

- **Hitscan**: the shooter's client traces the shot through the solid grid and against the soldiers as it draws them
  (interpolated), and claims hits. The server accepts a `hit` only when: both are alive; the victim is not spawn
  protected; not the same team in `tdm`; it belongs to a `fire` of that weapon the server accepted ≤ 1.5 s ago and that
  fire has hits left (1, or 8 pellets for `scatter`); the distance between the server's positions of both ≤ range + 3 u;
  and the straight line between those positions crosses no solid cell (shrunk by one cell of tolerance). Damage is
  the server's table (× 2 with `surge`).
- **Rockets**: every client simulates a rocket identically from the `shot` (origin, yaw, `ts`): straight line at 22 u/s
  until it meets a solid cell, the arena edge, a soldier other than its owner (radius 0.18 u + 0.1 u) or 4 s. The
  OWNER's client reports the impact (`boom`); the server checks it lies within 1 u of the fire ray and not farther
  than the rocket could have flown, then applies splash from ITS positions (linear 90 → 0 over 4 u, line of sight
  not required) and announces it. A rocket whose owner never reports expires silently after 4.5 s.
- **Fire**: the server accepts a `fire` when the player is alive, holds the weapon, has ammo and the weapon's interval
  has passed (10 % tolerance), then decrements ammo and broadcasts `shot`. Anything else is dropped silently.
- Positions outside the arena rect + 2 u are ignored; speed above 6 u/s is clamped.

## 6. Phases and modes

`lobby` (warm-up: everyone can run and shoot, pickups work, nothing is scored, deaths respawn at once) → host `start`
→ `countdown` 3 s (frozen at spawns, full reset) → `match` → `results` 15 s (frozen, scoreboard) → `lobby`.
The match ends at the frag limit (default 20; `tdm`: team total, default 40) or the time limit (default 5 min); host
`stop` → `lobby`. `dm`: every player for themselves, score = kills − suicides. `tdm`: red (0) / blue (1), joiners go to
the smaller team, the host may move players; a player's colour is the team colour.
`spot` ("Spotlight", WO-1083, `server/sk-spot.js`): every player for themselves; one pool of light (radius 2.5 u) lies
on a pickup pad and moves to another pad every 40 s (≥ 12 u away when the arena allows; clients warn 5 s ahead). A
soldier alone in it scores a point per full second; two or more inside = contested, nobody scores. Frags do not score
(kills / deaths are still counted); the limit (`limits.frags`) is points, default 60. In the lobby the pool is there,
nothing is scored.

## 7. Socket (JSON text frames; ≤ 2 KB; rate limits as RC)

Client → server:
- `{ "t": "join", "name": "Ola", "color": "#ff5533", "spectator": false }`
- `{ "t": "s", "p": [x, z], "yaw": 1.2, "mv": 1, "w": "rattler" }` — own soldier (yaw = aim; `mv` 0/1 moving; `w` held
  weapon shown). y is the arena's.
- `{ "t": "fire", "w": "rattler", "n": 41, "p": [x, z], "yaw": 1.21 }` — `n` = the client's shot counter.
- `{ "t": "hit", "n": 41, "id": 5, "k": 1 }` — shot `n` hit player 5 (`k` = pellets that hit, 1–8).
- `{ "t": "boom", "n": 42, "p": [x, z] }`
- `{ "t": "pick", "id": 3 }` · `{ "t": "ping", "c": 1 }` · `{ "t": "video", "on": true }` (RC §2.6)

Server → client:
- `{ "t": "welcome", "id": 3, "you": {…}, "state": <state> }` · `{ "t": "full" }` · `{ "t": "off" }`
- `{ "t": "state", "state": <state> }` — lobby / phase / arena / mode / roster / score changes (not per shot)
- `{ "t": "w", "ts": ms, "a": [[id, x, z, yaw, flags], …] }` — flags: 1 moving, 2 dead, 4 protected, 8 surge
- `{ "t": "shot", "id": 3, "w": "rattler", "n": 41, "p": [x, z], "yaw": 1.21, "ts": ms, "seed": 12345 }` — to everyone
  (the shooter too: its ammo is in `me`). Spread is derived from `seed` identically on every client
  (`mulberry32(seed)`, one draw per pellet, uniform in ± spread/2).
- `{ "t": "dmg", "id": 5, "by": 3, "w": "rattler", "hp": 61, "ar": 0 }` — to everyone (hit flash / numbers)
- `{ "t": "kill", "id": 5, "by": 3, "w": "rattler", "at": ms }` — `by` = `id` for a suicide · `{ "t": "spawn", "id": 5, "p": [x, z], "yaw": 0, "until": ms }`
- `{ "t": "boom", "by": 3, "n": 42, "p": [x, z], "ts": ms }`
- `{ "t": "me", "hp": 100, "ar": 0, "w": { "pea": -1, "rattler": 60 }, "surge": 0 }` — to its owner whenever it changes
  (ammo −1 = infinite; `surge` = server ms it ends, 0 = none)
- `{ "t": "pk", "id": 3, "by": 5, "until": ms }` — pickup 3 is gone until then · `{ "t": "countdown", "startAt": ms }`
- `{ "t": "results", "mode": "dm", "order": [{ "id", "name", "team", "kills", "deaths", "score" }], "teams": [r, b], "final": true }`
- `{ "t": "pong", … }`, `lxfull` / `lx` and binary video frames exactly as RC §2.6.

`<state>`: `{ enabled, phase, mode, arenaId, limits: { frags, minutes }, endsAt, bots, maxPlayers,
players: [{ id, name, color, team, bot, connected, kills, deaths, score }], teams: [r, b], pk: [[id, until]],
joinUrls, sceneRev, lights, wall, house, botLevel, spot }` — `botLevel` 'easy'|'normal'|'hard'; `spot` (mode `spot` only,
else null) `{ x, z, r, movesAt, holder: id|null, contested }` in metres / server ms (WO-1083).

## 8. Bots (server)

Host `bots {n}` adds up to 6 server-driven soldiers (named from a fixed list of our own, `bot: true`). They move on the
arena's solid grid (grid path to a goal: a pickup worth it, else the spawn points they passed longest ago — a patrol;
in `spot` the pool unless hurt; re-plan every 2–4 s or when stuck) and obey every limit a player does. No bots → no
bot timer. **A bot never sees farther than a player (WO-1083):** it notices, turns to and fires at only an enemy a
player standing where it stands could see — inside the follow camera's frame (`server/sk-view.js`, a 16:10 view, inner
90 %: ± 4.75 u up / down screen, ± 6.85 u sideways, never past 7.09 u), both ways, with a line crossing no solid cell.
The referee enforces it too: a bot's `hit` needs distance ≤ range (no slack), that view and that line; its splash
spares everyone outside the view. Humanlike aim (`server/sk-bot-aim.js`): a reaction delay per sighting, a turn rate,
fire only within a cone of the target, aim error growing with distance, a lost target is dropped. Host `botlevel`
(`easy` / `normal` / `hard`) changes delay, turn rate and error — never the view.

## 9. Client: look and controls

- **Camera**: above the own soldier, looking down at a pitch of 60–70°, about 14 u up (spectator: the whole arena, or
  cycling players). **The room above 1.2 u over the arena floor is cut away** (a clipping plane on the scene's
  materials only — soldiers, effects, light beams and LED wall pictures are not cut), so play under tables is visible:
  you see the floor, the cut legs, blocks and the fence.
- **Live room**: the light pools and beams of the real rig and the LED wall pictures appear as in the RC game
  (`stage-fx`), with the host switches. In this view the pools on the floor matter most; beams must not hide the play
  (thin / faint, or pools + lens glows only).
- Soldiers: procedural green-army-style toy figures (own design: a base disc, body, helmet, the held weapon visible),
  team / player colour, name tags, a health bar over enemies that were hit recently, muzzle flash, tracers, pellets,
  the Longshot beam, rocket with a smoke trail, explosion ring, hit sparks, a death pop, pickup models that bob and
  spin on a glowing pad, surge glow.
- **Controls** — keyboard + mouse: WASD / arrows move (screen-relative), mouse aims, left button fires (held =
  automatic), 1–5 / wheel / Q switch weapon. Touch (landscape, like RC): left stick moves, right stick aims and fires
  while pushed past 35 %, a weapon-cycle button. Gamepad: left stick move, right stick aim, right trigger fire.
  Auto-switch to a newly picked weapon when it is better than the held one.
- **HUD**: health + armour, weapon + ammo, kill feed, score (own rank and leader in `dm`; team totals in `tdm`), match
  clock, a minimap of the arena (solid cells, pickups, team-mates), "FRAG" / "you were fragged by" banners, respawn
  count-down, the full scoreboard on Tab / a button and in `results`, a full-screen button (kit `fullscreen.js`),
  sound toggle.
- Lobby: join form (name, colour), roster, mode / arena shown, "Warm up" while waiting. Host panel as §2.

## 10. Testing without the live server (the show may be running)

`tools/dev/skirmish-dev-server.js` (server agent): a stand-alone HTTP server on **127.0.0.1:4310** that mounts ONLY the
two modules' routes / static / socket through a small fake module host, reads the active project and the MVR store
read-only for the scene bake, has no API password, enables a session at start (`--arena`, `--mode`, `--bots n`), and
fakes the live lights with a slow moving pattern (`--fake-lights`) — no Caspar, no OSC, no Art-Net socket, no shm
lease, no write outside `~/.highascg/cache/rc-game`. It is the only place the game runs until the lead enables the
module on the box.

## 11. Files and ownership

- Server agent: `modules/toy-skirmish/{module.json,register.js,server/**}`, `tools/dev/skirmish-dev-server.js`,
  `tools/smoke/smoke-wo1081-sk-server-*.test.js`.
- Client agent: `modules/toy-skirmish/client/**`, `tools/smoke/smoke-wo1081-sk-client-*.test.js`.
- Lead only: this note, `tools/ci/offline-test-files-3.js`, `work/OPEN_ISSUES.md`, `work/work-orders/**`,
  `THIRD_PARTY_NOTICES`, `eslint.config.js`, everything under `modules/rc-game/`, and every git operation.
- A side that needs the contract changed says so in its final report (what and why) — it does not silently diverge.

## 12. Clarifications after the server was built (lead, 15.11 — wire format unchanged)

- **Bots and the 10-player cap:** effective bots = min(n, 10 − humans); a joining guest takes a bot's place, which
  comes back when the guest leaves. `state.bots` is the number the host asked for.
- A weapon pickup is refused when the weapon is held at its maximum ammo (as health / armour at 100).
- Server tolerances: pick radius 0.5 u + 0.5 u slack; the speed clamp allows 0.1 s of slack; a `fire` whose `p` lies
  outside the arena rect + 2 u is taken from the server's position.
- Line of sight "shrunk by one cell": a solid cell blocks only when its 4 neighbours are solid too (blocks are ≥ 3
  cells deep, so they still stop shots).
- `state` also carries `startAt` (countdown only) and `spectators` (a count). `endsAt` = the match end during countdown
  and match, the end of the results screen during results, null in the lobby. `team` is null in `dm`. Players keep
  their own `color` in `state` in `tdm`; the client draws the team colour.
- **Block rectangle:** `x`, `z` = its centre; `w` runs along X at `yaw` 0; `yaw` π/2 swaps `w` and `d`. A cell is
  solid when its centre lies inside the closed rectangle.
- Dev server: `node tools/dev/skirmish-dev-server.js [--port 4310] [--arena id] [--mode dm|tdm|spot] [--bots n]
  [--fake-lights] [--empty]`; host actions `POST /api/game/sk/host` without auth; LED wall pictures are off there
  (screens are listed, no video feed).
- **After the client was built (lead):** `w` tuples are `[id, x, z, yaw, flags, weapon]` (the held weapon, so others
  draw it before the first shot). The owner also reports `boom` when its rocket ends its 4 s flight in the open; the
  server accepts it (within reach of the fire ray). `results.order` carries no colour — the client takes it from the
  roster. Own hit claims are made with a locally drawn seed right after `fire` (the server's seed arrives later); the
  server re-checks every claim. The follow camera is 9 u up, not 14 (a soldier was 30 px tall at 720p).
