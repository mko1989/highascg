# WO-1089 — Stage Salad: slingshot vegetables at the presenter's avatar (third opt-in browser game)

**Area:** web-client, engine
**Status: DONE (15.11.26 — on the box: 6 scripted WS rounds with bots against the live test puppet, headless Firefox
player page through a full round to the results board; 82 smokes. Not checked: real phones / touch / gamepad / sound)**

Owner, 15.11: "new game idea. when a presenter is on stage and there is his avatar representing him, id like to be
able to shoot vegetables at the avatar from a large slingshot. also multiplayer with the same idea as rc and skirmish.
the game loosely based on angry birds"

Related: WO-1074 (RC game, kit + baker), WO-1076 (opt-in modules), WO-1086 / WO-1087 (previs avatars, test puppet
people), toy-skirmish (second game, `sk-kit.js` pattern). Contract: [stage-salad-contract](../notes/stage-salad-contract.md).

Originality: only the genre (aim an arc, knock something over for points) is taken. No birds, pigs, names, level
layouts, block towers, art, sounds or UI from Angry Birds. Vegetables, slingshot prop, names, bots, HUD and sounds are
our own, and the target is the presenter's own previs avatar.

## Investigation

### Where the presenter comes from

- Tracking lives in the `tracking` module. `GET /api/tracking/detections` → `world.persons`, each with `id`, `x / y`
  (PSN metres), `height`, optional `traits {top, bottom, skin, hair, hair_len}`. The server reads it in-process through
  `moduleRegistry.get('tracking').handleApi(...)` (body is a JSON string) — no HTTP loop, no auth.
- The WO-1087 test puppet people are ordinary world persons with locked traits, so the game needs no puppet code. The
  puppet API (`/api/tracking/puppet/people`) is only used by the box run to check it is still there.
- Frame: PSN → Godot `(x, floorY, −y)`; floorY = the stage deck inside the stage rect (Hilton Wawer y 0.639).

### The previs avatar (read, not edited)

- `godot/client/features/previs/tracking/person_avatar.gd` (+ `person_avatar_model.gd`, `person_avatar.gdshader`):
  a unit figure (feet y 0, top 1.02, front +Z) scaled by height / 1.02; `_part(...)` calls for head, hair, torso, arms,
  legs, shoes, eyes, blush, a smile arc; shoes = bottom × 0.45; blush mixes skin → (1, 0.45, 0.5); 0.3 self-light.
- While this WO ran, WO-1086 / WO-1087 were still changing these files (shoe height, eyes, smile, self-light 0.35 →
  0.3). They are committed now (9623382b) and the twin smoke passes against HEAD.

### Venue

- The RC baker (`rc-game`) already bakes the project's MVR into a GLB + scene JSON. Its `heights` field is a toy-scale
  height field for a 1:10 car — useless for walls a vegetable bounces off. So the game builds its own colliders
  (`client/venue.js`, shared): stage box from the stage rect, hall floor + walls + ceiling from the scene bounds, the
  live lights' truss rows, the LED wall screens.
- `rc-video` screens: `p` is the picture CENTRE (not its bottom), `rot` YXZ degrees, `size`. Hilton wall: p [12.7, 2.739,
  3.5], rot [0, −90, 0], 15 × 3 m → bottom at 1.239 m, 0.6 m above the deck. A box run showed 13–19 shots per round
  flying under the wall to the back wall. I added a "skirt" (wall reaching the floor), then looked at the previs on :0
  (screenshot gui0.jpg): the real wall is flown with that gap visible. Skirt reverted; a smoke now asserts that a shot
  under the wall ends on `room`.

### Node quirk found

- The shared client modules (`veggies.js`, `flight.js`, `venue.js`, `avatar-body.js`, `aim.js`) are ES modules that
  the server `require()`s (Node 24). Measured: Node keeps them in its ESM loader cache even after their `require.cache`
  entry is deleted, so a module disable / enable does NOT reload them — only a node restart does. Server CJS files
  reload on disable / enable as usual. Noted in contract §1.

## What was done

Module `modules/stage-salad/` (module.json, register.js; needs `rc-game` installed for the kit; 51 files).

**Server** (`server/`)
- `salad-game.js` — the session: enable / disable, host actions, socket attach (≤ 40 sockets, 30 msg/s token bucket,
  256 KB backlog cap), venue built from the bake + live lights / screens (rebuilt when its rev changes), tracking poll
  10 Hz only while someone is connected, scene with the `salad` venue.
- `salad-room.js` — players / spectators (20 + 20), slots on two arcs, teams (left / right halves), phases lobby →
  countdown 3 s → round (30–600 s, default 90) → results 12 s → lobby, scoring, streaks, results order, 30 Hz tick,
  `w` avatar / slingshot stream only on change, throttled `state` (≤ 4/s), housekeeping (silent 10 s / unjoined 15 s).
- `salad-presenters.js` — targets from tracking (auto ≤ 3 nearest the stage centre / ids / dummy), stand-in when nobody
  is tracked, 3 s `lost` grace, eased feet, face the audience when standing, dodge (duck / step, chance 0.18) and
  umbrella (4 s every 25–40 s; always up in presenter-safe).
- `salad-shots.js` — the referee: server-authoritative flight, swept avatar test per step (head / body / legs),
  anti-cheat (fire sequence numbers, reload per vegetable, power / angle clamps, rate limit), pea bursts.
