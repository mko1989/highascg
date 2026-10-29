# WO-815 — Simulated server ("demo mode") in the Godot client + a static Web demo

**Status: IN PROGRESS (29.10) — phase 1 implemented and offline-verified (Godot 22685/0, of which 135 new; boot OK;
Web export run in headless Firefox: take / PRV push / fader / mute / timer work). Published 29.10 after WO-811 was
committed first (see "Publish (29.10, Opus, sequential)"): `.github/workflows/pages.yml` builds the Web demo into /demo/.
Open: owner eye on the demo, phase 2 items below.**

Owner 29.10: "demo inside the client especially other systems than linux should have an option to simulate a server,
should be part of the client. for show preparing. can we somehow fake the server for the static github page?"

## 1. Investigation

### Where the client talks to the server (the two seams)

- Every HTTP call goes through `core/api.gd:54 request(method, path, body)` and returns
  `{ok, status, data, error, reason}`. `get_bytes()` (`core/api.gd:~92`) is the only other HTTP path (thumbnails, models,
  bundles). The upload / download helpers build their own sockets from `Config.origin`.
- The WebSocket is `core/ws.gd`: `start()` (`:30`), `send()` (`:55`), `_process()` (`:65`). Server → client messages
  are `{type, data}`: `state` (full snapshot on connect), `change {path, value, seq?}`, `project_sync`. Client → server
  carries `scene_deck_sync` (`core/project_sync.gd:68`).
- Boot (`app/main.gd:376-388`): GET `/api/settings`, `/api/state`, `/api/project`, then `Ws.start()` (`app/main.gd:44`).
- `Config._init` (`core/config.gd:26`) picks the origin; `tests/test_auth_wo811.gd:87` and
  `tests/test_devices_target.gd` pin the exact `origin = home_origin()` / `_load_password()` lines.

### Shapes the demo has to reproduce (server source)

- Take: `deck_view.gd:262 request_take` → POST `/api/scene/take-look {sceneId, mainIdx, target}`
  (`src/api/routes-scene-take-look.js`). The deck re-highlights only from the `scene.live` broadcast
  (`src/state/live-scene-state.js:146 broadcastSceneLive`), which `src/server/ws-server.js:174` sends as
  `change {path: "scene.live", value, seq}`. `deck_model.resolve_bus_look_ids` reads `scene.live[ch].sceneId`, the
  channel from `channelMap.programChannels` / `previewChannels`.
- PRV push: `features/live/preview_pusher.gd:44` → POST `/api/scene/preview-push {sceneId, mainIdx}`.
- Mixer: `src/api/routes-audio-mixer.js:6` GET `/api/audio/mixer → {ok, gains, muted, solos}`; keys must match
  `src/audio/mixer-state.js:16 KEY_RE /^(pgm|prv|input):\d+(:layer:\d+)?$/`; changes broadcast as `change audioMixer`.
  Faders post `/api/audio/volume` (`src/api/routes-audio.js:79`), mutes `/api/audio/mute`.
- Timers: `src/engine/screen-timers.js:310-372` record `{timerId, name, config, lastCmd, cmdAt, remainingSec, screens}`,
  list carries `serverNowMs`; reset sets `remainingSec = null` (`:135`).
- Pixel map: `src/api/routes-pixel-map.js:1-68` GET / POST `{mappings}` (POST replaces the whole list).
- Autosave policy: `core/project_sync.gd:3-10` (debounced POST `/api/project/autosave`; look edits also go as
  `scene_deck_sync`).
- Video: `video/video_surfaces.gd:87 path_for` maps roles to this box's Caspar shm — a demo on the box would show the
  real PGM/PRV pictures unless redirected.

### Data source

`projects/mhp_harder.json` plus read-only GETs from the box (127.0.0.1:4200: state, project, settings, mixer, timers,
pixel map, fixture types, effect registry, layer options, …) captured to the session scratchpad. They contain the
show / client names, media paths under `/home/`, Polish media names, other machines' IPs, the Art-Net destinations and
redacted credentials — none of it may reach a public page.

## 2. What was done

- **`tools/demo/build-demo-data.py`** (new) — builds `godot/client/demo/*.json` from whitelists, not from deletion:
  9 looks with neutral names and synthetic `demo/*.mov|wav` media (main 0: LED wall, main 1: projection), live buses
  PGM 1 / PRV 2 / PGM 3 / PRV 4, curated templates, 8 PixelLine fixtures renamed `PixelLine N` (dest 127.0.0.1,
  universe 1), one timeline "Opener timeline", previs stage only (LED wall L/C/R + 2 projections, no MVR), screen
  labels "LED wall" / "Projection", whitelisted settings (no network, stream credentials, RTMP, Caspar host, nuclear
  password), `caspar.host = "demo"`, one timer "Show clock" (300 s), mixer `pgm:1` / `pgm:3` at unity.
  `scan()` fails the build on any IP outside {127.0.0.1, 0.0.0.0, 255.255.255.255, 236.10.10.10}, on show / client /
  path words (`/home/`, `mhp`, `harder`, `VISUALE`, `BRIDGE`, owner name, Polish media words, `/dev/`, `Bearer`, …) and
  on a non-empty password / token / secret value. Output: 10 files, 117 646 bytes.
  Note: rerunning it today gives slightly different pixel-map rects in project.json — the source project moved on
  (owner work); the generator is deterministic for a given input.
