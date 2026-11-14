# Stage Sprint RC — browser client (WO-1074)

A small party game: up to 10 players race RC buggies on tracks generated inside the show's 3D stage model.
Plain ES modules, no build step, no internet needed (three.js comes from the box at `/vendor/three/`).
The wire format and the scene JSON are in `work/notes/rc-game-contract.md`.

## Modes (same page, by query)

| URL                          | What                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------- |
| `http://<box>:4200/game/rc/` | Player: name + colour, lobby (drive around freely while waiting), race                      |
| `…/game/rc/?spectate=1`      | Spectator: automatic race camera, big leaderboard, countdown and results; no controls       |
| `…/game/rc/?host=1`          | Host panel: enable / disable, track (with previews), laps, start / stop, kick, join address |

The host panel needs the normal API login (the session cookie of the HighAsCG web UI in the same browser, or
`?host=1&token=…`). Players and spectators need no password while the game is enabled. While the game is off, every
mode shows "The game is not running" and re-checks every few seconds.

## Controls

- **Keyboard:** arrows or WASD drive and steer, Space = handbrake (slide), R = back to the last checkpoint,
  C = chase / top camera, M = sound.
- **Touch (landscape):** left thumb = steering slider (drag sideways from where you touch), right thumb = gas and
  brake / reverse pedals (you can slide between them). Buttons top right: camera, back to checkpoint, tilt steering
  (phones, asks for motion permission on iOS), sound, quality (LQ / HQ).
- **Gamepad:** left stick or d-pad steers, RT / A = gas, LT / X = brake / reverse, B = handbrake, Y = back to
  checkpoint, RB = camera.

## Showing the spectator view on a screen

The game never puts anything on a screen by itself and has no button for it. The spectator page is an ordinary web
page: if the operator wants it on a wall, they add `http://<box>:4200/game/rc/?spectate=1` as a browser / HTML source
by hand, like any other web page (a Caspar HTML layer needs CEF GPU rendering enabled for WebGL). It renders the stage
as its background (not transparent) with large text.

## Files

Pure, node-tested modules: `physics.js` (60 Hz arcade bicycle model; steer + = left), `track-math.js`,
`lap-logic.js`, `interp.js` (snapshot buffer + server clock), `protocol.js`, `net.js` (WebSocket with reconnect),
`standings.js`, `cameras.js`. Browser modules: `main.js` (mode switch), `game.js` + `loop.js` (session and frame loop),
`world.js`, `track-mesh.js`, `car-model.js`, `input.js`, `hud.js`, `lobby.js`, `host.js`, `screens.js`, `audio.js`,
`trackdraw.js`, `dom.js`. Tests: `tools/smoke/smoke-wo1074-rc-client*.test.js`.
