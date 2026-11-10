# 01 — Identity, addressing, discovery, mastership (linked servers)

Reviewer slice: `src/cluster/cluster-peers.js`, `cluster-master.js`, `cluster-invites.js`, `cluster-media.js` (fingerprint),
`src/api/routes-cluster.js`, `src/system/{device,hardware}-identity.js`, `src/replication/replication-local-identity.js`,
`src/replication/discover-leaders.js`, smokes `tools/smoke/smoke-wo670-cluster*.test.js` (+ wo732/739/802 for context).
Read-only; only GETs on both boxes' `/api/cluster*` and `/api/replication/ping`, plus local `getent`/`journalctl`.

## 0. Evidence collected on the boxes (10.11, ~11:00)

| | A = 127.0.0.1 (this box) | B = 192.168.0.10 |
|---|---|---|
| hostname / ping `selfId` | highascg7579 / `highascg7579` | highascg5867 / **`''`** (id falls back to hostname) |
| device fp | 8db7a1684d72446e | 8b7567e8ec9ffb85 |
| claim | epoch 9, master = A, auto = true, succession [A, B] | same |
| peer entry | 5867 @ 192.168.0.10, linked_at = added_at (Nov 9) | 7579 @ **192.168.0.36**, linked_at 09:59:17 today (the manual re-add) |
| follows_master | false | **true** (B blocks its own PGM lines) |

A's journal (`journalctl -u highascg`), the incident in order:

```
09:51:09 kernel boots as highascg7580
09:51:22 [hardware-identity] hostname highascg7580 → highascg7579          <- the box RENAMED ITSELF at boot
09:51:23 [cluster] master: forwarding takes to the linked servers           <- stale stored claim (A master, epoch 1)
09:51:32 [cluster] stepped down: highascg5867 is master (epoch 2, …)        <- B had failed over while A rebooted
09:56:41 master this server epoch 3 (operator) → 09:56:42 stepped down (epoch 4)   <- overruled after 1 s
09:57:03 epoch 5 (operator)                    → 09:57:07 stepped down (epoch 6)
09:58:45 epoch 7 (operator)                    → 09:58:47 stepped down (epoch 8)
09:59:25 epoch 9 (operator)                    → holds (B was re-pointed to .36 at 09:59:17)
```

