# Codebase review 2026-08-03 — tools/, test/, scripts/ (CI harness, smokes, ops tooling)

Read-only review wave (7 reviewers over the full repo), owner-requested full codebase review (todos03.08.26).

Verification status: findings #1, #2, #6 independently re-verified by the coordinating session
(`syncStreamOutputsToDeviceGraph` exists only in the test file; `computeContainDestRect` gone
from client/ and src/; routes-media-thumb.test.js has no `node:test` import; system-time test
really spawns the `set` path of the real wrapper). Others are the reviewer's verified claims
(it ran 156 of 163 non-curated files to establish the failure inventory).

Covered: full curated gate run (1799 pass / 2 fail, both the known WO-237/WO-415 item — excluded); ran 156 of the 163 non-curated offline test files (skipped 7 that talk to live Caspar :5250 or are `.live.` tests, after verifying the rest are mock-based); read the whole `tools/ci/` harness + GitHub workflow; destructive-defaults scan of `scripts/` and `tools/eggs/`; exec-interpolation sweep of `tools/`. Skipped: executing live-AMCP tests, manual non-`.test.js` tools (`run-live-test*`, `smoke-caspar*`), and deep review of `tools/map`/`tools/wiki`.

### 1. [HIGH] Tests pin APIs that no longer exist anywhere in the codebase
`tools/smoke/smoke-stream-output-project-sync.test.js:5-12`
> `const { syncStreamOutputsToDeviceGraph, ... } = require('../../src/config/device-graph-output-mapping')` … `hardwareConfigHasStreamOperatorData`

Neither function exists in `src/` (verified: `device-graph-output-mapping.js:269` exports neither; repo-wide grep only hits the test). All 3 tests fail with `TypeError: ... is not a function`. Same class: `tools/smoke/smoke-cg-deck-thumb-contain.test.js:9` imports `computeContainDestRect` from `client/lib/fill-math.js` — the function is gone from client/ and src/ entirely. WO-172 (2026-07-13) already documented `smoke-stream-output-project-sync` as "stale test" — three weeks later it's still in the tree, still failing, still collected by `test:ci:full`. Failure scenario: anyone told "run the full suite" gets noise that masks real regressions; the stream-output sync behavior these tests were guarding has no working guard.

### 2. [HIGH] test/api/routes-media-thumb.test.js has never executed a single assertion
`test/api/routes-media-thumb.test.js:23`
> `describe('WO-184: Thumbnail serving guard', () => {`

`describe`/`it` are used without `require('node:test')` — Node's runner has no globals, so the file dies at load with `ReferenceError: describe is not defined` (reproduced standalone). The WO-184 zero-byte/recently-modified thumbnail guard has zero coverage and always has; the file also hard-crashes any `node --test` invocation that includes it (it is collected by `test:ci:full`).

### 3. [HIGH] Handlers went async; their smokes still call them synchronously
`tools/smoke/smoke-wo317-helper-taskbar-routes.test.js:40-41`
> `const r = handleOperatorHelperTaskbarGet({ config: {} })` / `const body = JSON.parse(r.body)`

`handleOperatorHelperTaskbarGet` is now `async` (`src/api/system-hardware-gui.js:288`), so `r` is a Promise and `JSON.parse(undefined)` throws — 2 tests fail. Identical drift in `tools/smoke/smoke-scene-live-preview-register.test.js:35-39` (`handlePreviewLiveRegister` is `async` at `src/api/routes-scene-preview.js:18`; test asserts `res.status === 200`, gets `undefined`). The WO-317 taskbar test file self-describes as pinning "the load-bearing safety property on a LIVE box" (flag-off gate on the kiosk shape-flag writer) — that guard is currently dead. The rest of the WO-317 family IS in the curated FILES list; this one was never added.

### 4. [MED] Ten more behavior-drift failures rotting outside the curated gate
`tools/smoke/smoke-wo172-device-view-sync.test.js:92,127,149,215` (`program_1` vs `program_2`, channel 1 vs 3, missing rejection); `smoke-meter-null-consumer.test.js:22` (pins `METER_NULL_CONSUMER_INDEX === 96`, source is now `720` at `src/audio/meter-null-consumer.js:25`); `smoke-mixer-effects-catalog.test.js:179,209,239` (client/server AMCP parity: actual `MIXER 2-15 ROTATION 45` vs expected `MIXER 2-15 ANCHOR 0.5 0.5` — rotation no longer emits the anchor line first); `smoke-amcp-offline-migration.test.js:131` (`CG 1-10 CLEAR` no longer emitted by `/api/cg/clear`); `smoke-host-live-caspar-config.test.js:22` (`webpage_host` absent from `extraLiveSources`). Total non-curated rot: **10 files / 18 failing tests**. Each is a former acceptance guard whose subject either regressed silently or changed intentionally without the test being repointed — currently indistinguishable, which is exactly the state CLAUDE.md's "add new tests to the curated list" rule exists to prevent.

