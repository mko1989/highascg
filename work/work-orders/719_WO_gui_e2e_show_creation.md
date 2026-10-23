# WO-719 — Automated GUI end-to-end checks for building a show (+ sandbox server isolation)

**Status: DONE (23.10.26 — full GUI run 26/26 green in the sandbox, live box fingerprint unchanged, offline gates
below). Remaining owner action: delete the stale branches (commands at the end — the session's permission layer
blocked branch deletion / push).**

Owner, 23.10: *"Figure out and start writing automated checks for each step of "creating" a show. Starting fresh
project, setting different sizes for outputs, using different outputs, inputs etc. Adding content to layers, to
timeline etc. … I've seen you do tests where you click in the gui the same a user would. I'd like to automate those
checks so different parts and different paths can be tested."* Plus: *"move [the Godot GUI] to the normal main branch
and stop other branches."*

## Investigation

### What existed
- GUI "clicking" so far = one-off `--probe-*` flags in `godot/client/app/main.gd` (probe-take, probe-effect,
  probe-pip, probe-cg, …), each hand-written, run against the **LIVE** server, results read from print lines. They
  call widget internals (`pressed.emit()`, `_select()`), so a hidden / covered / disabled control still "works".
- Godot unit runner `godot/client/tests/run_tests.gd` (models only, never loads UI scenes) and `--check` (boot).
- Server: `--no-caspar` = WO-453 simulated Caspar (`src/caspar/amcp-simulated.js`): INFO / INFO N stage XML from its
  own playback state, CLS from `local_media_path`. `POST /api/amcp/raw {cmd:"INFO 1"}` reads it back → a test can
  check what is actually "playing" on PRV / PGM.
- Godot renders on Xvfb (`xvfb-run … --rendering-driver opengl3`), screenshots work — a test client never appears on
  the operator's monitors.

### Why a second server is dangerous on this box (audit, file:line verified)
A sandbox instance with only `HIGHASCG_CONFIG_PATH` + `HIGHASCG_PROJECTS_DIR` set still reached the live box:
- **WO-718's incident explained** (`work-orders/718…` "Incident during verification"): `persistProject` →
  `pushProjectSlugToVolumes` copies the scratch project to `~/bridge/projects/` (`src/engine/project-scenes.js:276`,
  `project-volume-sync.js:334`; gate `volumeSyncAllowed()` was only "not under node --test"), and every
  `ConfigManager.save` schedules the exFAT sync (`config-manager.js:259`, `exfat-sync-on-save.js:18`) whose live map
  pair `bridge-projects` copies the bridge back into the LIVE `projects/`. Boot alone saves config, so it fires even
  without New project.
- **Pointer confine** (`src/system/pointer-confine.js` stop/sync): `pkill -f confine-pointer-barriers.py` +
  `pkill -x unclutter` at boot / settings / shutdown — would kill the live operator's barrier daemon. `"off"` still
  runs the pkills.
- Media-library registry hard-coded to repo `data/media-library/registry.json` (`media-library-registry.js:20`); a
  reconcile 10 s after boot would mark the live entries missing.
- `config/replication-local-identity.json`, `config/hardware-identity.json` under REPO_ROOT; `hostnamectl` when the
  derived name differs (`hardware-identity.js:209-268`).
- xrandr / OS layout on the hard-coded `:0` via API routes (`os-config-xrandr-apply.js:47`), Caspar window placement
  by xdotool after INFO CONFIG (`caspar-info-ready.js:46`), `POST /api/settings {local_media_path}` re-points the live
  media symlink (`settings-post.js:105`), browser_display inputs spawn real Firefox / x11grab on `:0`.
- Guarded already by env / config: state file (`HIGHASCG_STATE_FILE`), OS-layout watchdog, startup LED test, system
  inventory path, boot-screen gate/hold files (`CASPAR_SCREEN_*_FILE`), tracking plugin (`HIGHASCG_TRACKING=0`),
  Art-Net input 6454, OSC port, USB automount, replication, Caspar config apply (refused offline).
- `--no-osc` is a trap: no oscState → the sim OSC feeder never starts → no playback state. Move the port instead.

## What was done

### Sandbox switch — `src/bootstrap/sandbox.js` (`HIGHASCG_SANDBOX=1`)
One `isSandbox()` read by every side effect that had no guard: pointer confine (start/stop/sync no-op),
media-library registry under the instance cwd, replication identity next to the instance config, hardware identity
(no file write, no hostnamectl), exFAT sync on save + project volume sync (closes the WO-718 leak path), xrandr apply,
screen-consumer placement, the media-symlink re-point, browser-capture spawn. Chosen over "remember 25 env vars":
a new side effect gets one `isSandbox()` line, and the launcher cannot forget a var.

