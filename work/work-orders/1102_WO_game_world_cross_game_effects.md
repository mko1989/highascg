# WO-1102 — Game World step 2: the games affect each other (server-refereed, capped, never griefing)

**Area:** web-client, engine
**Status: DONE (16.11.26, referee smokes for all 9 rules; R2 R3 R5 R7 R8 fired live in a 5-min box soak; R1 R4 R6 R9 smoke-only; phones not yet)**

Owner, 16.11.26: "can the game world be a shared space between games. so someone is throwing tomates while another is
driving thru the stage etc" → step 2 of WO-1101 ("send agents for step 1 and 2"). Contract §6:
[game-world-contract](../notes/game-world-contract.md).

## 1. Investigation
- **Only Salad's motion is server-authoritative**; cars (RC) and soldiers (Skirmish) are simulated in each browser
  (bots: on the server, through the same client code — RC `bot-brain.js` behind `conn.botSink`, Skirmish `sk-bots.js`).
  A cross-game hit can therefore only be decided on the server from: Salad's flight steps (exact), the cars' and
  soldiers' last reported positions (≤ 20 Hz), and Skirmish's accepted hitscan rays (`sk-combat.js`, server positions).
  The effect on a client-simulated car / soldier must be APPLIED by its owner (browser or bot) from a server message —
  never reported by it. RC already works this way for its own spin-outs in reverse (the client reports `hit`); for the
  world we keep the decision on the server and only send the consequence.
- **Hooks that exist:** `flight.js stepFlight(f, venue, { hitTest, extra })` takes extra colliders (umbrella) →
  cars / soldiers as sphere colliders give bounce / splat for free (restitution per vegetable); Salad clients replay
  flights from `shot` and stop at the server's `end`, so a server-side bounce off a car needs one re-anchor message.
  `salad-presenters.js planDodge` gives the avatar's `step` dodge (used for R7 "make way").
- **Scoring models differ:** Salad = points (bonus easy), Skirmish = frags with a limit that ends the match (a bonus
  must not end a match: every 3rd bonus +1, ≤ 2 per match), RC = race order (no points: the bonus is a tiny mini-boost).
- **Scales:** a car is ≈ 6 × 3.5 cm, a soldier 5.5 cm, a tomato 9 cm across, a cabbage 22 cm. Hit spheres in room
  metres: car r 0.04 m, soldier r 0.025 m.

## 2. Design
The referee `modules/game-world/server/world-referee.js` is pure and seeded. Rules R1–R9 and caps (immunity, ≤ 4 s
loss per target per minute, ≤ 3 control effects per source→target pair per minute, ≤ 12 bonuses per source per minute,
per-game "others can affect this game": on / soft / off) — contract §6.

## 3. What was done
- `modules/game-world/server/world-referee.js` (contact / landed / shot: R1, R2, R4, R5, R6) and
  `world-referee-tick.js` (R3 bowled over, R7 make way, R8 vegetable rain, R9 spotlight bonus): pure, seeded,
  every effect through one `decide()` that applies immunity, ≤ 4 s loss per target per minute, ≤ 3 per pair per minute,
  ≤ 12 bonuses per source per minute and the target game's on / soft / off (soft = the effect is drawn, nothing
  happens). Events carry `dur` / `soft` (the soak table). Effects reach the adapters through a microtask, never inside
  a game's own tick.
- RC (`rc-world.js`, client `world-fx.js`): `hop` / `bump` / `boost` / `wobble` on the own car only, slick patches
  under the car (grip × 0.55, top × 0.85); bot cars take the same effects via `bot-brain.js`; bonus = mini-boost.
- Skirmish (`sk-world.js`): every accepted hitscan goes to `hub.shot` with the arena line of sight (R4); `stun` drops
  fire server-side for its duration, the client holds input and slides 1.2 u along `dir`; bonus +1 every 3rd, ≤ 2 per
  match, keyed on a match counter (a pause cannot reset the cap — a bug the test agent found).
- Salad (`salad-world.js`, `salad-shots.js`, `salad-presenters.js`): the flight step tests world colliders (cars /
  soldiers) through the hub hooks (wrapped: a throwing world never reaches the 30 Hz tick — the other bug found),
  bounces re-anchor the flight on the clients (`xb`), landings report to `hub.landed` (R2 / R5); R7 = a 0.4 m side
  step of the avatar for 0.7 s; points 15 / 5 / 10 in a round only.
- World host page: per-game on / soft / off, rain / spotlight events, one pause-everything switch.

## 4. What was verified
- **Tests:** `smoke-wo1102-referee-rules` 23, `smoke-wo1102-referee-props` 5 (caps, soft, immunity, determinism)
  + the game-side smokes (rc 10 + 9, sk 12, salad 10: effects land on the right target, the causer alone gets the
  bonus, stun drops fire, bonus caps, pause). All pass; gates exit 0 (see WO-1101 §4).
- **Box, 5-min soak** (as WO-1101, rain at +30 s and +200 s for 30 s, spotlight at +120 s for 30 s), events per rule
  from the world page's `xev` stream:

  | rule | count | soft | mean / max effect | worst target-minute |
  |---|---|---|---|---|
  | R3 bowled over | 12 | 5 | 0.8 / 0.8 s | 1.6 s (sk Major Mallow) |
  | R5 pea scatter | 2 | 1 | 0.5 / 0.5 s | 0.5 s |
  | R7 make way | 13 | 0 | 0.7 / 0.7 s | 2.8 s (the Stand-in avatar) |
  | R8 rain | 1 | 0 | 0.6 s | 0.6 s |

  No target got near the 4 s / minute cap; hub totals: 41 effects, 8 soft, 7 bonuses, 0 errors. R2 slick patches
  are environment (no event by design): a 45 s probe of the world feed saw 20 `splat` patches (source `world`,
  tomato red, r 150 mm); screenshots 06 / 06b / 07 show them on the stage and on the oval.
- **NOT fired live:** R1 (a vegetable on a car), R4 (a shot sparking a car), R6 (a bounce), R9 (spotlight bonus — the
  light pools depend on the live rig; none was earned in the 30 s event). They are smoke-proven only. Owner play and
  real phones not yet.
