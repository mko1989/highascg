# src/cluster — sweep 29.10.2026 (batch 074)

Files: 16 · lines: 2563 · findings: 0 BUG-HIGH, 4 BUG, 2 DEAD, 10 RISK, 3 QUALITY

How checked: the air journal, `rewriteLine`, `show-merge` (20 000-case randomized diff/apply and merge3 identity fuzz: 0 failures) and the peer connection were exercised with small node harnesses; exported names grepped over `src client godot tools scripts index.js`; the Caspar fan-out allow-list read from `src/replication/amcp-fanout.js`. Nothing was sent to a peer or to :5250.

## src/cluster/air-state.js
- `OK`

## src/cluster/cluster-air-journal.js
- `BUG` src/cluster/cluster-air-journal.js:65-70 (`MAX_PLAY = 8`) — the per-layer `play` list is trimmed from the FRONT, so the `PLAY <clip>` line that starts the producer is evicted by later `PAUSE` / `RESUME` / `CALL` / `LOADBG` lines. Failing cases (ran `createAirJournal()`): `PLAY 1-10 "a"` + 5×(`PAUSE`,`RESUME`) → `replay()` = 8 PAUSE/RESUME lines and no PLAY; `PLAY 1-10 "a" LOOP` + 9×`CALL 1-10 SEEK n` → 8 `CALL … SEEK` lines, no PLAY. A server that joins or reconnects (P4b catch-up) is sent control lines for a clip that never starts. Fix: compact PAUSE/RESUME to the last one and keep only the last `CALL` per verb+first argument; never evict the head `PLAY`/`LOAD`.
- `BUG` src/cluster/cluster-air-journal.js:61-63 (`MAX_CG = 20`) — same eviction for CG: `CG 1-10 ADD …` followed by 25 `CG … UPDATE` lines replays 20 UPDATEs and NO `ADD` (ran it). Any template updated more than 20 times (countdown/timer/lower-third text edits) is not recreated on a catch-up. Fix: keep the ADD and the latest UPDATE/PLAY state only.
- `BUG` src/cluster/cluster-air-journal.js:32-71 — `SWAP` is on the fan-out allow-list (`amcp-fanout.js:48`, sent by `scene-take-lbg-bank-finalize.js:51` on a bank flip) but `record()` has no branch for it, so a catch-up replays the pre-swap layer contents (ran: `PLAY 1-10 a`, `PLAY 1-20 b`, `SWAP 1-10 1-20` → replay still `PLAY 1-10 a`, `PLAY 1-20 b`). Fix: swap the two layers' journal entries (and mixer maps with `TRANSFORMS`).

## src/cluster/cluster-call-actions.js
- `RISK` src/cluster/cluster-call-actions.js:21-32,43-48,72 — `asObj()` reads `r.status`/`r.body`; `handleAuto` (tracking/auto-routes.js:41) and `handleRecallLook` (routes-fixture-dmx.js:87) are synchronous today, but if either becomes `async` the Promise has no `.body` and the action answers `200 { ok: true }` while having done nothing. Await them (`asObj(await …)`), which is free for sync functions.
- `OK` otherwise.

## src/cluster/cluster-call.js
- `RISK` src/cluster/cluster-call.js:60,117-119 — the replay cache (`seen`) is in memory only. A signed call captured on the LAN (plain HTTP) can be replayed after the receiver restarts, as long as it is still inside the ±60 s timestamp window (`MAX_SKEW_MS`); the nonce is unknown after the restart. Narrow window, but the actions include `look.take` and `companion.press`. Fix: persist the latest accepted `ts` per sender (reject `ts` ≤ it), or refuse calls for the first 60 s after boot.
- `OK` otherwise (`hasOwnProperty` guards on `actions`/`info`, signature checked before the nonce is stored).