- `salad-bots.js` — 0–8 bots with our own names, aim through the shared solver, error by level + distance, think
  time; never perfect.
- `salad-public.js` — exact GET paths public only while the game runs; the host route always needs the API password.
- `salad-kit.js` — the one place that reaches into `rc-game` (baker, lights, video, static, sanitize).

**Shared pure modules** (`client/`, required by both sides): `veggies.js` (6 vegetables: tomato, potato, carrot,
cabbage, onion with bank-shot bonus, pea burst), `flight.js` (1/120 s fixed step, drag, bounces), `venue.js`,
`avatar-body.js` (twin table + hit parts), `aim.js` (solver).

**Browser client** (`client/`, ~5400 lines, three.js from the vendored node_modules/three via the RC static mount):
player page (follow camera, wooden Y-frame slingshot prop with the player's colour, vegetable tray with reload rings,
drag-to-pull / keys / gamepad, arc preview, banners, leaderboard, results), spectator page (`?spectate=1`), host panel
(`?host=1`: big presenter-safe pause, start / stop, round length, bots + level, teams, target mode, kick, lights / wall
toggles). Avatars are three.js twins of the previs figure with the person's traits, splat decals, slapstick reactions
(wobble spring, sparkle stars after a head hit, a cabbage-leaf hat, the umbrella prop) — friendly only. Sounds are
our own synthesized WebAudio blips (no audio files), off until unmuted; quality tiers from the kit.

**Smokes** (curated in `tools/ci/offline-test-files-3.js`): `smoke-wo1089-salad-{module,flight,hits,room,bots,
presenters,twin}` (39 tests) + `smoke-wo1089-salad-client-{protocol,input,shots,avatar,static}` (43 tests);
`tools/smoke/lib/salad-fixtures.js` (manual clock, Hilton-like venue, puppet snapshot, room harness).

**Other:** `check-unwired-exports.js` EXPORT_ROOTS + `modules/stage-salad/server`; `docs/wiki/api/contract/http.md`
regenerated (4 salad routes). Game sockets have no WS contract doc (same as RC / Skirmish) — nothing to regenerate.

**Bugs found and fixed on the way:** presenters deselected in `ids` mode lingered as `lost` (now gone at once); a
player joining mid-round saw no avatars until something moved (`w` now resent after each welcome).

## What was verified

**Smokes:** 82 / 82 (39 server + 43 client). Offline bot hit rates (4 seeds × 90 s, 8 bots): easy 9.9 %, normal
14.4 %, hard 23.8 % — never perfect.

**Box runs** (live server, running test puppet "TEST puppet 1", scripted WS players aiming with the solver + noise):

| Run | Setup | Shots | Hits (body / head / legs) | Notes |
|---|---|---|---|---|
| 1 | 60 s, 3 scripts + 4 normal bots | 119 | 29 (18 / 10 / 1) | 4 dodges, 1 umbrella (5 blocks); presenter-safe: 0 shots 0–7 s into it |
| 2 | 45 s, teams, 4 scripts + 6 hard bots, stand-in mode mid-round | 162 | 62 (51 / 7 / 4) | team totals 1537 : 2518, winner team 1; target switched to Stand-in and back |
| 3 | 60 s, 8 easy bots | 106 | 19 (13 / 4 / 2) | |
| 4 | 60 s, 3 scripts + 4 normal bots | 150 | 33 (20 / 6 / 7) | 13 under-wall shots → led to the skirt test |
| 5 | as 4 + the headless browser player, skirt live | 162 | 62 (38 / 24 / 0) | skirt took 60 wall hits, 0 room; skirt reverted after the previs check |
| 6 | final code: 60 s, 3 scripts + 4 normal bots + spectator | 122 | 37 (29 / 6 / 2) | 3 dodges, 1 umbrella (3 blocks), 16 under-wall → room; safe: 0 shots; points 17–190 |

**Browser** (headless Firefox ESR on a private Xvfb :79, throwaway profile, dev auto-player, then TERMed): screenshots
viewed — follow camera on a tomato in flight, "Bonk! +78", "HEAD SPLAT! +59" close-up with pea / onion splats on the
avatar, live leaderboard, slingshots with player colours, the results board ("Round over — Dev wins", hits / shots /
best / score, back to the lobby in 11 s). The client agent's own run covered the spectator and host pages.

**Twin vs previs:** the :0 previs (screenshot, no pointer use) shows the puppet in a purple top, red trousers, dark
short hair; the three.js twin shows the same colours and figure. The twin smoke checks every `_part` of the committed
person_avatar.gd against the twin table.

**Left as found:** game session disabled, 0 bots, teams off, target auto; module `stage-salad` enabled in
`~/.highascg/modules.json` like rc-game and toy-skirmish (the session itself is off); test puppet enabled, 1 person,
seed 1314122551. RC and Skirmish code untouched. Node restarted twice (ESM reload), the puppet restored each time.

**Not verified:** real phones (touch drag, iOS Safari), gamepad, sound on a device, `low` quality tier on
a weak device, the kicked / full / off screens and the countdown on glass, team colours on glass, dodge / umbrella
animations seen from a player page, more than one real tracked person at once (only puppets), behaviour with the
API password set.

Minor open points: peas are hard to see in the pouch; the selected label in the vegetable tray is dim.
