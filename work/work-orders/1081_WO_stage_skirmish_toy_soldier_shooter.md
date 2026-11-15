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

## What was done

(filled in when the two halves are verified)

## Verified

(nothing yet)
