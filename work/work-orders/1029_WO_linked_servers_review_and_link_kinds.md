# WO-1029 — Linked servers: full review, link kinds (one operator / peers), identity that survives an IP change
**Area:** network, engine, testing-ci, devices-config
**Status: IN PROGRESS (10.11 — review done, reports in `1029_review/`; phase 1 DONE and verified on the two boxes; phase 2 = link kinds + destination ownership, owner's answers recorded, not started)**

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

**Owner's answers (10.11):**
1. **Failback:** stay where it is. Whoever took over stays master until an operator presses Make master.
2. **Link kind:** per link (each pair of servers has its own kind), not one per cluster.
3. **A press on the backup box of a hot-backup destination:** sent to the master; played locally and marked
   "diverged" when the master does not answer in about 1 s.
4. **The old pair (`src/replication/`):** folded into the link. Hot backup is a link mode; the direct AMCP mirror
   stays only as an opt-in frame-accurate backup transport; the separate pair UI and roles are retired.

## Work

- [x] P1a identity hello + proof (df2372ee) — `cluster-hello.js`; replay by per-sender counter, never a clock window
- [x] P1b mastership (04fd38da) — heard-from, stored floor, settled at boot, Make master reports refusals; no failback
- [x] P1c drive gate (df2372ee) — `cluster-fanout-report.js`, `air-held.js`; 409 AIR_HELD; zone relay (R3) left as it was
- [x] P1d hardware id — one rule for the boot unit and the node; a hostname one of the box's NICs derives wins over a
      flipped file (this box: file said 7580, name 7579 → stays 7579, file repaired on the next start)
- [x] P1e harness + incident replay (df2372ee) — loopback aliases, `move()`, one-way cut; 4/4
- [x] Phase 1 on both boxes (10.11, release 2026-11-10T095041Z on 5867, main on 4d68638e) — see "Verified on the two boxes"
- [ ] Phase 2 after the owner's answers

## Phase 1 — left open (found while fixing)

- Signed node-to-node calls (`cluster-call.js` MAX_SKEW_MS 60 s) still need both clocks within a minute: no NTP on a
  show LAN breaks take relays. Same cure as the hello: a per-sender counter.
- Link-back proof compares the public key fetched from the new address; it is not a proof of possession (needs a
  challenge).
- Godot does not show the 409 `AIR_HELD` answers yet (test card dialog, FTB, timeline, media play, Draft sync); the
  Servers card could show `forwarded_here`.
- For ~10 s after boot `is_master` is false with `master_id: self` (unsettled): check the Devices master line.
- Up to ~12 s of two writers on one channel after a fan-out report goes stale while the master still forwards.
- The replay's one-way-cut case no longer requires B to see A offline; tighten it.
- Engine paths that swallow send errors (stop audio-only look, clear channel, FTB retries) are covered only where a
  route pre-checks; the library-typed AMCP path skips the gate (B14).

## Verified on the two boxes (10.11, main 4d68638e from the tree, highascg5867 on release 2026-11-10T095041Z)

- **Gates:** local gate loop green (offline suite included), CI green on 4d68638e, Godot unit suite 26608 / 0.
- **5867 post-update sweep:** 26 pass, 4 warn (client not restarted, one root helper, DeckLink keyer lines, build
  stamps differ because main runs from the tree), 0 fail.
- **WO-1026 harness, phase 2:** static 26 pass / 0 fail / 2 warn (no SDI signal). Full run 41 pass / 1 fail / 2 warn /
  1 skip of 45: the fail is T5.0 "missing look 2box LED" — the look is no longer in the show (the owner's
  BIG_BUCK_BUNNY look took its place), T5.4 skipped with it. Re-run of T5 with `TWOBOX_LED_LOOK=BIG_BUCK_BUNNY_1080P24`:
  7 pass / 1 fail — T5.6 counted one Caspar line, `ffmpeg[…BIG_BUCK_BUNNY_1080P24.Y4M] Latency: 0` (the stand-in clip).
  Stream 591 frames / 12.1 s, record 501 / 10 s, soak 3001 / 60 s with 11 takes: no frame lost.
- **Drive gate (P1c):** the master reports `forwarded_here: [7]` to 5867. On 5867: test card on its own PGM ch 2 →
  200 and on its Caspar; test card / `PLAY` on ch 7 → 409 `AIR_HELD … driven by highascg7579`; a MIXER query on ch 7 is
  answered by Caspar.
- **Mastership (P1b):** master node frozen 22 s → 5867 takes over (epoch 10); thawed → main steps down and STAYS
  follower (no failback); Make master on main → epoch 11, `push: accepted`, held 30 s on both. Master node restart
  (back in < 12 s) and follower node restart: no takeover, epoch stays 11, show in sync, report resumes.
- **Identity (P1a), live:** a second address made primary on main's eno1 (.37, route source changed) → 5867 logs
  `highascg7579: now at 192.168.0.37:4200 (was 192.168.0.36:4200)` within one poll; address removed (.37 dead, the
  incident's state) → `now at 192.168.0.36:4200 (was 192.168.0.37:4200)`; master and epoch unchanged throughout.
- **Hardware id (P1d):** after the node restart the box is still highascg7579 and `config/hardware-identity.json` is
  repaired to 7579 / eno2. Not verified through a real boot.

### Found in this run (both are phase 2, not regressions)

1. **A follower still cannot drive a screen that is cabled only on it when the master forwards to it.** With 5867 as
   master it reported `forwarded_here: [2, 5]` to main, and the test card on main's own LED wall (ch 2) answered 409.
   Honest now, but against the owner's rule 2. Cure = destination ownership: a destination cabled only here is never
   held here; only a backup destination (cabled on the master too) hands the press to the master.
2. **A new master's catch-up replays its own copy channel onto the other box's screen** (B5): a probe layer put on
   5867's ch 2 (`PLAY 2-99 EMPTY`) appeared on main's LED channel after 5867 took over. Cure = the same ownership
   rule: catch-up only for destinations the master holds.

## Remote operator client (owner, 10.11)

Research: [`1029_review/05-remote-client.md`](./1029_review/05-remote-client.md) — builds, connecting, auth, pictures,
what degrades off the box, two boxes.

Owner: *"when i run the godot client on my mac, i want to connect it to one of my boxes, making it work like a local
on that box, but with a good handover system for backup."* — *"Say im connected to the master and driving it as a
local, in case of the master failaure i want to be moved to the backup/follower, so i have controll etc."* After the
first box is back: stay and offer to go back. Handover targets: the box's linked servers, learned from the box.
Rule 6 added to RULES.md "Linked servers".

Design: automatic move only when a linked server confirms the loss (it is master now, or lists the box offline);
an offer when only the client's own path is broken; never for the on-box client; persistent amber cue; no flapping.

Owner, same day: *"i dont want this godot client a/b the whole linking system is done in a different place and no need
for additional linking options"* — the client's A/B host slots go. A remote client has ONE server address
(`--server`, `HIGHASCG_SERVER`, or the single address in the connection menu); every other box it may move to comes
from the connected box's linked servers.

## One Devices view for all linked servers (owner, 10.11)

Owner: *"when the view is changed to the follower to edit its setup, which shouldn't be needed. config should be
shared. and screen destinations become created on a connected machine, we need only operator gui distinction the rest
should be \"shared\""*

Reading (to be confirmed by the owner): no "Edit" switch of the Devices tab to a linked server — every linked
server's rear panel is in the one view and a destination is cabled straight to a connector of any server; destinations
are one shared list; only the operator GUI and the live inputs are per server. Plan:
[`1029_review/06-unified-devices-plan.md`](./1029_review/06-unified-devices-plan.md) (steps S1–S18, decisions D1–D11; not started).

Owner, same day: *"and distinction in the live inputs is needed apart from gui"* — two things are per server in the
otherwise shared setup: the operator GUI and the **live inputs** (an input belongs to the box whose hardware it is on;
a look names "input X of server S", never a channel number — WO-1027).

## Phase 2a verified on the two boxes (10.11, main 832cb496 from the tree, highascg5867 on 2026-11-10T104723Z)

- Gates green, CI green on 832cb496; virtual box bed: remote client 13/13, takeover 11/11 (the stray layer reproduces
  on the old code), handover 8/8; ownership smoke 18/18; Godot 26654 / 0.
- **Takeover, live:** main's node frozen 22 s → 5867 master (epoch 12). Main's LED channel unchanged
  (`10: BIG_BUCK_BUNNY`), although 5867's copy channel held `1: shm visuals` — nothing replayed. Main reports
  `forwarded_here: [2], mirror: []`, LED = `own`.
- **A follower drives its own screen:** test card on main's LED → 200, `html` on layer 999 of its own Caspar; 5867 then
  shows holder `highascg7579`. **The master still can:** 5867's test card on its channel 2 lands on main's LED, holder
  `self`; off → gone.
- **Make master on main** (epoch 13, accepted): 5867's channels 2 and 7 and main's LED unchanged — no stray writes.
- 5867 post-update sweep: 27 pass, 2 warn, 1 fail = `app.logs`, two `403 APPLY FAILED` per node start: the WO-869
  capability probe (`APPLY 1-65535 SLICES CLEAR`), which runs because the owner's new cabling on 5867 (operator GUI →
  P1, mapping outputs → P2 / P3) left no screen consumer. Not from this work; the probe's expected 403 should not be
  logged as an error.
- WO-1026 harness on the owner's NEW 5867 cabling: 38 pass / 4 fail / 2 warn / 1 skip. T2.4 (Stream PGM no longer on
  DeckLink 2: cabling), T5.6 (2 log lines), T7.1 and T8.1 (recording 7.1 s of 10 s, 41.4 s of 60 s). The record loss
  is NOT attributed: it appeared together with the new cabling (a mapping on two GPU heads, shm visuals on 5867's
  channel 2); the same checks passed at 10:55 on the previous cabling. To be re-run on the old cabling before blaming
  either.
