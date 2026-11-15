# Stage Sprint RC — browser client (WO-1074)

A small party game: up to 10 players race RC buggies on tracks generated inside the show's 3D stage model.
Plain ES modules, no build step, no internet needed (three.js comes from the box at `/vendor/three/`).
The wire format and the scene JSON are in `work/notes/rc-game-contract.md`.

## Modes (same page, by query)

| URL                          | What                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------- |
| `http://<box>:4200/game/rc/` | Player: name + colour, lobby (drive around freely while waiting), race                      |
| `…/game/rc/?spectate=1`      | Spectator: automatic race camera, big leaderboard, countdown and results; no controls       |
| `…/game/rc/?host=1`          | Host panel: enable / disable, track (with previews), laps, bots, start / stop, kick, join address |

The host panel needs the normal API login (the session cookie of the HighAsCG web UI in the same browser, or
`?host=1&token=…`). Players and spectators need no password while the game is enabled. While the game is off, every
mode shows "The game is not running" and re-checks every few seconds.

## Controls

- **Keyboard:** arrows or WASD drive and steer (S / Down = brake, then reverse), Shift or Space = drift (hop),
  E or Ctrl = use the item, R = back to the last checkpoint, C = chase / top camera, M = sound.
- **Touch (landscape):** left thumb = steering slider (drag sideways from where you touch). Right thumb = a 2 × 2
  cluster: **GO** (big, bottom right), **BRAKE**, **DRIFT** and **ITEM** — slide the thumb between them; DRIFT and ITEM
  keep the gas on. Every finger is tracked on its own (multi-touch). Buttons top right: camera, back to checkpoint,
  tilt steering (phones; asks for motion permission on iOS), sound, quality (LQ / HQ).
- **Gamepad:** left stick or d-pad left / right steers, RT or d-pad up = gas, LT or d-pad down = brake / reverse,
  LB / RB = drift, A / B / X = item, Y = back to checkpoint, Back / View = camera.

## Racing (v2)

- **Tracks run through the whole room:** hall floor, up a **ramp** onto the stage, off a **drop** back down. Ramps are
  solid wedges (yellow / black edges); a drop has a hazard-striped ledge and cyan landing chevrons. Where the ground
  steps up more than 0.3 m it is a wall; where it steps down you fly. The minimap shows raised parts in violet and ramps
  in amber.
- **Drift:** hold drift while steering — a hop, then sparks: white → cyan → magenta. Let go for a mini-boost (the longer
  the drift, the stronger). Orange chevron pads give a boost.
- **Start:** gas just before the lights go green = boost start; too early = stall.
- **Items:** drive through a floating gem box → the slot rolls → use it. **Turbo** (speed burst), **Slick** (a violet
  puddle left behind: whoever drives over it spins), **Rocket** (flies ahead along the track, hits the first car),
  **Pulse** (a ring that spins out cars close to you), **Shield** (blocks one hit). Cars further back get a small
  catch-up bonus.

## Showing the spectator view on a screen

The game never puts anything on a screen by itself and has no button for it. The spectator page is an ordinary web
page: if the operator wants it on a wall, they add `http://<box>:4200/game/rc/?spectate=1` as a browser / HTML source
by hand, like any other web page (a Caspar HTML layer needs CEF GPU rendering enabled for WebGL). It renders the stage
as its background (not transparent) with large text.

## Files

Pure, node-tested modules (no three.js / DOM): `physics.js` + `physics-world.js` + `phys-const.js` (60 Hz arcade model,
gravity, air, walls; steer + = left), `ground.js` (floors + the one ramp rule), `drive-rules.js` (drift stages, boosts,
start launch, spin-out, catch-up, `fx` flags), `track-math.js` (3D tracks; v1 2D tracks are converted), `lap-logic.js`,
`standings.js`, `interp.js` (snapshot buffer + server clock), `protocol.js`, `net.js` (WebSocket with reconnect),
`cameras.js`, `items.js` (boxes, roulette, held item, hazards, hit tests), `rocket.js` (the shared rocket path),
`item-play.js` (item / launch / event glue), `bot-brain.js` (WO-1082: a race bot — the server runs it with these same
modules, see `server/rc-room-bots.js`), `scale.js` (§3 toy scale: the scene's one `scale` → scaled PHYS, wire
precision), `occ.js` (§3 occupancy grids: RLE decode, disc-vs-cells), `seg-grid.js` (segment grid for long tracks).

§3 toy scale: the room stays life-size, everything the game adds is drawn and driven at `scene.scale` (live 0.1; missing
= 1 = the v2 sizes). `prepareTrack(track, scale)` stores it as `T.scale`, `createEnv(T, floors, obstacles, { scale, occ })`
as `env.s` / `env.P` (= `physFor(s)`). Only `sceneScale()` reads the scene field (game.js once per scene → `G.s` for
the car models and item effects; host.js for its previews); everything else takes `T.scale` / `env.s`.
Browser modules: `main.js` (mode switch), `game.js` + `session.js` + `loop.js` (session, messages, frame loop),
`world.js`, `track-mesh.js` + `track-deco.js` + `mesh-util.js` (ribbon, ramps, ledges, gantry), `props.js` (pads,
item boxes), `fx-view.js` (hazards, one-shots), `car-model.js` + `car-fx.js`, `input.js`, `hud.js` + `hud-extra.js` +
`icons.js`, `lobby.js`, `host.js`, `screens.js`, `audio.js`, `trackdraw.js`, `dom.js`.
Styles: `rc.css`, `rc-ui.css`, `rc-hud.css`, `rc-touch.css`. Everything the game draws is procedural (no image files, no external URLs); the scene GLB may carry the venue's
textures (WO-1082), which three.js decodes from the GLB itself. `dev-hook.js`: `?dev=1` on 127.0.0.1 only — a fixed
camera for verification screenshots (`window.__rcDev.setCam`).
Tests: `tools/smoke/smoke-wo1074-rc-client*.test.js` (fixtures in `tools/smoke/lib/rc-client-fixtures.js`).
