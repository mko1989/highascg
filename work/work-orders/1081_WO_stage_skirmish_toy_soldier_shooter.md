# WO-1081 — Stage Skirmish: a toy-soldier top-down shooter in the show's room (second game module)

**Area:** web-client
**Status: IN PROGRESS (15.11.26 — contract written, server and client being built; nothing enabled on the box, show on)**

Owner 15.11: "second game idea. also some logic for world as the rc one, where players are small toy size soldiers,
top down view, shooter. different weapons to pickup, deathmatch or teams modes. counter strike / unreal tournament
vibes but top down. also as a module. also the lights/video is live from the room."

## Investigation / design decisions (lead)

- Contract: `work/notes/skirmish-game-contract.md`. Module `modules/toy-skirmish/` (title "Stage Skirmish"), URLs
  `/game/sk/`, `/api/game/sk/*`. Original names and looks only (a genre, not a copy of any game).
- **World shared with the RC game, not copied.** The RC module's scene bake (floors, occupancy grid, GLB, toy scale),
  live lights and LED wall pictures are reused: the server requires the sibling module's files (`server/sk-kit.js`),
  the client loads the sibling's client files through `/game/sk/kit/…`. So Skirmish needs the `rc-game` module
  INSTALLED (not enabled). Chosen over a copy (≈ 5 000 lines that would drift) and over moving the world code into
  the core (WO-1076 took all game code out of the core). Nothing under `modules/rc-game/` is edited.
- **Who decides what:** movement in each browser (as RC); health, ammo, kills, pickups, phases on the server; the
  shooter's client claims hits and the server checks them against its own positions and the solid grid.
- **Top-down view under tables:** the room above 1.2 u (12 cm) over the arena floor is cut away on the scene's
  materials, so play between table legs is visible; lights and LED walls are not cut.
- **Arenas** are rectangles of the real room at toy scale (stage, under the tables, …) with generated toy building
  blocks as cover where the room is empty. **Bots** (0–6) so one person can try it.
- **Show on:** the game runs only in `tools/dev/skirmish-dev-server.js` (127.0.0.1:4310, no Caspar) until the module
  is enabled on the box after the show.

## What was done (15.11.26)

Built by two builders against the contract (server, client), each half checked by the lead before its commit.

- **Server** `modules/toy-skirmish/` (`register.js`, `server/sk-*.js`, 2 660 lines): `sk-kit.js` (the RC sibling's
  baker, lights, video), `sk-arenas.js` + `sk-arena-check.js` (deterministic arenas per scene rev, toy blocks as cover,
  `validateArena`), `sk-grid.js` (solid grid, line of sight, A*), `sk-room.js` + `sk-combat.js` (phases, modes, the
  referee for fire / hit / boom / pick), `sk-bots.js`, `sk-sanitize.js`, `sk-static.js` (`/game/sk/*` and the
  `/game/sk/kit/*` alias), `sk-ws.js`, `routes-sk.js`, `sk-public.js`, `sk-game.js`.
- **Client** `modules/toy-skirmish/client/` (5 130 lines, no build step): pure logic (`grid.js`, `move.js`, `shots.js`,
  `protocol.js`, `score.js`, `cam.js`, `sk-const.js`) and the view (`sk-world.js` with the cut-away plane,
  `soldier-model.js`, `arena-view.js`, `fx.js`, `stage-look.js`, HUD, lobby, host panel, input for keyboard + mouse /
  twin touch sticks / gamepad). Kit files used unchanged: `world.js`, `occ.js`, `interp.js`, `mesh-util.js`,
  `fullscreen.js`, `join-code.js` + QR, `scale.js`, `stage-fx*.js`, `rc.css`, `rc-ui.css`. Copy-adapted because they
  are tied to the RC API: `dom.js`, `net.js`, `sk-screens.js`.
- `tools/dev/skirmish-dev-server.js`: the game alone on 127.0.0.1:4310 (reads the project read-only, no Caspar).
- Lead after review: the held weapon rides in every `w` tuple; the follow camera came down from 14 u to 9 u.
- Contract clarifications from both halves: `work/notes/skirmish-game-contract.md` §12.

## Verified

- 79 tests in `tools/smoke/smoke-wo1081-sk-*.test.js` (37 server, 42 client; in the curated list), among them: the
  client's grid and spread are bit-identical to the server's, every accept / reject rule of the referee, module load /
  unload through the module host, the owner rules by source grep (no URL but `/api/game/sk`, `/game/sk/`,
  `/vendor/three/`; no Caspar, look, layer or project write). RC smokes unchanged and passing.
- Live room (rev 405f970d98a2-d841e6d4a2): 8 valid arenas (stage, tables, foh, aisle, backrow, banquet, sidehall,
  crossroads), 40–80 u per side, 16 spawns, 10–11 pickups, 20–44 blocks, 11–13 % solid.
- Dev server + headless Chrome (lead, 1280×720, 4 bots, fake lights): join → match → the soldier moves and fires, a
  bot fragged the player, respawn countdown, kill feed, minimap, cut-away room with fence and light glow; no console
  errors. Builder's runs: weapon pickup and ammo, a kill, results screen, phone layout with real touch events, host
  panel with QR, spectator view.
- NOT verified: on the box's real server (module not enabled — show on); LED wall pictures (the dev server has no
  video feed); real phones, gamepad, sound, frame rate on a real GPU.

## Owner play test 1 (15.11.26, module hot-enabled on the box at 12:21, three bots)

Owner: "the base of the game is cool. the problems, cant see shots on white floor. cant roam and shoot before the
match starts."

- **Shots on the white hall floor.** Every effect was additive light (`fx.js` `glowMat`), which adds nothing to white,
  and the streaks were 4–5 mm wide and lived 60–90 ms. Now a shot is a dark outline + a saturated solid core (normal
  blending) under the glow, twice as wide, 120–160 ms (Longshot 500 ms); explosion rings get the dark edge too. HUD
  text got a dark edge (`sk-hud.css`) — it was white on white.
- **Warm-up.** Moving and firing in the lobby did work (checked: `lastFireAt` advances in phase `lobby`), but after
  joining a panel "Waiting for the host to start" covered the middle of the screen and took the mouse until its "Warm
  up" button was pressed. The panel now stays closed behind the "Lobby" button: joining drops you straight into the
  warm-up.
- Verified in the dev server (headless, "Under the Tables", white floor): after joining there is no panel, the soldier
  aims and fires; the Longshot streak is clearly visible on white. The short streaks of the other four weapons expire
  between two frames at the 5 fps of the headless renderer, so they were NOT seen there — same code path as the
  Longshot's; owner to confirm on a real screen.

## Open

- Enable on the box after the show: `POST /api/modules/enable {"name":"toy-skirmish"}`, then the host panel
  `/game/sk/?host=1`; check the wall pictures and the real lights there.
- The dev hook (`?dev=1`, page on 127.0.0.1 only) drives the own soldier for tests; it gives no advantage.
