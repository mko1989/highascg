# WO-1029 — Linked servers: full review, link kinds (one operator / peers), identity that survives an IP change
**Area:** network, engine, testing-ci, devices-config
**Status: OPEN (10.11 — review done by four reviewers, reports in `1029_review/`; phase 1 fixes in progress; phase 2 design waits for the owner's answers)**

Owner, 10.11 (after the incident below):
- *"it seemed like it didnt let me drive local screens. which is my main idea with 2box/multibox setup. have connected
  servers each does something different, for instance driving local led wall one, streaming and record second. local
  screendests should be driveable from the local box. but in the same time being able to drive from master all the
  screens. as well as being able to drive first's screen from the second machine in a pinch."*
- *"we need a clear distinction in connections, the master follower (hotbackup) route, where one operators drive 2
  boxes from the master, either hot backup or role distribution. and second option is peers, where two operators splitt
  workload (local vs stream for instance) and work alongside. thats why the link needs to be between highascg node's
  and not casparcg straight amcp."*
- *"as for ip addresses changes. thats why we have baking of id from mac address into hostname so boxes can recognize
  and find eachother regardless of the ip address, as long as they are reachable."*
- *"the whole box linking needs a good review and very thorough tests to catch bags."*

## The incident (10.11, 09:51)

- highascg7579 rebooted after a kernel update. eno1 is DHCP and came back as 192.168.0.36 (was .17).
- highascg5867 had it saved by IP, saw it offline and auto-failed-over (12 s) — again on every tick, so an operator
  "Make master" on 7579 was overruled within 2 s (epoch 7 → 8).
- 7579 could reach 5867, so it followed it; a follower blocks every AMCP line to its own program channels. 5867
  forwarded nothing to 7579 (offline in its view). Nobody drove 7579's screens: no test card, no media.
- Fixed by hand: re-add on 5867 with the new address, then Make master on 7579.

## Investigation — the review

Four read-only reviews, full text with file:line, scenarios and fixes:
- [`1029_review/01-identity-mastership.md`](./1029_review/01-identity-mastership.md)
- [`1029_review/02-drive-gating-fanout.md`](./1029_review/02-drive-gating-fanout.md)
- [`1029_review/03-shared-state.md`](./1029_review/03-shared-state.md)
- [`1029_review/04-test-coverage.md`](./1029_review/04-test-coverage.md)

### Bugs against today's design (the ones that matter)

| # | Finding | Where | Severity |
|---|---|---|---|
| I1 | A peer is stored and polled by IP only; nothing re-finds it by device key, hostname or scan | `cluster-peers.js:256-260` | blocker |
| I2 | The hardware id is not stable: the boot unit derives it from eno1 (7580), the node from eno2 (7579); the box renames itself on every boot | `apply-hardware-hostname.js:18` | major |
| I3 | Peers are keyed by `selfId‖hostname`, not by device key; any HighAsCG box at a saved IP is taken for that peer; a `link_back:false` POST overwrites host + key without proof | `cluster-peers.js` | major |
| M1 | Failover is decided from one side's view, and that side always wins; an operator claim weighs no more than a failover claim | `cluster-master.js:159-177` | blocker |
| M2 | At boot a box acts on its stored self-claim for ~10 s before it pulls the newer one (two masters); the epoch floor is not stored | `cluster-master.js` | major |
| M3 | `make()` answers 200 when every peer refused | `cluster-master.js:120` | minor |
| D1 | A follower blocks all its program channels whenever it sees the master, whether or not the master forwards to it | `routes-cluster.js:192-198`, `amcp-fanout.js:228` | blocker |
| D2 | Blocked actions answer ok (fake `202 OK`, take routes 200) and record their side effects | `amcp-client-transport.js:72`, `amcp-batch.js:192`, take routes | major |
| D3 | The batch gate reads the first line's channel only | `amcp-batch.js:182-193` | major |
| D4 | Catch-up keeps a channel whose journal is empty; lines for a briefly offline peer are dropped | `cluster-fanout.js` | major |
| S1 | A mastership flip pushes the new master's show; the follower's open show and live destinations switch | `shared-show.js:255-290` | major |
| S2 | The backup taken before a replace covers the open project, not the file that is overwritten | `shared-show.js:275-281` | major |
| S3 | New project / Load on a follower replaces the master's open show (WO-751 again) | `shared-show.js` | major |
| S4 | An unsent edit does not survive a restart; `diverged` is never shown | `shared-show.js` | major |
| S5 | Lighting / PTZ senders follow the master claim with no hysteresis; with one-way reach both boxes hold a duty | `server-senders.js`, `server-duties.js` | major |

### Gaps against the owner's model

- A follower cannot drive its own screens at all (only "ask the master to take a stored look").
- There is one implicit link kind. "Peers" cannot be expressed; backup vs distribution is derived from cables only.
- Screen destinations are one cluster-wide list with no owner.
- The master's fan-out opens AMCP straight into the peer's Caspar (against "node to node only"); that is the root of
  the channel-number translation problems (WO-1017, WO-1027) and of the follower node not knowing what is on its screens.
- Show sharing is a per-box toggle, not part of the link. The old pair (`src/replication/`) is a second, separate
  leader/follower with its own epoch.

### Tests

- 19 offline cluster smokes, all green, all in CI. Not in CI: the two-box harness, the cluster sweep, the Godot test.
- No test for: an IP change while linked, one-way reachability, Make master against the failover timer, a follower
  driving its own destination, two operators on one destination.
- The sandbox runs N real nodes but only on 127.0.0.1:port, with no re-addressing, no one-way drop, and no fan-out.
- About eight test files assert the behaviour that has to change (list in report 04, section 4).

## Design

### Phase 1 — fixes that need no decision (the incident cannot happen again)

- **P1a identity:** each poll, a box sends a signed hello with its own address to every linked server it can reach. The
  receiver checks it against the saved device key, updates the saved host and counts the sender as seen. A box at a
  saved address with another device key counts as offline. A link-back for a known server needs the same proof.
- **P1b mastership:** a hello or a pushed claim from the master counts as "master seen" (no failover from a one-sided
  view); the epoch floor is stored; a box does not act as master at boot before its first pull; `make()` reports the
  servers that refused.
- **P1c drive gate:** a follower blocks a program channel only on positive, fresh evidence that the master forwards
  that channel to it and is connected. A blocked action answers 409 with who holds the screen — never ok. The batch
  gate works per line. Queries are never gated.
- **P1d hardware id:** the boot unit and the node derive the same id (the node's rule, `config.network`).
- **P1e test harness:** fake LAN with `move()` and one-way blocks; sandbox nodes on loopback aliases that can be
  re-addressed; the incident replayed as a test.

### Phase 2 — link kinds and destination ownership (proposal, waits for the owner)

From report 02 section 3 and report 03 section 3:
- **Destination owner** = the server(s) it is cabled on.
- **Link kind** in the signed claim: `one_operator` (backup where a destination is cabled on several boxes,
  distribution where on one) or `peers`.
- **An owner always drives its own destinations through its own node.** Others drive them by signed node-to-node calls
  keyed by destination id (`dest.take`, `dest.ftb`, `dest.testcard`, `dest.media`, `dest.mixer`, `dest.timeline`) — no
  channel numbers on the wire, no AMCP into another box's Caspar.
- **One holder per destination**, last press wins, shown in both GUIs.
- The direct AMCP mirror stays only as an opt-in frame-accurate backup transport, and takes over the old pair.
- Shared show: per-link sharing, destinations carry their owner, peers get a symmetric merge.

Open questions for the owner: failback after the old master returns; link kind per cluster or per link; what a local
press on a backup destination does; whether the old pair is retired into the backup mode.

## Work

- [ ] P1a identity hello + proof
- [ ] P1b mastership
- [ ] P1c drive gate
- [ ] P1d hardware id
- [ ] P1e harness + incident replay
- [ ] Phase 1 on both boxes (update 5867, change an address under a live link, reboot each box)
- [ ] Phase 2 after the owner's answers