- **Orphan cable (owner: "connecting the screen 3 to a mapping node and send it to other box gpu outputs … doesnt let
  me"):** 5867's Pixel Mapping 1 input was held by the cable of a destination deleted on the other box. Removed by
  hand; fix: such cables are no longer served as cables and are dropped when that input is cabled again
  (`device-graph-edges.js`, smoke-wo1029-orphan-cables).

## Apply (restart Caspar) across linked servers, with the air state kept (owner, 10.11)

Owner: *"add a logic hidden underneth the apply caspar config (restart) button, first it should work on both boxes
(if needed of course for another box, also with the harnes to not restart local machine when only dirty config for
other box) second hitting that button should grab a full state of the box outputs etc with video frames if running etc
and restore it back to screens asap after restart is sucessful"*

Spec (in progress): each server decides its own "dirty" (`GET /api/caspar-config/dirty`); the node plans
(`GET /api/cluster/apply-plan`) and applies only the dirty servers (`POST /api/cluster/apply`), linked servers first,
the master last, a clean server never restarted. Before a restart the server takes an air snapshot (Caspar's INFO per
channel + the node's own state: looks, clip positions, paused / loop, routes, CG, test card, timeline, runtime
consumers) and restores it once Caspar is back, clips resumed at position + elapsed, mapped by destination (not by
channel number). WO-1013's restore is folded in. Tests: unit smokes + the virtual box bed with a restartable fake
Caspar.

### Apply, first run on the real box (10.11 12:28, main ce07da11)

- Plan: main clean, 5867 "clean (older build: running config only)". Forced on main with a clip playing on the LED
  and the test card on.
- Snapshot 12:28:38.72 → AMCP RESTART → Caspar back :41.1 → `restored in 1150 ms`; screens black about 3.8 s.
- Clip on ch 2 layer 10: 63.04 s before, 67.06 s after 4.11 s (expected 67.15) — the SEEK path works on this build.
  Test card back on layer 999; PRV clip resumed; stream look on ch 7 re-taken.
- **Bug:** the PGM look came back twice — its old bank layer (10) resumed at the right position AND the re-take on
  the other bank (110) from 0. The plan did not know look banks. Being fixed (engine).
- 5867 is not on this build yet (the owner is working on it): the two-box apply is verified only in the virtual bed.
- **Bank fix, second run (12:34):** the snapshot records each program channel's look bank and look layers; the re-take
  lands on the same bank, the node's bank pointer agrees. Live: one copy on layer 110, 348.08 s → 352.14 s over
  4.13 s (expected 352.21), `via: look`, card back, a stale route on ch 7's other bank reported as a leftover and not
  put back. `restored in 1149 ms`.
- Open: the virtual bed's fake looks do not alternate banks (the scenario could not have caught this); a program
  channel in bus mode was not considered; CG templates played by hand outside a look come back without their data;
  mixer state set outside a look is not captured.

### Two-box Apply on the real boxes (10.11 12:53, 5867 on 2026-11-10T113912Z, main on 87f8643b)

- 5867 updated (owner's go): sweep 27 pass, 3 warn, 0 fail. Plan: both servers `clean`, build `current`.
- `POST /api/cluster/apply {servers: [highascg5867]}` on main: 3.5 s. **Only 5867's Caspar restarted** (pid
  2415357 → 2424359); main's Caspar pid and its LED channel unchanged, main reported `skipped: clean`.
- 5867 restored its own screens in 349 ms: looks on its channels 5 and 7 re-taken, 1 clip.
- Seen: the look on Stream PGM was on layer 110 before (written there by the master's AMCP mirror, on the MASTER's
  bank) and came back on layer 10 — 5867's node did not know the mirror's bank (its own pointer said A), so it
  reported the layer 110 route as a leftover. One copy on screen, but the two nodes now disagree about the bank until
  the next take. Root cause is the Caspar-to-Caspar mirror (the follower's node does not see what the master writes);
  it goes away with node-to-node `dest.*` calls (plan 07).
- After its restore 5867 holds PGM/PRV 3 and Stream PGM (`it holds it now`): the master replays nothing there until
  its operator presses.

## Channels only where a destination is cabled (owner's go, 10.11) — plan

[`1029_review/07-channels-where-cabled-plan.md`](./1029_review/07-channels-where-cabled-plan.md): the rule (channels
only where this server's own graph cables the destination to a physical sink; the screen index stays the shared key,
with holes), node-to-node `dest.*` calls replacing the copy-channel AMCP mirror, the picture relay, media per
destination, migration of the two boxes, rollout R0–R6 and steps C0–C15, owner decisions O1–O11. Not started.

### Operator GUI invisible on 5867 (owner, 10.11 13:00) — fixed

Owner: *"im trying to run operator gui on the second box and it doesnt show there. the dock is on this screen, but
mouse isnt and no gui"*. 5867: operator GUI first (HDMI-0 at 0,0), PGM/PRV 3 → Pixel Mapping 1 → DP-0 / DP-4. The OS
layout put the mapping canvas at x=2048, but the generated Caspar window of the mapping-fed screen (7680x2160, always
on top, no slice windows, no DeckLink tiles) kept the default 0,0 and covered the operator monitor. The bbox-origin
rule only ran for screens with DeckLink tiles. Fixed in `build-caspar-generator-layout-sync.js` (453edf26, test in
smoke-wo869-operator-first-slices; fails on the old code). Hot-patched on 5867 (that one file), its node restarted,
the plan showed it dirty, Apply restarted only its Caspar: window now at x=2048, the GUI is on HDMI-0 (screenshot
checked).
- Seen on that screen: the Servers card of 5867's client still says "PGM here is driven by the master: local PGM
  takes are skipped" — no longer true for its own screens; wording to fix with the unified view.

## Channels only where cabled — live on both boxes (10.11 14:15, owner: "run the fix directly on the boxes")

Built and pushed (plan 07 wave A): C0 caps (0a2b39f0), C4 clock-free signed calls (a2fc6eed), C1a/C2/C3 the rule
behind `cluster.channelsWhereCabled` (957c598a), C1b/C1c engine + API hole-safe, `NOT_HERE` 409 (e82bd3a4). Flag set
by hand in each box's `config/general.json` (the switch UI, C12, is not built), then Apply.

| Box | Before | Now |
|---|---|---|
| highascg5867 (release 2026-11-10T130244Z) | 10 channels | 7: GUI, PGM/PRV 3 on 2/3, Stream PGM on 4/5, DeckLink 3/4 on 6/7 |
| highascg7579 (tree e82bd3a4) | 11 channels | 6: GUI, PGM/PRV 1 (LED) on 2/3, DeckLink 1/2 on 4/5, monitor mix on 6 |

- Each box refuses the other's screens with a clear answer: FTB / test card for screen 3 on 7579 →
  409 `NOT_HERE … it is on highascg5867`; FTB for screen 1 on 5867 → `… it is on highascg7579`. Each drives its own
  (5867: test card by `screenIdx: 2` → its channel 2).
- 7579's Apply (new engine): LED look re-taken and resumed (23 s → 34 s), `restored in 722 ms`; the "2box Mixer" look
  that sat on the old Stream copy channels reported `its destination no longer exists` and was not put anywhere.
- 5867's first switch ran on the core-only release and put content back by channel number (see WO-1030); it is on
  the converted build now.

**Open, expected at this stage (plan 07 waves B–D):**
- No box can drive the other's screens (the master included): `dest.*` node-to-node calls are not built. The old
  fan-out has nothing to mirror (no copy channels).
- "to zoom" has no channel anywhere (cabled nowhere; the Local use connector is not built).
- `GET /api/cluster` `destinations` lists only the screens a box has channels for.
- The "2box" looks' `route://9-3` / `10-4` point at channels that are now 6 / 7 on 5867 (input identity, plan 06
  S13–S16).
- No picture of a remote screen; no media needs / spread (in progress); the Godot client does not know `NOT_HERE`.
- The channel switch has no UI and no dry run; the flag was written into general.json by hand
  (backups: `/tmp/general.before-cwc.json` on 5867, the session scratchpad on 7579).
- `smoke-wo746-shared-show-e2e` step G7 failed once in a full local suite run ("save refused twice") and passed on
  rerun and in CI: a load-dependent flake to harden.

### 10.11 14:35 — both boxes on c5cf3a00 / 2026-11-10T133002Z, GUIs and Caspar restarted

- Mastership had moved to 5867 at 14:23 (failover: 7579 unseen 15 s on the 192.168.0.x path while a 44.5 GB rsync
  ran over 7579's 100 Mbit `eno1`; cause not proven — upstream gap or the copy starving the polls). Made master again
  on 7579: epoch 15, accepted.
- **Godot was not hole-safe:** after the first relaunch the client threw `int(null)` thousands of times per second
  (PGM timer, compose tiles, header chips / monitor options, audio rows). Fixed (c5cf3a00); 0 script errors on both
  GUIs after the relaunch. The full Godot audit (plan 07 C15) is still to do.
- Both Caspars restarted through `POST /api/cluster/apply {servers:[highascg5867, self]}` in 7.1 s: 5867 first
  (test card back on the wall, 114 ms), then 7579 (LED look re-taken, clips resumed, 725 ms).
- Screens checked by screenshot: 7579 shows "Spread (0)", 5867 "Spread (1)" with an amber dot on the BUMPER look;
  remote screens are empty tiles on each box (no picture relay yet).
- Root-installed `/usr/local/bin/highascg-replication-ssh` on both boxes is the old wrapper: a spread runs without
  rate limit and resume until it is reinstalled (sudo):
  `sudo install -m 755 ~/highascg/tools/runtime/highascg-replication-ssh.sh /usr/local/bin/highascg-replication-ssh`

### 10.11 15:45 — drive calls live on both boxes (main 1974c860, 5867 on 2026-11-10T142816Z + dock hot-patch)

Pushed: wave B + C8 (1e770113), C15 Godot audit (020962e8), Live layout reconcile (67d40b30), air restore leaves the
operator GUI / multiview channels alone (18a29c05), strobe (eeca7d75), dock on its own monitor (1974c860, not in a
release yet). 5867: 2 channels (GUI + the wall, PGM only); DeckLink 2/3/4 unassigned and the stale live sources
removed (leftovers of the WO-1026 setup).

- `GET /api/cluster` on both: every destination with owners (`own` / `remote`); `scene.remoteLive` present on both.
- **From 7579 (master): FTB on the wall** → 200 `via: [highascg5867 ok]`, the wall's channel emptied.
- **From 7579: take "OKKKK (LOOP)" on the wall** (`mainIdx: 1`) → 200 via 5867 in 126 ms; the wall plays it; 7579's
  `remoteLive[1]` shows `pgm: OKKKK (LOOP)`, `holder: highascg7579`.
- **From 5867 (follower): test card on 7579's LED** (`screenIdx: 0`) → 200 `via: [highascg7579 ok]`, `html` on the
  LED's layer 999; off again.
- Found: the same take WITHOUT `mainIdx` answers 400 `no program channel for main 2` — the looks' `mainScope` is a
  screen INDEX and still says 2 after two destinations were deleted (the wall is index 1 now). Looks need their scope
  re-keyed by destination id, like the Live layout cells (67d40b30).
- Found and fixed: the operator dock sat on the wall (the screen's usable rect was the whole desktop once the wall
  was one tiled RandR monitor).
- The wall's two heads carry the RandR `TILE` property (group 473, 2×1, 3840×2160 each) and X exposes one
  7680×2160 monitor: the GPU driver registers the DisplayID tile topology. Scan-out phase between the two heads was
  not measured.
