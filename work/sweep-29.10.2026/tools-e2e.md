# tools/e2e — sweep 29.10.2026 (batch 113)

Files: 17 · lines: 2243 · findings: 0 BUG-HIGH, 3 BUG, 0 DEAD, 5 RISK, 9 QUALITY

Nothing here was run against a server. Checked statically plus in scratch: every API route these tools call exists in src/api (rg per route), all 21 `HIGHASCG_*` / `CASPAR_*` env names in sandbox-server.js are read by src/ (so the sandbox isolation list is not stale), the HASCGSHM offsets in pixel-map-fixture.js match caspar/modules/shm/hshm_abi.h, the e2e report fields match godot/client/e2e/e2e_runner.gd. Wired/documented: `package.json:28 test:e2e:gui` → run-gui-e2e.js; smoke-wo753-project-matrix, smoke-wo746-shared-show-e2e, smoke-wo802-node-only-links (curated) use project-matrix / harness / cluster-nodes; WO-725/728/742/743/744/745/746/753/807 cover the rest.

## tools/e2e/caspar-shm-producer.sh
- `QUALITY` tools/e2e/caspar-shm-producer.sh:64 — the readiness loop falls through silently after 30 s; the next `amcp` call (:44) then fails on `exec 3<>/dev/tcp…` and `set -e` aborts with only bash's "Connection refused": no `FAIL:` line and no tail of caspar.out (the helper `fail` at :51 is never reached). Reproduced the pattern in scratch.

## tools/e2e/cluster-bench.js
- `OK`

## tools/e2e/cluster-nodes.js
- `OK`

## tools/e2e/cluster-scenario.js
- `RISK` tools/e2e/cluster-scenario.js:157 — the allow-list negative test POSTs the real-sounding action `system.shutdown` to a linked peer. In `--live` mode (run-cluster-e2e.js, real servers) a regression that lets it through (src/cluster/cluster-call.js:124 is the only guard) would shut down a real box. Use an inert name such as `wo725.no_such_action`; the assertion `/unknown action/` stays valid.

## tools/e2e/e2e-report.js
- `OK`

## tools/e2e/godot-shm-writer.sh
- `BUG` tools/e2e/godot-shm-writer.sh:30 — `LIB=$(ls …/libhshm_sink.linux.*.so 2>/dev/null | head -1)` under `set -euo pipefail`: when the extension is not built, `ls` exits 2, the pipeline fails and the script exits rc=2 right here, silently. The helpful `fail "libhshm_sink not built (godot/extensions/hshm/build.sh)"` on :31 is unreachable (verified with the same three lines in scratch: rc=2, no output). Fix: `LIB=$(… | head -1) || true`.
- `QUALITY` tools/e2e/godot-shm-writer.sh:77 — same silent-abort shape as caspar-shm-producer.sh:64: if Caspar never opens the AMCP port, the bare `exec 3<>` at :81 ends the script without printing godot.out / caspar.out.

## tools/e2e/godot-shm-writer/main.gd
- `OK`

## tools/e2e/pixel-map-fixture.js
- `RISK` tools/e2e/pixel-map-fixture.js:28 — `SOURCE = projects/mhp_harder.json`, the owner's live rig project; `projects/` is gitignored (`.gitignore:18`), so on a clean clone, CI or after the project is renamed `writeProject()` throws ENOENT (:44). It only reads that file (the "live project is never written" claim holds), but scenario 07 and `run-gui-e2e.js` with the default `--e2e=all` depend on a private file. Failing consequence is worse than a red run: see run-gui-e2e.js:335.

## tools/e2e/project-matrix.js
- `QUALITY` tools/e2e/project-matrix.js:459 — `process.exit(failed)` uses the failure count as the exit code; 256 failing projects would exit 0 (run-cluster-e2e.js caps at 100 for this reason). Trivial with `--all` on a big projects dir; use `Math.min(failed, 100)`.

## tools/e2e/replication-check.js
- `QUALITY` tools/e2e/replication-check.js:148 — the CLI exposes only `--peer`; the SSH user (`'casparcg'`, :59) and the peer's repo root (defaults to this checkout's path) are fixed although `steps()` accepts them, so a peer with another user or install path fails with a forced-command refusal. The destructive-looking cleanup is safe: the exact args of the `always` step (`--delete` + `--relative media/./.highascg-check/`) were replayed locally into scratch with a sibling `media/keep.txt`, and only `.highascg-check/` was emptied.
- `QUALITY` tools/e2e/replication-check.js:116 — the local temp dir is removed only after the "files left" assertion passes; any failure in the cleanup step leaks `highascg-repl-check-*` in $TMPDIR.

