# WO-1105 — Settings ▸ Games: host the browser games and the Game World from the operator client, with Show QR

**Area:** godot-client, web-client, devices-config
**Status: DONE (16.11.26 — offline smokes + Godot tests; on glass on the box: pane drove all four games, QR decoded, join card staged on PREVIEW only)**

Owner, 16.11.26: "the game hosting and game world hosting should be a global setting from settings. with a show qr etc."

## 1. Investigation

**What existed.** Hosting lived only in each game's own web host page (`/game/rc/?host=1`, `/game/sk/?host=1`,
`/game/salad/?host=1`) and in the Game World host page (`/game/world/?host=1`, WO-1101/1102). The Godot client had no
games UI at all.
- Each game's server has one host function, `host(body) → {status, body}`. Its web route `POST /api/game/<id>/host`
  calls it, and so does the Game World registry descriptor (`modules/*/server/*-world.js register()`: `{id, title,
  paths, host, state, room}`, contract `work/notes/game-world-contract.md` §0.1).
- The host bodies differ per game:
  - rc: `laps {laps}` (MAX_LAPS 20, `rc-room.js`), `bots {count, level}` (lobby / results only), `pause {on}`.
  - sk: `limits {minutes}` (RULES.minutes 1–30), `bots {n}` + `botlevel {level}`, `pause`.
  - salad: `round {secs}` (RULES.secs 30–600), `bots {n}` + `botlevel`, `safe {on}`.
  - All three: `enable` / `disable`, `start` / `stop`, `lights` / `wall {on}`, `house {level}` (WO-1099).
- The world service (`modules/game-world/server/world-service.js` `host()`) already does enable / disable / start / stop
  per game, presenter `safe`, `affect {game, mode}`, lights / wall / house for the whole world, and remembers them.
- Which modules are on is persisted in `~/.highascg/modules.json` (module-loader `enableModule` / `disableModule`).
  A session is runtime state of the game (`state().enabled`). Nothing restarts one after a server restart.
- Join addresses: every game builds `joinUrls` from `getLanIPv4Addresses()` (CGNAT 100.64/10 last). On this box that is
  `192.168.0.15` (eno1) first, then the Tailscale `100.101.245.97`. No game lets the operator pick.
- The QR encoder is `modules/rc-game/client/vendor/qrcode-generator.mjs` (MIT, in THIRD_PARTY_NOTICES), used by the
  RC host panel in the browser. No server-side QR existed.

**Constraints that shaped the design.**
- **The core names no game and no world** (WO-1101 boundary): `smoke-wo1101-world-server-static` fails when any `src/`
  file contains `game-world` / the registry key. My first version read the registry from `src/games/register.js`; the
  smoke caught it. So the core now reaches a game only through its module: each game's `register.js` exposes
  `gameDescriptor()`, which returns the same object the game puts in the registry. The manifests say which module is
  which game (`"game": "rc"`).
- `POST /api/settings` builds `newConfig` from a hand-maintained list (WO-619 / WO-1093 trap). `GET /api/settings`
  also lists its sections by hand, and the Godot `Settings` autoload reads only what GET returns. Both need `games`.
- **Placement.** Settings had 7 panes after the WO-1093 compaction, all "set once" (System, Defaults…). Hosting is used
  *live* during an event: pause everything, start a round, show the join code. A fold inside System would be two clicks
  deep and scrolled away. So it is its own pane **Games**, after "This screen" (tests/test_settings_layout_wo1093.gd
  pins the new list).
- **Spectator as a source.** Two existing ways turn a web page into a source:
  - `browserAsCg`: an iframe in the `highascg_browser_url` CG template. The game pages send CSP
    `frame-ancestors 'self'` (curl `/game/rc/?spectate=1`), and the template loads from `file://`, so the iframe is
    blocked.
  - `webpage_host`: `POST /api/device-view {addExtraLiveSource: {type:'browser', …}}`, a CEF host channel. This is
    the one that can work. It may answer `casparRestartRecommended`. `operatorTools.cefEnableGpu` is off on this box,
    so the 3D spectator may render black there (memory: Caspar shaders need CEF GPU).
  - I added no new playout path.
- **QR onto a screen.** A CG template layer of a look takes `source.data` as its CG ADD data (`window.update(json)`).
  The repo's `template/` is Caspar's own template dir (Caspar cwd = ~/highascg, `<template-path>template/`). A template
  file is therefore enough, and no browser or JS library is needed in Caspar.

## 2. What was done

