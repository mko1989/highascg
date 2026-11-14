# WO-1074 — RC car racing game in the show's 3D scene (browser, up to 10 players)

**Area:** web-client, engine
**Status: IN PROGRESS (14.11.26 — built, offline suite green; see "Verified" for what ran on the box)**

Owner, 14.11: *"Is it possible to host on the box some kind of a game for instance rc car racers … played inside the
previs scene … a browser game both for laptops and mobile."* → *"Implement the rc cars game. Generate some different
tracks in the 3d scene. 10 players max is enough."* → *"Running the game shouldnt automatically send the spectators
view or scoreboard to the led wall in the room."*

## Investigation

- The box already serves pages and WebSockets on :4200 (`src/server/http-server.js`, `ws-server.js`), has three.js
  0.185 in node_modules (mounted at `/vendor/three/` only with the previs module, `src/bootstrap/modules.js`), and keeps
  the show's scene as parsed MVR objects with per-part Godot-frame transforms (`src/stage/mvr-store.js`,
  `/api/stage/mvr/<id>`: 3392 objects for "Narvil IDE 11.2026"). That is too many requests / triangles for a phone, so
  the game gets one merged, simplified GLB.
- Auth: API paths are checked by `src/server/auth.js` `isPublicApiPath`; static paths are not authenticated at all.
- No QR library is installed (`qrcode` absent) — the host panel prints the join address.
- The spec both halves were built against: `work/notes/rc-game-contract.md`.

## What was done

- **Server** (`src/game/rc-*.js`, `src/api/routes-rc-game.js`): room (10 players, spectators uncounted, lobby →
  countdown → race → results, lap referee, kick, timeouts), track generator with a validator (oval, loop, figure-eight,
  slalom, GP in the free space of each floor; a track that does not fit is left out), scene builder (the MVR as the
  previs shows it + tracking stage + stage objects → floors, ≤ 300 obstacles, one flat-colour GLB within 8 MB / 400 k
  triangles, baked async and cached in `~/.highascg/cache/rc-game/`), WebSocket `/api/game/rc/ws`, static `/game/rc/*`
  and `/vendor/three/*`. Off by default, in memory only; disabled it holds nothing and runs no timer.
- **Client** (`game/rc/`, plain ES modules): player page, `?spectate=1`, `?host=1`; arcade car physics at a fixed 60 Hz,
  keyboard / touch / gamepad, snapshot interpolation of the other cars, HUD, lobby, results.
- **Never on a screen by itself:** no AMCP, look, layer or channel code in the game (smoke-enforced on both halves); the
  host panel has no output control. Public while enabled: only `GET /api/game/rc/state|scene|scene.glb`, the game WS and
  the static pages; `POST /api/game/rc/host` keeps normal auth.
- Built by two agents in parallel against the contract; the lead reconciled the wire formats and tested on the box.

## Verified

- Offline: 8 smokes `smoke-wo1074-rc-*` (71 tests) in the curated list; suite 6318 pass, 0 fail; line limit, unwired
  exports, lint, format, `--no-http` clean.
- Live-project bake in a throwaway process: 382 001 triangles, 7.2 MB (3.0 MB gzipped), ~2.1 s; 6 tracks (stage oval
  27 m, stage slalom 23 m, hall loop 120 m, hall slalom 91 m, hall GP 93 m, hall figure-eight 124 m).