## tools/e2e/retro-source.sh
- `BUG` tools/e2e/retro-source.sh:178 — `WIN=$(DISPLAY=… xdotool search --name 'HighAsCG Retro' | head -1)`: `xdotool search` exits 1 when nothing matches, and with `set -euo pipefail` the script aborts silently there, before `fail "no window"` (:179) and without the `retro.out` tail. Verified against an empty private Xvfb: rc=1, no output. Failing input: the Godot retro window did not start (missing `godot/retro/install.sh`, wrong core path). Fix: `… | head -1) || true`.

## tools/e2e/run-cluster-e2e.js
- `RISK` tools/e2e/run-cluster-e2e.js:222 — no SIGINT/SIGTERM handler anywhere in tools/e2e (`rg -n "SIGINT|SIGTERM|on\('exit'" tools/e2e` shows only kill calls). Cleanup is the `finally` at :251 only. Ctrl-C or `kill` mid-run leaves the sandbox servers (spawned in sandbox-server.js:135 without `detached`) running, and when it happens during the failover step the master frozen by `old.freeze()` (cluster-scenario.js:212, SIGSTOP) is never thawed: a stopped process does not act on a pending SIGINT/SIGTERM until SIGCONT, so the server, its port and the root under `<out>/sandboxes` survive. Fix: register handlers that thaw and `stop()` every node.
- `QUALITY` tools/e2e/run-cluster-e2e.js:252 — in `--live` mode `await liveRestore(nodes, senders)` runs first in the `finally`; if it throws (a peer unreachable) `n.stop()` is skipped and the original error is replaced. Wrap each in its own try.

## tools/e2e/run-gui-e2e.js
- `BUG` tools/e2e/run-gui-e2e.js:335 — `pm.prepare(sb, …)` runs outside the `try/finally` that starts at :337. Failing input: default `--e2e=all` (so `pixelMap` is true, :327) on a box without `projects/mhp_harder.json` → `writeProject()` throws ENOENT → `main().catch` → `process.exit(97)` with the sandbox server child (started at :334, `tracking: true`) never stopped: an orphaned HighAsCG process plus its `<out>/sandbox` root. Fix: move `prepare` inside the `try` (or stop `sb` in the catch).
- `RISK` tools/e2e/run-gui-e2e.js:350 — the xvfb-run/Xvfb/Godot group is `detached: true`, so a terminal Ctrl-C reaches only the parent; with no signal handler `killGroup()` never runs and the whole GUI group keeps running (the comment "no orphaned Xvfb" only covers the timeout/hang kill paths). The (non-detached) sandbox server dies from the same Ctrl-C, leaving a client without a server.

## tools/e2e/sandbox-server.js
- `RISK` tools/e2e/sandbox-server.js:157 — `stop()` (and the readiness loop at :143) test `child.exitCode !== null`, but a child killed by a signal has `exitCode === null` and `signalCode` set. Failing case: the server was killed by a signal (OOM kill, a test's `kill -9`) → `stop()` registers an `'exit'` listener that never fires → the returned promise never resolves, and `startSandbox` waits the full 45 s for a dead child. Verified in scratch with `spawn('sleep'); kill('SIGKILL')` → `exitCode null / signalCode SIGKILL`, and the `stop()` body as written never resolved. Fix: also test `child.signalCode !== null`.
- `QUALITY` tools/e2e/sandbox-server.js:134 — the `server.log` fd opened for the child is never closed in the parent, and the 5 s SIGKILL timer (:160) is never cleared, so a clean `stop()` can hold the event loop for 5 s.

## tools/e2e/shared-show-harness.js
- `OK` — loads and builds a 2-node `createShowCluster` in scratch; its `src/cluster` imports (`createClusterCall`, `createSharedShow`, `HEARTBEAT_MS`, `show-merge`) all resolve.

## tools/e2e/shared-show-scenario.js
- `QUALITY` tools/e2e/shared-show-scenario.js:45 — steps are borrowed from cluster-scenario.js by `s.name.startsWith(prefix)` (:17, used at :45-46 and :134). Rename one of those steps and `step()` returns `undefined`; the `catch` in `runShowScenario` (:148) reads `s.name` of `undefined` and throws, aborting the run with a TypeError instead of a failed step. All three prefixes resolve today (verified).

## tools/e2e/shm-source-take.js
- `QUALITY` tools/e2e/shm-source-take.js:89 — children get `SIGTERM` only, then a 500 ms sleep and `rm -rf` of the work dir; a Caspar that is slow to stop keeps running with its config and log dir deleted, and there is no SIGKILL fallback (project-matrix.js:178 has one).