- **`core/demo/demo_server.gd`** (new, pure RefCounted) — the simulated server. `handle()` → core routes, then
  `demo_scene.gd`, then `demo_extras.gd`, else `not_in_demo()`: 501 `"not in demo: VERB /path"`, reason
  `not_in_demo`, printed once per path; non-GET writes also emit `notice` (shown in the header notice line) except the
  client's own boot-time writes (`QUIET`). `change()` writes the in-memory state and broadcasts `change` (with `seq`
  for `scene.live`). Every answer is a JSON round trip (numbers become floats exactly as over the network).
- **`core/demo/demo_scene.gd`** (new) — take-look, preview-push, PRV clear, FTB, new-look, autosave / save (rev bump,
  no echo), `scene_deck_sync`.
- **`core/demo/demo_extras.gd`** (new) — mixer (volume / mute / solo with KEY_RE validation), live-inputs and routing
  stubs, timers on the client clock (list / cmd / assign / unassign / visible), pixel map GET / POST (validated) /
  pixels / live, fixture types, fixture program, OSC audio layers, timelines (list, get, put, state).
- **`core/config.gd`** — `demo` flag, `DEMO_ORIGIN = "http://demo.invalid"` (`.invalid` never resolves, so the
  upload / download sockets fail at once instead of reaching a box), `DEMO_LABEL`, `demo_wanted()` (`:41`; Web always
  demo; `--demo` / `--demo=0`; else ui.cfg `[demo] enabled`), `saved_demo()`, `save_demo()`. The override runs after
  `_load_password()` (`:31-34`) so the WO-811 pin holds, and clears the password (nothing is sent anywhere).
- **`core/api.gd:55-58`** — demo answers `request()` (one frame later, so callers stay async as on the network);
  `get_bytes()` answers 501 not-in-demo (`:96`).
- **`core/ws.gd:33-35, 57, 67`** — no socket: `start()` queues the snapshot and connects the demo's broadcasts to an
  inbox drained by `_process()`; `send()` hands messages to `on_ws()`.
- **`video/video_surfaces.gd:29, 88`** — no video feed in a demo, and `path_for` points at a user-dir path no writer
  creates, so a demo on the box never shows the real Caspar channels.
- **`app/header_project.gd:49`, `app/shell.gd:117, 236`** — header "where" label and status line read
  "DEMO — no server" (amber); demo notices go to the header notice line.
- **`features/settings/settings_panes.gd:90 demo_switch`** — Settings → This screen → "Simulated server" (Off / On,
  ui.cfg, default off) + "Restart client" when the choice differs from the running mode; disabled on Web.
- **`export_presets.cfg [preset.4]` "Web"** — `../export/web-demo/index.html`, single-threaded template (no
  COOP/COEP needed on GitHub Pages), excludes `tests/*, e2e/*, addons/hshm/*`; every preset now includes
  `demo/*.json`. `godot/export/` is gitignored.
- **`tools/ci/check-max-file-lines.js`** — skip `web-demo` (Godot's generated 909-line `index.js` in the gitignored
  export dir made a local run fail after a web build).
- **`.github/workflows/demo-pages.yml.draft`** — DRAFT, not active: a full replacement of `pages.yml` that also builds
  the Web export into `_site/demo/` (one Pages deployment per repo, so it cannot be a second workflow).
- **`tests/test_demo_server.gd`** (new, 135 assertions) — data set loads, take / PRV push / FTB change the state and
  broadcast with seq, fader / mute / solo change the mixer, unknown endpoint → 501 "not in demo" (+ notice rules),
  timers on an injected clock, pixel-map save, deck sync + autosave, the switch, public-safe scan + under 1 MB.

### Simulated vs not (phase 1)

Simulated: state, project, settings (GET / POST), effect registry, layer options, media list, templates, variables,
system time, missing-assets, hardware-check, video-surfaces (empty), media preview (no-op), take-look, preview-push,
PRV clear, FTB, new-look, project autosave / save, scene_deck_sync, audio mixer / volume / mute / solo, live inputs,
input routing, timers (all), timelines (list / get / put / state), pixel map (GET / POST / pixels / live), fixture
types, fixture program, OSC audio layers.

