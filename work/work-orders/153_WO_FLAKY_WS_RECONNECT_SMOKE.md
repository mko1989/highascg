# WO-153 — smoke-ws-restart-reconnect hangs under node --test (flaky harness)

**Status:** Open (diagnosed, not fixed)
**Priority:** Medium (blocks clean `test:ci` when it strikes; product behavior verified healthy)
**Date:** 2026-07-08
**Related:** WO-104 (test origin, T104.7)

## Evidence (2026-07-08)

- `tools/smoke/smoke-ws-restart-reconnect.test.js` fails with "reconnect timeout" (25 s) and then
  wedges the event loop ("Promise resolution is still pending but the event loop has already
  resolved") under `node --test` — reproducibly today, standalone and via `test:ci`.
- The SAME sequence extracted to plain scripts passes in seconds, twice over:
  raw `ws` client → second boot serves `/api/ws` + state fine; full `WsClient`
  (`reconnectInterval: 150`) → reconnects **0.9 s** after the restarted server is up
  (`connectCount=2`). Scripts preserved in the session scratchpad; flow documented here.
- The same test passed a full `test:ci` run earlier the same day; no WS-related code
  (`client/lib/ws-client.js`, ws-server) changed in between → load/harness-sensitive, not a
  product regression.
- Test file dates to WO-104 (Jul 2); its own header anticipates this: "excluded from default CI
  if too slow", with the `HIGHASCG_SKIP_SERVER_INTEGRATION=1` escape hatch.

## Task

- [ ] T153.1 Root-cause the hang under the test runner (suspects: spawned-server boot latency
  under load vs the fixed 25 s window; grandchild process/pipe interaction with the node --test
  child IPC; missing `finally` teardown leaving the spawned server + WsClient timer alive after
  the rejection, which explains the event-loop wedge).
- [ ] T153.2 Make the test deterministic (poll server readiness before the reconnect window,
  always `stopProcess` + `client.close()` in `finally`, generous env-scaled timeouts) or convert
  it to the extracted-script pattern that demonstrably works.

## Work log

- 2026-07-08 — Diagnosed as above. Pre-push gate run with `HIGHASCG_SKIP_SERVER_INTEGRATION=1`
  (the test's own designed skip), disclosed in the push summary. Product reconnect behavior
  verified healthy by direct instrumentation the same hour.
