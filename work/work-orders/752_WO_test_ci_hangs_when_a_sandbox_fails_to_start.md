# WO-752 — test:ci hung for hours when one sandbox server failed to start

**Area:** testing-ci
**Status: DONE (25.10.26 — new smoke 1/1, which fails on the old `cluster-nodes.js` ("no sandbox server left running"); smoke-wo725-cluster-e2e 14/14; lint 214.)**

Owner, 25.10: *"its stuck the run before was stuck for a couple hours"*

## Investigation

- The local gates run (`test:ci` on a clean export) sat on `smoke-wo725-cluster-e2e.test.js` for 25+ min.
  The owner had seen an earlier run stuck for hours. GitHub CI was green throughout (each run 4 min).
- Process tree: the test process (idle, no sockets) with **two** sandbox servers (`sb-a` :32801, `sb-b` :33589)
  alive and answering. The test starts three; `sb-c` was missing and its root folder was gone.
- After the two leaked servers were stopped by PID, the test process exited and test:ci printed the real error:
  `sandbox server did not come up on http://127.0.0.1:38727 — see /tmp/wo725-cluster-NSZ6IQ/sb-c/server.log`,
  1.8 s into the run. So sb-c's server exited at start.
- The hang:
  1. `tools/e2e/cluster-nodes.js` `startSandboxNodes` used `Promise.all`: one rejection rejects the call, and
     the sandboxes that did start are returned to nobody.
  2. The test's `after()` stops `nodes`, which was never assigned, then removes the temp root, sb-c's log included.
  3. The two live child servers keep the test process's event loop alive. With process isolation, `node --test`
     waits for that process forever.
- Why sb-c died is not knowable now: its log went with the root. Rerun alone, the test passes 14/14 → intermittent
  (a port race between the concurrent `freePort` calls, or load, are the candidates). The fix makes the next
  occurrence say why, and fail instead of hanging.

## What was done

- `tools/e2e/cluster-nodes.js` `startSandboxNodes`: `Promise.allSettled`; when any start fails, the started
  sandboxes are stopped, then the first error is thrown. One place, so every caller (WO-725, WO-746 e2e,
  `run-cluster-e2e`) is covered.
- `tools/e2e/sandbox-server.js`: the "did not come up" error carries the child's exit code and the last 12 lines of
  its `server.log`, so the reason survives a test's cleanup.
- `tools/smoke/smoke-wo752-sandbox-start-failure-no-leak.test.js` (in FILES): starts `sb-ok` + `sb-bad` (its root
  path is a file); the call must reject and no process may be left with a cwd in the temp root.

## What was VERIFIED

- New smoke: 1/1. With `cluster-nodes.js` from HEAD it fails: "no sandbox server left running".
- `smoke-wo725-cluster-e2e`: 14/14 alone. Lint 214 warnings (cap 216).
