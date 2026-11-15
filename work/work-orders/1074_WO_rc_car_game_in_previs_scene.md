# WO-1074 — RC car racing game in the show's 3D scene (browser, up to 10 players)

**Area:** web-client, engine
**Status: IN PROGRESS (15.11.26 — toy scale, tunnels, module and QR code run on the box in headless Chrome; never on a real GPU or phone)**

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
- No QR library was installed at first (`qrcode` absent) — the host panel printed the join address only. Added 15.11, see "QR code" below.
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

## Toy scale (14.11.26 night) — "The cars and tracks should be at least 10x smaller. I'm talking like toys in the room."

### Investigation

- Every size in v2 was a literal (PHYS, generator, referee, cameras); the room model is life-size.
- In the live model the round tables have cloths down to the floor and the chairs are solid: in the toy height band
  (floor … +0.06 m) they are solid footprints, no legs. Cars route through the aisles. (A synthetic hall with legged
  tables proves the under-table path.)
- 300 boxes cannot describe that at 3 cm detail → occupancy grid per floor.

### What was done

- Contract §3. One number: scene JSON `scale` (server `RC_SCALE` = 0.1 in `src/game/rc-scale.js`); the client derives
  everything from it in `game/rc/scale.js` (`physFor`): lengths, speeds, accelerations incl. gravity × scale; times
  and angles unchanged. No `scale` → 1, the v2 sizes (old fixtures stay valid).
- Server: occupancy grids `occ` (RLE, 3 cm cells; `rc-scene-occ.js`, `rc-track-check-occ.js`), toy track planner
  (`rc-toy-{plan,route,tracks}.js`), referee limits × scale, track `laps` hint. GENERATOR_VERSION 5, BAKE_VERSION 4.
- Client: scaled physics, models, fx, cameras (near plane follows the shot), grid collision (`occ.js`), segment grid
  for 2500-point tracks (`seg-grid.js`), HUD speed ÷ scale, host follows a track's `laps`.

### Verified (offline only — show on, server NOT restarted, live server still runs full-size v2)

- Offline suite 6446 tests, 6438 pass, 0 fail (wo1074 smokes incl. 4 new toy files); all gates clean.
- Live project baked at 0.1 from the project files: 10 tracks — 8.8–28 m short/medium (stage oval, stage GP, table
  weave, toy bridge on a 0.18 m deck, ramp onto the stage and drop off it) and two 131–135 m tours of the whole hall
  (1 lap). Bake 5.9 s, scene JSON 400 kB (123 kB gzipped), occ 138 kB.
- Bot with the real client physics and the live occupancy grid laps all 10 tracks: 7–24 s per lap on the short and
  medium ones, ≈ 105 s on the tours; no wall hits.
- Headless Chrome against a mock serving that bake: toy car and track among life-size tables (screenshots in the
  session scratchpad).

### Open

- Not run against the real server (referee at toy scale, bake inside the service), a real GPU or a phone.
- Cameras can still pass through room objects taller than the toy band (table tops, chairs seen from the top camera).
- The second tour (drop exit) does not build on the synthetic solid hall; cause not found (it builds on the live hall).

## Tunnels and the move into a module (15.11.26)

- Tunnels through tables (contract §3.1): `rc-toy-blobs.js`, `rc-toy-tunnel.js`, `rc-track-check-tunnel.js`, client
  `tunnel.js`, `track-tunnel.js`, `tunnel-cut.js`. Live hall: 11 tracks, `hall-tunnel` (22 m) and the long tour each
  with one 2.8–2.9 m tunnel; 96 of 221 blobs are tunnel-able. Bot laps all 11, 0 wall hits. Open: the live tunnels
  clip the chair ring and the table edge instead of the middle of a table; both use the same table.
- The game now lives in `modules/rc-game/` as an opt-in module — see WO-1076. All paths in the sections above are the
  old ones (`src/game` = `modules/rc-game/server`, `game/rc` = `modules/rc-game/client`).
- Tunnel refinement (15.11): tunnels go through the middle of a round table (≤ 25 % of its radius off centre), a
  different table per tunnel, ≤ 0.09 m of tube in the open at each end, no light shell. Live hall, GENERATOR_VERSION 7:
  3 tracks with tunnels — `hall-tunnel` (20.5 m, one), both long tours (two each) — 8 without; 91–97 % of each tube is
  under furniture. Relaxed: only 51–55 % is under the table TOP itself, because every table is ringed by solid chairs
  (the rest is under chair covers). Bot laps all 11 tracks, 0 wall hits; offline suite 6471 tests, 0 fail.
  Open: at toy scale the director's overview can be blocked by chair backs.

## QR code for the join address (15.11, owner: "Add the qr")

- `modules/rc-game/client/vendor/qrcode-generator.mjs` — `qrcode-generator` 2.0.4 (MIT, Kazuhiko Arase), `dist/qrcode.mjs`
  unchanged. Vendored inside the module, not an npm dependency of the core: it works offline, ships in the module
  tarball, and the core still names nothing of the game. Credited in `THIRD_PARTY_NOTICES`.
- `modules/rc-game/client/join-code.js` — `qrMatrix(text)` (level M, smallest version) and `drawQr(canvas, matrix, px)`
  (black on white, 4-module quiet zone). Canvas, not a `data:` image, so the page CSP is untouched.
- `host.js renderJoinCode` draws the code next to the address in large type; if the code cannot be made the address is
  still printed. One code per join address (LAN first).
- `eslint.config.js` ignores `modules/**/vendor/**`.
- Verified offline: `tools/smoke/smoke-wo1074-rc-client-qr.test.js` (3 tests: finder patterns / timing / size of the
  symbol, quiet zone, vendoring + printed address). Full suite 6474 tests, 0 fail.

## Verified on the box (15.11.26 07:00–07:05, node restarted at commit fb45db79, module enabled, show off)

- Host `enable` → journal `scene 405f970d98a2-d841e6d4a2 baked in 17202 ms: 382001 triangles, 7229492 bytes, 2 floors,
  0 obstacles, 11 tracks`; `/scene` has `scale 0.1`, 11 tracks, `hall-tunnel` 20.5 m with 1 tunnel, the two long tours
  138.3 / 142.0 m with 2 tunnels each and `laps 1`.
- Race: 2 headless Chromes (software GL, nice 19, ~7 fps) on `hall-tunnel`, 2 laps, lights and wall pictures on. Bot1
  finished both laps (62.0 s and 49.5 s at that frame rate — the track crosses the tunnel each lap), picked up 3 item
  boxes, used turbo and slick; both pages got 995 wall-picture frames and the lights snapshot. Bot0 completed no lap
  inside the 120 s window — not investigated (the old driver script steers poorly at 7 fps; the offline bot laps every
  track). Screenshots: scratchpad `qr/race1/` (toy car between chair legs).
- QR code: host panel screenshot `qr/host.png`; OpenCV's QR detector reads both codes from the canvases and from the
  screenshot itself: `http://192.168.50.64:4200/game/rc/` and the VPN address. No console errors.
- Never on a screen: from the scene bake to the end of the race (journal 07:01:10–07:05:15) the server sent Caspar
  nothing but its routine `INFO` queries (242 of them) — no play, load, mixer or clear line on any channel.
- ffmpeg clean-up: 0 zombie processes after the race and after `disable` (9 zombies before the restart, from the old
  worker); no wall-feed ffmpeg left.
- Left: game session disabled, module enabled, pgm2 empty.
