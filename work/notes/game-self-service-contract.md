# Game self-service — players run the games, no host needed (WO-1125)

Owner, 17.11.26: "i want to extend the game world. so clients have better control and hosts are not needed. i want to
connect to the world. be in spectator mode with game choices. when i choose one im in that game and can start a
session with bots, practice and wait for a colleague and start a session with him. etc"

Read first: `game-world-contract.md`, `rc-game-contract.md`, `skirmish-game-contract.md`, `stage-salad-contract.md`.
All their hard rules hold (opt-in modules, the core names no game and no world, nothing on a screen by itself, plain
ES modules, three.js only from `/vendor/three/`, user text only through `textContent`, 500 lines per file — the three
`*-room.js` files are within 9–30 lines of the cap: NEW files, at most 1–3 hook lines in a full file).

## 1. What changes for a player

1. Opens `/game/world/` → sees the room live (the world spectator picture) with the game cards on top
   ("spectator mode with game choices"). No operator has to open anything.
2. Taps a game → that game's page; name + colour as today → seated in its lobby (practice works there as today:
   RC drive around, Skirmish warm-up, Salad practice throws).
3. In the lobby the player has a **session panel**: Bots (count − / +, level), the game's own choices (RC: track,
   laps; Skirmish: arena, mode; Salad: round length), and **Start**. Anyone seated may use it; whoever joins meanwhile
   (the colleague) is in the roster and is in the round when Start is pressed.
4. After the results: "Play again" (start) / "Back to lobby" (stop, only from results) / "World" (link to `/game/world/`).

## 2. Setting (core, `src/games/`)

`games.selfService` (boolean, **default true**; `normalizeGamesSettings`, defaults-core, the hand-listed settings POST
already carries the whole `games` section — verify). Meaning while true:
- every enabled game module's session is open: opened at server start (like `autoOpen`, lobby only, defaults applied)
  and re-opened by core when found closed (the 1 s hosting check may do it) unless an operator closed it on purpose —
  an explicit close from Settings ▸ Games / a host page holds until the operator opens it again or the server restarts;
- games accept player control (§3).
`GET /api/games/hosting` reports `selfService`; `POST /api/games/hosting {action:'selfService', on}` sets + saves it.
How a game learns the flag without the core naming a game: the core already talks to games through their registered
hosting descriptor / `host()` — add ONE generic host action `{action:'self', on:boolean}` that every game service
accepts (runtime state, default **false** in the module itself so a module alone is unchanged), sent by core to every
loaded game on open and whenever the setting changes. If the world module fans host actions out, it forwards `self` too.

## 3. Player control wire (identical in rc / sk / salad)

Client → server, from a seated, connected, non-spectator player only:

```
{ t: 'ctl', a: 'start' }
{ t: 'ctl', a: 'stop' }                         only in phase results (→ lobby); never ends a running round
{ t: 'ctl', a: 'bots', n: <int>, level?: 'easy'|'normal'|'hard' }
{ t: 'ctl', a: 'set', k: <key>, v: <value> }    the game's own lobby choices, whitelist per game:
      rc:    track (id), laps (1–20)
      sk:    arena (id), mode ('dm'|'tdm'|'spot'), minutes (1–30)
      salad: round (seconds 30–600), teams (boolean)   — NOT target / safe / house / lights / wall / kick / pause
```

Server rules (one shared pure helper per game is fine; put the common part where all three can load it without a game
requiring the world — the RC kit is the existing shared place sk and salad already depend on):
- ignored with `{t:'ctl', ok:false, error}` back to the sender when: self-service off (`error:'host'`), sender is a
  spectator / not seated, phase is not lobby or results (`'running'`), unknown action / key / bad value (`'bad'`),
  or more than 4 ctl messages in 2 s from that socket (`'slow'`). Never a WS close for a ctl.
- allowed → mapped onto the SAME `host()` code path the operator uses (so every existing validation applies); the
  resulting state goes to everyone through the normal `state` push. Bot counts keep each game's own caps.
- a paused game (`pause` / presenter `safe`) refuses ctl (`'paused'`).
- `state` gains `self: true|false` (clients show the session panel only when true) and, where missing, whatever the
  panel needs to draw the choices (track / arena lists with id + title, current laps / mode / minutes / round, bot
  count + level). Do not send anything large on every tick.
- Every accepted ctl is logged at info: `[<game>] <player name> (#id): start | bots 3 normal | set track <id>`.
- Operator host actions keep working unchanged and win (kick, pause, close).

## 4. Clients

- Each game's lobby: the session panel of §1.3 (new file per game, e.g. `client/session-panel.js`; shared drawing
  helper in the RC kit if that keeps three files small). Phone-first: big tap targets, minimal, same look as the
  existing lobby. Hidden when `state.self` is false or the page is a spectator. A refused ctl shows one short line
  ("The host runs this game" / "A round is running" / "Too fast").
