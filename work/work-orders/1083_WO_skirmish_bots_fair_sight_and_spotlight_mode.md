# WO-1083 — Stage Skirmish: bots see no farther than a player (no more cross-map shots); flat decor; Spotlight mode

**Area:** web-client
**Status: DONE (15.11.26 — offline smokes; live bot matches on the box's server, max bot hit 6.63 u against the 7.09 u
limit; Spotlight played live by bots and looked at in a headless Firefox; real phones / owner play not yet)**

Owner 15.11 (after playing [WO-1081](./1081_WO_stage_skirmish_toy_soldier_shooter.md)): *"bots shouldnt be able to aim
longer than a player can. there were cases were bots were shooting across the whole map."*

Then: expand the skirmish with what it lacks most (lead: a few solid, tested additions; original content only).

## Investigation

### How a bot picked targets and fired (before)

- `modules/toy-skirmish/server/sk-bots.js` (5c7f6d30) `sight(p)`: the nearest enemy within `SIGHT_U = 45` u with a clear
  line on the full grid; `tick()` turned the bot onto it instantly (`p.yaw = yawTo(…)`, no turn rate) and fired after
  `REACTION_MS = 350` of continuous sight, with ± 6° (Longshot ± 3°) aim error regardless of distance.
- The referee (`sk-combat.js hit`) checked a bot's hit exactly as a human's: server distance ≤ range + `hitSlack` 3 u
  and the TOLERANT line (solid shrunk by one cell). A bot's pellets were traced to the weapon's full range, so a miss
  could hit anyone behind the target (Longshot: 120 u); a bot's Thumper rocket flew up to 88 u and splashed whoever
  stood at the far wall.
- What a human sees: the follow camera (`client/cam.js followCam`, `loop.js`) is 9 u up, pitched 64°, vertical fov
  40°, leaning 1.6 u towards the aim. Projected on the floor (16:10 viewport, inner 90 % of the frame) that is about
  5.9 u up-screen, 4.75 u down-screen and 6.85 u to the side of the own soldier (16:9: 7.4 u, a 21:9 phone 8.7 u; the
  vertical reach does not depend on the aspect). The minimap shows no enemies. So a human engages at ≤ ~7 u; a bot at
  up to 45 u — 6× farther, more than half of every arena (40–80 u a side), the whole width of "crossroads" (80 × 40 u).

### Measured (evidence)

A simulated 3-minute match of 6 bots on each of the 8 arenas of the live room (rev 405f970d98a2-d841e6d4a2, the
room's real `sk-room.js` + `sk-combat.js` + `sk-bots.js` with an injected clock; scratch script, every `dmg` with
shooter → victim distance): **bot hits up to 40.8 u** (banquet, Longshot), pea 39.7 u, Thumper 38.7 u, rattler 30.1 u;
on every arena the maximum was 24–41 u. Some hits landed on a soldier that was NOT the bot's target (stray Thumper
splash / rounds, up to 8 per arena). Root cause: the 45 u sight radius, i.e. no notion of the player's view at all;
weapon ranges (40–120 u) never limited anything because every target was inside them.

### General case (any shot, bot or human)

- Hitscan from a human: the server refuses a hit beyond range + 3 u (the 3 u is latency slack) — nothing farther.
  A human CAN hit a target it does not see (blind fire down a corridor) — legal, it is a skill shot, not an advantage.
- Rocket: the impact must lie within 1 u of the fire ray and within the flight so far (≤ 88 u); splash reaches 4 u
  around it — by design (contract §3).
- Bots used no private damage path (every hit went through `combat.hit` / `combat.boom`), but those checks were the
  human ones (slack, tolerant line), and a bot's AI decided what to shoot at from 45 u.

### Flat decor in `occ` (scene from the other agent's baker work)

`occ` is binary per 0.3 u cell: anything that crosses the toy band (floor + 0.05 u … + 0.6 u, `rc-scene.js:99`) blocks
— a carpet thicker than 5 mm would be a wall for soldiers and bullets. The bake also carries a height field
(`heights`, 0.5 u cells, 0.25 u bins, `rc-scene-height.js`), which tells how high things reach. On the live room
1 548 hall cells and 1 031 stage cells are blocked in `occ` with nothing above 0.3 u (low plates on the stage, bases
by the curved hall wall).

## What was done

### Part 1 — a bot never out-sees a player (by construction)

- `server/sk-view.js` (new): the client camera as a pure function. `ndcOf(dx, dz)` projects a floor point through the
  follow camera leaning at it; `inFrame` = inside the inner 90 % of a 16:10 frame; `botSees(a, b, u)` = BOTH ways (b in
  a's frame AND a in b's: the frame is not symmetric, so the soldier being shot could always see its shooter). Limits:
  **± 4.75 u up / down screen, ± 6.85 u sideways, never past 7.09 u (`REACH_U`)**. 16:10 is narrower than a 16:9 or
  phone-landscape browser (only a 4:3 tablet is narrower) — conservative.
