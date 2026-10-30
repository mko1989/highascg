# WO-836 — Test categories: offline / live-box, and a GUI release suite with screenshot + PRINT checks

**Area:** testing-ci
**Status: IN PROGRESS (30.10) — parts 1, 2 and 3 done and verified: offline 4485/4486 (§3), scripted GUI release suite `npm run test:release-gui` 73/73 green twice in a row (§3d); the agent-run live cards (§3c) await their first watched live run**
**Source:** REPORT §7a/7b; owner 30.10: *"id like to have a full suite of tests that i could run before each relese and/or
pull request that would run a routine test of all/most of the features by literally clicking in gui and verifing by
screenshots/ casparcg channel prints. so the tests that do actual stuff on the box are needed. but they should be in their
own category."*
**Related:** WO-719 (sandbox GUI e2e, `npm run test:e2e:gui`), WO-720, WO-725, 8b9fc4e (test-isolated projects root).

Parts:

1. **Category + guard.** Tests that touch the live box (AMCP on real channels, POST to the live API, writes into live
   `config/`, `data/`, `projects/`, `/run/highascg`) move to their own category and refuse to run without
   `HIGHASCG_LIVE_TESTS=1`. The offline suite never reaches them.
2. **CI gate bugs (7a):** Godot runner 8-bit exit, npm-audit passes on a registry error, unwired-exports misses
   single-line exports, `check-script-paths.js` red and unrun, vacuous asserts.
3. **Release suite:** one command that clicks through the main features in the real Godot client and verifies with
   screenshots and Caspar channel PRINTs, building on WO-719's scenarios.


## 1. Investigation (parts 1 and 2)

Every sweep claim was re-read before fixing. What was real:

**Live-box tests (REPORT 7b/7e).** Confirmed by reading the code, not just the batch notes:

