# WO-1125 — Game self-service: players run the games, no host needed

**Area:** web-client, engine
**Status: IN PROGRESS (17.11.26 — built, 941 game smokes pass, full flow driven in a headless phone browser on the box incl. two players; real phones and the second box open — releases carry no game modules)**

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

## Browser + two-box pass (17.11)

Driver: chrome-headless-shell 150 over CDP (GPU through ANGLE/EGL, WebGL renderer "NVIDIA RTX PRO 4000"), phone
viewports 844×390 and 390×844 with touch emulation, real touch taps, one browser context per player. Screenshots in
`/tmp/claude-1000/-home-casparcg/7f544ecb-b95b-46a0-9588-e32afc757555/scratchpad/shots/wo1125/` (scratchpad, not kept).

### Seen (this box, 192.168.0.15)

- Landing `/game/world/`: three cards over the room picture, Play on each, works at both sizes (c1-landing-*.png).
  Before the fix the page scrolled (scrollHeight > innerHeight) and the cards covered the whole 390 px height.
- Dark room picture: NOT reproduced. With GPU, default SwiftShader and swiftshader-only flags the picture draws
  within 1 s (mean luma ≈ 113 at 1 s / 2.5 s / 5 s; a4-gpu-*.png, a4-swangle-*.png). With WebGL disabled
  (`--disable-3d-apis`) the cards still work on a plain background and THREE logs "Error creating WebGL context"
  (a9-nowebgl-landing.png). The first dark shot was most likely taken while no game was enabled (the world keeps its
  plain background until a game runs) — not proven.
- Full single-player flow, each game: card → join (name, colour) → lobby with the session panel → bots + → level →
  the game's choice → Start → countdown → round → results bar → Play again / Back to lobby / World.
  - RC (d-rc-1…7): bots 2, Normal, Track "Double stage", laps 1 → results at ≈ 66 s → Back to lobby ok.
  - Salad (e-salad-1…8): bots 2, Normal, round 0:30 → results → Play again → results #2 → Back to lobby → Start →
    results #3 → World → `/game/world/` with 3 cards.
  - Skirmish (e-sk-1…7): bots 2, Normal, arena "Under the Tables", minutes 1 → results at ≈ 86 s → Back to lobby ok.
- Two humans in one lobby + a `?spectate=1` page, each game (f-<game>-two-*.png): both see "Ana / Bo (you)" in the
  roster, the panel shows for both, Bo presses Start → countdown. The spectator page has no panel element and no
  results bar in the lobby, the round and the results. Salad and Skirmish: Ana pressed Play again → round #2,
  Bo pressed Back to lobby → lobby. RC with 0 bots: the race did not finish inside the 200 s script window
  (two idle players), so Play again / Back to lobby were not tapped there (single-player RC covered them).
- Portrait 390×844: RC / Salad / Skirmish join pages show "Turn your phone sideways", no page scroll (h-*-join-390x844.png).
- Console: only the THREE `toNonIndexed` warning and the SwiftShader deprecation notice; no page exceptions.

### Faults found and fixed

- `modules/game-world/client/world.css`: landing page scrollbar (body overflow hidden in landing, panel max-height
  from 100dvh minus safe areas), cards drawn under the world canvas in landing (z-index), the top strip shown over the
  cards (now only when the cards are folded), a compact card rule for heights ≤ 460 px.
- `modules/game-world/client/world-landing.js`: `cards-hidden` body class when the cards fold (drives the strip rule).
- `modules/rc-game/client/ctl-panel.css`: at 844×390 the panel rows ran below the fold (Laps / Minutes / Round and
  Start out of reach); two columns from 640 px wide. Results bar ghost buttons got a solid background (unreadable over
  the bright scene) and the World link the same button shape. A sticky Start was tried and removed: it covered rows
  and a tap scrolled to a row started a Salad round.
- `modules/toy-skirmish/client/sk-hud.css`: the Lobby button sat on the health bar (x14 y96); now at y206 under the
  weapon block (h-sk-warmup-lobby-button.png).