- `server/sk-combat.js` (the referee, so it holds whatever the AI does): a bot's `hit` needs distance ≤ range (no
  slack), `botSees` and a line that crosses NO solid cell (no tolerance); a bot's splash spares every soldier outside
  `botSees` from the fire position. Human rules unchanged.
- `server/sk-bot-aim.js` (new) + `sk-bots.js`: notice = alive, not protected, `botSees` + clear line, nearest; a
  target out of sight is dropped at once (no turning towards it, no firing); reaction time drawn per sighting
  (normal 300–500 ms; a target seen again within 400 ms keeps it); turn rate limited (normal 450°/s), fire only within
  6° of the target; aim error uniform ± (1.5° + 0.6°/u × distance). Weapon choice re-tuned to the view (Scatter ≤ 8 u,
  Thumper beyond its own splash, else Longshot / Rattler / Pea). Host levels `easy` / `normal` / `hard` (reaction,
  turn rate, error — never the view rule): `POST /api/game/sk/host {"action":"botlevel","level":"hard"}`,
  `state.botLevel`.
- Patrol: with a 7 u sight, the old goals (a pickup it wants, else a random spawn re-picked every 2–4 s) left an idle
  player unvisited for minutes (simulated: no bot closer than 25 u in 2 min). Bots now take a pickup only when it is
  worth it (a missing weapon, health when hurt, near enough), else patrol the spawn points they passed longest ago,
  keeping a patrol goal until reached.

### Flat decor

- `server/sk-occ-flat.js` (new), used by `sk-scene.js` before the arenas are generated: a blocked `occ` cell stays
  solid only when the height field shows geometry between floor + 0.3 u and + 0.6 u at that cell (or the field cell
  next to it); cells the field does not cover, and scenes without a field, stay as baked. The served scene carries the
  filtered `occ`, so the server grid, the arenas and the client grid agree. The baked files and the RC game are not
  touched (`sk-kit.js` re-exports `rc-scene-height.js fromJSON` and `rc-scene-occ.js encodeRle`, read-only).

### Part 2 — Spotlight mode (`spot`)

What the game lacked most after WO-1081: a third way to play that is not just "frag more" and that gives bots and
humans a reason to meet (with a 7 u sight, an empty arena is otherwise a lot of walking). Original idea and names.

- `server/sk-spot.js` (new, pure): one pool of light (radius 2.5 u) on a pickup pad; it moves every 40 s to another
  pad ≥ 12 u away when the arena allows (`movesAt` in the state; clients warn 5 s ahead). Alone inside = holder, a
  point per full second in a match (`p.score`, `p.spot`); two or more = contested, nobody scores. Lobby: the pool is
  there to try, nothing scored. `sk-room.js`: mode `spot` (host `mode {mode:'spot'}`), a 250 ms tick timer only while
  the mode is on (cleared on a mode change and on dispose), the pool reset on arena change / lobby / start,
  `state.spot` (`{x, z, r, movesAt, holder, contested}` or null), the points limit through the existing `limits.frags`
  (`RULES.frags.spot` = 60). `sk-combat.js`: kills / suicides score nothing in `spot` (still counted).
  `sk-bots.js`: in `spot` a bot walks to a random point inside the pool and waits there (fighting whoever comes
  — under the same view rule), unless hurt below 40 hp with a health pickup worth it; it re-plans when the pool moves.
- Client: `spot-view.js` (the pool on the floor: disc, dark edge, ring, soft halo; free = warm white, yours = green,
  someone else's = their colour, contested = flashing orange; blinks before it moves), `spot-status.js` (pure: the HUD
  line "You hold the light · +1 a second" / "<name> holds the light" / "Light contested!" / "The light is free", an
  arrow + distance when the pool is out of view, "moves in N"), minimap ring, HUD score line and board in points,
  lobby text, host panel: Spotlight mode button, points label, bot Skill buttons (easy / normal / hard).
  `game.js` / `protocol.js` keep the mode (they folded every non-`tdm` mode to `dm`).
- Contract (`work/notes/skirmish-game-contract.md`) §2 / §6 / §7 / §8 updated (view rule, `botlevel`, `spot`).

## Verified

- `tools/smoke/smoke-wo1083-sk-bot-view.test.js` (10 tests): the view constants equal `client/cam.js`'s; `ndcOf` is
  the exact inverse of the client's `screenToPlane` (72 directions × 3 distances, < 1e-6 m); the limits above; a bot
  holding every weapon (Longshot 120 u) and an idle target sideways / up-screen / down-screen at 25, 12, 8 u and 0.15 u
  past the limit → 0 shots, 0 damage; 0.15 u inside → fires; 3 u → fires and hurts; a block between at 3 u → 0 shots;
  the referee refuses bot Longshot hits at 30 / 10 / 8 / 5 u off-view, accepts at 6 u sideways, still accepts a
  human's 30 u hit and refuses anyone's past range + 3 u; bot splash spares a soldier 9 u away, hurts one 6 u away;
  first shot after both reaction and turn time; a lost target is not tracked. Mutation check: with `botSees` loosened
  to the old 45 u, 6 of the 10 tests fail.
