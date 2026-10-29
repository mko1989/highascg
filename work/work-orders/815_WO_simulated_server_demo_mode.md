# WO-815 — Simulated server ("demo mode") in the Godot client + a static Web demo

**Status: DONE (29.10, phases 1 + 2) — phase 2 (stills per look, timeline playback on the client clock, read-only
Devices view, "Reset demo") verified by the Godot suite 22969/0 (101 new phase-2 assertions), a desktop demo client on a
private Xvfb (play / pause / take / stop, PRV push + TAKE change the stills, Devices write refused, Reset restarts with
--demo) and the local Web export in Firefox ESR (same stills, timeline plays, Devices loads, Reset reloads). Phase 1:
Godot 22685/0, published 29.10 (see "Publish (29.10, Opus, sequential)"). Not committed yet (phase 2 files are in the
working tree); owner eye on the demo still welcome.**

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

## Phase 2 (planned list)

Black previews → a still per look (generated thumbnails in the data set); timeline playback on the client clock;
Devices tab read-only device-view; web icon font fallback; a "Reset demo" action. Built in "Phase 2 (29.10)" at the end
of this WO; the web icon font fallback was done separately by WO-826.

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

## Follow-up 29.10 evening: the demo is the site root

Owner: "The GitHub pages still show docs instead of the Godot client with simulation server."
- `pages.yml`: the Web export goes to the site root; Jekyll builds into `_site/docs` with `docs/_config.yml`
  `baseurl: /highascg/docs` (jekyll-github-metadata only fills baseurl when it is unset); `/demo/` is a redirect page to
  the root; the Project Map stays at `/map/map.html`. README: "Try the demo" → root, Wiki → `/docs/`.
- Verified live after Pages run 40920456181 (success): `/` 200 `<title>HighAsCG Operator`, `index.wasm` 200, `/demo/` 200
  redirect page, `/docs/` 200 `HighAsCG documentation`, `/docs/ARCHITECTURE.html` 200, docs CSS
  `/highascg/docs/assets/css/style.css` 200, `/map/map.html` 200 (`/map/` alone was already 404: the map page is
  `map.html`). Firefox ESR on a private Xvfb :117, 55 s after load: the demo runs at the root ("Demo show",
  "DEMO — no server", LED wall 6 looks, Projection 3 looks) — scratchpad `pages_root/root_demo.png`.

## Phase 2 (29.10)

### Investigation

