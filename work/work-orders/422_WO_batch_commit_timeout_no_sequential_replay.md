# WO-422 — Batch COMMIT-ack timeout no longer replays the transaction sequentially (review 03.08 engine §3, the last open review item)

**Status: DONE (2026-08-04 — smoke 2/2, batch neighbor smokes 21/21 total, suite 1820 / 0 fail / 2 skip; server restarted. Live-path change is deliberately minimal: one new refusal branch, all pre-send failure behavior identical)**

## Investigation

Review engine §3 (verified in source, unchanged since 03.08): `batchSend`'s fallback

```js
return runBeginCommitBatch(client, clean, options).catch((e) => { … return sequentialRaw(clean, client) })
```

could not distinguish "batch never reached the socket" (safe to retry) from "payload was
written but the `2xx COMMIT` ack timed out" (the `drainTimeout` path). In the second case the
commands very likely executed inside Caspar; the replay runs every PLAY a second time —
clips visibly restart from frame 0 mid-transition, deferred MIXER lines re-queue, and the
second pass has no transaction atomicity. The 2026-07-19 incident (ack format drift — GUI
actions executed, acks lost) is precisely a case where commands DID run and a replay would
have double-executed.

Failure-mode trade recorded: with the refusal, a timeout where Caspar somehow did NOT execute
leaves the look partially unapplied and logged at warn — operator re-takes. Versus the old
behavior's silent double-execution ON AIR. The take path already logs batch failures
(WO-418's Phase-B logging), so the timeout is operator-visible.

## What was done

`src/caspar/amcp-batch.js`:
1. The drain-timeout rejection now carries `err.amcpPayloadSent = true` — it can only fire
   after `connection.socket.send(payload)` succeeded.
2. The `batchSend` fallback checks the marker: payload-sent failures log at warn ("NOT
   resending — a replay would double-execute") and propagate; every other failure (not
   connected, validation, internal) keeps the sequential fallback exactly as before.

Scoped deliberately: an explicit Caspar ERROR ack inside the transaction still takes the
sequential fallback (Caspar told us something definite; that recovery predates this WO and
2.6-dev batch-rejection semantics are not established enough to change it blind).

## What was VERIFIED

- New `tools/smoke/smoke-wo422-batch-no-replay-after-send.test.js` (curated) 2/2: functional —
  a never-acked batch (120 ms env timeout) rejects with the marker after the payload provably
  hit the mock socket, drain cleared; source pins — the fallback checks the marker before any
  resend and the marker is set exactly on the ack-timeout path.
- Batch neighbor smokes unmodified: drain-timeout + WO-259 two-phase, 21/21 with the new file.
- Suite 1820 / 0 fail / 2 skip; server restarted to load. On-air behavior under a real slow
  COMMIT is owner-observable only: the symptom to watch for is a take that logs the warn and
  needs a re-take — instead of clips visibly restarting.

This closes the last open item from the 2026-08-03 review wave (rows 1–10 + engine §3).