- `smoke-wo1083-sk-flat-decor.test.js` (3): a 1 cm carpet cleared, a table leg, a 4.5 cm step and cells outside the
  field kept, no field = unchanged, the served scene carries the filtered grid.
- WO-1081 smokes updated (bots: "fires only at an enemy it can see" now uses `botSees`; phases: `state.botLevel`;
  module: the height-field kit file allowed): all skirmish smokes pass.
- Simulation after the fix (same 8 arenas × 3 min × 6 bots): max bot hit distance 6.8 u (measured from the bot's
  position at the damage, Thumper from the fire position ≤ 7.09 u); no stray hit on a non-target outside the view.
- LIVE (box server :4200, module reloaded through `/api/modules/disable|enable`, 6 bots + one idle player over the
  WebSocket, every bot `dmg` logged with the shooter's `shot` position → the victim's last `w` position):
  - run 1 (view rule + aim, before the patrol change), 3 min per arena: stage 219 bot hits, max **6.33 u**; crossroads
    70, max **6.51 u**; banquet 281, max **6.49 u** — **570 hits, max 6.51 u, p99 6.43 u** against the 7.09 u limit
    (before: up to 40.8 u). Per weapon the farthest: pea 6.51, scatter 6.48, thumper 6.49, longshot 6.32, rattler 6.46.
    The idle player was never found (0 hits: no bot came near it) — that is what the patrol change fixed.
  - run 2 (patrol loaded): stage 152 hits, max **6.29 u**, the idle player hit too; the run was then cut by a node
    restart from another session (the socket closed, the session came back disabled), so it was repeated (below).
  - run 4 (everything of part 1 loaded), 2 min per arena: stage 63 hits, max 5.71 u (5 on the idle player);
    crossroads 172, max **6.63 u** (20 on the idle player); banquet 105, max 5.83 u (5) — **340 hits, max 6.63 u, p99
    6.24 u**, the idle player found and hit 30 times. Over runs 1 + 4: **910 live bot hits, none past 6.63 u.**
- `smoke-wo1083-sk-spotlight.test.js` (4): the pool on a pickup pad in the lobby, warm-up scores nothing, alone =
  exactly 3 points in 3 s, contested = none (and the state says so), a frag scores nothing, the pool moves after 40 s
  ≥ 12 u, the points limit ends the match with `results.mode` `spot` and the holder first, 2 bots in 60 s stand in the
  pool (187 bot-ticks) and score (34 points), the HUD line and arrows; no timer survives dispose. All skirmish smokes
  (wo1081 × 13 files + wo1083 × 3): **96 / 96 pass**; eslint clean on the module, file-line limit and format gates pass.
- LIVE Spotlight (box server, 4 bots, stage, 2 min, a spectator socket logging `state.spot`): the pool moved 4 times
  (12.7, 12.1, 31.7, 12.6 u), 16 contested states, four different holders; points 26 / 18 / 17 / 4 with frags 6 / 2 /
  1 / 3 (frags did not score); `results.mode` `spot`. A second socket compared `state.spot.holder` with the `w`
  positions once a second: holder = the one soldier inside, every time.
- Headless look (private Xvfb :77 + a throwaway firefox-esr profile, both TERMed after): the spectator page in a
  Spotlight match — HUD "The light is free" / "<name> holds the light" / "Light contested!", "to 60 points", the board's
  Points column, the minimap ring, the results board "Match over · <bot> wins" in points
  (`work/notes/wo1083-evidence/*.jpg`). The first look showed the pool too faint on the light hall floor (warm white at 0.3,
  a 0.4 mm lift z-fighting in the overview): now warm yellow, thicker edge and ring, lifted 1.2 mm; the banquet frame
  shows it clearly with a bot standing in it.

## Open / notes

- Not verified on real phones or by the owner playing; the bot level buttons and the Spotlight button were exercised
  over the host API, not clicked.
- In the spectator overview of the `stage` arena a large black slab from the room scene covers the middle of the arena
  (soldiers and the pool under it; the name tags float above). It is scene content (the RC scene / baker, another
  session's area), not the skirmish's — worth a look there.
- Flat decor: the skirmish now ignores occ cells with nothing above 0.3 u, but the RC game itself still treats every
  occ cell (anything > 5 mm, e.g. a carpet) as a wall — for whoever owns the baker / RC game.