Not simulated (501 "not in demo"): video pictures (previews black), thumbnails and every `get_bytes` (models,
bundles), timeline playback, Devices tab / device-view, shaders, MVR / previs models, tracking, pixel-map proposal,
ALSA mixer, client-prefs, operator layout, network / Wi-Fi, cluster, replication, streaming, v4l2 / shm sources, DMX,
modules, HAP encode.

## 3. Verified

- Godot suite: **22685 passed, 0 failed** (my run of 22651 = baseline 22516 + 135 new; other agents added the rest).
  `tests/test_demo_server.gd` alone 135/0. `run-client.sh --check`: boot OK (no script errors).
  `node tools/ci/check-max-file-lines.js`: 0 files over 500.
- Headless demo boots on tabs 0–3: 9 looks, WS open, 26 state keys, settings loaded, autosave ok.
  Desktop screenshot on a private Xvfb: `scratchpad/demo_mode/xvfb_live_demo.png`.
- Web export: `godot/export/web-demo/` 41 MB (index.wasm 39.5 MB, index.pck 2.6 MB, index.js 280 KB), served with
  `python3 -m http.server 8815 --bind 127.0.0.1` and run in Firefox ESR on a private Xvfb `:115` (never `:0`).
  Screenshots (session scratchpad `demo_mode/`): `web_a_before.png` (Live tab), `web_b_after_take.png` (TAKE ok, Song 1
  on PGM), `web_c_prv.png` (PRV ok), `web_d_audio.png` (ALSA shows "not in demo: GET /api/audio/alsa-mixer"),
  `web_e_mixer_timers.png` (L10 MUTE, PGM 1 master −13.4 dB, Show clock 00:05:00), `web_f_crop.png` /
  `web_g_restart_notice.png` (timer counting: 00:04:56 → 00:04:52).
