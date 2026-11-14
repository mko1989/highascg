# WO-1074 — RC car racing game in the show's 3D scene (browser, up to 10 players)

**Area:** web-client, engine
**Status: IN PROGRESS (14.11.26 — version 2 built and run on the box in headless Chrome; never on a real GPU or phone; see "Version 2")**

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
- **On the box, 14.11 19:13–19:20** (server restarted with the game, game enabled through the host API):
  - `/game/rc/`, `/vendor/three/…` 200; scene bake on the live server 3.4 s (382 001 triangles, 7.2 MB, 3.0 MB gzipped
    on the wire), cached in `~/.highascg/cache/rc-game/`.
  - A real browser (headless Chrome 150 with software GL, driven over the DevTools protocol): the player page loaded the
    scene and the stage oval, joined as "Tester" (server state shows the player in slot 0), the host API picked a track
    and started; the page showed the countdown lights, the race started, holding the throttle took the car to 8.85 m/s
    (stage oval) and 9.0 m/s (hall GP, 83 world snapshots relayed to a second, spectator socket). No page errors or
    console warnings. Screenshots looked at: lobby, countdown, in-race view, host panel.
  - NOT done: a phone or touch input, more than one real player, a full lap by a human, frame rate on real hardware
    (software GL gave 12 fps, which says nothing about a phone), sound, the spectator page beyond its first frame.
- After the test: join addresses list the venue network before VPN addresses; two toolbar buttons no longer use emoji.

## Version 2 (14.11.26) — whole-room tracks, arcade driving, items, live lights and LED walls

Owner feedback on v1: the game must never put anything on a screen by itself; tracks through the whole room, "more Mario
kart less simulator"; the game world should show the lights and the LED wall contents.

### Investigation

- v1 hall tracks lay on the hidden sub-floor (y 0). The visible hall floor of this project is y 0.839, the stage 1.42.
- The furnished hall leaves no free loop longer than ~45 m on the floor (277 obstacles), so long tracks need raised
  decks over the tables (contract §2.7).
- A checkpoint right after a high drop is flown over: at the 24 m/s cap a car passes ~2.9 m above it and the client only
  counts a gate within 1.3 m above the road → the bot never finished a lap on the first Rollercoaster bake.
- `video-feed-worker.js` exited right after SIGKILLing its ffmpeg → one zombie ffmpeg under node per feed session
  (found in the box test: 9 after 9 wall sessions; reproduced with a scratch script: old code leaves `Z ffmpeg`, new none).

### What was done

- Contract `work/notes/rc-game-contract.md`: "Version 2", §2.6 (live lights, wall frames), §2.7 (decks).
- Server: ground model + height field (`rc-ground.js`, `rc-scene-height.js`), track planner/builder/validator split
  (`rc-track-{geo,plan,build,deco,room,sky,check,check-deco,check-deck}.js`), items referee (`rc-room-items.js`),
  live lights (`rc-lights.js`, `rc-lights-fk.js`), wall pictures (`rc-video.js`, uses the existing video feed with
  `tier:'game'`), host actions `lights` / `wall`. GENERATOR_VERSION 4, BAKE_VERSION 2.
- Client: arcade physics with drift/boost, rails, items, HUD, touch layout, deck drawing with pillars, stage fx
  (beams, pools, wall textures).
- The game issues no playout command. The only AMCP it causes is the existing read-only SHM lease of the video feed
  (`ADD <ch>-741 SHM` / `REMOVE`), pinned by `smoke-wo1074-rc-live-video`.
- `video-feed-worker.js` / `video-feed-encoder.js`: on stop the worker waits (max 1.5 s) for its ffmpeg children to
  exit before the thread ends.

### Verified

- Offline suite 6407 tests, 6399 pass, 0 fail (152 in the wo1074 smokes); file-lines, unwired exports, lint, format,
  `--no-http` all clean.
- On the box (commit 12a50eea, node restarted, headless Chrome with software GL, 22:01–22:18):
  - bake 3.5 s, scene JSON 101 kB, GLB 7.2 MB / 382 k triangles, 9 tracks (3 deck tracks 117–121 m).
  - Races on the real server: room-over 3 laps (bridge, upper and lower deck), room-leap 3 laps, 3 bots 2 laps. The
    server referee counted every lap within 1 ms of the client and sent final results; standings identical on all pages.
  - All five items granted and used through the server (rocket and pulse hits, slick spins).
  - `lxfull` with 90 fixtures on connect; host `lights` off/on stops/resumes it. The rig was dark, so no `lx` update
    and no lit beam was seen live — NOT proven.
  - Wall frames for `pgm1` (both walls), 480×160 JPEG at ~7.6 fps, live programme picture visible on both walls in
    game; host `wall` off/on stops/resumes within 0.3 s.
  - node CPU (of one core): disabled ~20 %, 1 player + walls ~40 %, walls off ~29 %, 3 players + walls ~41 %.
  - Journal: no play/load/clear from the game; only the SHM lease pairs. After disable: state off, scene 403, WS 4403.
- Zombie fix: scratch repro against `/dev/shm/highascg-visuals` — old worker leaves `Z ffmpeg`, new leaves none. The
  running node still has the old worker (not restarted: the owner was working on the box).

### Open

- Never run on a real GPU or a phone. Headless ran at 4–11 fps.
- `lx` updates and lit beams unproven live (dark rig). Fixture bodies are not drawn.
- Walls fed by a channel of the linked peer box show no picture.
- Cosmetic: join URL shown twice on the spectator lobby; results table over the lap toast; free-roam hint over the
  gantry; gantry text is "STAGE SPRINT" on every track; distant walls speckle (no mipmaps).
