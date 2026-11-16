# RC car game in the previs scene — contract between the server and the browser client (WO-1074)

> **Paths (WO-1076, 15.11):** the game is the opt-in module `modules/rc-game/` — where this note says `src/game/…` read
> `modules/rc-game/server/…`, `src/api/routes-rc-game.js` is `modules/rc-game/server/routes-rc-game.js`, `game/rc/…` is
> `modules/rc-game/client/…`. URLs are unchanged. The core holds no game code; the module registers through `register.js`.

Owner, 14.11.26: "Implement the rc cars game. Generate some different tracks in the 3d scene. 10 players max is
enough." A browser game (laptops and phones) hosted on the box; players race RC cars inside the show's 3D scene.

## Frames and units

Everything the game exchanges is in the **Godot / three.js frame**: metres, right-handed, **Y up**, X = stage left,
**Z = towards the audience** (Z = −upstage). This is the frame of the MVR store's part `xform`s
(12 numbers: basis x, y, z columns, then origin) AFTER the scene's placement (`project.previs.mvr.place`,
`godot/client/features/previs/mvr_model.gd` `placement`: translation (place.x, place.z, −place.y), rotation Ry(−yaw)).
Angles in radians. A car's `yaw` is the rotation about +Y; yaw 0 faces −Z (three.js default forward).

## URLs (all on the box's HTTP port, 4200)

| What | URL | Owner |
|---|---|---|
| Player page | `GET /game/rc/` (static files from repo `game/rc/`) | client |
| Spectator view (for the LED wall / a Caspar HTML layer) | `/game/rc/?spectate=1` | client |
| Host panel (enable, pick track, start / stop, shows the join address) | `/game/rc/?host=1` | client |
| three.js | `/vendor/three/…` (already mounted from node_modules/three; check `vendorDirs` in src/server) | server |
| Game state | `GET /api/game/rc/state` | server |
| Host actions | `POST /api/game/rc/host` `{ action: 'enable'|'disable'|'track'|'start'|'stop'|'laps'|'kick'|'lights'|'wall'|'house'|'bots', … }` (`lights` / `wall` / `house`: §2.6; `bots`: below) | server |
| Scene description | `GET /api/game/rc/scene` | server |
| Scene mesh (one merged GLB) | `GET /api/game/rc/scene.glb` | server |
| Realtime | WebSocket `/api/game/rc/ws` | server |