- **Why the previews were black.** `video/video_surfaces.gd` builds one reader per role (`pgm1` / `prv1` / … / `chN`,
  and the operator surface `opgui`) from the server's shm / feed descriptors; the demo answers
  `/api/video-surfaces` empty, so no reader exists. The Live tab's preview is **not** per-channel: it is the operator
  surface `opgui` (Caspar's operator channel), whose PGM / PRV windows `features/live/compose_tiles.gd` lays out with
  `POST /api/operator-gui/layout {cells:[{id, role, mainIndex, rect}], atlas:true}` (src/api/routes-operator-gui.js).
  A first attempt that only fed `pgmN` / `prvN` left the Live preview purple "NO SIGNAL", which proved that.
  Role → channel: src/system/video-surfaces.js `resolveRoleChannel` (a PGM-only main has no PRV).
- **Look cards** fetch `GET /api/thumbnail/<media id>` over `Api.get_bytes` (features/live/look_thumb.gd); in phase 1
  every `get_bytes` answered 501. Audio media have no thumbnail on a box either ("No preview" on the Opener card,
  whose layers include wav files, is the box's behaviour).
- **Timelines.** The node keeps them in src/engine/timeline-engine.js + timeline-playback-runtime.js: one cell per
  timeline `{position, playing, loop, _t0, _p0}`; `getPlayback` → `{position, playing, loop, timelineId, sendTo}`,
  broadcast as `timeline.playback` (index.js) on every transport change and `timeline.tick {timelineId, position}`
  throttled to 165 ms while playing. `normalizeTimelineSendTo`; a paused timeline on air resumes where it stands; stop
  resets a PGM `sendTo` to PRV-only; take = sendTo PGM-only + play from the current position
  (src/api/routes-timeline.js, timeline-take.js). PUT creates when missing; POST /api/timelines upserts.
- **Devices tab** reads `GET /api/device-view` (one big document: live hardware, screen destinations, cables). A
  capture from this box (`GET 127.0.0.1:4200/api/device-view`, read-only) holds host name, EDID, monitor serials, log
  and `/dev/` paths, owner device names — it has to be rebuilt, not copied.
- **Reset.** The demo state lives only in memory (`Demo.shared()`), so a fresh process is the shipped show. Phase 1's
  "Restart client" uses `OS.set_restart_on_exit(true, OS.get_cmdline_args())`, which drops the user args after `--`
  (so `--demo` would be lost); `app/connection_menu.gd restart` already keeps them (`Profiles.restart_user_args`).

### What was done (per file, and why)

- **`tools/demo/build-demo-extras.py`** (new, 210 lines) — builds the two new data files from the phase-1 data set and a
  device-view capture: `python3 tools/demo/build-demo-extras.py --device-view <capture.json>`.
  - `thumbs.json` (191 kB): one generated 640-wide JPEG per MOVIE / STILL media (gradient + motif + the clip's name,
    nothing from a real file; aspect of the screen the first look shows it on), base64 in JSON. JSON, not `.jpg`
    files, because `res://demo/*.json` is already in every export preset's include filter and FileAccess reads it
    without Godot's importer (a `.jpg` would need `.import` files and an import step in CI / Pages).
  - `device_view.json` (22 kB): the capture with its destinations mapped onto the demo's by mode + main index (ids and
    labels replaced), owner device / monitor names neutralised, EDID / monitor identity / log / `/dev/` / `/home/`
    paths cleared, mode lists trimmed, host `demo`, DeckLink refs = index, audio devices limited to the PortAudio
    ones, Caspar host 127.0.0.1 with the demo's channel map. Both pass build-demo-data.py's public-safe scan
    (thumbs: its keys — random base64 happened to contain a banned 3-letter word).
- **`godot/client/demo/thumbs.json`, `demo/device_view.json`** (new, generated).
- **`core/demo/demo_video.gd`** (new, 186 lines) — the demo's VideoSurfaces reader, same face as video_feed.gd's
  RoleReader (`poll / frame / width / height / signal_lost`, RGBA8). A still per look, not video: the look on that
  channel in `scene.live` composited from the thumbnails with the look cards' own placement
  (`look_thumb_math.gd sorted_layers / placement`), black when the bus is empty. For `opgui` it composes the operator
  canvas: every PGM / PRV window of the stored compose layout gets its bus's still at its picture rect
  (`compose_tile_math.gd fit / to_px / source_aspect`). It redraws only when the bus / layout key changes (take, PRV
  push, clear, FTB). Reusing the two math files keeps the demo pictures where the real ones would be.
- **`core/demo/demo_timeline.gd`** (new, 232 lines) — the timeline engine on the client clock: routes GET / POST
  `/api/timelines`, GET / PUT / DELETE `/:id`, POST play / pause / stop / seek / sendto / loop / take, GET state;
  cells, resume-on-air, stop → PRV-only, end → loop or stop, `timeline.playback` + `timeline.tick` (165 ms) — the
  server's shapes, so `timeline_transport.gd` runs unchanged. Seeded from the project's timelines.
- **`core/demo/demo_server.gd`** — routes `/api/timelines` to demo_timeline (the phase-1 list/get/put in
  `demo_extras.gd` removed), `GET /api/device-view` from the data set (every write to it stays 501 → read-only),
  `get_bytes()` (thumbnails → JPEG, the rest 501), `tick()`; the operator-gui layout POST no longer QUIET.
- **`core/demo/demo_scene.gd`** — GET / POST `/api/operator-gui/layout` keep the compose cells (`op_cells`), answered
  with `atlas:null` (no atlas in a demo).
- **`core/demo/demo_extras.gd`** — the phase-1 timelines branch moved out (see above).
- **`core/api.gd`** — `get_bytes` in demo answers from `Demo.shared().get_bytes()`.
- **`core/ws.gd`** — the demo branch of `_process` calls `Demo.shared().tick()` once a frame (timeline clock).
- **`video/video_surfaces.gd`** — in demo, readers are `DemoVideo` instances, `is_native()` false, descriptors ignored,
  frames uploaded with `update_rgba` like the feed path.
- **`features/settings/settings_panes.gd`** — "Reset demo" button (only in demo): desktop → `ConnectionMenu.restart`
  (keeps `--demo`), Web → `window.location.reload()`. The note mentions timelines. On Web the "Simulated server"
  option now shows "On" (it is disabled there and the Web build is always a demo; it showed "Off" before).
- **Tests**: `tests/test_demo_phase2.gd` (new, 101 assertions: thumbnails, look still compositing, role channels and
  sizes, reader follows the bus, operator surface windows, timeline on the clock incl. tick throttle / end / loop,
  take / stop / create, device view read-only, reset + hooks keep `--demo`); `tests/test_demo_server.gd` adjusted
  (public-safe scan reads thumbs.json keys only; the quiet boot-write example is now `POST /api/client-prefs`).
- **Web icon font fallback**: done by WO-826 (DejaVu Sans symbol subset as Rewir's fallback) — nothing here.

Simulated after phase 2 (in addition to phase 1): media thumbnails, PGM / PRV / operator-surface stills, timeline
playback (play / pause / stop / seek / loop / sendto / take, ticks), operator-gui layout, Devices view (read-only).
Still "not in demo": live-input / video frames, timeline pictures in PRV / PGM (a playing timeline does not change the
stills), timeline flags (pause / jump), layer opacity / rotation in stills, models, shaders, tracking, network, cluster,
streaming, device-view writes.

### What was VERIFIED

- **Godot suite: 22969 passed, 0 failed** (full run after the last change; the 18 ERROR / WARNING lines in the log are
  the pre-existing ones). `test_demo_phase2.gd` 101 + `test_demo_server.gd` 152 = 253 / 0 in an isolated run.
  `node tools/ci/check-max-file-lines.js`: 0 files over 500. Headless demo boots on tabs 0 / 2 / 4 / 6: 0 script
  errors.
- **Desktop demo client on a private Xvfb :93** (never `:0`; the owner's GUI untouched), screenshots in
  `/tmp/claude-1000/-home-casparcg/03d195b7-40ef-44d0-b117-27e2e6a3e0d1/scratchpad/wo815/`:
  - `base_devices.png` — before: Devices "Could not load devices: not in demo".
  - `p2_live.png` — Live: PGM 1 Opener, PRV 1 Loop A, PGM 2 Projection loop, PRV 2 Song 1 projection stills; look
    cards with thumbnails. `thumbs_sheet.png` — all generated stills.
  - `p2_live_prv_push.png` → `p2_live_take.png` — click Loop B: PRV 1 becomes Loop B; TAKE: PGM 1 becomes Loop B.
  - `p2_timeline_idle.png`, `p2_timeline_play_a.png` / `_b.png` (00:00:04:00 → 00:00:07:03 three seconds later,
    playhead moves), `p2_timeline_pause_a.png` / `_b.png` (paused at 00:00:21:04, identical pixels 3 s apart),
    `p2_timeline_take.png` (Take: PGM checked, PRV off, plays on from 21:04 → 23:06), `p2_timeline_stop.png` (00:00,
    back to PRV-only).
  - `p2_devices.png` — Devices view loads (Operator GUI / LED wall / Projection, rear panel, 4 cables, no host data);
    `p2_devices_write.png` — "Reset all cabling" → OK: "not in demo: POST /api/device-view", cables unchanged.
  - `p2_settings_reset.png` — "Reset demo" button; pressing it (timeline playing) restarted the client with
    `-- --demo --resolution 1920x1200 --position 0,0 --tab=2` (new pid, args kept) → `p2_after_reset.png`: timeline at
    00:00, paused, demo show as shipped.
- **Web export** (preset "Web" → `godot/export/web-demo/`, index.pck 2.99 MB (+0.4 MB: thumbs.json + device_view.json,
  both found in the pck), index.wasm 39.5 MB), served with `python3 -m http.server 8816 --bind 127.0.0.1`, Firefox ESR
  with its own profile on a private Xvfb :118: `web_p2_live.png` (stills + card thumbnails, icon glyphs render),
  `web_p2_timeline.png` / `web_p2_timeline_play.png` (00:00:04:02 after play), `web_p2_devices.png`,
  `web_p2_settings.png` → Reset demo → the page reloaded (2nd `GET /index.html` in the server log) →
  `web_p2_after_reset.png` fresh demo.
- **NOT verified:** the published Pages site with phase 2 (nothing committed / pushed by this run); Windows / macOS
  builds; the owner's eye.
- **Known, not changed:** phase 1's "Restart client" (Simulated server switch) still restarts with
  `OS.get_cmdline_args()` and so drops user args; deliberate enough there (switching the demo off must not keep
  `--demo`), but a `--tab` / `--resolution` given on the command line is lost too.

### Phase 2 published (29.10, Opus)

Commit 3d1f28ac pushed; CI and "Deploy GitHub Pages" green. The published https://mko1989.github.io/highascg/index.pck
(2.96 MB) contains `core/demo/demo_video.gdc`, `core/demo/demo_timeline.gdc`, `demo/thumbs.json` and
`demo/device_view.json` (checked by downloading the pck).
