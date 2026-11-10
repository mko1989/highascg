# 04 - Test coverage of server linking (read-only review, 10.11.2026)

All paths relative to /home/casparcg/highascg. Nothing edited; tests run with HIGHASCG_DEVICE_IDENTITY_PATH / PRESENTERS_DIR pointed at the scratchpad (as run-offline-tests.js does).

## 1. Inventory

CI = in the curated list. The list is the hard-coded arrays in tools/ci/offline-test-files.js, offline-test-files-2.js, offline-test-files-3.js (concatenated by tools/ci/run-offline-tests.js, `node --test --test-timeout=60000`, with HIGHASCG_SKIP_SERVER_INTEGRATION=1). Every file below is in it unless marked NO.

| Test file | What it asserts | Real / stub | CI | Run result / time |
|---|---|---|---|---|
| smoke-wo670-cluster.test.js | address parsing; add peer (not self, not non-HighAsCG); saved list is device-local; offline marking; real HTTP peer device-view read + subnet scan; route registration; link records device key, cloned identity refused; SSH key install only for linked/signed/fresh; send-media trust-then-rsync | real cluster-peers.js, cluster-media.js; stub persistence, stub fetch; one real HTTP peer | yes | 8 pass, 0.1 s |
| smoke-wo670-cluster-master.test.js | claim ordering (epoch, then lower fingerprint); "Make master" = epoch+1 pushed to all; claim accepted only from linked signer, untampered, newer; auto failover after FAILOVER_MS by succession order; auto off; split brain converges on lower fingerprint; routes registered | real cluster-master.js, fake clock, in-memory net (`cluster()` helper) | yes | 7 pass, 0.1 s |
| smoke-wo670-cluster-fanout.test.js | channel plan by destination id, only cables on the peer; route:// rewrite; forwards translated lines to peer Caspar; off when not master / pair on; stepping down closes conns; every AMCP send hits the sink (source-text grep for wiring) | real cluster-fanout.js, fake Caspar sockets | yes | 5 pass, 0.07 s |
| smoke-wo670-cluster-catchup.test.js | air journal; replay on connect/reconnect; **followsMaster() + shouldFollowerSkipLocalPgmAmcp (see section 4)** | real journal/fanout/amcp transport, stub sockets | yes | 7 pass, 0.1 s |
| smoke-wo712-cluster-call.test.js | signed call wire format, rejection matrix, 6-action allow-list, look.take on follower goes to master, zone look on follower goes to master, route auth | real cluster-call*.js, real router; stub peers | yes | 17 pass, 0.2 s |
| smoke-wo725-cluster-e2e.test.js | two source-text guards + runs tools/e2e/cluster-scenario.js on 3 sandbox node servers (14 steps: alone timing, clocks, link all pairs, link refusals, master set + epoch fencing, signed calls, sender choice, master restart, failover via SIGSTOP, follower restart, unlink) | REAL node processes (`--no-caspar`, simulated Caspar), loopback ports | yes | 14 pass, 24 s |
| smoke-wo732-mutual-link.test.js | link one = both; unlink either = both; half-link repair at HEAL_MS; missed unlink handled; racing repair; sign-in-needed peer; old server without clusterLinked; 3 servers | real cluster-peers.js on fake LAN (tools/smoke/lib/cluster-lan.js) | yes | 9 pass, 0.05 s |
| smoke-wo739-link-invites.test.js | invite waits on other side; accept/decline; renew/lapse; auto-accept; no re-ask | real cluster-invites.js on fake LAN | yes | 8 pass, 0.05 s |
| smoke-wo802-node-only-links.test.js | client relay only through own node; master claim after unlink (master unlinked, other unlinked, last unlinked); onRemove wiring; shared show after unlink | real relay/peers/master | yes | 10 pass, 0.25 s |
| smoke-wo1026-two-box-follower.test.js | follower may ADD/REMOVE consumers but PLAY/CG still blocked; program take-look on follower goes to master (502 if unreachable); tracking duty follows camera presence; air journal cleared on Caspar pid change | real fanout/take code, stub cluster | yes | 13 pass, 0.07 s |
| smoke-wo746-shared-show-gates.test.js | shared show G1-G10 on in-memory 3-node cluster: off by default, delta edits, follower proposals merged by master, 3 operators different looks, same look conflict (master wins, follower kept as file), accept_remote off, stale epoch, replay, follower/master restart, switch off | real shared-show.js + show-merge.js, fake transport | yes | 19 pass, 0.2 s |
| smoke-wo746-shared-show-e2e.test.js | wiring greps + shared-show scenario on 3 sandbox servers (tools/e2e/shared-show-scenario.js, 7 steps) | real node processes | yes | 6 pass, 7 s |
| smoke-wo746-show-merge.test.js | merge algorithm | real | yes (not verified in list) | 9 pass |
| smoke-wo712-server-duties / -exchange / smoke-wo723-duties-from-config | duty gates (lighting/zones/ptz/presenters/auto), exchange sender/receiver rules, duty publication in ping/cluster view | real modules, stubs | yes | duties 9 pass, exchange 14 pass |
| smoke-wo979-linked-roles.test.js | fake detection sidecar; role fixtures; unlink drops the peer's exchange data; then duties scenario (tools/e2e/duties-scenario.js, 13 steps incl. relay and "unlink survives restart") on 2 role-split sandbox servers | real node processes, fake sidecar | yes | 23 pass, 11 s |
| smoke-wo1017-fanout-holds-stale-layout, smoke-wo933-fanout-checks-before-replay, smoke-wo772-media-sent-resync, smoke-wo724-media-send-paths (needs rsync) | fan-out holds a destination whose channel layout is stale on either box; catch-up checks Caspar INFO before replay; after media rsync the fan-out resyncs; rsync names with spaces/&/() | real fanout/media code, stubs | yes | 8 / 7 / 3 pass |
| tools/e2e/run-cluster-e2e.js (+ cluster-scenario, shared-show-scenario, duties-scenario, cluster-bench) | CLI wrapper; `--live=host,host --yes` drives real servers | sandbox or live | NO (CLI) | not run (scenario already covered via wo725/wo746/wo979 smokes) |
| tools/e2e/two-box/{run,checks-static,checks-active,probes,scenario}.js | WO-1026 on the REAL pair (main 127.0.0.1 / .17, peer .10): T0 linked/master/follows/show-sync; T1 channel layout + fan-out; T2 outputs; T3 DeckLink; T4 tracking duty; T5 takes (master->follower PGM, LED stays local, follower press relayed to master, cluster call); T6-T8 stream/record/soak; T9 cleanup | live boxes, ssh, ffprobe | NO (manual, changes air on both boxes) | not run (live) |
| tools/sweep/checks-cluster.js | read-only live sweep: peers online/same build/clock, signed call, media copy | live | NO (sweep) | not run |
| tools/test-env/linked-roles.{js,sh} | holds a 2-node media+tracking sandbox pair for manual poking | sandbox | NO | n/a |
| tools/dev/fake-cluster-peer.js | dev stub peer with own identity, real cluster-master, optional fake Caspar (`--amcp-port`) | stub | NO | n/a |
| godot/client/tests/test_devices_cluster.gd | pure model strings: cluster_model.gd roles per destination, follow_note, show_line | real GDScript, stub payload | Godot suite, not node CI | not run |
| replication/hot-backup smokes (smoke-replication-*, wo842, companion-hot-backup-failover, project-hot-backup) | the OLD strict leader/follower pair, not src/cluster | mixed | some in CI | not in scope, not run |