- Owner's client restarted with the NON-demo line (`--autostart --tab=0`): back on 127.0.0.1:4200 with the real
  project (`demo_mode/gui_after_restart.png`). The 4 "Unicode parsing error … NUL" lines at its start are pre-existing
  (same lines in earlier sessions' logs).
- Known cosmetic: on Web some icon glyphs (▾ …) render as boxes (no font fallback in the browser).

**NOT verified:** the owner's eye on the demo; GitHub Pages publishing (draft workflow never run); Windows / macOS
desktop builds in demo mode (same code path, untested on those OSes).

## Phase 2 (not done)

Black previews → a still per look (generated thumbnails in the data set); timeline playback on the client clock;
Devices tab read-only device-view; web icon font fallback; a "Reset demo" action.

## Publish (29.10, Opus)

**Not published — stopped at step 1 (file audit); nothing committed, nothing pushed, workflow not renamed.**

- Pure demo (would commit as-is): `godot/client/core/demo/` (3), `godot/client/demo/` (10 json),
  `godot/client/tests/test_demo_server.gd`, `tools/demo/build-demo-data.py`, `features/settings/settings_panes.gd`
  (only the `demo_switch` hunk), `app/header_project.gd`, `app/shell.gd`, `video/video_surfaces.gd`,
  `export_presets.cfg` (demo/*.json include + [preset.4] Web), `tools/ci/check-max-file-lines.js` (web-demo skip),
  `.github/workflows/demo-pages.yml.draft`, this WO. `.gitignore` needs no change: `godot/**/export/` (line 150)
  already ignores `godot/export/web-demo/`.
- **Mixed — not committable alone:** `godot/client/core/api.gd`, `core/ws.gd`, `core/config.gd` carry the demo hooks
  AND the uncommitted WO-811 auth changes (AuthModel / AuthPrompt preloads, `_login()` 401 retry, `_send` /
  `_send_bytes` split with auth headers, WS `handshake_headers`, `_load_password` / `adopt_local_password` /
  `set_password`). Those need the untracked `core/auth_model.gd` / `core/auth_prompt.gd` (WO-811, not committed).
  In config.gd the demo override is deliberately placed after `_load_password()` (WO-811 pin in test_auth_wo811.gd).
- Committing the pure-demo files without those three would break main: `shell.gd`, `header_project.gd`,
  `video_surfaces.gd`, `settings_panes.gd` read `Config.demo` / `Config.DEMO_LABEL`, which only the uncommitted
  config.gd defines; and a Web export without the api/ws hooks would try to reach a server.
- Options for the owner: (a) commit WO-811 first (its own unit), then the demo commit is clean; (b) one combined
  WO-811 + WO-815 commit; (c) hand-stage only the demo hunks of the three files (`git add -p`-style) — untested
  intermediate state, not recommended.
- Checks run on the current working tree (all agents' edits): `check-max-file-lines` 0 over 500; offline suite 3571
  tests, 3569 pass, 0 fail, 2 skipped; Godot suite 22749 passed, 0 failed; the draft workflow parses as YAML.
- No CI / Pages runs (nothing pushed; local main is still 3 commits ahead of origin).

## Publish (29.10, Opus, sequential)

Owner 29.10: "commit and push sequentially". Option (a) above: WO-811 first, then WO-818, then this WO. Each commit was
tested in a detached temporary worktree at that commit (`git worktree add --detach`, removed afterwards) with the CI
gates (require integrity, 500-line limit, unwired exports, ESLint ≤ 216 warnings, Prettier), the offline suite under
`xvfb-run` and the Godot suite + boot check with that worktree's `godot/client`, then pushed (`git push origin main`).

| commit | content | worktree tests |
|---|---|---|
| `7b4fa842` | WO-811 auth (phases 1-3 + template credentials). `core/api.gd`, `ws.gd`, `config.gd` staged as **auth-only blobs** (`git hash-object -w` + `update-index --cacheinfo`; the demo lines removed), so the commit has no reference to `core/demo/`. First test found 2 new ESLint warnings (217 > 216) and one unwired export → fixed in the commit (amend) and retested | offline 3520 / 3511 pass / 0 fail / 9 skipped; Godot 22252/0; boot OK |
| `258e5fad` | WO-818 NotchLC warning, tooltip without the ffmpeg command ("Transcode it to HAP in HighAsCG") | offline 3524 / 3515 / 0 / 9; Godot 22266/0; boot OK |
| `deb38d56` | this WO: `core/demo/`, `demo/*.json`, `tools/demo/`, the demo hooks in api/ws/config.gd (full working files), settings / header / shell / video_surfaces, Web preset, line-limit skip, `.github/workflows/pages.yml` (the draft moved over it, YAML parsed, header comment updated) | offline 3524 / 3515 / 0 / 9; Godot 22401/0 (+135); boot OK; local Web export of that tree: index.wasm 39.5 MB, index.pck 2.5 MB |

The 9 skips are worktree-only (no companion-module-dev checkout beside it, no dist-web, two CI-only tests). The push of
`7b4fa842` also carried three earlier local commits (c115e0d1, 335b030f, 24c71734) that were already ahead of origin.

**CI / Pages runs**
- `7b4fa842`: CI https://github.com/mko1989/highascg/actions/runs/40895044170 — **failure in the `release` job only**
  (verify, godot, build-client green): "Server prerelease" got `HTTP 403: Resource not accessible by integration` from
  the GitHub releases API — not a code failure; the same job passed 4 minutes later on `deb38d56`. Pages run
  https://github.com/mko1989/highascg/actions/runs/40895044261 cancelled (superseded, `cancel-in-progress`).
- `258e5fad`: CI https://github.com/mko1989/highascg/actions/runs/40895379676 cancelled (pending run superseded by the
  next push); Pages https://github.com/mko1989/highascg/actions/runs/40895379560 success (old workflow, no demo).
- `deb38d56`: CI https://github.com/mko1989/highascg/actions/runs/40895716710 **success** (verify, godot, build-client,
  release → prerelease `Server 2026-10-29T145635Z`); Pages https://github.com/mko1989/highascg/actions/runs/40895716301
  **success** (Jekyll docs + Project Map + Web demo).

**Live**
- https://mko1989.github.io/highascg/demo/ → HTTP 200 (`<title>HighAsCG Operator</title>`; `index.wasm`, `index.pck` 200).
- https://mko1989.github.io/highascg/ → HTTP 200 (`HighAsCG documentation | highascg`).
- Screenshots in `/tmp/claude-1000/-home-casparcg/03d195b7-40ef-44d0-b117-27e2e6a3e0d1/scratchpad/pages_demo/`:
  `demo_1280x720.png` (`firefox-esr --headless --screenshot`, 1280×720) shows only Godot's loader with "WebGL2 …
  missing" — headless Firefox here has no GL, not a page fault. `demo_xvfb_1280x720.png` (Firefox ESR, own profile, on a
  private Xvfb `:116`, never `:0`, 50 s after load) shows the demo running: header "Demo show" + "DEMO — no server",
  Live tab with PGM 1 / LED wall, PGM 2 / Projection, PRV 1 / PRV 2 (black, no video in a demo), LED wall 6 looks
  (Opener on PGM, Loop A on PRV, Loop B, Song 1) and Projection 3 looks, Sources "demo" / "EFFECTS", Inspector,
  Playlists / Timers / Program audio footer.
- Not verified: an operator click-through on the published page (takes etc. were exercised on the local Web build
  earlier, section 3).