**The game never puts anything on a screen by itself** (owner, 14.11: "Running the game shouldnt automatically send
the spectators view or scoreboard to the led wall"). No AMCP, no look, no layer, no Caspar channel is touched by enabling,
starting or running it. The spectator view is only a web page; showing it on a wall is a separate, deliberate operator
action (a browser source in a look) that the game code does not perform or offer as a one-click.

The game is **off by default** and does nothing until enabled. While it is disabled: `state` answers
`{ enabled: false }`, `scene`, `scene.glb` and the WS refuse (403 / close 4403), the static page shows "The game is not
running". While enabled, `/game/rc/*` and `/api/game/rc/*` (state, scene, scene.glb, ws — NOT host) are reachable
without the API password (guests' phones); `host` always needs normal API auth when auth is on. Nothing else becomes
public.

## `GET /api/game/rc/state`

```json
{ "enabled": true, "maxPlayers": 10, "phase": "lobby", "trackId": "stage-oval", "laps": 3,
  "players": [{ "id": 3, "name": "Ola", "color": "#ff5533", "ready": true, "connected": true }],
  "joinUrls": ["http://192.168.1.17:4200/game/rc/"], "sceneRev": "405f970d98a2-7" }
```
`phase`: `lobby` | `countdown` | `race` | `results`.

**Bots (WO-1082).** Host `{ action: 'bots', count: 0…9, level?: 'easy'|'normal'|'hard' }` (lobby / results only; 409
during a race; 400 out of range) fills empty seats with server bots: virtual players run by `server/rc-room-bots.js`
with the client's own physics / items / lap code (`client/bot-brain.js`). They join, send `s` / `box` / `use` / `hit`
like a browser and are refereed the same way; a full room takes no more. State: each bot's player entry has
`"bot": true` (set from the server's own virtual socket — a client cannot claim it), and the state carries
`"bots": n, "botLevel": "normal"`. A new level redraws the field. A bot-only race is allowed (attract mode for the
spectator page). The 30 Hz bot timer runs only while bots exist.

## `GET /api/game/rc/scene`

```json
{ "rev": "405f970d98a2-7", "name": "Narvil IDE 11.2026",
  "glb": "/api/game/rc/scene.glb?rev=405f970d98a2-7",
  "bounds": { "min": [-30, -0.5, -60], "max": [30, 12, 20] },
  "floors": [{ "id": "hall", "y": 0, "rect": [minX, minZ, maxX, maxZ] },
             { "id": "stage", "y": 1.42, "rect": [minX, minZ, maxX, maxZ] }],
  "obstacles": [{ "min": [x, y, z], "max": [x, y, z] }],
  "tracks": [ Track, … ] }
```
- `glb`: ONE merged binary glTF of the visible scene, small enough for a phone: ≤ 400 k triangles, geometry ≤ 7.5 MB
  (`MAX_BYTES`) plus textures ≤ 1.5 MB (`TEX_BUDGET`, WO-1082) — ≈ 9 MB in all, ≈ 4.6 MB gzipped on the wire. One
  node / mesh `rc-scene`; flat primitives carry positions only + one material per colour; textured primitives (the
  venue's carpet, parquet, truss …) add TEXCOORD_0 and a named material with a JPEG/PNG `baseColorTexture` (REPEAT
  sampler); one LINES primitive (mode 1) may carry the venue's line work. Fixtures may be left out or drawn as their
  meshes if the budget allows; trusses, stage, risers, floor, walls, LED walls stay. Baked once per `rev` and cached on
  disk under `~/.highascg/cache/rc-game/` (never inside the repo, never under projects/).
- **The venue .glb (WO-1082).** When the project has a Capture venue export (`project.previs.mvr.venue_glb`, the file the
  previs merges), the baker merges it exactly like the previs (`mvr_venue.gd`, WO-1003): objects matched by Capture
  uuid swap their MVR boxes for the .glb meshes (fixtures and bound screens keep their MVR parts), .glb-only meshes are
  extras on their Capture layer (hidden layers / hidden objects stay hidden), layer colours never repaint them. Images
  are shrunk by ffmpeg in a child process (≤ 1024 px, halved until the budget fits); a textured material over 8000
  triangles (Capture writes per-face UVs, so it cannot be welded) is drawn in its picture's mean colour instead. The
  scene JSON reports it as `venue: { file, swapped, extra, extraLayers, textures, textureBytes, flatTextures,
  lineSegments }` and `dropped.venueGlb` (`used` | `missing` | `unreadable`); no .glb → the plain MVR bake. The venue
  file's name, size and mtime are part of `rev`.
- `floors`: the drivable planes. `stage` comes from the tracking stage (`project.previs.tracking.grid`: width, depth,
  x_offset, y_offset, z_offset in the PSN frame — convert) when there is one; `hall` is the scene's ground (y of the
  lowest large horizontal surface, default 0) clipped to the scene's footprint. No scene loaded → a default 30 × 20 m
  hall and no stage, and the client still works (an empty arena).
- `obstacles`: axis-aligned boxes of things a car would hit at car height (0–0.6 m above a floor): truss legs, risers,
  the stage's own sides when driving in the hall. At most 300, merged when they touch. Tracks avoid them.
- A scene with no MVR still returns `tracks`.

### Track

```json
{ "id": "stage-oval", "name": "Stage oval", "floor": "stage", "y": 1.42, "width": 2.2, "closed": true,
  "points": [[x, z], …],            // centre line, 60–200 points, evenly spaced, closed loop (last ≠ first)
  "length": 48.3,
  "checkpoints": [0, 15, 30, 45],   // indices into points, in driving order; [0] is the start / finish line
  "grid": [{ "x": 1.2, "z": -3.4, "yaw": 1.57 }, … 10 slots ] }
```
At least **four different tracks** generated from the scene (deterministic for a given `rev`): e.g. an oval on the
stage, a figure-eight on the stage, a long loop around the hall floor, a slalom / chicane course that weaves between
obstacles. Each must be drivable: centre line inside its floor rect with `width/2` clearance, no obstacle within
`width/2`, minimum turn radius ≥ 1.2 m, no self-intersection except a figure-eight's single crossing. When a floor is
too small or missing, that track is left out (never an invalid one); at least two tracks always exist.

## WebSocket `/api/game/rc/ws` (JSON text frames)

Client → server:
- `{ "t": "join", "name": "Ola", "color": "#ff5533", "spectator": false }` → server answers `welcome` or `full`.
  Name ≤ 16 chars, stripped of control characters; colour `#rrggbb`. Spectators do not count towards the 10.
- `{ "t": "ready", "ready": true }`
- `{ "t": "s", "p": [x, y, z], "yaw": 1.2, "v": 4.1, "st": 0.3, "cp": 2, "lap": 1 }` — own car state, ≤ 20 per second
  (the server drops faster ones). `cp` = index (into `checkpoints`) of the last checkpoint passed in order, `lap` =
  completed laps.
- `{ "t": "ping", "c": 123 }` → `{ "t": "pong", "c": 123, "s": <server ms> }`

Server → client:
- `{ "t": "welcome", "id": 3, "state": <state>, "you": { "id": 3, "name": "Ola", "color": "#ff5533", "slot": 2 } }`
- `{ "t": "full" }` (10 players already) · `{ "t": "off" }` (game disabled; socket closes)
- `{ "t": "state", "state": <state> }` — on any lobby / phase / track change
- `{ "t": "w", "ts": <server ms>, "cars": [[id, x, y, z, yaw, v, st], …] }` — everyone's last state, 15 per second,
  only while at least one car moved
- `{ "t": "countdown", "startAt": <server ms> }` — cars are frozen on the grid until `startAt`
- `{ "t": "lap", "id": 3, "lap": 1, "ms": 23456, "best": 23456 }`
- `{ "t": "results", "order": [{ "id": 3, "name": "Ola", "totalMs": 71234, "bestMs": 23011, "laps": 3 }], "final": true }`

Rules the server owns: max 10 players; the phase machine (host `start` → `countdown` 5 s → `race` → `results` when the
first car finishes `laps` laps + 20 s grace or everyone finished; host `stop` → `lobby`); lap counting from the
reported `cp` / `lap` with sanity checks (checkpoints in order, a lap never faster than `track.length / 20 m/s`);
dropping a silent player after 10 s; clamping absurd positions (outside `bounds` + 5 m → ignored). Physics runs in
each player's browser (client-authoritative, it is a party game); the server only relays and referees.

## Car (client; numbers the server's sanity checks may assume)

RC car ≈ 0.45 m long, 0.25 m wide. Top speed ≈ 9 m/s on track, ≈ 4 m/s off the track surface (outside `width/2`),
never above 12 m/s. Cars stay on their track's floor plane (`track.y`); obstacles and floor edges stop them.
Car-to-car contact is a soft push computed locally.

## Controls (client)

Keyboard: arrows / WASD, space = brake, R = back to the last checkpoint. Touch: left thumb steers (horizontal
slider / stick), right thumb gas and brake pedals; works in landscape on a phone, no page scroll or zoom, no text
selection. Gamepad when present.

## Files

- Server: `src/game/rc-*.js`, `src/api/routes-rc-game.js`, the wiring in `src/server/` and `src/api/router.js`,
  `tools/smoke/smoke-wo1074-rc-server*.test.js`.
- Client: everything under `game/rc/` (plain ES modules, no build step, three.js from `/vendor/three/`),
  `tools/smoke/smoke-wo1074-rc-client*.test.js` for its pure modules (physics, track maths, interpolation).
- Neither side edits the other's files. `tools/ci/offline-test-files-3.js`, `work/OPEN_ISSUES.md`,
  `work/work-orders/` are edited by the lead only.

---

# Version 2 (owner, 14.11.26 evening): "The tracks shouldn't only be on stage but rather thru whole room. More Mario kart less simulator."

Version 2 REPLACES the v1 text above wherever they differ. It is an arcade kart racer in the genre sense only: all
names, items, looks and sounds are our own — nothing is copied from an existing game.

## 2.1 Tracks run through the whole room, in 3D

```json
{ "id": "room-grand-tour", "name": "Grand tour", "floor": "room", "width": 4,
  "points": [[x, y, z], …],          // 3D centre line; y = height of the driving surface at that point
  "length": 142.5, "closed": true,
  "ramps":  [{ "from": 31, "to": 44 }],   // point index ranges where the ribbon is a built ramp above the floor below
  "drops":  [{ "at": 80, "land": 86 }],   // the ribbon ends at a ledge (stage edge / ramp lip) and resumes at `land`
  "pads":   [{ "x": 1, "y": 0, "z": 2, "yaw": 0.3 }],              // boost pads lying on the ribbon
  "boxes":  [{ "id": 0, "x": 1, "y": 0.5, "z": 2 }, …],            // item boxes, in rows of 3–4 across the ribbon
  "checkpoints": [0, 20, 44, 86, 120], "grid": [{ "x": 0, "y": 0, "z": 0, "yaw": 0 }, … 10] }
```
- `points` are `[x, y, z]` (v1's `[x, z]` and `track.y` are gone); `grid` slots carry `y`.
- **At least three "room" tracks** use BOTH the hall floor and the stage: up onto the stage by a ramp, across it, and
  off again by a second ramp or a drop off the stage edge. Plus at least one hall-only and, where it fits, one short
  stage-only track. Still deterministic per `rev`, still validated, a track that cannot be built is left out, at least
  two tracks always exist (no stage → hall tracks get ramps over a generated bridge / table-top jump instead).
- Ramps are generated geometry (not in the scene model): slope ≤ 18°, straight in plan or gently curved (radius ≥ 8 m),
  as wide as the track, smooth entry/exit (no kink above 6° between consecutive segments). The client draws them with
  side skirts down to the floor.
- Drops only go DOWN (ledge → lower floor), `land` is 3–8 m beyond `at` along the driving direction and at least one
  track width clear of obstacles, so any speed lands safely. No gap needs a minimum speed.
- Width: ≥ 4 m in the hall, ≥ 2.5 m on the stage; `width` is the single value the track is drawn and judged with (the
  generator picks the largest that fits everywhere on that track, never below 2.5).
- Min turn radius ≥ 3 m in the hall, ≥ 1.8 m on the stage. 2–4 boost pads and 2–3 box rows per track, never on a ramp
  crest, a drop or within 6 m of the start line.
- `validateTrack` checks all of it (3D), including that every point of a non-ramp section lies on the ground model
  below (|y − ground| ≤ 0.02) and that ramp points are above it.

### Ground model (server validator and client physics MUST agree)

`ground(x, z)` = the highest of: the hall floor's `y` (inside its rect); the stage floor's `y` (inside its rect); the
surface of any ramp of the ACTIVE track whose ribbon footprint contains (x, z). Outside every floor rect there is no
ground (the hall rect's edge is a wall). A car is *grounded* when its y ≤ ground + 0.02. Moving horizontally into
ground more than 0.3 m above the car's y is a wall (stage side, ramp skirt); lower ground ahead means the car drives
off and falls. `obstacles` boxes only collide when their [min.y, max.y] overlaps [car.y, car.y + 0.5].

## 2.2 Arcade handling (client physics, fixed 60 Hz)

- Top speed 13 m/s on the ribbon, 7 m/s off it, 18 m/s while boosting, hard cap 24 m/s. Brisk acceleration
  (0 → top in ≈ 1.6 s), strong grip, wide steering lock at speed — easy to drive flat out with a thumb.
- **Drift**: hold Drift (Shift / Space / touch button / gamepad shoulder) while steering above 6 m/s → a small hop, then
  the car slides at a held angle with tighter turning; charge builds in two stages (sparks change colour at 0.7 s and
  1.6 s); releasing gives a mini-boost of 0.6 s / 1.3 s. Brake is its own control (S / Down / pedal).
- **Boost** sources: mini-boost, pads (1.0 s), the Turbo item (1.5 s), a start boost for pressing throttle within
  the last 0.35 s of the countdown (too early = a 1 s stall).
- Gravity 20 m/s², cars fly off ramps and ledges, land with a squash; air steering is slight.
- Walls and obstacles bounce (restitution ≈ 0.4) instead of stopping dead; car-to-car bumps are springy.
- **Spin-out** (hit by an item): 1.2 s uncontrolled spin, speed × 0.3, then 2 s of blinking immunity.
- Catch-up: top speed + 0…8 % by race position (last place gets the most). Never for the leader.

## 2.3 Items (original names and looks)

| Item | Effect |
|---|---|
| `turbo` | boost 1.5 s |
| `slick` | drops a puddle behind the car for 25 s; driving over it = spin-out |
| `rocket` | flies forward along the track's centre line at 26 m/s for ≤ 5 s; first car within 1.2 m (not the owner in the first 0.5 s) spins out |
| `pulse` | instant ring, radius 7 m: every other car inside spins out |
| `shield` | 8 s bubble; absorbs one hit |

One item held at a time; Use = E / Ctrl / touch button / gamepad face button. A box gives a 1 s roulette then the item.
Boxes respawn 6 s after being taken.

## 2.4 Realtime additions (same socket, same framing as v1)

Client → server:
- `{ "t": "box", "id": 4 }` — I drove through box 4.
- `{ "t": "use", "item": "slick", "p": [x, y, z], "yaw": 1.2 }` — I used my held item.
- `{ "t": "hit", "hid": 17 }` — hazard 17 hit me (I am spinning out) · `{ "t": "hit", "by": 3, "item": "pulse" }`
- `s` gains `"fx"`: bit flags (1 boosting, 2 drifting, 4 spinning, 8 shielded, 16 airborne) so others can draw it:
  `{ "t": "s", "p": […], "yaw": …, "v": …, "st": …, "cp": …, "lap": …, "fx": 3 }`

Server → client:
- `{ "t": "box", "id": 4, "by": 3, "until": <server ms> }` — box 4 is gone until then (first claim wins).
- `{ "t": "item", "item": "rocket" }` — to the claimer only; the server rolls it by race position (leaders mostly
  `slick` / `shield`, the back of the field mostly `turbo` / `rocket` / `pulse`). The server remembers the held item
  and ignores a `use` of anything else.
- `{ "t": "haz", "hid": 17, "kind": "slick"|"rocket", "by": 3, "p": [x, y, z], "yaw": 1.2, "ts": <server ms>, "until": <server ms> }`
  — a hazard exists (every client simulates a rocket identically from `p`, `yaw`, `ts` along the centre line).
- `{ "t": "hazgone", "hid": 17, "hit": 5 }` — removed (expired: `hit` null).
- `{ "t": "fx", "id": 3, "k": "pulse"|"turbo"|"shield"|"spin", "p": [x, y, z], "ts": <server ms> }` — one-shot effects
  for everyone (`pulse`: each client checks its own car against the 7 m radius and reports `hit`).
- `w` cars become `[id, x, y, z, yaw, v, st, fx]`.
- `welcome` and `state` carry `"boxes": [[id, until]]` and `"hazards": [haz…]` so a late joiner sees them; both are
  cleared when a race starts and when it ends.

Server sanity: `v` clamped to ±24; a lap never faster than `track.length / 24`; ≤ 5 `use` and ≤ 10 `box` per second
per player; a `hit` on a hazard that is gone is ignored; at most 40 hazards alive (oldest dropped). Items exist in the
lobby free-roam too (so people can try them) but nothing is scored there.

## 2.5 Look and feel (client)

Bright, toy-like, readable from a phone: saturated kerbs, glowing boost pads with moving chevrons, floating spinning
item boxes with a "?"-free own symbol (e.g. a star-burst cube), drift sparks, boost flames + a field-of-view kick,
speed lines, squash-and-stretch on landings, a bubble for the shield, a comic "POW" ring for the pulse, confetti for
the winner, position shown big ("3rd"), a lap banner, an item slot with roulette. Touch layout: steer left; right
side = big Go pedal, Brake, Drift, Item. All procedural — no asset files, no fonts, no audio files (WebAudio blips).

## 2.6 Live show in the game world: lights and LED wall pictures (owner, 14.11: "In the Game World the visualizer should work if possible, showing lights and led wall contents.")

Built as NEW files only (wired in by the lead after v2 lands): server `src/game/rc-lights.js`, `src/game/rc-video.js`;
client `game/rc/stage-fx.js` (+ helpers `game/rc/stage-fx-*.js`). Both features cost nothing while the game is disabled
or nobody is connected, and each can be switched off by the host (`host` actions `{action:'lights', on}` and
`{action:'wall', on}`; state carries `"lights": true, "wall": true`; default both on). WO-1099 house lights:
`{action:'house', level}` (a SLIDER: `level` a number 0..1, clamped, 400 for a non-number / NaN; `on` true/false kept = 1 / 0;
state `"house": 1`, a number, default 1; only state, survives disable/enable — every client dims its own room by the curve
g = level^2.2: lights × (0.3 + 0.7 g), room colours × (0.1 + 0.9 g), glow × g, background lerped near-black → lit by g, so 0
is the old "off" and 1 the old "on" exactly; a boolean `house` from an older server = 1 / 0. Host page: label + range 0–100 +
"%", throttled ~100 ms + once on change, label click toggles 0 ↔ last level; the rig, the walls and the game's objects
untouched — `game/rc/house.js` through `world.setHouse`, applied from `welcome` / `state` via stage-fx `onHouse`).

**Scene JSON additions**
```json
"lights":  [{ "i": 0, "id": "mvr-…", "name": "MAC Quantum Profile 1", "p": [x, y, z], "kind": "spot"|"wash"|"bar"|"strobe" }],
"screens": [{ "id": "led_wall_1", "role": "pgm1", "p": [x, y, z], "rot": [rxDeg, ryDeg, rzDeg], "size": [wM, hM],
              "curveDeg": 0, "cols": 14, "uv": [u0, v0, u1, v1] }]
```
`lights` = the patched, typed fixtures the previs draws. `p` = the head's TILT PIVOT in the Godot frame (not the raw
patch pose point: for a hanging moving head that is the yoke top, and the beam starts lower, at the tilt axis — the
yoke length of its GDTF); the beam from `p` along `d` passes the follow target within millimetres. For a head without a
tilt axis `p` is its mean beam origin.
`screens` = the project's LED walls (`project.previs.stage.objects` of type `led_wall`: `p` = the picture CENTRE — a previs wall's
`position` is its BOTTOM-centre (stage_builder.gd / mvr-export.js), so `p` = `position` + R·(0, h/2, 0) — `rotation`
degrees (Godot YXZ), `cols` = the panel column count (a curved wall bends per column), size =
panels × panel_mm, `source.role` + `source.rect` normalised by that role's raster → `uv`, v down) and MVR objects
mapped as screens where the project has them. The baked GLB keeps showing the wall bodies; the client lays a textured
quad 2 cm in front.

**Lights, realtime** (same socket):
- `{ "t": "lxfull", "ts": …, "on": true, "rev": "…", "lights": [ …as in the scene JSON… ], "f": [[i, dx, dy, dz, r, g, b, a, zoomDeg], …] }`
  when a socket connects and whenever lights are switched on (and when the patch changed); `{ "t": "lxfull", "on": false,
  "rev": "…", "f": [] }` when they are switched off. `lights` + `rev` ride along because the patch can change while the
  scene JSON stays cached: the client takes the newer list.
- `{ "t": "lx", "ts": …, "f": [[i, dx, dy, dz, r, g, b, a, zoomDeg], …] }` — only fixtures that changed, at most 10 per
  second, nothing while nothing changes.
`d` = unit beam direction in the Godot frame (the server computes it with the same decoding the previs uses:
`follow-service.js` `visual()` → axes + beams, the fixture's pose and its GDTF geometry chain); `r g b` 0–1; `a` =
intensity 0–1 (0 = dark); a multi-beam head is ONE entry (mean colour, max intensity, widest zoom). At most 150 lights.
The client draws additive cones (length to the first floor below, capped 25 m), a soft pool where they land and a
lens glow; nothing when `a` = 0. Quality "low" draws pools and lens glows only.

**LED wall pictures, realtime**: the client sends `{ "t": "video", "on": true }`; the server then sends BINARY frames
on the same socket: `[u8 n][n bytes role, ASCII][JPEG]` (the existing video feed's framing, `src/system/video-feed.js`),
width 480 px, ≤ 8 frames per second, one encoder per role shared by all game clients (reuse the video-feed worker /
encoder; lease the role's video surface like the feed does and release it when the last subscriber leaves), frames
skipped for a client that is behind. Only roles named in `screens`. The client decodes with `createImageBitmap` into
one texture per role and maps each screen's `uv`.

**Limits**: this shows the programme picture and the lighting state to every guest who has the game open — that is
the point, and it is why both have a host switch. It still never puts anything on a screen.

## 2.7 Whole-room tracks over a furnished hall: elevated decks (lead, 14.11 night)

The live hall floor (y 0.839) is full of banquet tables (277 obstacles), so v2's floor-bound generator only found
34–45 m laps in front of the stage. The owner asked for tracks "thru whole room". A track may therefore run on a
**built, elevated roadway** above the furniture:

- Track field `"decks": [{ "from": i, "to": j }]` — point ranges where the ribbon is a raised deck. In the ground model
  a deck is exactly a ramp range (same surface rule, same footprint rule), so `ramps` semantics apply to physics
  height; `decks` only adds: (a) **rails** — a car on a deck range cannot leave the ribbon sideways (it bounces off the
  edge like a wall, both sides, for the whole range; the open ends are the ramps that lead on and off), and (b) the
  look — a slab on pillars with low glowing rails, no skirts to the floor (a ramp keeps its skirts).
  A deck range is always entered and left through ramp ranges or directly from / onto the stage or a drop.
- Deck height: flat, at least 0.6 m above the highest thing beneath its footprint and at least 1.0 m clear below
  anything above it (trusses, hanging objects, balconies — checked against the scene geometry, not only the car-height
  obstacle list); typically 1.6–3 m above the hall floor. Different decks may have different heights; a deck may be
  level with the stage and join it without a ramp.
- **Lengths and coverage**: at least two tracks ≥ 120 m (or ≥ 2.2 × the hall's longer side if the hall is smaller) that
  reach both ends of the hall — the centre line's extent must cover ≥ 70 % of the hall rect's longer side and ≥ 50 % of
  its shorter side — and still visit the stage. Keep the short stage tracks too (party games want a 20-second lap as
  well). Width ≥ 4 m on decks. Decks may cross OVER other parts of the same track (a bridge): plan-view crossings are
  allowed when the two ribbons are ≥ 1.2 m apart in height at the crossing.
- Pads and boxes are allowed on decks (not on ramps). Drops off a deck end are allowed onto clear floor or stage as in
  2.1. `validateTrack` covers all of this; the client draws decks and applies rails.

## 3. Toy scale (owner, 14.11 night: "The cars and tracks should be at least 10x smaller. I'm talking like toys in the room.")

The room stays life-size; the cars, tracks and everything the game adds shrink. One number carries it:

- Scene JSON gains **`"scale": 0.1`** (server constant `RC_SCALE` in `src/game/rc-scale.js`; the live value is 0.1).
  A client that gets no `scale` uses 1 (the v2 sizes) — existing fixtures and smokes at scale 1 stay valid.
- **Everything with a length scales by `scale`, times and angles do not.** That is: every PHYS length, speed and
  acceleration incl. gravity, STICK, RADIUS, CAR_GAP, CAR_H, PROBE, pad size, unstick step, TURN_R; ground-model
  tolerances (0.02, 0.3 wall step, END_TOL, rail heights and the gate window −1.0/+1.3); car, item, pad, box, gantry,
  rail, kerb, pillar, fx and shadow sizes; camera distances, heights, near plane and the director's framing; item
  ranges and speeds (rocket, pulse radius, slick size); server sanity limits (speed cap, teleport distance, box/pad
  pick-up radius). Yaw rates, steer rates, durations, lap counts, fps stay. So a car at scale 0.1 drives exactly as the
  v2 car does, seen from a chase camera ten times closer: top speed 1.3 m/s, hard cap 2.4 m/s, car ≈ 6 × 3.5 cm,
  gravity 2 m/s².
- The HUD shows speed ÷ scale (the "toy km/h" reads like v2).
- Wire: positions and velocities must keep ≥ 3 significant digits at this scale (round to 1 mm / 1 mm/s or finer;
  check every rounding in protocol.js / rc-sanitize.js / rc-room.js).

### Tracks at toy scale
- Width 0.30–0.45 m. Turn radius ≥ 0.3 m on the floor, ≥ 0.18 m on the stage. All v2 / §2.7 rules hold with their
  lengths × scale (ramp slope stays ≤ 18°, kink ≤ 6°).
- The hall is now a landscape: cars drive **under** tables and chairs, between their legs, along walls, around truss
  bases, up a ramp onto the stage (0.58 m above the hall floor here = a long ramp at 18°) and off its edge.
- At least 8 tracks, deterministic per `rev`, a mix:
  - 2–3 short (4–10 m, on the stage or one corner of the hall),
  - 3–4 medium (12–30 m: e.g. under a table row and back, around the stage front, stage + hall with ramp and drop,
    one with a small bridge on decks 0.1–0.4 m high),
  - 1–2 long tours (≥ 60 m) that visit both ends of the hall and the stage; they carry `"laps": 1` as a suggested lap
    count (host default when picked), others `"laps": 3`.
- `points` spacing ≈ 0.5 × width or finer on curves; a track may have up to 2500 points. The client must not assume
  ≤ 200 (minimap, mesh, nearest-point search need to stay fast — use the existing segment grid / windowed search).

### Obstacles at toy height
- What blocks a toy is only what crosses the band **floor … floor + 0.06 m** (CAR_H × scale + margin): legs, bases,
  walls, the stage side, risers. A table top is a roof, not an obstacle. Boxes cannot describe hundreds of thin legs,
  so the scene gains an occupancy grid per floor and `obstacles` becomes a coarse summary (may be empty):
  ```json
  "occ": [{ "floor": "hall", "y": 0.839, "x0": -13.5, "z0": -2.0, "cell": 0.03, "w": 904, "h": 2054,
            "rle": [120, 3, 899, 2, …] }]
  ```
  Row-major, z rows from `z0`, x from `x0`; `rle` = run lengths alternating FREE, BLOCKED, FREE … (starts with free,
  a leading 0 when the first cell is blocked); cell (i, j) covers x0 + i·cell … +cell, z0 + j·cell … +cell.
  Blocked = a drawn triangle crosses that cell inside the band, dilated by nothing (the client adds the car radius).
  **Flat decor (WO-1082):** the band starts at `FLAT_DECOR` (0.3) × scale above the floor (3 cm live; it was 5 mm) and
  a triangle whose top stays below that is skipped — carpets, rugs, floor graphics, skirting feet are driven over, not
  around (v2's ground rule: a step ≤ 0.3 u is driven over); a 10 cm step, a leg, a wall still block.
- Collision (client physics, and the validator for track clearance): a car whose y is within [floor.y − 0.02·s,
  floor.y + CAR_H·s] collides with blocked cells of that floor's grid like a wall (normal from the grid gradient /
  nearest free direction; same restitution and scrape as a wall). Cars on a ramp or deck above the band ignore it.
- A track's ribbon keeps ≥ width/2 + 1 cell clear of blocked cells (except under its own decks' pillars: none allowed
  on a blocked cell).
- If the model has no legs (tables drawn as solid blocks down to the floor), those cells are simply blocked — the
  generator routes around them. Report which it is for the live scene.

### 3.1 Tunnels through tables (owner, 14.11 night: "tables to the ground, this is a perfect place for occasional tunnel")

- A **tunnel** is a stretch of ribbon that passes through a table-like blocked blob of the hall grid: a connected
  blocked component that is compact (bounding box 0.8–3.5 m each way, not a wall, not the stage side, not touching the
  hall edge) and has a roof (height field ≥ 0.3 m above the floor over it). Chairs around a table count as part of it
  when they touch.
- Track JSON gains `"tunnels": [{ "from": 120, "to": 171 }]` (point index ranges, in driving order; absent = none).
- **Carving** (validator and client physics MUST agree): for the ACTIVE track, every occupancy cell whose centre is
  within `width/2 + 1 cell` of the centre line between `from` and `to` is FREE; everything else stays as in `occ`. So
  inside a tunnel the corridor walls are the remaining blocked cells — a car cannot leave the ribbon there.
- Rules: level floor (no ramp, deck or drop inside or within 2 widths of a portal); plan radius ≥ 2 × the track's
  minimum; both portals open onto ≥ 2 widths of free straight; tunnel length 0.6–4 m; no pad, box row, checkpoint,
  grid slot or start line inside or within 1 width of a portal; a tunnel never crosses another part of the same track.
- "Occasional": at most 3 tunnels per track; on the live hall at least 2 tracks have one (a medium hall track and a
  long tour), and at least 3 tracks have none. No suitable blob → no tunnels, never an invalid track.
- Client look: an arch portal at each end and a dark tube inside (walls + ceiling, height ≈ 0.75 × width, a row of
  small glowing lights), all game geometry × scale, hiding the table's own faces. The chase camera stays inside the
  tube (treat the tube ceiling like a deck underside). Spectator / top cameras cannot see a car in a tunnel: its name
  tag stays visible and the director picks a portal or chase shot. The minimap draws tunnel stretches dashed.
- **Refinement (lead, 15.11: "the track disappears into the tablecloth of a round table and comes out the other
  side")**. Generator: each corridor runs through the MIDDLE of a table top (a field region whose underside is
  0.6–1.2 m above the floor; the line passes ≤ 25 % of the table's radius off its centre); the portals sit where the
  tube enters the furniture (the carve's round end cap frees the cloth there); one table carries at most one track's
  tunnel (no two tracks share a table); a long tour may take 2–3. Validator (and measure lib): ≥ 85 % of the tube's
  centre line under a roof (height field ≥ 0.3 m above the floor) and ≤ 0.15 m of it in the open (neither a blocked
  cell of the uncarved grid nor roofed) at each end; the portal free-floor check reads the CARVED grid. Relaxed on the
  live hall (every round table is ringed by chairs with floor-length covers, 10–25 cm apart): the generator asks only
  ≥ 50 % of the line under the table top itself (the rest runs under the chair seats, which count as a roof; best
  measured 0.52–0.56), and lines enter through a chair rather than between two (a line between chairs leaves > 0.15 m
  in the open). Client: no outer shell — the tube is drawn from furniture face to furniture face (the uncarved grid
  under its cross-section), a dark cloth-neutral collar (0.5 × scale) behind each striped arch; the scene cut reaches
  0.04 × scale past the inner walls. The director's toy-scale overview frames 30 × scale around the lead car.