- Results screen: Play again / Back to lobby / World.
- `/game/world/` (no query): the world spectator picture full-page behind the game cards (reuse `world-spectate.js`;
  the cards are the existing landing list, as an overlay that can be collapsed to a small "Games" button so the room
  can be watched). A closed game's card reads "Closed by the host". `?spectate=1` and `?host=1` stay as they are.
  If WebGL / the scene is not available the cards still work on a plain background.
- Each game page gets a small "World" link back to `/game/world/` (only when the world module answers
  `GET /api/game/world/state`; a game alone shows nothing new).

## 5. Tests

Node smokes (`tools/smoke/smoke-wo1125-*.test.js`, pure rooms / services with injected clocks like the existing
wo1074 / wo1081 / wo1089 / wo1101 / wo1105 smokes): ctl allowed / refused matrix per game, rate limit, self flag in
state, core setting normalize + reopen rule + explicit close holds, landing static rules. Existing smokes must stay
green — several grep source text and forbid URLs (see `smoke-wo1076-rc-game-module`, `smoke-wo1101-world-*-static`).

## Server notes (server half, 17.11.26)

Wire of §3 as written, with these additions (all additive; a client that ignores them works):
- Refusal codes: `host`, `running`, `bad`, `slow`, `paused` as §3, plus **`seat`** for "spectator / not seated / not
  connected" (§3 names the case but no code). Every reply also carries `a` (the action asked). A refusal that came from
  the game's own `host()` (e.g. RC start with no track / no players, a bot count over the game's cap) is `error:'bad'`
  with `msg: <the host's error text>`.
- Accepted ctl is answered `{ t: 'ctl', ok: true, a }` to the sender (the state still reaches everyone through `state`).
- `stop` in the **lobby** is a no-op answered `ok: true` (a double tap / Salad's own results → lobby timer racing a tap);
  in a running phase it is `running`; only in results does it reach `host({action:'stop'})`.
- Check order: `slow` (counted for every ctl, also refused ones) → `host` → `seat` → `bad` (shape) → `paused` → `running`.
- Log line prefix is each game's existing one: `[rc-game]`, `[toy-skirmish]`, `[stage-salad]`, e.g.
  `[rc-game] Ana (#1): bots 3 normal`, `… set track stage-oval`, `… start`, `… stop` (level omitted when not sent).

State fields added (in the game's normal `state` / `welcome` state and `GET /api/game/<id>/state`; never per tick):

| game | field | shape |
|------|-------|-------|
| all three | `self` | boolean — show the session panel only when true |
| all three | `botMax` | number — the game's own bot cap (RC 9, Skirmish 6, Salad 8) |
| rc | `tracks` | `[{ id: string, title: string }]` (title = the track's `name`; `[]` until the first bake) |
| sk | `arenas` | `[{ id: string, title: string }]` (title = the arena's `name`) |

Already in the state (unchanged, what the panel reads): rc `trackId`, `laps`, `bots`, `botLevel`; sk `arenaId`, `mode`,
`limits.minutes`, `bots`, `botLevel`; salad `secs` (round seconds), `teams`, `bots`, `botLevel`, `safe`; rc / sk `paused`.
Note: rc `bots` counts the bots that have joined (it settles a moment after a `bots` ctl, once they load); sk / salad
`bots` is the wanted count.

`set` whitelist / mapping (each onto the game's own host body): rc `track`(id string) → `{action:'track', trackId}`,
`laps` 1–20 → `{action:'laps'}`; sk `arena`(id) → `{action:'arena', id}`, `mode` dm|tdm|spot, `minutes` 1–30 →
`{action:'limits', minutes}`; salad `round` 30–600 → `{action:'round', secs}`, `teams` boolean → `{action:'teams', on}`.
`bots` → rc `{action:'bots', count, level?}`, sk / salad `{action:'bots', n}` + `{action:'botlevel', level}` when sent.

Server pieces: the shared rules `modules/rc-game/server/rc-ctl.js` (`createGameCtl`, reached by sk / salad through
their kit, `kit().createGameCtl`); host action `{action:'self', on}` in every game service (accepted open or closed,
default false, a change pushes `state`); each game descriptor gained `held()` (true after an operator `disable` until
the next `enable` — the public `{ enabled: false }` state is unchanged); the Game World fans `self` out
(`POST /api/game/world/host {action:'self', on}`). Core: `games.selfService` (default true) in games-settings /
defaults-core / settings POST; `GET /api/games/hosting` → top-level `selfService`; `POST {action:'selfService', on}`
saves it; the 1 s hosting tick (after the 5 s start delay) sends `self` to every loaded game and re-opens a closed
session unless it was closed from Settings ▸ Games (until opened there or on its host page) or the game reports `held()`.