### Sandbox launcher — `tools/e2e/sandbox-server.js`
Scratch root = one `highascg.config.json` of overrides (factory defaults for the rest; every live-path default
pointed inside the root), projects, state, empty exFAT map, scratch `HOME`, `XAUTHORITY=/nonexistent`, `DISPLAY=`,
free HTTP + OSC ports bound to 127.0.0.1, `--no-caspar`. Generates fixture media with ffmpeg (`e2e_bars.mp4`,
`e2e_still.png`, `e2e_tone.wav`).

### GUI driver + runner — `godot/client/e2e/`
- `e2e_ui.gd`: clicks are real `InputEventMouseButton`s pushed into the viewport at the control's centre after a
  **hit-test** (hidden / disabled / covered → the step fails with what covers it); typing = key events; drags =
  press → motion (with `relative`, which the viewport's drag threshold accumulates) → release; dialogs inside embedded
  Windows are offset correctly. Finders by text / tooltip / placeholder / form caption / Tree row / tab title.
- `e2e_scenario.gd`: a scenario = chain of steps; each returns "" or why; first failure skips the rest; every step
  ends with a screenshot; `await_api()` polls the server for the stored truth.
- `e2e_runner.gd`: `-- --e2e=all|a,b --e2e-out=<dir>` → `results.json`, exit code = failed steps. Hooked from
  `main.gd` with one `load()` (production boot never compiles it).
- `tools/e2e/run-gui-e2e.js` (`npm run test:e2e:gui`): sandbox + Xvfb Godot (own `XDG_*` so `user://` is not the
  operator client's) + `report.md` with a screenshot link per step.

### Scenarios (`godot/client/e2e/scenarios/`)
| file | steps |
|---|---|
| 01_new_project | New project → confirm dialog → Start fresh (server + client deck empty) → type name (server name) → Save (project list) |
| 02_outputs | Devices → add PGM/PRV → 1080p5000 (stored mode + 1920×1080) → add PGM-only → Custom 1280×720@25 → generated Caspar config → remove |
| 03_looks_layers | Sources → Media lists the clips → drag clip onto deck "+" (look with layer) → drop still into the editor (2 layers) → Close → click card = PRV (sim INFO on the PRV channel plays it) → double-click = PGM |
| 04_timeline | New timeline → drag clip onto it → drag audio → Play (engine /state playing) → Stop |
| 05_live_inputs | Add live input dialog: NDI by name → extraLiveSources, dialog closes; webpage URL → same; both listed in Sources → Live |

### Running / extending
```
npm run test:e2e:gui                                  # all scenarios, ~1-5 min, nothing on :0, live box untouched
node tools/e2e/run-gui-e2e.js --e2e=02_outputs,04_timeline --out=/tmp/e2e --keep
```
Result: `<out>/report.md` (✅/❌ per step + screenshot link), `results.json`, `godot.log`, `sandbox/server.log`;
exit code = failed steps (97 runner error, 98 no results, 99 killed / HANG). A new path = a new
`godot/client/e2e/scenarios/NN_name.gd` (`extends "res://e2e/e2e_scenario.gd"`, `func run()` of `await step(...)`);
find controls by visible text / tooltip / caption, never by node path, and check the server, not the widget. Each
scenario must pass alone (its own setup) and after the others. Not in CI (needs Godot + Xvfb + ffmpeg, ~minutes):
run it before a release / after GUI work.

## What was VERIFIED

- Isolation: `fingerprint.sh` (md5 of `projects/`, `config/`, `data/media-library`, `.highascg-state.json`,
  `~/bridge/projects`, `~/.highascg/run`, `~/.config/highascg`, openbox autostart, system inventory; hostname;
  confine / unclutter / caspar PIDs) before and after a 40 s standalone sandbox boot: **identical** except one
  transient confine PID (the live daemon 457519 kept running). Re-checked after the GUI runs (see below).
- **Final: full run 26/26 green** (`d_all`: exit 0, no HANG, 0 SCRIPT ERRORs; 03 alone 7/7), every step with a
  screenshot + `report.md`. Fingerprint after all runs (≈20 sandbox runs): identical to the pre-session baseline
  except the transient confine PID; live daemon 457519, `highascg` active, hostname unchanged. No Xvfb / sandbox
  process left (process-group kill).
- Gates: `smoke-wo719-sandbox-guards` 4/4 (+ wo597 / wo670 video smokes, 24/24 together); `test:ci` all green
  except `smoke-wo308-pointer-confine-split` "auto … pre-WO-308 rule" (actual `operator_monitor_port_3`) — fails
  identically on a clean `git archive HEAD` copy: it reads this box's real operator monitor, pre-existing and not
  WO-719; lint 0 errors (214 warnings ≤ 216), prettier clean, 0 files > 500 lines, Godot unit tests 21462/0, boot
  check OK — run against a sandbox, not `run-client.sh --check`, which boots against the live :4200.
- Run 1 (01 only): 4/4, screenshots show the real confirm dialog and the typed name autosaved.
- Run 4: 03_looks_layers 6/6 (drag → look, still → 2nd layer, PRV / PGM confirmed in sim INFO).
- Bugs in the harness found and fixed on the way (recorded so nobody re-learns them): GDScript lambdas capture
  locals **by value** (ids found inside a step must go to members); synthetic motion needs `relative` or no drag
  ever starts; the Sources tab strip scrolls (ensure_tab_visible first); the live-input dialog is modal for 1.5 s
  after Add.
- **OptionButton picks (run 5 → 16, "1080p5000 not stored, still 1080p2997").** Traced with a `tree_exiting` stack
  on the select + a `patch` signal stack: the *click* that opened the popup sent `{videoMode: "1080p2997"}` — the
  release (pushed one frame after the press; a frame on Xvfb's software GL is >150 ms) landed on the just-opened
  PopupMenu, which picks the row under the pointer = the current mode. That patch's reload
  (`destinations_panel._patch → _done → changed → Settings.load_from_server → devices_tab.refresh →
  show_destination`) then freed the select while the driver waited for its popup, so the real pick went nowhere.
  Same-frame press+release did NOT avoid it (Godot 4.7 still takes the pushed release). Fix in `e2e_ui.choose()`:
  press → popup → `index_pressed` (the row click) → hide → release (press-drag-release onto a row). Also: an Add
  keeps working after the server has the destination (settings seed → reload → `changed` → reload), so
  `02_outputs._settled()` waits for `_dests._busy` / `devices_tab._loading` to clear and the page to be the same
  node for 0.8 s; `_hover()` / `choose()` report a freed control instead of a script error.
  App-side note (not a bug, not changed): every device-view reload rebuilds the open destination page, so a select
  opened during a reload (≈1 s after an Add) closes under the pointer.
- **Shared memory was not isolated.** A local Godot client reads `/dev/shm/highascg-<role>` (the server announces the
  path, `video-surfaces.js segmentFor`; fallback `video_surfaces.gd segment_path`) — the sandbox's pgm1 / prv1 / in2
  are the LIVE Caspar's segments (`/dev/shm/highascg-in2` exists on the box). Read-only mmaps, but not isolation.
  Now: in a sandbox `segmentFor` and the video feed's default `pathFor` point at `<root>/shm/`, and the runner starts
  the client with `--video=feed` (pictures over the sandbox's WebSocket, never a local mmap).
- **Client did not quit after a full run** (run 5 / 17: DONE, `results.json` written, `get_tree().quit()` called,
  Godot alive at ~200 % CPU until the 420 s kill; each scenario alone quits). The kill hit only the `xvfb-run` shell
  → Xvfb :99 / :100 were left orphaned (killed). Runner: Godot + Xvfb in their own process group (`detached`,
  `kill(-pid)`), a client alive 20 s after DONE is killed and reported `HANG` (exit ≠ 0) instead of hiding in a
  timeout. With `--video=feed` (no local shm mapping) the full run quits normally — the hang lives in the
  local-shm reader path at shutdown (not root-caused; the kiosk client quits rarely — follow-up if it ever shows).
  **Root-caused and fixed in [WO-720](./720_WO_bugs_found_by_gui_e2e.md) (A):** the shm path opens a media preview
  that reports its layout twice; the server's debounce never answered the superseded POST, and quit joined the
  Godot HTTPRequest thread stuck in `recv()`. The app-side notes above (reload under an open select, Store channel
  map not refreshed) and the box-only WO-308 smoke failure are fixed there too.
- **Scenario independence:** 03 alone failed ("no channel") — it lived off 02's screen. It now has a setup step (the
  Devices panel's own `add("pgm_prv")` when the server map has no PRV) and reads channels from the server's
  `/api/settings` channelMap (the client Store's copy is only refreshed by some broadcasts). 02's custom-size fields
  are typed into the settled page (`_settled()` per field instead of a fixed 0.6 s sleep — a reload freed the field
  once under load).
- **Own bug caught while pinning:** the sandbox replication-identity path joined onto `HIGHASCG_CONFIG_PATH` (a
  *file*) → `path.dirname` (never hit: replication is off in the sandbox).
- `tools/smoke/smoke-wo719-sandbox-guards.test.js` (curated CI list): runs the pure gates (isSandbox, exFAT sync,
  project volume sync) and pins the other guards by source — deliberately not executed: a missing guard would
  pkill the live barrier daemon / run hostnamectl / xrandr on this production box.

## Branch cleanup
`godot` == `main` == `origin/main` (c05d558f, 0 commits either way); CI only runs on `main`. The box was switched to
`main` (same tree, no file change). `stabilize/2026-07-07` is fully merged; `wip/2026-07-07-pre-stabilize` has 7
unmerged July commits → kept as tag `archive/wip-2026-07-07-pre-stabilize`. Deleting branches was blocked by the
session's permission layer — owner runs:
```
git push origin archive/wip-2026-07-07-pre-stabilize
git branch -d godot stabilize/2026-07-07 && git branch -D wip/2026-07-07-pre-stabilize
git push origin --delete godot
```
(The Mac checkout, if on `godot`: `git switch main && git branch -d godot`.)