Result of the offline cluster smokes run once: 16 files + 3 sandbox files, ALL PASS (0 failures). Total for sandbox-backed ones about 42 s.

## 2. What the sandbox harness can and cannot simulate

tools/e2e/cluster-nodes.js + sandbox-server.js (read in full):
- CAN: start N real node servers (`startSandboxNodes(root, ids)`), each its own root, device key, config, `--no-caspar` simulated Caspar (WO-453), ids forced via `replication.selfId` (cluster-nodes.js:78). Per-node `freeze()` (SIGSTOP) / `thaw()` (SIGCONT), `restart()` on the SAME port and SAME root (persistence kept), `stop()`. `liveNodes()` can also wrap real boxes (read-only/limited steps only).
- CANNOT (hard limits in code):
  - Not loopback aliases: every node binds `--bind 127.0.0.1` (sandbox-server.js ~line 138, config `bindAddress: '127.0.0.1'` ~line 99) and is addressed `127.0.0.1:<port>` (cluster-nodes.js:79). A "different IP" is only a different port. Nothing starts a node on 127.0.0.2/3.
  - Not real Caspars: `--no-caspar`; and a sandbox master never fans out (routes-cluster.js `isMaster: () => !isSandbox() && ...`, asserted at smoke-wo725:28-31 and cluster-scenario.js:137). So AMCP fan-out, follower PGM blocking, drive rights and catch-up are NOT exercisable multi-node. They are tested only with stub sockets in unit tests. I believe (not confirmed in code) followsMaster/PGM-block is also inert in a sandbox because there is no real AMCP client.
  - Not identity: selfId is injected by config, not derived from a MAC/hostname; sandbox deliberately ignores the hardware hostname (replication-local-identity.js, `isSandbox() ? null : getHardwareHostnameSelfId()`). The "highascg<NNNN> from MAC" re-find path is not exercised at all.
  - Address change: `restart()` reuses `node.sb.port` (cluster-nodes.js:81); no option for a new port/host. Easy to add (call start(id) without port) but then the peer's stored host:port is stale, which is exactly the scenario, so this is cheap to script once added.
  - One-way packet drop: no. Only whole-process SIGSTOP (symmetric, and the node also stops talking). No proxy, no iptables, no fault-injecting fetch.
  - Mastership flip: yes via POST /api/cluster/master/set (step 'master: set on one', cluster-scenario.js:120-141) and failover by freezing the master.
  - Operator override vs auto: not tested; set() is always followed by a stable state, never raced against a failover timer.