- Wording while self-service is on (all keyed on `state.self`, host wording unchanged when off):
  `rc-game/client/lobby.js`, `rc-game/client/session.js`, `toy-skirmish/client/lobby.js`, `toy-skirmish/client/hud.js`,
  `toy-skirmish/client/game.js` (scoreInfo carries `self`), `stage-salad/client/lobby.js` — "anyone here can press
  Start" / "press Start in the Lobby" instead of "waiting for the host".

### Empty-room rule (job B)

- New `modules/rc-game/server/rc-empty-room.js` (111 lines), wired once in `rc-game/server/rc-ctl.js`
  (createGameCtl, the kit shared by all three games); `rc-game.js`, `sk-game.js`, `salad-game.js` only pass
  `game`, `log`, `now`, `timers` and the host action args to `ctl.note()`. No *-room.js file grew.
- While `self` is on, a 1 s check: no connected human player (bots, disconnected seats and spectators do not count)
  for 20 s in any phase but the lobby → the operator's `{action:'stop'}` through host(), once per empty stretch.
  60 s with nobody in the lobby → the bots return to the operator's last host-set value (Settings default applied at
  enable, a host page), else 0 — once, only when different. Paused / presenter-safe games are left alone. Self off →
  no timer at all.
- Results included: live test showed an RC race whose players left ends in the results (WO-1106 B39) and stayed
  there; the next visitor joined into a results screen (g-rc-joined-in-results.png). The stop now also applies to
  results (the players' "Back to lobby").
- Live, after a node restart: a player starts a 2-bot round in RC and in Skirmish and closes the page:
  `[toy-skirmish] nobody connected for 20 s: the round goes back to the lobby` (21:30:57, older wording),
  `[rc-game] nobody connected for 20 s: back to the lobby` (21:32:38); a minute later
  `[rc-game] / [toy-skirmish] / [stage-salad] nobody connected for 60 s: bots back to 0`.
- Smoke `tools/smoke/smoke-wo1125-empty-room.test.js`: 15 tests (pure rig with a fake clock + real RC / Skirmish /
  Salad sessions). Not yet in `tools/ci/offline-test-files.js`.

### Box 2 (192.168.0.5, fresh ISO, API only)

- Update: release 2026-11-17_200002 (contains 0c9df94a) applied with `POST /api/system/update/apply` → 202; stamp
  2026-11-17_191219 (packageVersion 2026.05.20) → 2026-11-17T200002Z.
- No game modules, by design: the release tarball has 0 `modules/` entries
  (`tools/release/make-github-release-server.sh` refuses modules/), the ISO excludes them
  (`tools/eggs/live-usb/penguins-eggs-exclude-highascg-fragment.list`, `embed-server.list`), and module tarballs are
  not published (docs/MODULES.md). A box needs the module dirs under `~/.highascg/modules/<name>` through
  `POST /api/modules/install {url|path, sha256}`, which is code-change gated (password or box-local request);
  `POST /api/modules/<name>/enable` from here → 403 NOT_ALLOWED. `GET /api/modules`: enabled previs, tracking,
  cg-studio, games-hosting; available []. `GET /api/games/hosting`: games [], selfService true.
  `/game/world/` answers 200 with the main web UI index (SPA fallback), `/api/game/world/state` 404. No side channel
  was used, so job A was not repeated on box 2.
- Other box 2 API: keeping-up ok (level 0). Cluster: highascg5867, standalone, no peers (this box highascg7579
  standalone too). Sweep after the update: 24 pass / 3 warn / 1 fail / 3 skip — fail app.logs (kiosk
  `Couldn't find the given section "midi" and key "clip_banks"`), warn code.restarted (kiosk needs a restart,
  boot_launcher.gd changed), warn installed-helpers (`highascg-network-apply.sh` differs), warn failed unit
  apparmor.service.

### Verified

- Smokes wo1074/1076/1081/1083/1089/1101/1102/1105/1106/1125: 941 pass, 0 fail. Line limit 0 over, unwired exports
  no new, lint 0 errors, format clean. Require-integrity fails only on the 11 known `projects/*.sync-conflict-*` files.

### Still open

- Module delivery to a fresh install (no published module tarballs; box 2 cannot get the games without an install
  by the owner).
- Box 2 kiosk `midi/clip_banks` config error and the installed-helpers / apparmor warnings.
- Two-human RC to the results bar (needs bots or a finished race in the script).
- Settings ▸ Games still has no `selfService` switch (API only).