Name resolution on A: `/etc/nsswitch.conf` = `hosts: files mdns4_minimal [NOTFOUND=return] dns`; libnss-mdns is installed,
avahi-daemon is active (its :5353 sockets show Recv-Q 9600/9984 — possibly not draining, unconfirmed). Results:
`getent hosts highascg5867` → only `100.109.24.25 highascg5867.tailc30860.ts.net` (Tailscale MagicDNS);
`getent ahostsv4 highascg5867.local` → **nothing after a 5.0 s timeout (rc 2)**; `getent ahostsv4 highascg7579.local` (own
name) → nothing either (only IPv6 answers for `hosts`). `avahi-resolve` is not installed. **No usable IPv4 LAN name
resolution exists today.** Node has no mDNS code (the :5353 node listeners are Companion's).

---

## 1. Addressing and re-finding a peer

### How it works now
- A peer is stored as `{ id, host, port, name, added_at, device_key, linked_at }` under persistence `clusterPeers`
  (cluster-peers.js:171-175, 345-346). `host` is whatever the operator typed or the scan found — an IP.
- `id` = `idFromPing` = ping `selfId || hostname || host:port` (cluster-peers.js:110). The stable cryptographic identity
  (`device_key`, ed25519, config/device-identity.json) is stored but is **not** the key of the map.
- Every 5 s `pollOne` GETs `http://host:port/api/replication/ping` (cluster-peers.js:256-260). Failure → `online:false`.
  **That is all.** Nothing re-resolves: no hostname lookup, no mDNS, no scan-for-fingerprint, no announce from the peer.
- The only ways a saved host changes: an operator re-add (`POST /api/cluster/peers {address}` with the same id → `prev`
  found → host overwritten, cluster-peers.js:336-347) or an *inbound* link-back from the peer (`link_back:false`, same
  code path). A link-back is only sent by `heal()` when the peer does **not** list this server (cluster-peers.js:280-283);
  `clusterLinked` in the ping is a list of fingerprints, not addresses, so a peer that lists you at a **stale** address
  looks "linked back = true" and is never told your new address.

### Incident trace (A moved .17 → .36, B unchanged)
1. A boots; A's poll of B (.10) succeeds; B lists A's fingerprint → `linkedBack(B) === true` → A's heal does nothing.
2. B polls .17 → timeout → A `online:false` forever. B's `heal()` skips offline peers (cluster-peers.js:281).
3. Nothing in either node can carry ".36" to B. Only the operator's manual re-add at 09:59:17 fixed it.
4. The fan-out (cluster-fanout.js:174-181) follows `m.host`, so once B's entry is fixed the Caspar connection follows too —
   the fix point is just the saved host.

### Findings (bugs against the current design)

**F1.1 — no re-addressing path at all; a one-way reachable peer is never told the new address** — *blocker*
cluster-peers.js:256-260, 280-283. Scenario: exactly the incident. Fix: see design below (signed hello carrying the
sender's address, sent every poll by whoever can reach the other).

**F1.2 — the MAC-derived hostname id is NOT stable on this box: it flips between highascg7579 and highascg7580** — *major*
- hardware-identity.js:68-81 picks the "primary" NIC = `networkCfg.primaryInterface` if given, else the first NIC *with an
  address*. config/general.json `network.primaryInterface = "eno2"` (MAC …:b9:db → 7579). eno1 is …:b9:dc → 7580
  (hardware-identity.js:24-34: last two MAC bytes `% 10000`, so sibling NICs differ by 1).
- The boot unit runs `tools/runtime/apply-hardware-hostname.js:18` → `ensureHardwareHostname({ log })` **without
  `config.network`** → eno1 → 7580. The node calls it with `ctx.config.network` (hardware-identity.js:273) → eno2 → 7579.
  `replication-local-identity.js:22` and `getHardwareIdentityPingFields` call `getHardwareIdentity()` with no networkCfg
  too; whichever runs first in a process wins, and a MAC mismatch with the cached file rewrites it (hardware-identity.js
  ~180-194).
- Proof: journal "Hostname set to <highascg7580>" at boot, node "hostname highascg7580 → highascg7579" at 09:51:22;
  earlier today the box logged as highascg7580; `config/hardware-identity.json` now says **7580/eno1, written 10:14:47**
  (writer unknown — some process without networkCfg; guess: a tool/smoke run) while `/etc/hostname` says 7579.
- Consequences for linking: `selfId` (= hw hostname) changes → the peer's `idFromPing` changes → see F1.3. Also the
  owner's premise "a box's identity is baked from its MAC into its hostname" does not hold.
- Fix: derive from a deterministic NIC (lowest MAC of physical `en*` NICs, or a persisted choice made once), never from
  "first NIC with an address"; all callers must use the same function with the same input; never rewrite an existing
  identity file because the "primary" changed. Use 3 bytes (`%1e6` or hex) to avoid sibling/collision ids. For linking,
  do not depend on it at all (key by device fingerprint).

**F1.3 — peers are keyed by `selfId||hostname`, not by device key → duplicates and a bogus failover** — *major*
cluster-peers.js:110, 335-336 (`prev = peers.get(id)`); no dedupe by `device_key` anywhere (`byDeviceKey` returns the
first match, :446). Scenario: A renames itself 7579→7580 (F1.2) and moves IP; B's operator re-adds A at the new IP →
`id = highascg7580` ≠ saved `highascg7579` → **second entry with the same device key**; the old one stays offline.
Then in cluster-master.js:171 `all.find(m => m.key_id === claim.master)` can hit the **offline** stale entry →
`master.online === false` → B fails over although A is online under the other entry (the `seen` set at :174 even
contains A). Fan-out `members()` (routes-cluster.js:167) would also list the same box twice if both were online
(guess: double forwarding to one Caspar; not exercised). Fix: key `peers` by device fingerprint; on add, if a saved
entry has the same `device_key`, update it in place (host, port, id/name) instead of adding.

**F1.4 — `pollOne` accepts ANY HighAsCG box at the saved IP as that peer** — *major*
cluster-peers.js:258: only `appId === 'highascg'` is checked; the ping's identity is not compared with the saved one.
Scenario: identical boxes on DHCP; A leaves .17, box C later gets .17 → B shows "A online", runs no failover, and if B
is master the fan-out (cluster-fanout.js:174) forwards A's destinations to **C's Caspar**; relays/device-view/`send-media`
also go to C (send-media is signed for A's fp so C refuses the SSH key; the AMCP fan-out has no such check). Fix: put
the device fingerprint in the ping (public, harmless) and treat a mismatch as `online:false, error:'another server
answers at this address'` (and trigger re-find).

**F1.5 — a link-back POST can overwrite an existing peer's host AND device key, unauthenticated** — *major (security)*
cluster-peers.js:332-347: the invite gate is `fromServer && !prev && …` (:337); with `prev` present any caller of
`POST /api/cluster/peers {address: X, link_back:false}` whose box at X answers a ping with that peer's `selfId`/hostname
replaces `saved.host` and `saved.device_key` (:345-346). From then on X's key is trusted for master claims
(cluster-master.js:73-77), signed calls and SSH-key install (cluster-media.js:211). `enforceAuth` is false on this box
(config/security.json), so the whole API is open anyway, but WO-670 P2b explicitly says trust = keys recorded when
*this* operator linked. Fix: a link-back for an existing id may update host/port only if X's `device_key` equals the
saved one AND X proves possession (signed challenge); a different key must become an invite.

**F1.6 — scan cannot recognise a linked peer at a new address** — *minor (but it is the natural re-find tool)*
cluster-peers.js:432-442: skips saved `host:4200` strings, compares only `instanceId` with self, returns hostnames.
The ping has no fingerprint, so a moved peer shows as a "new" server; adding it can duplicate (F1.3). Also `172.` matches
any 172.x not just 172.16/12 (:139), and the scan is /24-only on every IPv4 NIC (here also 10.0.0.0/24 of a /8).
Fix: ping carries `fingerprint`; scan marks `linked: <peer id>` when the fingerprint matches a saved key, and the UI
offers "update address".

**F1.7 — identity route returns `id: ''` on B** — *minor.* routes-cluster.js:313-315 uses ping `selfId`, which is empty
on 5867 (older replication config). Harmless today because `idFromPing` falls back to hostname, but it is a second
id-source inconsistency; if B's `selfId` later becomes non-empty and ≠ hostname, A creates a duplicate (F1.3).

**F1.8 — self-link check depends on the replication runtime** — *minor.* cluster-peers.js:325 compares `instanceId`,
which is `rt?.instanceId || null` (routes-replication-get.js:101); falls through to the device-key check (:328) whose
error message then says "a cloned install". Fix: compare fingerprints first with a correct message.

`src/replication/discover-leaders.js` is not used by the cluster; it scans only the *first* IPv4 NIC's /24 (:34-45,
here possibly 10.0.0.x instead of 192.168.0.x) and filters `leaderAvailable`. Not a cluster bug; note only.

### Smallest robust design for "a link survives an IP change" (target model #7)

Identity = device-key fingerprint (already exchanged and stored; unforgeable), **not** the hostname. Three layers, in
order of value:

1. **Signed hello / "I am here" (fixes the incident on its own).** On every poll where A reaches B, A POSTs
   `/api/cluster/hello { from_fp, host: localAddressTo(B), port, nonce/ts, sig }` (the `localAddressTo` helper already
   exists, cluster-peers.js:96-107). B verifies with the saved `device_key` for `from_fp`; if valid and the address
   differs, B updates `saved.host/port`, marks A online/`last_seen = now` and logs "A moved .17 → .36". Replay: include
   B's fingerprint and either a ts window (clock-dependent, as cluster-media.js MAX_SKEW) or better a nonce B handed out
   in its ping (`helloNonce`, rotated per minute) — no clock dependence. Cost: one small POST per peer per 5 s.
   It also gives B a "master seen" signal through the direction that works (see §2).
2. **Re-find by fingerprint when nobody can announce** (both moved, or the moved side cannot reach the other). After a
   peer is offline > ~15 s, at most every 60 s: probe the /24s (existing `subnetHosts`, 350 ms timeout) for a ping
   whose `fingerprint` equals the saved one, then verify by challenge (`POST /api/cluster/whoami {nonce}` → signature)
   before re-addressing. ~254 tiny GETs/min per lost peer; cheap.
3. **Hostname as a hint only.** mDNS does not work today (above); MagicDNS resolves to the Tailscale 100.x address, which
   must not become the AMCP fan-out path (the fan-out connects Caspar :5250 at `peer.host`) unless intentionally chosen.
   If wanted later: publish `_highascg._tcp` with the fingerprint in TXT via avahi (needs avahi working + `avahi-utils`;
   ask the owner) — still verify by challenge.

Plus: ping must expose `fingerprint` (F1.4/F1.6), peers keyed by fingerprint (F1.3), identity mismatch at a saved IP =
offline (F1.4).

---

## 2. Mastership

Model in code: signed claim `{epoch, master, succession, auto, by, ts, sig}`, beats = higher epoch, tie → lower master
fingerprint (cluster-master.js:39-44). Pushed on make, pulled from every online member on each poll (:159-168). Auto
failover: the master unseen for FAILOVER_MS 12 s → first online fp in `succession` other than the master claims epoch+1
(:169-176). `auto` defaults to **true** (:123).

### What happened at boot (explains "forwarding takes" then "stepped down" ~10 s later)
- Before the reboot A was master (stored claim epoch 1). While A rebooted, B saw A gone for 12 s and failed over:
  epoch 2, master B — the push to A failed (A down). A booted with its stored epoch-1 claim naming itself.
- `startIfLinked` (routes-cluster.js:363-367) starts the cluster; the first `afterPoll` runs `tick()` then
  `fanout.refresh()` (routes-cluster.js:73-76). If B is not yet reachable on that first poll (network still coming up;
  eno1 is DHCP), the pull finds nobody, `isMaster()` is true from the stale claim → "master: forwarding takes"
  (cluster-fanout.js:154). Next successful poll pulls B's epoch 2 → "stepped down" (09:51:32).
- So: **a rebooted master always loses mastership to the failover**, and runs as a **stale second master** until its
  first successful pull (both A and B forwarding to each other's Caspar for up to ~10 s).

### Why the operator was overruled within 1–4 s
A's operator "make master" → epoch 2k+1, pushed to B at .10 → B adopts (A's key is linked, A is a member). On B's next
tick A is "offline" (B polls .17) and `now - max(master.last_seen, startedAt)` is huge because `last_seen` is from before
the reboot (:173) → **immediate** failover, epoch 2k+2 (09:56:41 → 09:56:42). B's push to A fails (stale IP), but A
pulls it from B on its next poll and steps down. Repeat for every operator press; the epoch climbs by 2 per attempt.

### Findings (bugs against the current design)

**F2.1 — failover is decided from one-sided reachability; the blind side always wins** — *blocker*
cluster-master.js:169-176. No quorum, no evidence that the master is down (just "I can't see it"), and the deposed
master steps down on a pulled claim even though it sees the claimant and the claimant cannot drive it (fan-out to a
stale/unreachable Caspar). Result: the box nobody can reach is "master", the reachable box is a follower whose PGM is
blocked (routes-cluster.js:191-197: `followsMaster` only needs *the follower* to see the master online). Fix: (a) count
any authenticated inbound contact (the signed hello of §1) as "master seen"; (b) a master that receives/pulls a
*failover* claim from a member it currently reaches answers with a signed "alive" (or refuses the push with 409 alive)
and the claimant reverts; (c) in a 2-box cluster without a witness, auto failover should be off unless the link is
explicitly "hot backup" (see gaps).

**F2.2 — failover timer ignores the claim's own age** — *major*
cluster-master.js:173 uses `max(master.last_seen, startedAt)`. A claim just adopted (pushed by the master itself a
second ago) does not reset the timer, so a stale `last_seen` triggers instant failover (the 1 s overrule). Fix: also
`max(…, adoptedAt)` and treat a pushed claim signed by the master as "master seen now".

**F2.3 — operator claims and failover claims weigh the same** — *major*
`make()` (:120-130) has no `reason` in the signed claim; a failover claim from a box that cannot see the master
overrules an explicit operator decision made seconds earlier. Fix: sign `reason: 'operator'|'failover'`; a failover
claim may not beat an operator claim whose master has been seen (by anyone, incl. hello) within FAILOVER_MS; surface
"overruled by failover from X" in the UI.

**F2.4 — rebooted/restarted master acts on its stale claim before the first pull** — *major*
routes-cluster.js:165 `isMaster` reads the stored claim immediately; the first poll may have no reachable members.
Fix: after boot, `is_master` is false ("deciding") until one pull round got an answer from every member that answers,
or FAILOVER_MS passed; the fan-out waits for that.

**F2.5 — previous master never gets mastership back** — *design question → owner*. After a failover the old master just
follows (smoke `auto failover` asserts this). For "hot backup" that is right; for "role distribution" the box that
drives the LED wall should arguably be master again when back (or there should be no master at all). Needs an owner
rule; today it is implicit.

**F2.6 — `make()` reports success even when every member refused** — *major (UX/split brain)*
cluster-master.js:126-129 only logs warnings; `set()` returns 200 with `is_master: true`. Scenario (3 boxes): A's floor
was lost (F2.7), A makes epoch 1, C holds epoch 9 → C answers 409, A believes it is master and forwards to C's Caspar
while C's master B forwards too. Fix: return the per-member results; if a reachable member holds a higher epoch, re-make
above it (floor = max seen in the 409 body, which already carries `claim`).

**F2.7 — epoch floor is not persisted** — *minor (major with ≥3 boxes)*
cluster-master.js:63 `floor` lives in memory; `forget()` stores `null` (:193-194). After unlink-master + restart the
floor is 0. Fix: persist `{claim, floor}`.

**F2.8 — duplicate entries cause failover (see F1.3)** — *major*, cluster-master.js:171 `find` picks the first entry
with that fp. Fix: key by fp / use `some(online)`.

**F2.9 — `ts` is signed but never used; replay** — *minor.* `claimText` includes `ts` (:36) but nothing checks it.
Replaying an old claim is mostly harmless (must beat the held epoch) but after a `forget()` + restart (floor 0) an old
captured claim from a still-linked box is adopted. Clock dependence today: none for claims (failover uses local
`now()`); cluster-media.js MAX_SKEW 60 s does depend on clocks. Fix: persisted floor; optionally reject claims older than
the held one's `ts` for the same epoch.

**F2.10 — same-epoch divergence on `auto`/succession** — *minor.* beats() (:42-43) ignores everything but master; two
boxes that both re-sign epoch N for the same master with different `auto` stay divergent. Fix: tie-break on `claimText`.

**F2.11 — epoch has no upper bound** — *minor.* wellFormed (:48) accepts up to 2^53; a buggy/malicious linked box
sending `MAX_SAFE_INTEGER` makes `+1` a no-op and freezes mastership. Fix: cap (e.g. 1e9) and refuse jumps > floor+1000.

**F2.12 — succession is frozen at claim time** — *minor.* `[master, maker, ...members]` (:121-122); a server linked later
is not a successor until someone makes a new claim; unlinked fps stay (filtered, :186). Acceptable, but document it.

**Claims after unlink** — OK as designed: signer must be linked (:73-77) and master must be linked (:88, :110, :160);
`dropped()` (:204-209) forgets a claim naming the unlinked master. With F1.5 an attacker can, however, become "linked".

### Gaps against the owner's target model (not bugs in the current design)
- **G2.1 No link kinds.** Every link is a cluster; any "Make master" turns it into master/follower with `auto: true`
  default. There is no "peers" mode (two operators, no master, no follower PGM block) and no distinction between hot
  backup (same content, failover makes sense) and role distribution (different destinations; failover makes no sense).
- **G2.2 Local screens not always driveable.** `followsMaster` (routes-cluster.js:191-197) makes a follower drop its own
  PGM commands whenever the master is online *from the follower's view*, even if the master cannot reach it (incident).
  Target #2 wants local destinations always driveable locally. (Detailed in the fan-out slice; flagged here because the
  mastership flaw is what triggered it.)
- **G2.3 In a pinch, drive box 1 from box 2** works only by making box 2 master (a cluster-wide state change), not as a
  per-destination take.

---

## 3. Invites, link-back, tombstones, auto-accept

**F3.1 — re-add with a new address via POST /api/cluster/peers works only while the id is unchanged** — *major*
(cluster-peers.js:335-347). Today's manual fix succeeded because A's id stayed `highascg7579`; with F1.2 the next time
it may be 7580 → duplicate (F1.3). Same fix: dedupe by device key.

**F3.2 — heal never runs for an offline peer and never corrects an address** — *blocker (same as F1.1)*, :281.

**F3.3 — link-back trusts the address the caller computed** — *minor.* `linkBack` sends `localAddressTo(peer)` (:264-269);
with several NICs/Tailscale the chosen source address may be one the receiver cannot use for Caspar AMCP (e.g. a
100.x Tailscale address if the saved peer host is a MagicDNS name). Fix: send all IPv4 addresses, receiver prefers its
own subnet; or let the receiver use the request's socket remote address.

**F3.4 — 30-day tombstone makes the unlinked side unable to re-link from its own UI** — *minor.* unlink() with an
unreachable peer tombstones for TOMBSTONE_MS (:387). Later, the other box's operator links back → its link-back gets
409 `unlinked` → after `justLinked` (2×HEAL_MS, :286) its repair drops the link again. Only the tombstoning box's
operator can re-link. Intended per WO-732, but the 30-day silent stuck state is surprising; also in the incident's
setting an unlink sent to a stale IP *always* goes the tombstone route. Fix: show the tombstone and a "clear" action;
expire tombstones once the peer acknowledged via a signed hello.

**F3.5 — invites are keyed by fp-or-id and live in memory** — *minor.* cluster-invites.js:144, 156-160. A restart loses
them (renewed within HEAL_MS by design). An invite from a box without a recorded key is keyed by `id`, which can change
(F1.2). OK otherwise.

**F3.6 — decline / unlink DELETE goes to the stale address** — *minor.* decline() (:409) and unlink() (:385) use
`inv.host`/`saved.host`; after an IP change they fail and fall back to the tombstone path. Acceptable with the
tombstone design; better once hello keeps addresses fresh.

**F3.7 — auto-accept off + first link while the other side is offline** — *minor.* add() requires the peer to answer a
ping (:322-323), so linking an offline box is impossible; fine. But `link_back.pending` is recorded and the inviter's
heal renews every 60 s indefinitely; no UI timeout. Cosmetic.

**Races checked and OK:** simultaneous operator links on both sides (the second side's add sees `prev` and links
directly, invites dropped at :344); racing repair right after unlink (2-min tombstone, :383; smoke wo732 covers it).

---

## 4. Test coverage

Covered (smokes): add/refuse self/cloned key, offline peer kept, scan skips self (wo670-cluster); beats ordering, make +
push, claim validity (unlinked signer, tamper, malformed, older), failover after FAILOVER_MS with succession order, auto
off, split-network convergence (wo670-cluster-master); mutual link, unlink both sides, half-link repair, missed unlink
tombstone, racing repair, sign-in needed, older server, 3 servers (wo732); invites accept/decline/lapse/auto-accept
(wo739); claim drop on unlink, onRemove paths (wo802). The master harness (smoke-wo670-cluster-master.test.js:32-74)
models reachability as one symmetric `up` set — **asymmetric reachability cannot even be expressed**.

Missing test cases (concrete):
1. **IP change, one-way reachable**: A moves address; A reaches B, B cannot reach A at the saved host → after ≤ N polls
   B's saved host = A's new address (needs the hello feature; today: fails).
2. **Both moved** → re-find by fingerprint scan; an impostor at the old IP is not accepted.
3. **Different HighAsCG box at the saved IP** → peer shows offline / "another server", no failover suppression, no
   fan-out to it (F1.4).
4. **Re-add same device key under a new id** (hostname changed) → one entry, updated in place (F1.3/F3.1).
5. **Link-back POST with a different device key for an existing id** → refused / becomes invite (F1.5).
6. **Asymmetric partition in master harness**: B cannot see A, A sees B; A is master → A must stay master; B must not
   overrule; operator make-master on A must stick (F2.1/F2.3).
7. **Pushed claim resets the failover timer**: B adopts A's fresh claim with stale `last_seen` → no failover before
   FAILOVER_MS (F2.2).
8. **Boot with a stale self-master claim and an unreachable cluster** → not master (no fan-out) until a pull round or
   FAILOVER_MS (F2.4).
9. **Old master returns** — assert the owner-chosen behaviour (stays follower vs gets it back) explicitly.
10. **make() with every member refusing** → API reports it; re-make above the 409's epoch (F2.6).
11. **Floor persistence across restart after forget()** (F2.7).
12. **Duplicate entries with one offline** → no failover (F2.8).
13. **Hardware identity determinism**: `ensureHardwareHostname()` with and without `networkCfg` and with NIC address
    order swapped yield the same hostname; existing identity file is not rewritten because "primary" changed (F1.2).
14. **Scan marks a linked peer at a new address** by fingerprint (F1.6).
15. **Tombstone after an unlink to a stale address** and the other side's operator re-link → visible state, not silent
    drop after 2 min (F3.4).

---

## Severity summary
- Blockers: F1.1/F3.2 (no re-addressing), F2.1 (one-sided failover wins).
- Major: F1.2 (hostname id flips 7579/7580), F1.3/F2.8/F3.1 (keyed by id → duplicates, bogus failover), F1.4 (any box at
  the IP is "the peer"), F1.5 (unauthenticated host/key overwrite), F2.2, F2.3, F2.4, F2.6.
- Minor: F1.6–F1.8, F2.7 (major ≥3 boxes), F2.9–F2.12, F3.3–F3.7.
- Gaps vs target: G2.1 link kinds, G2.2 local screens always driveable, G2.3 per-destination drive-from-other-box.
