**Status: IN PROGRESS (2026-10-17) — foundation implemented in `godot/client/` and verified on the dev Mac against the real server protocol (simulator); box run pending. Parent: [WO-593](./593_WO_godot_client_port_epic.md). Starts after WO-595 GO. Everything in WO-600…608 builds on it.**

# WO-599 — Godot client foundation: project, engine pin, networking, state, theme, windows, CI, dev loop

## Investigation

Inputs: research [`godot-ecosystem-research.md`](../godot-port/inventory/godot-ecosystem-research.md) (risks 2–9),
contract inventory [`shell-settings-contract.md`](../godot-port/inventory/shell-settings-contract.md) §1–7,
CLAUDE.md house rules.

- **Engine:** latest stable **4.7.2** (✔ tag `4.7.2-stable`, git ls-remote 2026-10-17); 4.6.3 (dev Mac)
  is the last 4.6 patch and goes security-only once 4.8 ships (beta1 15.10.2026, stable expected Q4).
  Minor releases carry small API breaks (4.7: accessibility enums, RichTextLabel image params,
  input device ids). → **pin 4.7.x**, exact version + export templates in `godot/GODOT_VERSION`;
  one deliberate upgrade per minor, reading the migration guide.
- **Renderer:** Forward+ or Mobile (RD path required for WO-596). Benchmark both in WO-595.
- **Display:** X11 (Godot's default driver). Native Wayland cannot place windows on a chosen
  monitor → stay X11 (the box runs Openbox/X11). `screen_get_scale()` = 1.0 on X11 → do HiDPI
  ourselves (`content_scale_factor` from `screen_get_dpi`).
- **Frame pacing (research risk 2):** FIFO vsync on X11/NVIDIA with mixed-refresh monitors stutters to
  the slowest (godotengine/godot#62821, also vkcube); 50 fps channels on 60 Hz panels judder. The
  Caspar screen consumers already live with this on the PGM/multiview outputs.
- **Networking (research §6):** `HTTPRequest` = one request per node, new connection each time, no
  multipart helper, no streaming upload; `WebSocketPeer` buffers default 64 KB (must be raised
  *before* connect), no permessage-deflate, must be polled; JSON numbers become floats.
- **Desktop integration:** native file dialogs need xdg-desktop-portal over D-Bus (absent in a bare
  Openbox session); no tray/notification API on Linux.
- **Lists:** `Tree`/`ItemList` are not virtualized (pain at 10k+ rows; godotengine/godot#70869). Our
  media library is ~418 video files (WO-592) — fine today, but the logs modal and catalog can grow.
- **Tooling:** gdUnit4 ≥ 6.2.2 / GUT 9.7 support 4.6–4.7; `godot --headless` runs logic tests and
  exports in CI; gdtoolkit (gdlint/gdformat) stale since 2025-10 → GDQuest formatter or gdstyle.
- **House rules that apply:** 500-line file limit (CI), small verified commits, Syncthing peers
  (`godot/.godot/` import cache MUST be in `.gitignore` + `.stignore` before the project exists on
  any peer — the WO-354 "shader fight" class of bug), owner minimalism principle.

**Language (owner 17.10: "whatever is recommended"):** typed GDScript for the app, C++ (godot-cpp 10)
for `hshm` and any hot path. **Dev Mac note:** Godot 4.7.2 on the Intel Iris Mac fails compute pipelines
(bundled MoltenVK 1.4.1) → 3D dev on that Mac uses 4.6.3; the box (native Vulkan) stays pinned to 4.7.x
unless WO-595 M8b says otherwise.

## Design

### Repo layout

```
godot/
  project.godot  GODOT_VERSION  export_presets.cfg
  addons/hshm/                     (WO-596)   addons/gdUnit4/ (vendored, pinned)
  app/            main.tscn, AppRoot.gd (boot sequence), WindowManager.gd
  core/           Api.gd (HTTP pool), Ws.gd, StateStore.gd, SettingsState.gd, ProjectSync.gd,
                  SignalBus.gd, Contract.gd (constants from /api/contract/constants, WO-598)
  ui/kit/         Theme.tres, NumberField, TimeField, FractionSlider, VirtualTable, Section,
                  Modal, Toast, IconButton (built once, used everywhere)
  features/       live/ inspector/ timeline/ media/ audio/ device/ secondary/ previs/ settings/
  tests/          gdUnit4 suites (pure logic + golden project fixtures from WO-598)
```

### Core services (autoloads)

- **Ws**: `WebSocketPeer` with `inbound_buffer_size`/`outbound_buffer_size` = 64 MB set before
  connect; envelope `{type, data}`; reconnect 1-2-4-8-16-30 s + ≤ 20 % jitter, forever (same as
  `ws-client.js:13-21`); emits `connected`/`disconnected`/`message(type, data)`; JSON parsing of
  large frames (`state`, `project_sync`) on `WorkerThreadPool`; ids kept as strings.
- **StateStore**: dotted-path store with per-path + `'*'` signals (fix the web client's double
  `'*'` emit — WO-611 note); `state` snapshot authoritative on every connect; `scene.live` seq-gap
  → `GET /api/state`.
- **Api**: pool of N `HTTPClient` connections (keep-alive) with a request queue, JSON in/out, error
  objects with `status`/`reason` like `api-client.js`; uploads: on-box → server-side local ingest
  (WO-603), remote → chunked/resumable server endpoint (new) streaming from `FileAccess`.
- **ProjectSync**: the autosave/rev protocol exactly as specified in WO-598 (3 s debounce, single
  flight, 409 `stale_rev` ≤ 3, 410 latch, echo-skip latch, `remote` guard).
- **SettingsState**: whole-object `POST /api/settings`, 600 ms debounce (no Save button — same UX).

### Windows and monitors (replaces xdotool + the WO-290 python picker)

- `WindowManager`: reads `GET /api/system/operator-display` (operator monitor rect); main window
  borderless fullscreen on that screen via `DisplayServer` screen APIs; pop-out windows
  (`embed_subwindows=false` only for real detachable panels, e.g. previs) placed by the same code.
- Operator-monitor picker (WO-290) re-done natively: one undecorated window per screen showing
  "Make this the operator screen", result posted to the server.
- HiDPI: `content_scale_factor` from DPI, overridable in settings (replaces `operator-gui-scale.js`).
- Pacing — **OWNER RULE 17.10: every output runs at the project rate** ("when the project is 50fps all
  outputs should be 50fps and similarly for 60fps") → the client sets/asserts the operator monitor
  mode at the project fps (via the server, same mechanism as other outputs) and warns when it differs.
  M0 on the Mac confirmed why: 50 fps on a 60 Hz panel skipped ~1.4 % of frames on display while the
  transport lost none (WO-595). Previous wording: vsync on; operator monitor at 50 Hz; fallback mode =
  vsync off + `Engine.max_fps = channel fps` paced by the shm frame clock. Decided by WO-595 M8.
- File dialogs: Godot's built-in `FileDialog` (no portal dependency on the ISO).

### Theme

`Theme.tres` generated from the web design tokens (16 root tokens in `client/styles/01a1-base-theme-tokens.css:17-36`,
font **Rewir** woff/ttf — inventory E §CSS); 29 CSS variables are referenced but never defined in
the web client (inventory E) → define the Godot palette explicitly, owner-approved once.

### Dev loop + CI (house rules)

- Dev: edit on the Mac or box (Syncthing), `godot --path godot` runs it; **reload = WS message**
  `client_reload` from the server (replaces `DISPLAY=:0 xdotool key F5`).
- CI job `godot` (`.github/workflows/ci.yml`): download the pinned engine + templates (cached),
  formatter check, `check-max-file-lines.js` extended to `godot/**/*.gd`, gdUnit4 headless,
  hshm reader ctest, Linux export artifact.
- `tools/ci/run-offline-tests.js` stays JS-only; Godot tests have their own runner script.

## Tasks

- [ ] T1 `.gitignore` + `.stignore` (box **and** Mac) for `godot/.godot/`, `godot/build/` — FIRST commit.
- [ ] T2 project skeleton + engine pin + CI job (empty app boots headless, exports).
- [ ] T3 Ws / StateStore / Api / SettingsState / ProjectSync + tests against a recorded WS session.
- [ ] T4 WindowManager + operator display + native picker + HiDPI.
- [ ] T5 UI kit + Theme from tokens (owner look-and-feel review).
- [ ] T6 dev reload message + logs to journald (stdout) with the server's log format.

## Acceptance

- Godot client boots on the box, connects, mirrors `state` (connection eye green), survives server
  restart and Caspar restart, lands on the operator monitor without xdotool.
- CI green with the new `godot` job.

## What was done (2026-10-17, dev Mac)

| Path | What |
|------|------|
| `godot/GODOT_VERSION` | engine pin **4.7.2** (box + CI); dev Mac runs 4.6.3 for 3D (MoltenVK issue, WO-595) |
| `godot/client/project.godot` | autoloads `Config`, `Api`, `Store`, `Ws`, `Settings`, `VideoSurfaces` |
| `core/config.gd` | server origin (`--server=` > `HIGHASCG_SERVER` > `http://127.0.0.1:4200`), ws URL rule of `api-origin.js` |
| `core/api.gd` + `core/net_util.gd` | pool of 6 `HTTPRequest`s, await-able `get/post/put/delete_json`, `{ok,status,data,error,reason}` like `api-client.js` |
| `core/ws.gd` | `/api/ws`, `{type,data}`, `error→server_error`, 64 MB inbound buffer, backoff identical to `computeWsReconnectDelay` |
| `core/state_store.gd` | dotted paths + `'*'` (fires once — fixes the web double emit), `project` holder + `normalize_project` (= `normalizeProjectPayload`), `scene.deck` upsert, `scene.live` seq-gap detection |
| `core/settings_state.gd` | whole-object `POST /api/settings`, 600 ms debounce |
| `video/video_surfaces.gd` (+ shm reader/native/texture) | per-surface `Texture2D` from shm, native extension when installed |
| `app/main.gd` | boot order of `client/app.js`: settings → state → project → WS; `change` (+ seq-gap re-pull), `project_sync`, `scene.deck`; **re-connect resync** of settings + project |
| `app/theme_builder.gd` + `assets/fonts/Rewir-Light.ttf` (OFL) | Theme from the 16 web tokens (`01a1-base-theme-tokens.css:17-36`) |
| `app/shell.gd` | header (connection eye: server/Caspar, project name, status, origin) + tabs (Live + placeholders per port WO) |
| `tests/run_tests.gd`, `tests/test_core.gd`, `tests/test_deck_model.gd` | dependency-free headless runner; fails on suite load errors and on tests that make no assertion (proven with a deliberate failing suite → exit 2) |
| `run-client.sh` | run / `--test` |
| `core/project_sync.gd` + `core/project_sync_policy.gd` | show-document write path = web protocol: `scene_deck_sync` (100 ms debounce, 2 s echo memo, **resend on reconnect**) for looks + autosave (3 s debounce, single flight, `rev`, 409 `stale_rev` ≤ 3, 410 latch, echo-skip of our own `project_sync`); policy unit-tested (12 checks) |
| `.github/workflows/ci.yml` job `godot` | C++ seqlock test, bridge→probe round-trip, pinned Godot download, client tests |
| `tools/ci/check-max-file-lines.js` | now also `godot/`, `caspar/`, `.gd/.cpp/.h` (skips `.godot`, `build`); 0 tracked violations |

## What was VERIFIED (dev Mac, HighAsCG server in `--no-caspar` simulator, isolated copy in the scratchpad so nothing syncs to the box)

- Boot against the real server: settings ok, `/api/state` 29 keys, project 5 looks, WS connected (headless + windowed).
- **Live sync:** a look renamed through `POST /api/project/autosave` (`changed:true`) arrived via `project_sync` in the running client.
- **Server restart:** server killed at ~4 s, restarted at ~8 s → `ws disconnected` → `ws connected` (backoff), snapshot re-applied.
- Windowed: theme/font, header ("server ok · Caspar offline" correct for the simulator), live operator video from shm (native), deck (see WO-600).
- Unit tests: **52 passed / 0 failed** on 4.6.3 and on **4.7.2 from a clean checkout** (no `.godot`, no built extension) = the CI condition.
- Not verified: the GitHub Actions run itself (not pushed), the box (X11/NVIDIA/4.7.x), HiDPI, monitor picker, systemd unit.

## Box run (2026-10-17, shop dev box: X11, RTX PRO 4000, driver 595.71.05, DP-3 1920×1080@50)

**BLOCKER — `godot/client/core/` was never committed.** `.gitignore` `core` (core dumps) and `.stignore`
`core` also match the directory, so `api.gd, ws.gd, state_store.gd, config.gd, settings_state.gd,
net_util.gd, project_sync*.gd` exist only on the dev Mac (commit `e010372` + `601a6c6` lack them; no CI
run exists for `godot`, so nothing caught it). Same class: `.gitignore` `projects/` swallowed the WO-598
fixture `tools/fixtures/projects/take-payload-coverage.json`. Fixed the rules (`!godot/client/core/`,
`!tools/fixtures/projects/`, `.stignore` `!/godot/client/core` before `core`) — **owner: on the Mac pull,
mirror the `.stignore` line, then `git add godot/client/core tools/fixtures/projects` and push.**

- Engine: official 4.7.2 (SHA-512 verified) at `~/.local/opt/godot/godot` (no sudo for `/opt`; `GODOT=` env).
- hshm GDExtension: `build.sh` built clean (gcc, godot-cpp fetched), installed into client + m0.
- Headless `run-client.sh --test`: **40 passed / 2 failed** — `test_core`, `test_project_sync` cannot
  compile (missing `core/`); `test_deck_model`, `test_previs_uv_mapper` pass on 4.7.2. Windowed client
  cannot boot (6 autoloads in `core/`).
- Offline JS suite on the `godot` branch: 2593/2599 — 2 fail on the missing WO-598 fixture, 2 also fail
  on `main` (pointer-confine reason test, shader library "Value" label — box-environment, pre-existing).
- Server on the `godot` branch: `/api/video-surfaces` answers (all `channel:null` — box has 1 channel).
- M0 spike (WO-595) native reader, Vulkan Forward+, NVIDIA, synthetic bridge 15 s each: canvas 49.3 fps,
  frame p95 20.4 ms, latency p50 4.4 ms, 31/721 gaps, 0 lapped; atlas 49.2 fps, 37/715 gaps; previs
  3072×1728 45.7 fps avg, **130/752 gaps (17 %)**, frame p95 21.5 ms. Real Caspar shm (WO-594, ch1):
  latency p50 ~18–20 ms (one display frame: Caspar and the 50 Hz scan-out are separate clocks),
  gaps 6–13 %. Every run: ~145 ms first-frame hitch, `1 RID of type "Texture" was leaked` at exit.

## Earlier notes

Nothing yet. Engine/godot-cpp versions verified by `git ls-remote`; everything else from research + inventory.
