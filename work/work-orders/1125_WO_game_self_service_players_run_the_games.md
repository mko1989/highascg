# WO-1125 — Game self-service: players run the games, no host needed

**Area:** web-client, engine
**Status: IN PROGRESS (17.11.26 — built, 926 game smokes pass, the wire proven live on the box; pages not yet driven in a browser, phones not at all)**

Owner 17.11: "i want to extend the game world. so clients have better control and hosts are not needed. i want to
connect to the world. be in spectator mode with game choices. when i choose one im in that game and can start a
session with bots, practice and wait for a colleague and start a session with him. etc"

Contract (wire, rules, server notes): `work/notes/game-self-service-contract.md`.

## Investigation

- A session existed only after an operator `POST /api/game/<id>/host {action:'enable'}` (Settings ▸ Games or a host
  page), in memory: closed again after every server restart (`games.autoOpen`, default off, was the only exception).
- No protocol.js of the three games had a player-side start: only the host API started a round and set bots
  (`modules/*/server/*-game.js` `host()`); a lone player could drive / warm up / practise in the lobby and nothing else.
- `/game/world/` was a list of links, polling the state; the room picture lived on `?spectate=1` only.
- One room per game, no party / invite concept: "wait for a colleague" = both sit in the same lobby.

## What was done

- Core `games.selfService` (default on): enabled games' lobbies open at server start and are re-opened when found
  closed, unless an operator closed them on purpose (holds until re-opened or restart). `GET /api/games/hosting`
  reports it, `POST {action:'selfService', on}` sets it. Games learn it through one generic host action `self`
  (default off inside a module, so a module alone is unchanged; the core still names no game).
- Player control `{t:'ctl', a:'start'|'stop'|'bots'|'set'}` in rc / sk / salad (`modules/rc-game/server/rc-ctl.js`,
  shared): seated players only, lobby / results only, 4 per 2 s, mapped onto the operator's own `host()` path, logged.
  Never: stop a running round, kick, pause, lights, wall, presenter target.
- Clients: lobby session panel (bots, level, track / arena / mode / length, Start), results bar (Play again, Back to
  lobby, World), `/game/world/` = the room picture behind collapsible game cards, a World link in each game.

## What was verified

- Smokes: every wo1074/1076/1081/1083/1089/1101/1102/1105/1106 game smoke + five new wo1125 files: 926 pass, 0 fail.
  Line limit, unwired exports, lint (0 errors), format, `--no-http` clean.
- Live on the box after a node restart: the three sessions opened by themselves (`[games] auto-opened 3 game
  session(s)`), state `self: true`; a real socket player in each game: `ctl bots 2 easy` → ok, 2 bots seated;
  `ctl start` → countdown → race / match / round; `ctl stop` while running → refused `running`; journal lines
  `[rc-game] Probe (#1): start`.
- Headless browser (phone size): the landing shows the three cards with Play; the RC page loads its join form.

## Not verified / open

- The session panel, results bar and World link were not seen in a browser (need a joined player); the room picture
  behind the landing cards was dark in the headless shot (WebGL or a real fault — not yet told apart); a page
  scrollbar shows on the landing.
- A player who starts a round with bots and leaves: the round runs on with nobody there, and the next visitor
  cannot stop it. Needs "no human connected → back to lobby".
- Settings ▸ Games has no switch for `selfService` yet (API only). Phones. Two humans in one lobby.
