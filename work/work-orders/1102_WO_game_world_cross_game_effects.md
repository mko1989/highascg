# WO-1102 — Game World step 2: the games affect each other (server-refereed, capped, never griefing)

**Area:** web-client, engine
**Status: IN PROGRESS**

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
(in progress)

## 4. What was verified
(in progress)
