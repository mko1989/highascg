**Status: DONE pending owner check (2026-10-21) — box acceptance PASSED (boot, state mirror, survives server + Caspar restart, native operator picture); CI `godot` job green on every push; operator-monitor placement + HiDPI + the native "Make this the operator screen" picker done 2026-10-21 (box-verified); the systemd unit moved to [WO-609](./609_WO_godot_cutover_packaging_kiosk_decommission.md) T2; T6 (dev reload + journald log format) is a nicety left open. Parent: [WO-593](./593_WO_godot_client_port_epic.md). Starts after WO-595 GO. Everything in WO-600…608 builds on it.**

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

- [x] T1 `.gitignore` + `.stignore` (box **and** Mac) for `godot/.godot/`, `godot/build/` — FIRST commit (+ the `core/` un-ignore, box run 17.10).
- [x] T2 project skeleton + engine pin + CI job (`godot` job: shm seqlock, bridge round trip, unit tests, `--check` boot — green on every push; the export is WO-609 T1).
- [x] T3 Ws / StateStore / Api / SettingsState / ProjectSync + tests (box acceptance 17.10).
- [x] T4 WindowManager + operator display + HiDPI + native operator-screen picker ✔ 2026-10-21 (below).
- [x] T5 UI kit + Theme from tokens (`app/theme_builder.gd`; owner look-and-feel notes handled in WO-621…630).
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

## Box acceptance (2026-10-17, after the Mac pushed `core/` = 2118fd2)

- Headless **87/0** (was 40/2 without `core/`); WO-598 parity smoke 3/3.
- Windowed on DP-3 against the live server + Caspar 2.5.1: boots, eye green, mirrors state (29-30 keys),
  WS ~2000 msgs; **node restart** at t=15 s → `ws reconnected — resync`; **Caspar RESTART** at t=35 s →
  config shm consumer re-created 21 s later, client reattached with live picture (screenshot).
- Operator picture needed `videoOutput: shm` on the operator destination — the device-view update
  silently dropped that field (fixed under WO-597, `110c05d`); applied via `/api/caspar-config/apply`.
- Acceptance met on the box except: HiDPI, multi-monitor placement (box has one monitor), systemd unit.

## Earlier notes

Nothing yet. Engine/godot-cpp versions verified by `git ls-remote`; everything else from research + inventory.

## 2026-10-21 — T4: open on the operator monitor, HiDPI scale

**Investigation:** the client honoured only `--screen=N` (`main.gd`), and the box's two monitors make a wrong
default costly: DP-2 at +1920 is the operator monitor, DP-6 at 0,0 is a Caspar output. The server already says which
one is the operator's (`GET /api/system/operator-display` → `rect {x, y, width, height}`, from the destination
config). The kiosk scaled its UI with `operator-gui-scale.js` (Firefox `devPixelsPerPx` = resolution ÷ 1920×1080,
clamped 1–4); `screen_get_scale()` is 1.0 on X11, so the Godot client had no scaling at all.

**What was done:**
- `app/window_placement.gd` (pure): `pick_screen(rect, screens)` (exact origin, else the screen holding the rect's
  centre, else -1) and `ui_scale(size, override)` (the kiosk rule: 1 at / under 1080p, 2 at 2160p, 2 decimals,
  clamped; an override wins); `saved_scale()` / `apply_scale()` for ui.cfg `[window] ui_scale`.
- `main.gd` `_apply_window_args`: `--screen` wins; otherwise the operator monitor from the server; then
  `content_scale_factor` from that screen's size, or ui.cfg / `--ui-scale`.
- Settings → Defaults → **This screen → UI scale** (Auto / 1× / 1.25× / 1.5× / 2×), kept in this screen's ui.cfg
  (not a server setting — another screen may differ), applied at once (`settings_form.local_option`).
- Tests: `tests/test_window_placement.gd` (14: the box's two-monitor layout, inset rect, no answer, headless; scale
  at 720p / 1080p / 1440p / 2160p / ultra-wide, override + clamp).

**What was VERIFIED:** Godot 20442 pass, `--check` clean. Box: launched with no `--screen` → the window sits on DP-2
(`xdotool`: position 1922,32 screen 0, 1918×1059), DP-6 still shows the PGM output; scale 1× at 1080p. Settings → UI
scale → 1.25× redrew the whole client at once and wrote `ui_scale=1.25`; Auto put it back (1×). ui.cfg restored
byte-identical afterwards. Not on the box: a 4K operator monitor (Auto = 2×) and the move from a wrong screen (the
window manager already opened it on DP-2; forcing it onto the PGM monitor to watch it jump was not worth showing a
window on that output) — `pick_screen` is unit-tested for that case.

