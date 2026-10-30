# WO-836 — Test categories: offline / live-box, and a GUI release suite with screenshot + PRINT checks

**Status: IN PROGRESS (30.10) — parts 1 and 2 done and verified (offline 4485/4486, see §3); part 3 (GUI release suite) open**
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