**Server (core, game-agnostic)**
- `src/games/register.js`: an always-registered core module (`src/bootstrap/modules.js`).
  - `GET /api/games/hosting` returns the aggregated state.
  - `POST /api/games/hosting {action, …}` runs one action.
  - WS `games:hosting` is sent when the state changed. The server checks once a second while a game module is loaded,
    and sends right after every POST. A change made on a web host page therefore reaches the pane within a second, and
    the other direction is the same host function.
  - It uses the normal API auth.
  - With `games.autoOpen` set, the loaded games' lobbies open 5 s after start (never a round).
- `src/games/games-hosting.js`: actions `module` (the loader), `session` (open = enable plus this box's defaults,
  close = disable), `start` / `stop` (one game or every open one), `bots`, `main`, `affect` (needs the world), and
  `safe` / `lights` / `wall` / `house`.
  - When the world module is loaded, actions go through the world service (it remembers them and tells every game).
    Otherwise they fan out to every open game in that game's own body.
  - Every bad body gets a 400 with the state.
  - The game's own refusal is passed through (e.g. "no track").
- `src/games/games-hosting-rows.js`: one row per game.
  - Fields: module, session, phase, running, safe, players (connected humans), spectators, bots `{n, level, max,
    levels}`, main `{label, value, min, max}`, affect, lights / wall / house, joinUrl, paths, defaults, and a QR matrix.
  - Plus a world row and `global {safe, lights, wall, house, open, running}`.
- `src/games/games-join.js`: every IPv4 address with its interface and kind.
  - Order: LAN, then VPN (CGNAT or tailscale / wg / tun / zt), then loopback.
  - Automatic picks the same first address the games use. The operator may name an IP or an interface.
  - It warns when the chosen one is gone, when only a VPN or loopback address exists, or when there is no address.
- `src/games/games-qr.js` + `src/games/vendor/qrcode-generator.mjs`: an unchanged copy of the games' own encoder (MIT;
  THIRD_PARTY_NOTICES, eslint ignore). It produces the matrix as hex rows `{n, rows}`, cached.
- `src/games/games-settings.js` normalizes and merges the `games` settings `{joinAddress, autoOpen, defaults: {<id>:
  {bots, botLevel, main, affect}}}`. They are persisted through `POST /api/settings` (`settings-post.js` merge and
  newConfig) and returned by `GET /api/settings` (`settings-get.js`). The factory default is
  `{joinAddress:'', autoOpen:false, defaults:{}}` in `defaults-core.js`. No secret is stored: host auth is the API
  password (WO-1089).
- Manifests: an optional `"game"` id (`module-manifest.js` validates it, `module-loader.js listAvailable` passes it
  through). It is set in the four game manifests.

**Game modules (minimal)**
- `*-hosting.js` per game: the game's main number, bots and pause, built as its own host bodies. Each descriptor
  exposes it through a `hosting` getter.
- `*-world.js` exports `descriptor()`, and `register.js` exposes `gameDescriptor()`.
- `rc-room.js` exports `MAX_LAPS`.
- No game logic changed.

**Template**: `template/join_qr.html` is a transparent page with a centred dark card: title, the QR drawn from the hex
rows (4-module quiet zone), "Scan with your phone camera to join", and the address.

**Godot (`godot/client/features/settings/`)**
- `games_pane.gd`:
  - a big red-when-on **PAUSE EVERYTHING — presenter safe**;
  - live lights, LED wall pictures, a house-lights slider;
  - the summary line, the join line with its warning, and Show QR;
  - one row per game (the world first);
  - a "Box defaults" fold: join address (automatic / each non-loopback address) and auto-open.
- `games_row.gd`: one row per id, built once and then updated in place (never rebuilt under the pointer).
  - Main line: module switch, session open / close, status, Start, Stop, bots, Show QR.
  - "More" fold: the main number, bot level, "In the Game World" (on / soft / off), Open host page, Open spectator,
    Spectator as a live source, and this box's defaults for the game.
- `games_qr.gd`: the QR dialog.
  - A 620 px matrix, the address at 22 pt, "Copy address", a screen picker (with more than one screen), and **Send to
    preview**.
  - Send to preview finds or creates the project look "Join QR — <title>" (`POST /api/scene/new-look`, a `join_qr`
    template layer whose data is the matrix). It syncs the deck (`ProjectSync.send_deck_sync(true)`) and runs
    `POST /api/scene/take-look {target:'preview'}`.
  - The operator TAKEs it like any look. Nothing here can reach program.
- `games_model.gd`: pure helpers (status, enabling, join line, address items, QR matrix, look source, request bodies).

**Stays web-only**: the per-game exotic options (RC track / items, Skirmish arena / rules, Salad presenters / venue),
the per-game host events of the world (vegetable rain, spotlight bonus), and the spectator views themselves. "Open host
page" opens them in the box browser.

## 3. What was VERIFIED