**Note:** a manual scale above Auto squeezes the layout (1.25× on 1080p = 1536 logical px wide; the header clips its
right end). It is meant for small high-density panels, not to enlarge a 1080p screen.

## 2026-10-21 — T4: the native "Make this the operator screen" picker

**Investigation:** the WO-290 picker is a python-xlib prompt (`tools/runtime/operator-monitor-picker.py`) that the
kiosk launcher runs on a fresh multi-screen boot; its decision code (`src/system/operator-monitor-picker.js`) is pure:
`listPickerOutputs` (xrandr outputs + their 1-based flag port, from the same GPU map the resolver uses) and
`applyOperatorMonitorChoice` (sets `casparServer.screen_N_operator_monitor`, clears the others at both levels, wires
the operator_gui cable). No HTTP route exposed either. First box try: the prompts appeared on both screens, but the
pointer confine (XFixes barriers on DP-2) made the DP-6 prompt unclickable — and toggling the confine over HTTP needs
the nuclear password; the buttons also drew unthemed (native windows do not inherit `main.gd`'s theme).

**What was done:**
- `src/api/routes-operator-screen.js` (registered on router line 488, no new router line):
  `GET /api/system/operator-screen` → `{ outputs[{name, port, x, y, width, height, current}], port }`;
  `POST … { name }` → WO-290's `applyOperatorMonitorChoice` + `configManager.save` (400 / 404 / 422 for no name /
  unknown output / no port slot); `POST … { prompt: true|false }` lets the pointer off the operator monitor while the
  prompts are up and confines again on close (75 s backstop if the client vanishes); after a pick it re-confines to the
  NEW monitor. It only ever re-confines what it released itself.
- `app/operator_screen_picker.gd` (Node) + `app/operator_screen_model.gd` (pure: `match_outputs` screen → output by
  origin, else centre; `screen_line`; `should_auto_open`): one borderless, always-on-top window centred on every
  screen (scaled like the main window), "Make this the operator screen" (disabled for an output with no port slot) +
  "Cancel (Esc)"; 60 s timeout. Native windows need `gui_embed_subwindows = false` on the root, which Godot refuses
  while an embedded dialog shows — the picker says "close the open dialog first" then; the flag is put back (windows
  hidden first) on close. A pick moves this window to that screen.
- Settings → Defaults → This screen → **Operator screen: Choose operator screen…** with a result line.
- `main.gd`: a fresh box (no rect from `/operator-display`, no flagged port, > 1 screen) opens the picker at start-up —
  the WO-290 boot prompt, natively, for when the Godot client replaces the kiosk (WO-609).
- Tests: `tools/smoke/smoke-wo599-operator-screen.test.js` (5: GET marks the flagged output; POST moves the flag,
  clears both levels, rewires the cable; refusals save nothing; raw JSON body; confine release / restore on cancel,
  pick, backstop, never-released; registry GET + POST without Caspar) and `tests/test_operator_screen_model.gd` (12).

**What was VERIFIED:** offline 3024 pass, Godot 20454 pass, `--check` clean, lint 216, files ≤ 500, contract
regenerated. Box: Settings → Choose operator screen… → "Screen 2 — DP-6" over the PGM output and "Screen 1 — DP-2
(operator screen now)" on the operator monitor, themed; the barrier process stopped (`xdotool mousemove_relative`
from x 1930 by -100 reached 1830; with the confine on it stops at 1920); **Cancel** on DP-6 closed both, the barrier
came back (stops at 1920 again), "Nothing changed — cancelled."; **Make this the operator screen** on DP-2 → "Operator
screen: DP-2.", journal shows the confine re-synced on DP-2, `caspar_server.json` / `device_graph.json` semantically
unchanged (the `false` flags dropped, the cable re-added) — both restored byte-identical from the backup and node
restarted. Popups still embed afterwards (UI scale dropdown); ui.cfg unchanged. An earlier run also showed the 60 s
timeout restoring the confine. Not on the box: actually moving the operator screen to DP-6 (it is the PGM output),
and the fresh-box start-up prompt (the box has a monitor flagged) — `should_auto_open` is unit-tested.