- Fake LAN (tools/smoke/lib/cluster-lan.js) is the better place for (a)/(b): `n.up` toggles reachability per node (symmetric), `reach(h,p)` keyed on `host:4200`. It has hooks for refuse/401/old-server but no per-direction drop and no way to re-address a node (the nodes Map is keyed by host; you would add `lan.move(name, newHost)` and per-pair `block(from,to)`). It does not run cluster-master.js (that has its own `cluster()` helper in smoke-wo670-cluster-master.test.js with a fake clock) so peers+master together are not in one fake LAN.

Missing to script:
- (a) peer IP changes while linked: not scriptable in sandbox (see above); in fake LAN needs `move()`. Production re-find logic itself: cluster-peers.js keys peers by id but dials saved host:port; the only discovery is the manual `scan()` (line 432). No code or test re-resolves by selfId/hostname. This is a feature gap, not just a test gap.
- (b) asymmetric reachability: needs a per-direction block in the fake LAN or a tiny TCP proxy per node in the sandbox (the proxy is the one piece that works for both). Also a test that A sees B online but B sees A offline and the master claim does not flap.
- (c) reboot of master / follower: follower restart exists (cluster-scenario.js:231-243), master restart exists (cluster-scenario.js:191, "keep master, no failover inside 12 s"). Missing: reboot WITH a changed address (needs (a)), reboot while the other has become master (the 13:xx incident: A returns and must accept B's higher epoch, then operator "Make master" must stick), and downtime longer than FAILOVER_MS.
- (d) both boxes edited while apart: shared-show gates test G4 (split-brain old master comes back, edits kept) exist in the in-memory test (smoke-wo746-shared-show-gates:185-215) but the sandbox scenario never partitions. No test for edits on both sides when sharing is OFF, or for what a re-link does with two diverged projects.
- (e) operator on a follower drives its own local destination: impossible to test end-to-end (no Caspar). Unit level exists only in the CONTRARY direction (blocked, see section 4). The new rule needs a pure-function test on shouldBlockLocalPgmAmcpCommand with destination ownership (cabled-here vs cabled-on-peer).
- (f) operator drives another box's destination: partly exists (follower press to master T5.5/T5.5b live, wo712 callMaster unit, fanout channel plan unit). Missing: follower/peer operator driving a destination cabled on the OTHER box, and "second machine drives first box's screens in a pinch" (no relay of AMCP/take to a named server other than the master; call allow-list only has look.take etc.).
- (g) two operators take the same destination: only shared-show editing conflicts (G7) are tested; no test of two takes racing on one PGM, take ordering through master, or the lock/last-writer rule.

## 3. Prioritised test matrix

Legend: E exists, P partial, M missing. Columns: offline unit | sandbox multi-node | live two-box. "Where" = file that should hold it (new files marked +).

| # | Scenario (priority) | Unit | Sandbox | Live | Existing / where it should go |
|---|---|---|---|---|---|
| 1 | IP change of a linked peer: re-find by selfId/hostname, link stays, no duplicate peer, saved host updated (P0, the incident) | M | M | M | unit: +tools/smoke/smoke-wo10xx-peer-readdress.test.js on cluster-lan.js (+lan.move); sandbox: cluster-scenario.js new step (needs restart on new port); live: two-box checks-static T0.3b |
| 2 | Auto failover must not fire against a master that is reachable at another address / flapping epoch (P0) | M | M | M | unit: smoke-wo670-cluster-master.test.js (only "A unseen" case exists, no "A seen at new IP"); live: +T0.8 epoch stable over 60 s |
| 3 | Operator "Make master" sticks (no override within N s while target reachable); auto does not out-vote a fresh manual claim (P0) | M | M | M | unit: smoke-wo670-cluster-master.test.js (set() vs failover tick race); sandbox: cluster-scenario.js 'master: set' + wait > FAILOVER_MS |
| 4 | Local destination always driveable from local box whatever the role (P0, target rule 2) | M (inverse asserted, section 4) | M (impossible today: no Caspar) | M | unit: smoke-wo670-cluster-catchup.test.js 139-198 rewrite + smoke-wo1026-two-box-follower.test.js 26-34; live: checks-active new T5.7 "follower plays test card on its own PGM" |
| 5 | Master drives all screens on all boxes (P0, rule 3) | P (fanout channel plan 84-125, forwarding 155-172) | M (sandbox master never fans out) | E (T5.1-T5.4) | sandbox needs a throwaway real-protocol fake Caspar (like fake-cluster-peer --amcp-port) and removing the isSandbox guard behind an env |
| 6 | Link kind: master/follower vs peers distinct; peers: both operators drive own box, no AMCP block, no fan-out, no forwarded takes (P0, rule 5) | M (no such field exists; every link is one kind) | M | M | +tools/smoke/smoke-linkkind.test.js; extend cluster-scenario.js; two-box T0.x |
| 7 | Drive another box's destination in a pinch (follower or peer -> remote dest) (P1, rule 4) | P (cluster-call look.take to master only) | M | P (T5.5/5.5b: follower->master only) | smoke-wo712-cluster-call.test.js + checks-active.js |
| 8 | Two operators take the same destination (P1) | M | M | M | unit: shared-show-gates style file for take ordering; two-box checks-active |
| 9 | Linking & invites: add, invite, accept/decline, auto-accept, mutual, repair, old server, 401, self, non-HighAsCG (P1) | E (wo732 9, wo739 8, wo670 8) | E (cluster-scenario link + refusals) | E (T0.3) | complete; add duplicate-id/changed-IP-same-identity case (see 1) |
| 10 | Cloned identity / same selfId two boxes (e.g. MAC-id collision, restored ISO) refused (P1) | E (wo670 "cloned identity refused") | M | M | cluster.js; consider sandbox with two same selfId |
| 11 | Mastership basics: epoch ordering, claim signature, succession, split brain converge (P1) | E (wo670-master 7) | E (master set + failover) | P (T0.4 reads only) | complete for static; see 2,3 for dynamic |
| 12 | Failover then old master returns: steps down, does not take back (P1) | E (master 124-150 "stepped down") | E (failover step, 14 s) | M | live: +T9.3 optional (changes air) |
| 13 | Reboot of master / follower with changed address (P1) | M | P (restart same port only) | M | cluster-scenario.js 191, 231 + new address variant |
| 14 | Asymmetric reachability (P1) | M | M | M | lan.block(from,to) in cluster-lan.js; TCP proxy in cluster-nodes.js |
| 15 | Shared show sync: delta, proposals, conflicts, stale epoch, restarts, switch off (P1) | E (wo746-gates 19) | E (7 steps) | P (T0.5 read) | complete; add "diverged while apart, re-link" (d) |
| 16 | Both boxes edited while apart, then rejoined (P2) | P (G4 epoch case) | M | M | smoke-wo746-shared-show-gates.test.js + shared-show-scenario.js (needs partition from 14) |
| 17 | Duties: gating, exchange, refusal, relay, unlink survives restart (P2) | E (wo712-duties/exchange, wo723) | E (wo979, 13 steps) | E (T4.x) | complete |
| 18 | Media send: trust, rsync, resync after send, name escapes (P2) | E (wo670 P2b, wo772, wo724) | M (media:false in harness, no rsync target) | P (sweep cluster.media-copy) | sandbox: acceptable gap; sweep covers live |
| 19 | Unlink: both sides, tombstone, claim dropped, exchange dropped, shared show stops (P2) | E (wo732, wo802, wo979) | E (unlink step, duties unlink) | M | complete offline; live not run |
| 20 | Fan-out catch-up: replay after reconnect, check before replay, stale layout hold (P2) | E (catchup, wo933, wo1017) | M | E (T1.3) | complete at unit level |
| 21 | Follower-owned consumers (stream/record) allowed while PGM look blocked (P2) | E (wo1026 26-34) | M | E (T6/T7) | will change with rule 2 (section 4) |
| 22 | Godot UI: link-kind selector, follow_note text, role display (P2) | P (test_devices_cluster.gd; follow_note only) | n/a | n/a | godot/client/tests/test_devices_cluster.gd |

## 4. Existing assertions that contradict the owner's target model (will need to change)

Rule 2 (local screens always driveable locally) vs the current "follower blocks its own PGM AMCP":
- tools/smoke/smoke-wo670-cluster-catchup.test.js
  - lines 139-155 `describe('WO-670 P4b local PGM takes on a follower')` + `it('skipped only while another online server is master ...')`: asserts `followsMaster()` is true whenever another online server is master (any role, any destination), and false only if master gone / pair on. The target model needs the answer to depend on destination ownership and link kind, not just role.
  - lines 157-174: `shouldFollowerSkipLocalPgmAmcp(ctx, pgm) === true` when follower check is true; PGM only gated, `previewOnly` false; greps routes-scene-take.js, amcp-batch.js, amcp-client-transport.js `shouldBlockLocalPgmAmcpCommand` and routes-cluster.js `setClusterFollowerCheck(() => followsMaster(ctx))` (source-text wiring pins at 169-173).
  - lines 176-198: `client._send('CLEAR <pgm>-299')` returns `{skipped:true}` and nothing is sent to the local Caspar. Directly the incident behaviour.
- tools/smoke/smoke-wo1026-two-box-follower.test.js lines 26-34: `shouldBlockLocalPgmAmcpCommand(ctx, 'PLAY 1-10 "clip"') === true` ("air stays the master's"), `CG 1-30 ADD ...` true ("a template is content"). Only ADD/REMOVE consumers and SHM pass. Same pin as above.
- tools/smoke/smoke-wo1026-two-box-follower.test.js lines 42-80 `a program take-look goes to the master`: a program take on a follower is relayed to the master and the answer is the master's (53-57, 62-66 "local only for preview / relayed / master"). Correct for master/follower with role distribution of destinations owned by the master, WRONG for a take on the follower's own local destination (rule 2). Needs a destination-owner condition in handleTakeLook.
- tools/smoke/smoke-wo712-cluster-call.test.js
  - lines 222-233 `look.take on a follower: program goes to the master (once...)`: same relay-everything rule.
  - lines 288-333 `zone look on a follower goes to the master` (assert at 319 `local` empty: "the follower does not take program itself").
- tools/e2e/two-box/checks-active.js lines ~104-130 (T5.5, T5.5b): a take pressed on the second server "goes on air through the master". With a local-destination exception the check should be split: press on follower's own destination stays local; press on a master-owned destination relays.
- tools/e2e/two-box/checks-static.js T0.4 (line 52) "main is the master, the second server follows it" and scenario.js phases hard-code one master/follower pair; under the two link kinds a "peers" pair would fail T0.4 by design.
- tools/e2e/run-cluster-e2e.js header line 19 and tools/e2e/duties-scenario.js (lines 7-9, 80-92: `follows_master` asserted for the tracking server): document/assert "a follower skips its local PGM takes, kiosks follow the master". duties-scenario 373 asserts `follows_master === false` after unlink (stays valid).
- godot/client/tests/test_devices_cluster.gd line 97: `follow_note({"follows_master": true})` expects the string "PGM here is driven by the master: local PGM takes are skipped (PRV still works)." (and the corresponding string in cluster_model.gd).
- tools/smoke/smoke-wo670-cluster-fanout.test.js lines 174-195: "off when not master": only a master fans out. Fine for master/follower; for rule 4 ("first box's screens driven from the second machine") a non-master forwarding path is needed, so this will be extended, not just edited. (Judgement, not an outright contradiction.)

Rule 5/7-adjacent assertions that bake in the current single-link-kind and IP-keyed model (will need extension, not necessarily contradiction):
- tools/smoke/lib/cluster-lan.js:23 `nodes.get(`${h}:${p}`)`, `localAddress` returns `host` and fetchJson keyed by host: the fake LAN identifies a server by its address, the opposite of rule 7.
- tools/smoke/smoke-wo670-cluster-master.test.js 124-150 (auto failover after FAILOVER_MS "A unseen"): the incident behaviour (unreachable at old IP = unseen = failover) is asserted as correct; a reachable-at-new-IP exception should be added next to it.
- tools/e2e/cluster-nodes.js:79 `address: 127.0.0.1:${port}` and 81 restart on the same port: harness assumes address stability.