**Offline**
- `tools/smoke/smoke-wo1105-games-hosting.test.js` and `smoke-wo1105-games-join-qr-settings.test.js` (curated list,
  `tools/ci/offline-test-files-3.js`): 16 tests, 16 pass. They cover:
  - the route and its broadcast;
  - every action's body and its 400s;
  - the game's own refusal passed through;
  - rows, including Salad paused under `safe`;
  - the join pick and warnings;
  - the QR rows (29×29 for the box URL);
  - settings normalize / merge (a `null` resets a game or one key);
  - the settings-post newConfig and settings-get wiring;
  - the boundary: `src/` never names the Game World registry (smoke-wo1101-world-server-static stays 7/7).
- Godot `tests/test_games_settings_wo1105.gd`: 6 tests, 57 asserts. They cover status / enabling, the join line, the
  QR matrix and dialog, the preview look source and find-look, the request bodies, and the pane wiring.
  `test_settings_layout_wo1093.gd` now lists the Games pane.
- Whole Godot suite: 29439 passed, 0 failed. The run exits 134 on quit (glibc "corrupted size"). That happens on a
  clean HEAD too (WO-676, also noted in WO-1104).
- Gate loop: script-paths, max-file-lines, unwired-exports, `index.js --no-http`, lint, format, npm audit and licenses
  all exit 0. Offline suite: 7104 / 7112 pass. The 1 failure was smoke-wo846 (WO index) racing another agent's
  WO edit; re-run alone it gives 3 / 0 and `check-wos` is OK.

**Live on the box (.17, highascg running, operator client on :0)**
- `GET /api/games/hosting`: join 192.168.0.15 (eno1), automatic, no warning. Rows rc / salad / sk plus the world, each
  with its main number, bots and a 29×29 QR.
- Settings round-trip across a real node restart: `{games:{defaults:{rc:{bots:2,botLevel:'easy'}}}}` was stored in
  `config/general.json` and returned after the restart. Opening the RC session from the pane applied 2 easy bots.
  The defaults were reset to `{}` afterwards with `{rc:null}`.
- On glass, Settings ▸ Games (xdotool, screenshots):
  - enabled the Game World;
  - opened all three sessions;
  - set bots to 2 each and started rounds;
  - pressed PAUSE EVERYTHING. Through the world service the world, RC and Skirmish showed paused, and Salad showed
    `safe`.
  - The pane's state matched each game's own `/api/game/<id>/state`. The web world host page (headless Firefox on a
    private Xvfb) showed the pane's changes. A web "Soft" click for RC came back as `affect rc: 'soft'` in the pane
    within a second.
- Found on glass and fixed (8cf82e3f, 7c3c0d6e):
  - Salad showed "round" while paused. Rows now honour `safe`; re-checked by API after a restart (`safe:true` →
    salad `paused`).
  - The PAUSED label was not red in every button state. The pressed / hover / focus colours are now overridden.
    Checked after a relaunch only in the not-paused state (a parallel WO-1103 probe took the screen).
- Show QR (Game World): the 592 px matrix, sampled from the screenshot, matches the server's matrix in 841 / 841
  modules. An independent reader (format info → unmask → codewords → byte mode) decodes it as **version 3, EC M,
  mask 5: `http://192.168.0.15:4200/game/world/`**. For a second independent decode: `sudo apt install zbar-tools`,
  then `zbarimg`.
- Send to preview:
  - It created the look "Join QR — Game World" (one `join_qr` template layer whose data is the matrix) and staged it
    on channel 3 (PRV 1).
  - `/api/scene/live` showed only that preview; program was unchanged.
  - The Live tab PRV monitor showed the card (title, QR, address). Nothing was TAKEn.
- Left as found:
  - presenter safe off, rounds stopped, 0 bots, every session closed, world module off
    (`~/.highascg/modules.json`), lights / wall off;
  - preview cleared (`/api/scene/live/preview/clear`);
  - the test look deleted in the client (the project is back to 0 looks);
  - `games.defaults` `{}`;
  - Firefox / Xvfb terminated and the profile removed;
  - the test puppet reposted after the restart (2, `own:rb_f01`, walk).

**Not verified**
- The red PAUSED text after the fix, and the pane's Salad "paused" on glass. Both were fixed and proven by test / API
  only; the screen was handed to WO-1103.
- "Spectator as a live source": the existing `addExtraLiveSource` browser path was not run on glass. CEF GPU is off on
  this box, so a WebGL spectator may render black there (WO-881).
- Join-address warnings on a box with only a VPN / loopback address (offline smoke only).
- `autoOpen` at a real server start (offline only).
- The join card on program / a real wall: only PREVIEW was used, by brief.