### 5. [MED] `npm run test:ci:full` is permanently red — the full gate is unusable
`tools/ci/run-offline-tests-full.js:9` collects 366 files via `collect-offline-tests.js`, which includes every failing file from findings 1–4 (verified against its output). Consequence: the "full" gate can never pass, so it is never run, so nothing outside the 218 curated files is ever exercised — the mechanism that let findings 1–4 rot. Note the collector's live-AMCP protection is a name blacklist (`collect-offline-tests.js:39-42`, the WO-235 incident files); every currently-collected file that touches `net`/`ConnectionManager` was verified mock-based (port-0 server, `autoConnect: false`), so there is no live-traffic danger today — but the blacklist model means the next copy-pasted AMCP test is one filename away from repeating WO-235.

### 6. [MED] Running the suite as root sets the production system clock
`tools/smoke/smoke-system-time.test.js:141,152`
> `spawnSync('bash', [scriptPath, 'set', '2026-07-14', '10:27:20'], ...)`

These "accepts valid date-time" tests invoke the real wrapper `scripts/runtime/highascg-set-system-time.sh`, whose only guard is `id -u -eq 0` (line 59); as root it executes `timedatectl set-ntp false` + `timedatectl set-time "$datetime"` (lines 92–95). The test's safety is purely "we assume nobody runs tests as root". This file IS collected by `test:ci:full`, so a single `sudo npm run test:ci:full` on the box (plausible — much of the ops tooling requires sudo) disables NTP and jumps the live clock back to 2026-07-14, corrupting on-air timers and logs. The valid-args cases should target a stubbed `timedatectl` (PATH shim), not the real binary.

### 7. [MED] clean-eggs-dev-host.sh cleans the wrong directory and reports success
`scripts/eggs/clean-eggs-dev-host.sh:11`
> `ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"`

The script was moved from `scripts/` into `scripts/eggs/` (a forwarder at `scripts/clean-eggs-dev-host.sh` confirms the canonical path), but ROOT still goes up only one level → `ROOT=/home/casparcg/highascg/scripts`, not the repo root. Every intended target (`dist-web/`, `dist/`, `cef-cache/`, `log/`, `core` dumps) doesn't exist under `scripts/`, so the cleanup silently no-ops and prints `==> Done.` Only the hard-coded absolute `rm -rf /home/casparcg/highascg-server` / `-frontend` (lines 66–71) still fire. Failure scenario: an eggs build proceeds with gigabytes of `cef-cache/` + `dist-web/` the operator believes were cleaned.

### 8. [LOW] add-exfat-data-partition.sh conf fallback references files moved to legacy-persistence/
`tools/eggs/live-usb/add-exfat-data-partition.sh:57`
> `source "${HERE}/flash-iso-conf-lib.sh"`

Both `flash-iso-conf-lib.sh` and `flash-iso.conf.example` now live only in `tools/eggs/live-usb/legacy-persistence/` (verified; `finish-operator-stick.sh:57` was repointed, this one wasn't). Running the tool without a `/dev/sdX` argument errors telling the user to "copy flash-iso.conf.example" — and if they do, the `source` then aborts under `set -e`. Fails closed (no wrong-disk danger; `finish-operator-stick.sh:126` always passes `$DEV` explicitly), but the documented no-arg path is unusable.

### 9. [LOW] NODE_TEST_TIMEOUT is inert — neither gate has a per-test timeout
`tools/ci/run-offline-tests.js:256` and `run-offline-tests-full.js:21`
> `NODE_TEST_TIMEOUT: process.env.NODE_TEST_TIMEOUT || '60000'`

Node's test runner takes `--test-timeout=` as a CLI flag; it does not read a `NODE_TEST_TIMEOUT` env var, and nothing in the repo reads it either (repo-wide grep: only these two setters). So the intended 60s/120s guard does nothing. On GitHub the job's `timeout-minutes: 15` eventually kills a hung test (gate still fails, correctly); locally `scripts/ci/run-local-ci.sh` hangs forever.

### 10. [LOW] run-local-ci.sh has drifted from the workflow it claims to mirror
`scripts/ci/run-local-ci.sh:1` ("run the same checks as GitHub Actions locally") omits two gating steps the workflow runs: `node tools/ci/check-max-file-lines.js` and `node tools/ci/check-unwired-exports.js` (`.github/workflows/ci.yml`). A local green run can push a 501-line file or a new orphan export and go red on CI. Related: `verify:script-paths` (`tools/ci/check-script-paths.js` — built precisely to catch moved-script breakage like findings 7–8) is wired to neither CI nor the local script, and only scans `src/`, `run.sh`, `package.json`, systemd anyway.

---

## Overall health

The curated gate itself is in good shape: all 218 FILES entries exist on disk, no duplicates, sub-checker and `node --test` exit codes propagate correctly, the `HIGHASCG_SKIP_SERVER_INTEGRATION=1` default keeps server-spawning tests out of the gate, and the only failures are the already-diagnosed WO-237/WO-415 pair. Ops tooling is generally well-disciplined (`--yes`/`--dry-run` gates on both clean-slate resets, root checks, argv-array xrandr calls, no exec-interpolation issues found in tools JS). The systemic problem is everything *outside* the curated list: 163 test files are ungated, 10 of them currently fail (18 tests), the "full" fallback gate is permanently red and therefore never run, and rot that WO-172 explicitly flagged three weeks ago is still in the tree. The cheapest structural fix is to make the full gate runnable again — delete or repoint the ten rotted files, swap the live-AMCP name blacklist for an opt-in env gate, and stub `timedatectl` in the system-time test — then a red `test:ci:full` becomes signal instead of wallpaper.
