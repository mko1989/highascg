# WO-761 — smoke-ws-restart-reconnect: a reconnect race failed it, and the failure hung test:ci:full

**Status: DONE (25.10, standalone 5/5 after the fix vs 1/3 before; lint clean)**

## Investigation

- The 25.10 rerun of `test:ci:full` made no progress for 19 min after 19:06. The process tree showed
  `node --test … tools/smoke/smoke-ws-restart-reconnect.test.js` with no children, no TCP sockets and state S.
- Standalone it passed 1 time in 3; the other 2 were killed by `timeout 120`. A diagnostic copy that logged the
  spawned server's output showed:
  - both servers start, and the restarted one logs `[WS] client connected`;
  - so the WsClient did reconnect, yet the test failed `reconnect timeout` (25 s), then held the process open.
- Cause 1, a race (`:125-134` at HEAD). The client's reconnect backoff is 150–400 ms, so it often reconnects while
  the test is still polling `waitForHttp` for the restarted server. `connectCount` reaches 2 before `onConnect` is
  attached, and nothing calls it again.
- Cause 2, the hang. `client.close()` ran only on success, so after a failure the reconnect timer kept the event loop
  alive forever. `stopProcess` also waited for `'exit'` from a child that had already exited (`killed` is false then).
- Run 1 (earlier the same day) passed it in 3971 ms: timing-dependent.

## What was done

`tools/smoke/smoke-ws-restart-reconnect.test.js`:
- `onConnect()` is also called once right after it is attached;
- `client` is hoisted and `client?.close()` moved into `finally`;
- `stopProcess` returns at once for a child with `exitCode !== null`.

There's no change to what the test asserts. It is a test-only fix, because the product behaviour (reconnect) was
correct.

## What was VERIFIED

- Standalone `node --test tools/smoke/smoke-ws-restart-reconnect.test.js`: 5 runs × 3 pass / 0 fail, plus 1 more after
  the final edit. Before the fix: 1 of 3 runs.
- eslint clean. The file was already outside prettier's checked set (`format:check` passes with HEAD unformatted), so
  the diff is kept minimal.
- The rest of the 25.10 rerun: gates OK (repo-integrity only reports the 11 Syncthing conflict files);
  `test:ci` 3320/0; `test:ci:full` 3985/4, with the 4 failures being this smoke plus the 3 operator-display tests that
  read the real GPU; Godot 21744/0; `--check` OK.