| Test | Touches | Verdict |
|---|---|---|
| `smoke-amcp-migration-air-paths`, `highascg-live-amcp`, `smoke-amcp-batch-library`, `smoke-amcp-legacy-transport`, `smoke-amcp-send-after` | AMCP to real Caspar :5250 (CLEAR 1-10..15, PLAY, MIXER) | moved to `tools/test-live/` |
| `highascg-live-highascg-http`, `http-smoke`, `smoke-caspar`, `verify-streaming-channel`, `smoke-scene-take` | the running API on :4200 (the last POSTs a forceCut TAKE) | moved |
| `smoke-ws-restart-reconnect` | spawns a second full node on the box's config + default listeners | moved (it was already skipped in `test:ci` by env, never by structure) |
| `smoke-wo232-mario-transparent.live` | real browser against Caspar output | moved |
| `batch-test`, `raw-tcp-test`, `query-test`, `run-live-test*`, `test-artnet-input`, `spike-*` (7) | raw :5250 / :6454 (raw-tcp-test PLAYs on ch1 with no guard; test-artnet-input floods the box's own Art-Net input) | moved to `tools/test-live/manual/` (hand-run, guarded, never in `test:live`) |
| `smoke-replication-failover` | `promoteToLeader` POSTed `/api/replication/leader-yield` to 127.0.0.1:4200 | hermetic: `skipYieldNotify`, peer = 127.0.0.1:1 |
| `smoke-wo670-cluster`, `smoke-wo712-server-duties` | `createCluster().add()` ran the real `localAddressTo` (net.connect to 10.0.0.6/7:4200) + a link-back POST | hermetic: `localAddress`/`request` injected |
| `smoke-wo796-magicq-show` | binds 0.0.0.0:6454 + 127.0.0.2:6454 (port fixed in `src/fixtures/artdmx.js`) | self-skips when anything holds UDP :6454 (`lib/udp-port-busy.js`); on this box it now skips |
| `smoke-replication-handshake` | `ensureDeviceIdentity()` mints/reads `config/device-identity.json` | env `HIGHASCG_DEVICE_IDENTITY_PATH` set before the require (+ the offline runner sets it for every test process) |
| `smoke-wo266`, `smoke-wo379`, `smoke-wo577` | `data/shaders` + tracked `template/shaders` (save/delete/reconcile) | hermetic: `lib/shader-store-tmp.js` binds the store to a temp root holding a COPY of `template/shaders` |
| `smoke-wo344-shader-thumbs` | `utimes` +60 s on a live shader file | works on a temp copy (the fingerprint resolver is stubbed to it) |
| `smoke-virtual-camera` | wrote `/run/highascg/vcam-modules.conf` | fs write captured, never reaches the path |
| `smoke-full-config-apply` | real `writeCasparGlSyncEnvFile` -> `~/.config/highascg/caspar-env` | `HOME` -> temp |
| `smoke-wo499`, `smoke-wo501` | `mkdir -p /home/casparcg/exfat/drop-update` (hard-coded EXFAT_ROOT, `mountpoint` stubbed "mounted") | fake `mkdir` that refuses the exfat/bridge roots |
| `smoke-companion-satellite-preview` | `rm -rf data/companion-button-preview` (the live server's cache) | removes only the file it wrote |
| `smoke-cg-studio` | leaves `template/studio/lt-smoke-test-export.html` on a failed assert | try/finally |
| `smoke-wo268`, `smoke-host-operator-fullscreen` | `ConfigManager.load()` on the live `config/` (can write migrations; result depends on the rig) | empty temp config dir (factory defaults) |
| `smoke-wo721-install-to-disk` | an empty `HIGHASCG_CALAMARES_ROOT` would edit `/etc/calamares` | refuses a root outside `os.tmpdir()` |

Not fixed (cannot be without a `src/` change, outside this WO's scope): `smoke-private-volume-sync` (writes `REPO_ROOT/.private/smoke-test-*`; `assertUnderRoot` forbids a temp host dir; try/finally added, kept out of the curated list), `smoke-wo237` (reads the live `config/` read-only and asserts rig-dependent modes; with factory defaults the monitor channel picks 576p2500 while `inferProjectFpsFromConfig` says 50 fps — a generator question, not a test one), `smoke-exfat-sync` (reads the tracked `config/exfat-sync.json`), the xrandr smokes (real X display).
The sweep's `smoke-private-volume-sync` finding on `getMachineId` was also real: the test pinned `replication.selfId` first, the code answers the hardware hostname first (`machine-identity.js:13-16`); the test now asserts the current order.

**CI gate bugs (REPORT 7a):**
- `godot/client/tests/run_tests.gd:36` `quit(failures)` — real (8-bit exit status: 256 -> 0). "Not awaited": no current test body yields (every `await` in `tests/` is inside a source-text string), so nothing is lost today, but `suite.call(name)` would have returned at a test's first `await`; and "assert-then-crash" is real — a runtime error after the first assert still counted a pass (the existing "no assertion ran" guard only catches a crash before the first assert). Reproduced with a probe suite (assert, then call on null): old runner reported it passed.
- `npm-audit-ci.js` — real: a registry error prints `{message, error}` with no `vulnerabilities`, which the wrapper read as "none". Reproduced with `--registry=http://127.0.0.1:9` (old: OK / exit 0).
- `check-unwired-exports.js` — real: `module.exports = { a, b }` on one line yielded no names; a multi-line literal with a nested `}` was also cut at the first one. `index.js` and `test/` were not reference roots (51 baseline entries were only "orphaned" because their one consumer is a unit test or the boot entry).
- `check-script-paths.js` — exit 1 was a false positive: its only miss, `tools/runtime/operator-shape-overlay.py` (deleted in WO-646), is cited in seven `src/` **comments**. Not a broken path. No real broken script path exists (73 references checked, all git-tracked).
- Vacuous asserts: `wo574` (real, `indexOf` -1), `zip-slip` (real: `zip evil.zip "../../../tmp/evil.txt"` fails on a missing file, the catch returned, the guard was never reached), `wo737` — the sweep says it returns early on a box *with* `.git`; it is the other way round: it returned on a release tree *without* `.git` (here it ran). Fixed for both.

**Uncurated smokes (REPORT 7a "~150").** 199 files in `tools/smoke` + `test/` were in no curated list. Each was run (`node --test`, 150 s timeout): 188 pass, 9 fail, 2 are other agents' in-flight files. Verdict per file: `/tmp/claude-1000/-home-casparcg/03d195b7-40ef-44d0-b117-27e2e6a3e0d1/scratchpad/wo836/uncurated-verdicts.txt`.

## 2. What was done

**Part 1 — the live-box category.**
- `tools/test-live/live-guard.js`: `liveGuard(__filename)` (CJS; a top-level `return` leaves the file) and `requireLiveOrExit(file)` (ESM/scripts). Without `HIGHASCG_LIVE_TESTS=1` a `node --test` run registers one **skipped** test per file (so a release run that forgot the opt-in shows `skipped`, not green), a plain `node` run prints the skip and exits 0.
- `tools/test-live/run-live-tests.js` (`npm run test:live`): sets the variable itself (typing the command is the opt-in), pre-flights Caspar :5250 and the API :4200 (exit 1 if the box is down), runs the `*.test.js` files under `node --test`, then the exit-code probes (`http-smoke`, `smoke-caspar`, `verify-streaming-channel`; `smoke-scene-take` only with `HIGHASCG_LIVE_TAKE=1` because it takes program live), prints a PASS/FAIL summary.
- `tools/ci/run-release-tests.js` (`npm run test:release`): offline (`run-offline-tests.js`) -> live -> GUI e2e (`tools/e2e/run-gui-e2e.js`), never stops at the first failure, prints a summary, exits 1 if any group failed; `--only=` / `--skip=` take `offline,live,gui`. **Part 3 slots into the `gui` group**: extend `run-gui-e2e.js` (or add a second script to `GROUPS`) with the screenshot + PRINT scenarios; nothing else changes. Note for part 3: `run-gui-e2e.js` exits with the failed-step count, so 256 failed steps wrap to 0 (same 8-bit bug as the Godot runner) — clamp it to `1` there.
- Moved with plain create+rm (paths repointed in `package.json` scripts, `docs/wiki/api/scene-take.md`, `docs/reference/amcp-migration-qa-checklist.md`, `collect-offline-tests.js` excludes). The old `test:highascg:*` / `smoke:*` scripts still work and are now guarded. `smoke-ws-restart-reconnect` removed from `offline-test-files.js`.
- Hermetic fixes as in the table above (helpers in `tools/smoke/lib/`: `shader-store-tmp.js`, `tmp-config-dir.js`, `udp-port-busy.js`). `run-offline-tests.js` additionally gives every test process a throwaway `HIGHASCG_DEVICE_IDENTITY_PATH` and `HIGHASCG_PRESENTERS_DIR`.

**Part 2 — gates.**
- `run_tests.gd`: `quit(1 if failures > 0 else 0)`; `await suite.call(name)`; an `OS.add_logger` `Logger` subclass counts GDScript **script** errors per test (engine-level ERROR lines such as `get_node` outside the tree stay informational) and fails a test that logged one. 23211 asserts still pass; probe suite (assert, then null call) now fails with exit 1.
- `npm-audit-ci.js`: a report without `metadata.vulnerabilities` / with `error` exits **2** (distinct from 1 = blocking advisories; any non-zero fails the CI step). `NPM_AUDIT_ALLOW_OFFLINE=1` or `--allow-offline` downgrades it to a warning for local offline use.
- `check-unwired-exports.js`: brace-walking parser for `module.exports = {...}` (one-line, nested braces, strings/comments, `async x()`, spreads skipped); `index.js` and `test/` are reference roots (a root may be a single file). Baseline regenerated with `--update`: **622 -> 717 entries (+146 newly visible single-line-export orphans, -51 now referenced from `test/`/`index.js`)**; nothing deleted. `smoke-wo367-wiring-gates` got two tests for both fixes.
- `check-script-paths.js`: comment lines/tails are not references (`stripComments`), dead `PATTERNS` and unused catch bindings removed, exports `findScriptReferences`. Exit 0 (73 references). Added to `.github/workflows/ci.yml` (verify job, "Script paths exist", after Repo integrity).
- Vacuous asserts: wo574 repointed with both anchors asserted `>= 0`; zip-slip builds its archives in-process (`lib/zip-stored.js`), gains an absolute-path case and never skips; wo737 presents the `.git` marker when the tree has none.
- Curation: `tools/ci/offline-test-files-3.js` (170 files; chained from `-2`) — 708 curated files now (was 539 + deletions). `smoke-scene-take-pgm-only.test.js` entry removed from the list (file deleted by WO-831).

## 3. Verified

- Each touched smoke ran alone with `node --test` (all green except the pre-existing `smoke-wo379` "stacked shader can be taken off air", which fails on another agent's concurrent edit of `src/api/routes-shader-stack.js`, not on this change). After the shader tests ran, `find data/shaders template/shaders -newer <marker>` was empty.
- `node --test tools/test-live/*.test.js` without the variable: 8 tests, 8 skipped. The live runner was NOT executed (it sends AMCP to the real Caspar by design; the agent contract forbids that).
- Godot: `godot --headless --path godot/client --script res://tests/run_tests.gd` -> `23211 passed, 0 failed`, exit 0; probe suite with an assert-then-crash test -> `FAIL ... script error during the test`, exit 1 (probe file deleted).
- npm audit: real run exit 0; with `npm_config_registry=http://127.0.0.1:9` exit 2; with `NPM_AUDIT_ALLOW_OFFLINE=1` exit 0 + warning.
- The 188 passing uncurated files were re-run in a clean `git archive HEAD` tree (working-tree edits overlaid, `config/` from HEAD, `CI=true`): 186 pass; the 2 that fail there (`smoke-xrandr-canvas-check.js`, an other-agent wo835 file) are not added. 170 added (the rest: other agents' files, Chrome-dependent `.mjs`, `smoke-private-volume-sync`, the 9 broken).
- Prettier/500-line/script-paths/unwired-exports gates pass locally.
- Full offline suite (`node tools/ci/run-offline-tests.js`, once): see the result block appended below.

### Broken uncurated smokes (reported, not added)
`smoke-amcp-basic-plan-log.js` (casparcg-connection `_invokeTyped` drift), `smoke-amcp-command-plan.js` (tween case, plan diff), `smoke-caspar-cls-id.test.js` (7 cases need untracked `media/projects/tetst`), `smoke-decklink-output-resolve.js` (4 stale XML pins), `smoke-device-graph-output-mapping.js` (live-config fixtures), `smoke-live-thumbnail-api.js` (502 vs 400/503), `smoke-mapping-gpu-os-layout-2.js` (`<pixel-format>yuv`), `smoke-wo173-clip-start-batch.test.js` (TimelineEngine API drift), `smoke-wo47-manifest.mjs` (stale pin).

### Full offline suite (run once, after all edits)
`node tools/ci/run-offline-tests.js` -> 708 files, 4491 tests, 4485 pass, 1 fail, 5 skipped, 64 s. The one failure,
`smoke-wo537-look-timeline-starts-where-asked` ("a plain play() after a pause keeps the paused position", 13 vs 12046),
is not from this WO: it passes 3/3 alone, and `src/engine/timeline-*` was committed by WO-837 phase 1 at 11:27:43, i.e.
during the run. No file under `config/`, `data/shaders`, `template/shaders`, `projects/` (non-autosave), `.private`,
`/run/highascg` or `~/.config/highascg` was written by the suite (only the running server's own runtime files changed).

## Part 3 redesigned (owner 30.10): agent-run test cards instead of a scripted suite

Owner: *"maybe it doesnt make sense to script everything, rather create test instructions for haiku agents so i can run
the full test cheaply."*

- **Driver** (`tools/test-agent/`): a remote-control e2e scenario (`godot/client/e2e/scenarios/99_remote.gd`) that runs a second
  Godot client on a hidden Xvfb display against the LIVE node and executes label-based commands through `e2e_ui.gd`
  (tab, click, type, choose, drag, list, shot). CLI `tools/test-agent/ui` sends them and prints JSON. CLI
  `tools/test-agent/caspar` does `print <ch>` (Caspar PRINT → PNG + luma/colour stats), `info <ch>[-<layer>]`, and API
  GETs. The owner's GUI on :0 is never touched; PGM is (that is the point of a release test).
- **Cards** (`tools/test-agent/cards/NN_<area>.md`): preconditions, numbered steps written as driver commands, the
  expected result per step, the evidence to keep (shot / PRINT / API), and an explicit PASS/FAIL rule. Written for
  Haiku: no judgement calls, exact labels, exact thresholds.
- **Runner** (`.claude/skills/release-test/SKILL.md`, `/release-test`): runs the cards one after another with Haiku agents
  (one GUI, one PGM, so not in parallel), collects verdicts and evidence into `work/release-reports/<date>/report.md`,
  and hands only FAIL/UNCLEAR cards to a stronger model for triage.
- The scripted scenarios 01–08 stay as the cheap sandbox smoke (`test:release` gui group).
- **Owner 30.10, follow-up:** *"i want the full test suite to act as a user, so clicks on screen, doing real tests like a
  human user would do."* All input is real X input (xdotool on the test instance's Xvfb display): clicks, drags,
  scrolls, typing, shortcuts. The Godot side only reports what is on screen (labels plus screen coordinates) and takes
  screenshots. `ui click "Take"` finds the button and then clicks it with the X mouse. Canvases use raw
  `click_xy`/`drag_xy` chosen from the screenshot. Verification is from the screen and from the air (PRINT/INFO).

## 3c. Part 3 driver (30.10, agent wo836d)

Owner, same day: *"i want the full test suite to act as a user, so clicks on screen, doing real tests like a human user
would do."* So the driver does **real OS-level input**; Godot only supplies the eyes.

### What was built

- **Hands: `tools/test-agent/ui`** (node, CommonJS, `lib/*.js`). `ui start --sandbox|--live [--out DIR] [--server URL]` starts its
  own `Xvfb :N` (N from 120 up, 1920x1080) and one Godot client with `--e2e=99_remote` on it (pid-recorded in
  `~/.highascg/test-agent/state.json`, override `HIGHASCG_TEST_STATE`); `--sandbox` also starts `tools/e2e/sandbox-server.js`
  (via `lib/sandbox-daemon.js`). `--live` = the node on :4200: the client adopts `.private/api-token` itself
  (core/config.gd `adopt_local_password`, HOME stays real), no token is passed or printed. All input is `xdotool` on that
  display (`lib/xinput.js` refuses `:0`): label commands (`tab`, `click`, `type`, `choose`, `drag`) = ask the eyes where the
  label is, hover (real motion), check the hovered control is the target (`covered` → "X is covered by Y"), click; raw commands
  `click_xy`, `drag_xy`, `move`, `scroll`, `type "text"`, `key ctrl+z` (key names normalised in `lib/keys.js`). `ui shot` grabs
  the **whole Xvfb screen** with ffmpeg x11grab (popups, dialogs, pointer included). `ui stop` kills by pid.
- **Eyes: `godot/client/e2e/scenarios/99_remote.gd` + `e2e_eyes.gd`**. TCP 127.0.0.1:6299 (`--e2e-remote-port=`), newline JSON,
  answers `{ok, result|error, ms}`. Commands: `ping list find wait_for state covered popups shot quit`. Read-only: it never
  pushes an input event. `list` returns every visible Button / toggle / OptionButton (+items) / LineEdit / SpinBox / TextEdit
  (caption + hint + value) / TabBar tab / Tree row / ItemList item / Label / tooltip-bearing Control / open popup-menu row with
  its label, tooltip, enabled, and SCREEN rect+centre (window origin added, clipped by the scroll areas it sits in, not by the
  parent chain of an embedded dialog). `find` failures name the closest labels. `nodes_of()` walks internal children too
  (`find_children` skips them — that is where AcceptDialog keeps OK / Cancel). PopupMenu has no item-rect API: rows carry an
  ESTIMATED centre, and the driver nudges the real pointer until the popup reports that row focused (`aimAtMenuItem`, used by
  `choose` and by `click --kind menuitem`).
  `e2e_runner.gd`: `--e2e=all` skips `99_*` (the listener never returns), only an explicit `--e2e=99_remote` starts it.
- **`tools/test-agent/caspar`**: `print <ch> [--crop x,y,w,h]` (AMCP PRINT straight to Caspar → newest PNG in the media root →
  copied into the run's `prints/`, scratch file removed → `{png, frame, mean_luma, mean_rgb, nonblack_fraction, mean_alpha,
  alpha_nonzero_fraction, alpha_note}`; crop beyond the frame is refused, not clamped; the alpha plane is reported because PRINT
  frames are RGBA), `info <ch>[-<layer>]` (INFO channel XML through the node's own `info-channel-parse.js`), `channels`, `api <GET>`.
  Sandbox: `print` says "no Caspar in the sandbox" (exit 2). Pure PNG decode/crop/stats/encode in `lib/png.js` (zlib only).
- **`tools/test-agent/README.md`** (the reference a Haiku agent gets), **`cards/_TEMPLATE.md`**, pilot cards
  **`01_looks_take.md`** (look with two layers → PRV → TAKE → FTB, PRINT numbers live-only) and **`02_timeline_play.md`** (timeline,
  clip, play, pause, play to the end → end hold, play again → restart, stop), **`provision-fixtures.js`** (the three sandbox fixture
  files into the live media root; `--remove`), **`.claude/skills/release-test/SKILL.md`** (the `/release-test` coordinator: driver
  `--live`, one Haiku agent per card, sequential, verdict + evidence under `work/release-reports/<date>/`, `report.md`, stronger
  model only for FAIL/UNCLEAR).

### Verified (sandbox only; nothing was sent to :4200 / :5250)

- Driver end to end on the sandbox: `start`, `list` (buttons / fields / tabs / rows / labels / menu / options), `tab`, `click`,
  `click --right` + `--kind menuitem`, `choose` (real popup list), `type` (real keys into a LineEdit and into a dialog), `key`
  (F3 toggled the performance overlay through X), `drag` (media row → "+", real X press / glide / release) and `drag_xy` (editor frame,
  timeline lane), `shot` (full-screen PNG viewed with Read: coordinates in `list` line up with the picture), `stop` (no process left).
  `--live --server <sandbox url>` exercised the live code path (HOME real, token adoption) without touching :4200.
- Both pilot cards were walked literally in the sandbox: card 01 passes (PRINT steps 6 and 8 skipped as LIVE-ONLY; INFO shows both
  clips on PRV channel 2 layers 10/11 and on PGM channel 1 layers 110/111, FTB empties both, cleanup restores 0 looks).
  Card 02 steps 1–7 and 9 pass; **step 8 FAILS**: see Finding.
- Tests: `tools/smoke/test-agent-pure.test.js` 12/12 (arg parsing, key names, `ui list` formatter, PNG round trip incl. all filters,
  crop bounds, alpha note, AMCP reply parsing, INFO → clips, `caspar print/info` against a fake Caspar + temp media folder, sandbox
  "no Caspar", `:0` refusal). eslint clean on the new files, `check-max-file-lines` 0 over, Godot suite 23407 passed / 0 failed.

### Finding (FIXED 30.10 12:05, e2ac4165, WO-834)

The fix is on the server: a seek onto the held frame keeps the hold, so the client's seek-then-play starts over. Pinned by
`smoke-wo834-timeline-end-hold` "the clients' seek-to-playhead before Play keeps the hold" (5/5). The node has run it since the
16:41 restart. Original finding:

WO-834's "Play after the end hold restarts from 0" does not happen from the Godot client. `timeline_transport.gd toggle_play()` POSTs
`/seek {ms: playhead}` and then `/play {from: playhead}`. The hold parks the playhead at `duration − 1 frame` (e.g. 4746 of 4786 ms);
`seek()` clears `cell.endHeld`, so `play()` (timeline-playback-runtime.js:43) never sees the held state and resumes at 4746 → ends and
holds again at once (observed: state `playing:false, endHeld:true, position 4746` after Play; server log RESUME / PAUSE / SEEK, no PLAY). The
smoke only tests the engine (`play(id)` without a prior seek). Card 02 step 8 pins this. Fix idea: the client should not seek before
Play when the timeline is `endHeld` (or `seek` should keep `endHeld` when the target is the hold position and `play()` compares
`fromMs >= duration − 1000/fps`).

### Not covered / owner notes

- The GUI has no "delete timeline": card 02 renames its timeline `ZZ release-test` and lists it as LEFTOVER for the coordinator.
- Cards touch the owner's live project (a look, a timeline) and clean up through the GUI; the live second client is the same client
  the owner uses (hardware reconcile etc. run for it too) — first live run must be watched.
- `caspar print` could not be exercised against a real Caspar (only a fake AMCP server); PNG pickup relies on PRINT landing in the
  media root as WO-845 documents. The PGM thresholds in card 01 (luma 60–190, nonblack ≥ 0.85) come from stats of the fixture clip
  and SMPTE still scaled to 1920x1080 (luma ≈ 123–129, nonblack 1.0) and need a first live calibration run.
- Layout note seen on the sandbox: with the Timeline tab open the right-hand Inspector was cut off at the window edge in one run
  (others agent's WIP area, not investigated).

## 3d. Part 3 scripted release suite: `npm run test:release-gui` (30.10, agent wo836e)

Owner ask: *"a GUI release suite with screenshot + PRINT checks"*, run before a release / PR, one report. §3c's cards are the
human-like live run; this is the cheap repeatable one: no agent, no live box.

### What was built
- **`tools/e2e/run-release-gui.js`** (`npm run test:release-gui`; also the `gui` group of `npm run test:release`): two phases, each a
  `run-gui-e2e.js` run with its own sandbox server, then one report. `sim` = every scenario in `godot/client/e2e/scenarios` except
  06 (XR, needs `--xr`), 12 (air) and 99 (agent driver) against the simulated Caspar; `air` = scenario 12 against a throwaway real
  Caspar. `--only=` / `--skip=` (`sim,air`), `--e2e=` narrows `sim`, `--out=DIR` (default `$TMPDIR/highascg-release-gui/<stamp>`).
  Exit 0 = green, 1 = any failed step or a phase without results (a crashed client is a FAIL row, never a pass).
- **`tools/e2e/release-report.js`**: `<out>/report.md` (phase table, per scenario/step table with the screenshot link, the kept
  PRINT frames) + `<out>/results.json`.
- **`tools/e2e/air-fixture.js`**: a THROWAWAY real CasparCG (`bin/casparcg`, `LD_LIBRARY_PATH=lib`): own `Xvfb`, own free AMCP port
  (refuses 5250), 2 x 720p2500 (1 = PGM, 2 = PRV), no screen/audio consumers, media folder = the sandbox's, media-server pointed
  at a dead port; killed by PID. `run-gui-e2e.js --air` starts it before the sandbox server and points the server at it
  (`offline_mode:false`, `caspar:{host,port}`, a seeded 720p PGM/PRV destination) — additive flag, env `HIGHASCG_E2E_AIR`. The live
  Caspar on :5250 is never contacted (PRINT goes through the sandbox node's `/api/amcp/raw` to the throwaway's port).
- **`godot/client/e2e/e2e_probe.gd`** (pixel probes) + **`scenarios/12_air_print.gd`** (10 steps; "Not run" without `--air`):
  1. probe self-test on synthetic frames: picture vs black on luma/nonblack/alpha, flat grey rejected, a bars-scaled-to-fit picture
     rejected (geometry is part of the probe), a crop past the frame REFUSED not clamped (the ffmpeg X+W>3840 lesson);
  2. channel map has PGM 1 / PRV 2 and `INFO` answers `720p2500` (the node really talks to the throwaway);
  3. PGM and PRV PRINT black before anything is taken (RGBA: alpha 0 on a black channel, 255 on a picture — both reported);
  4. clicks/drags as an operator: drag `e2e_bars` onto +, drop `e2e_still` into the editor, Close;
  5. **screenshot probe**: the look card's thumbnail region of the client's own viewport image has a colour share >= 0.30, the empty
     "+" tile < 0.02 (separates good from bad in the same frame);
  6. click the card: PRV prints the still's bars (5 colour probe points at known x: yellow, cyan, green, magenta, red — `contentFit
     native` of a 1920x1080 still on a 1280x720 channel shows the middle 1280 px, the grey/blue bars are cropped; the probe pins
     that geometry), PGM stays black;
  7. double-click (TAKE): PGM prints the same bars, alpha opaque;
  8. FTB: PGM and PRV print black again.
  PRINT is polled (a print every >= 1.1 s because Caspar names the file by the second; the throwaway renders in software GL, a clip's
  first picture arrives ~3 s after PLAY, the still ~5-9 s) until the probe holds or 45-60 s; the accepted print is kept as
  `shots/print_<label>_ch<N>_<n>.png` and its numbers are logged.
- **Flake / harness fixes** (the baseline full run was 47/50 with 11 skipped):
  - `07_pixel_map` "Pick channel 1": the window fills its channel list after two API round trips; the scenario picked from an empty
    list in ~1 run in 2. Waits for `item_count > 0` (11 already did).
  - `tools/e2e/pixel-map-fixture.js`: the fixture project's name now slugs to its own slug (`e2e pixel map`); a save re-slugs a
    project from its name and renamed the file away, so `11_wo843_sweep` could not load `e2e_pixel_map` after 07 ran (full run only).
  - `10_cable_pull` "Dragging the body swings it": judged one instant 0.3 s after the drag; the rope is a per-frame physics sim and
    lagged on a loaded box (12 px miss). Polls up to 4 s for the rope to reach the pointer; assertion unchanged.
  - `e2e_ui.gd reset_screen()` + `e2e_runner.gd`: windows a scenario leaves open (11 leaves the **PixelMap** window over the
    Inspector) are closed before the next scenario starts; with it open the root viewport's hovered control is null over its area and
    `13_wo866_visuals_audio` step 2 failed deterministically in a full run ("covered by <null>"), green alone. (Two earlier guesses —
    a stale-hover retry in `_hover`/`press_drag` — were reverted, not the cause.)
  - `e2e_runner.gd`: a scenario that does not compile is a failed `load` step instead of a crash on `script.new()` that hung the run.
  - `run-gui-e2e.js` exit code clamped to 1 above 255 (8-bit wrap, see part 1 note).

### Verified
- `node tools/e2e/run-release-gui.js` twice in a row: **sim 63/63 + air 10/10 = 73/73, 0 failed, 0 skipped, exit 0** (133 s + 19 s, 131 s + 19 s).
  Reports: `/tmp/claude-1000/-home-casparcg/03d195b7-40ef-44d0-b117-27e2e6a3e0d1/scratchpad/wo836/release4/report.md` and `release5/report.md`;
  PRINT frames + step screenshots: `.../wo836/release5/air/shots/` (`print_prv_staged_ch2_1.png`, `print_pgm_taken_ch1_2.png`, ...); copy in `.../wo836/evidence_air_shots/`.
  Before the fixes the same command was 71/72 + 1 skipped (13 failing) and the plain e2e run 47 passed / 3 failed.
- Probe calibration: the throwaway Caspar's PRINT of black = alpha plane all zero, luma 0; with the still on air = luma 98, nonblack 0.87,
  alpha 255 100 %. The PNG was opened and the bars looked at (first run: the probe wrongly expected 7 SMPTE bars — the still is `native`-fit
  and cropped, found by viewing the print, probe corrected to the 5 visible bars).
- Negative control (`--client=<scratch copy>` with the FTB click removed): the FTB step FAILS with "pgm_after_ftb ... not black (luma 98,
  nonblack 0.87 ...)" after 10 prints; the earlier 9 steps pass.
- `tools/smoke/release-gui-suite.test.js` 5/5 (combined report, no-results = FAIL row, air config vs mode, unknown phase exit 2); in
  `offline-test-files-3.js`. Godot headless suite `23697 passed, 0 failed` (includes new `tests/test_e2e_probe.gd`: self-test, stats, crop
  refusal). eslint on `tools/e2e` clean, 500-line check 0 over, prettier (tools/ci) clean, unwired-exports / script-paths gates pass.

### Not covered / left
- `06_xr_walk` stays opt-in (`run-gui-e2e.js --xr --e2e=06_xr_walk`); it is not in the release run.
- Only the Live look flow is verified on air (stage / TAKE / FTB). Timeline play, outputs, audio and live inputs are checked against the
  simulated Caspar (server state, INFO), not by PRINT. More air scenarios can reuse `e2e_probe.gd` + `--air`; the LED test card is a CEF
  template and the throwaway has no template folder.
- No product bug found by this suite; the card-02 finding in §3c (Play after the end hold does not restart) still stands.
- `INDEX.md` untouched (the status keyword is still IN PROGRESS).

### Coordinator re-run (30.10, 17:00)

`npm run -s test:release-gui -- --out=…/scratchpad/wo836/verify` → `[release-gui] 73/73 steps passed`: sim 63/63 (134 s), air
10/10 (19 s), exit 0. Air PRINT: PRV luma 98 / nonblack 0.87 after the card click, PGM the same after TAKE, and both black after FTB.
The run includes the new `13_wo866_visuals_audio`.