## src/cluster/cluster-exchange.js
- `RISK` src/cluster/cluster-exchange.js:78-90 `send()` — no `try/catch` around `await deps.call(...)`. `cluster-call.call` is documented never to throw but runs `deps.sign(callText(req))` outside any guard; if signing throws, `send` rejects as an unhandled rejection (floating promise from `offer`) and `s.busy` stays `true`, so that peer/topic is never sent to again until restart. Fix: wrap in `try { … } finally { s.busy = false }`.
- `QUALITY` src/cluster/cluster-exchange.js:109-112 — the 5 s `expire` interval is never cleared (unref'd, so it only costs a timer) and `out` entries of peers that have gone away are never deleted.

## src/cluster/cluster-fanout.js
- `BUG` src/cluster/cluster-fanout.js:86 `rewriteLine` — only the FIRST channel number is translated (`/^(\S+\s+)(\d+)/`), but `SWAP <ch1>-<l1> <ch2>-<l2>` carries two. Ran with map `{2→1}`: `rewriteLine('SWAP 2-10 2-110 TRANSFORMS', map)` → `SWAP 1-10 2-110 TRANSFORMS`, a swap between two different channels on the follower (or a failed command when channel 2 does not exist there). It matters exactly when the two boxes number their channels differently, which is what `channelPlan` exists for. Fix: translate every `\d+-\d+` / channel token for `SWAP`.
- `RISK` src/cluster/cluster-fanout.js:188-191 — `catchUp` marks the channels `synced` after merely enqueueing the lines on the `PeerCasparConnection`; its queue drops jobs silently when 128 are pending (`peer-caspar-connection.js` `_enqueue`) and a job that finds the socket down only logs. Lost catch-up lines are never retried until the next (re)connect clears `synced`. Low impact now (batches of 50), but `t.sent` also counts dropped lines.
- `RISK` src/cluster/cluster-fanout.js:79-88 — the forwarded line is the transport's POST-injection line, so a CG ADD for a WS template carries the master node's WO-811 `templateKey` to the follower (see src/caspar/amcp-client-transport.js:111); the journal then replays a key that dies at the next master restart.

## src/cluster/cluster-invites.js
- `OK`

## src/cluster/cluster-master.js
- `OK` (epoch fencing, split-brain tie-break by lowest fingerprint and the WO-802 drop rules were traced against `smoke-wo670-cluster-master`; `claimText` is signed over every field).

## src/cluster/cluster-media.js
- `RISK` src/cluster/cluster-media.js:59,74 `sendMedia` — the `state === 'sending'` guard is checked at line 59, but `setMediaSend(… 'sending')` only happens at line 74, after two awaits (`deps.post` of the SSH key, `deps.project()`). Two clicks / two API calls inside that window both pass and start two rsync pushes of the same media to the same peer. Fix: set a synchronous `starting` flag right after the check.
- `OK` otherwise (`KEY_RE`, signature and `to` checks are correct; a replayed ssh-key request is idempotent).

## src/cluster/cluster-peers.js
- `RISK` src/cluster/cluster-peers.js:328-344 `add()` — a remote-initiated link-back (`link_back:false`) for an id that is already linked (`prev`) bypasses the invite and overwrites `saved` with whatever `device_key` and address the caller's `/api/cluster/identity` returns (`device_key: deviceKey`, line 343); the id is just the remote's self-reported `selfId`/`hostname` (`idFromPing`, line 107). Anyone who can reach `POST /api/cluster/peers` and run a fake HighAsCG ping with the same hostname as a linked peer replaces that peer's trust anchor (host and signing key), after which its signed `look.take` / `show.push` / master claims are accepted. Fix: if `prev?.saved.device_key` exists and differs, refuse (409) unless the call is an operator link.
- `RISK` src/cluster/cluster-peers.js:293-299,301-306 `poll()` — no re-entrancy guard (cluster-master and cluster-fanout both have `busy`). `heal()` can take up to ~6.5 s (`localAddressTo` 1.5 s + POST 5 s) per peer, longer than `POLL_MS` (5 s); an overlapping poll sees the old `p.back.at` and fires a second link-back / duplicate invite before the first records its result (line 272).
- `QUALITY` src/cluster/cluster-peers.js:136 — `/^(10|172|192)\./` also matches public 172.x / 192.x ranges (private are 10/8, 172.16/12, 192.168/16): a box with a public 172.217.x address would /24-scan a foreign network (254 GETs to :4200 per prefix, no auth header).
- `DEAD` src/cluster/cluster-peers.js:456 export `localAddressTo` — used only inside this file. grep: `grep -w localAddressTo` outside → none.

## src/cluster/cluster-relay.js
- `OK` (path checks run on the decoded path, the raw path is forwarded, `/api/system`, `/api/ws` and relay-of-relay are refused, 8 MB cap enforced).

## src/cluster/server-duties.js
- `OK`

## src/cluster/server-senders.js
- `OK`

## src/cluster/shared-show-ctx.js
- `QUALITY` src/cluster/shared-show-ctx.js:45-56 `casparLayoutDiffers` — any error (config file unreadable or missing, generator throw) returns `false`, i.e. "the layout matches"; the G10 `caspar_apply` hint is then hidden exactly when the server's Caspar config cannot be verified. Return `null`/`true` on error, or log it.
- `DEAD` src/cluster/shared-show-ctx.js:83 exports `commitShow`, `backupProject`, `casparLayoutDiffers`, `channelModes` — only `sharedShowDeps` is imported (routes-cluster.js); `commitShow`/`backupProject` are referenced by `smoke-wo746-shared-show-e2e` as text (`s.indexOf('function commitShow')`). grep: `grep -w "casparLayoutDiffers\|channelModes"` outside → none.

## src/cluster/shared-show.js
- `OK` (G1-G10 gates traced; the delta/need_full handshake terminates because the full push cannot answer `need_full` again, `pushTo` line 160).

## src/cluster/show-merge.js
- `RISK` src/cluster/show-merge.js:410-455 `apply` / `walk` — path segments from the wire are used as property names with no check, so `__proto__` walks into `Object.prototype`. Ran: `apply({}, [{ p: ['__proto__','polluted'], v: 'yes' }])` → `({}).polluted === 'yes'` process-wide. Reachable by any linked server through the signed `show.push` info action and by a follower through `show.propose` (both pass `ops` straight to `M.apply`, shared-show.js:191,271). Trust is "linked server", but a compromised/cloned peer can then corrupt every object in the master's Node process. Fix: reject segments `__proto__`, `constructor`, `prototype` in `apply` (and in `walk`), or use `Object.hasOwn` + null-prototype copies.
- `RISK` src/cluster/show-merge.js:363,376-378 `diff` — `same(a, b)` is `stableJson(a) === stableJson(b)` evaluated at EVERY recursion level, so each node is serialized once per ancestor: O(size × depth). Measured: a 1.8 MB show with ONE changed value → `diff` 267 ms, `merge3` 288 ms; the real shows are ~6.7 MB (header of shared-show.js), and the master runs `M.diff(base, m.show)` once per peer per push (shared-show.js:152) on the main event loop. Fix: compute a subtree hash once (memoize per node) or compare leaf-first and bubble up.
- `OK` otherwise (`diff`/`apply` round-trip and `merge3(base, base, t) == t` held in 20 000 randomized cases including keyed-array reorder).
