# RC car game in the previs scene — contract between the server and the browser client (WO-1074)

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
| Host actions | `POST /api/game/rc/host` `{ action: 'enable'|'disable'|'track'|'start'|'stop'|'laps'|'kick', … }` | server |
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
- `glb`: ONE merged binary glTF of the visible scene, small enough for a phone: target ≤ 8 MB and ≤ 400 k triangles;
  positions only + per-object flat colour (vertex colours or a few materials), no textures. Fixtures may be left out or
  drawn as their meshes if the budget allows; trusses, stage, risers, floor, walls, LED walls stay. Baked once per
  `rev` and cached on disk under the OS temp dir / `~/.highascg/cache` (never inside the repo, never under projects/).
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
