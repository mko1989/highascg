# WO-725 — Cluster autotests: link, master, failover, signed calls, sender choice, timing — sandbox and live

**Status: DONE (24.10.26) — `node tools/e2e/run-cluster-e2e.js` green on 2 / 3 / 4 sandbox servers (5 runs) and live on
this box + .4 (8 pass, 3 sandbox-only skipped, both boxes restored); the 3-server run is in CI (smoke 13/13); two
sandbox isolation bugs found by it and fixed.**

Owner, 24.10 (after WO-724): *"Create more autotests"*. WO-724's two-box checks (link, master, signed calls, failover,
timing alone and linked) were all run by hand from scratch scripts; nothing in the repo could repeat them, and the
offline suite only covers the cluster modules one at a time with stubs (`smoke-wo670-cluster*.test.js`,
`smoke-wo712-*.test.js`).

## Investigation

- **Base:** WO-719's sandbox server (`tools/e2e/sandbox-server.js`: own root, config, device key, `--no-caspar`,
  `HIGHASCG_SANDBOX=1`) boots in ≈0.9 s, so several can run side by side on this box next to the live server.
- **Found: every sandbox had the same cluster id.** Linking three sandboxes, the third replaced the second in the
  peer list. The peer id is the ping's `selfId` (`cluster-peers.js:224`), and
  `replication-local-identity.js` `getOrCreateLocalReplicationSelfId` forces it to the hardware hostname
  (`highascg7580`) and saves that over `replication.selfId` — in a sandbox too. (Two real boxes with the same
  hostname would collide the same way; real installs get unique `highascgNNNN` names, not changed here.)
- **Found: a sandbox master connected to the LIVE Caspar.** Once a sandbox was master, P4a fan-out
  (`cluster-fanout.js:128` → `connect`) opened AMCP to each peer's Caspar; a sandbox reports `127.0.0.1:5250`, i.e. this
  box's on-air Caspar: `ss -tnp` showed `127.0.0.1:33960 → 127.0.0.1:5250` held by the sandbox PID, fan-out status
  `connected: true, sent: 0, "no shared destination is cabled there"`. It sent nothing only because no destination was
  cabled on both; with a shared project, sandbox takes (and P4b catch-up) would have played on the live box. The
  same planning also delayed the cluster poll: a master hand-back took 1541 ms to agree (vs 3–6 ms) and a sender pick
  3237 ms to reach the third server (vs 102 ms); both went away with the gate.

## What was done

- `src/replication/replication-local-identity.js`: in a sandbox the hardware hostname is skipped — its id comes from
  its own config / identity file (`replication.selfId`). Same WO-719 rule as the rest: a sandbox is not this machine.
- `src/api/routes-cluster.js` `fanoutOf`: `isMaster: () => !isSandbox() && …` — a sandbox never forwards takes.
- `tools/e2e/sandbox-server.js`: `media: false` (no ffmpeg fixtures; CI has no ffmpeg) and `config` (extra
  overrides for a fresh root).
- `tools/e2e/cluster-nodes.js`: sandbox nodes (freeze = SIGSTOP, thaw, restart on the same root + port) and live nodes
  (host:port) behind one shape; JSON request + `waitFor`.
- `tools/e2e/cluster-bench.js`: WO-724's read-only API timing per server (sequential + 10 concurrent).
- `tools/e2e/cluster-scenario.js`, 11 steps: API timing each server alone · link every pair both ways (ids, all
  online) · API timing linked · link refusals (itself, no server) · master set on every server in turn, all agree,
  epoch grows, a sandbox master never forwards · signed `look.take` around the ring (404 not found = whole signed
  path), not allow-listed → 400, unknown peer → 404, p50/p95 · sender choice (WO-723) picked on one, agreed on all,
  Auto = the master, artnet_in everywhere · *sandbox only:* master restart keeps the master (no failover inside
  12 s) · failover (SIGSTOP the master: the next claims a higher epoch, not before ≈12 s; on SIGCONT the old one
  stands down) · follower restart rejoins from its own store · unlink → no peers, epoch 0.
- `tools/e2e/run-cluster-e2e.js`: the CLI (`--servers=N`, `--live=a,b --yes`, `--out`, `--bench`, `--keep`), writes
  `results.json` + `report.md`, exit code = failed steps. Live mode refuses servers already linked to anything and
  loopback addresses (each server links the others by the given address; `127.0.0.1` made .4 link to itself), and
  always unlinks and puts the sender choices back, also after a failed step.
- `tools/smoke/smoke-wo725-cluster-e2e.test.js` (in FILES): the two guards pinned + the full 3-sandbox scenario, one
  `it` per step (≈24 s).

## What was VERIFIED

- Sandbox runs, all steps pass: 3 servers ×3, 2 servers, 4 servers. Typical: link 6 pairs ≤ 20 ms, all online 4–5 ms;
  master agree 2–6 ms per change; signed call p50 0.6–1.2 ms; sender pick on all 102 ms; failover promotion 14.3 s
  with ≥ 3 servers (12.7 s with 2: the frozen master's ping timeout adds to each poll), stand-down 28–49 ms; restart
  ≈0.6 s, rejoin ≈10 ms.
- Mutation check: without the fan-out gate the smoke fails 2 (pin + `sb-a forwards takes`); without the id gate it
  fails 9 (`sb-a lists 127.0.0.1:… under its own id`, the rest cascade).
- **Live, this box (`192.168.0.23`) + .4 (now on `main`, see WO-724):** 8 pass, 3 skipped, 0 failed; afterwards both
  `peers: []`, epoch 0, sender choices back to Auto. Master agree 3–4 ms; signed calls here → .4 p50 8.2 ms, .4 → here
  23.8 ms; sender pick 1 ms; API timing unchanged by the link (`/api/state` here 31.7 ms seq, .4 9.8 ms).
- `test:ci` 3104 tests, 3102 pass, 0 fail, 2 skipped; lint (214 warnings ≤ 216), format:check, max-lines,
  unwired-exports, repo-integrity + `--no-http` boot on a clean export: green.

## Open
- Fan-out (P4a/P4b) is not covered end to end: the sandbox has no Caspar of its own to forward to. A simulated AMCP
  listener per sandbox would let a run check that a take on the master lands on the follower.
- Send media (P2b) needs sshd + the forced command; covered by `smoke-wo724-media-send-paths.test.js` instead.
