# 02 — Who may drive which screen: follower PGM block, take forwarding, fan-out

Reviewer slice: `src/cluster/cluster-fanout.js`, `cluster-relay.js`, `cluster-call.js`, `cluster-call-actions.js`,
`remote-destination.js`, `air-state.js`, `cluster-air-journal.js`, `cluster-peer-info.js` (read for the catch-up
check), the gates outside `src/cluster`, and `src/replication/amcp-fanout.js`. Read-only; the only live calls were
`GET /api/cluster` on both boxes (10.11, after the incident):

- A (highascg7579, now .36) `is_master: true`, epoch 9, fan-out active → B's Caspar 192.168.0.10:5250, one destination
  forwarded: "Stream PGM" `pgm [7,7] prv [8,8]`, `caught_up.kept [7]`.
- B (highascg5867) `follows_master: true`. B has `program_channels: 4`, but the master forwards only ch 7/8 to it.
  Every other program channel on B is blocked locally and driven by nobody. This is bug B1 below, live right now.

---

## 1. The map: what each operator action does today

### The gates (all of them)

| # | Gate | File:line | What it decides |
|---|---|---|---|
| G0 | `followsMaster(ctx)` | `src/api/routes-cluster.js:192-198` | "follower" = another server holds the master claim (epoch > 0), the old pair is off, and that master shows `online` in **this** box's peer snapshot. It does not check whether the master forwards anything to this box. |
| G0' | `isClusterFollower(ctx)` | `routes-cluster.js:200` | G0, only once `ctx._clusterMaster` exists |
| G1 | `isClusterFollower()` hook | `src/replication/amcp-fanout.js:16-29`, set at `routes-cluster.js:187` (only inside `fanoutOf`) | the same G0, read on every AMCP send |
| G2 | `shouldFollowerSkipLocalPgmAmcp` | `amcp-fanout.js:228-232` | blocks when (old pair receive box **or** G1) **and** the channel is in this box's `programChannels` (`:177-183`). PRV is never blocked. |
| G3 | `shouldBlockLocalPgmAmcpCommand` | `amcp-fanout.js:212-219` | G2 for one line. ADD/REMOVE are let through (WO-1026). |
| G4 | single-line transport | `src/caspar/amcp-client-transport.js:61-77` | a blocked line is **not sent** and resolves `{ ok: true, skipped: true, data: '202 OK' }` |
| G5 | BEGIN…COMMIT batch | `src/caspar/amcp-batch.js:182-193` (channel from `inferProgramChannelFromAmcpLines` `:105-116`, **first line only**) | the whole batch is dropped and answers `{ ok: true, okAll: true, skipped: true }` |
| G6 | scene take | `src/api/routes-scene-take.js:225-233` | returns before the take runs; the HTTP answer is still the 200 `{ ok: true, sceneLive }` built at `:479-493` |
| G7 | overlay look | `src/api/routes-scene-take-overlay.js:42-45` | 200 `{ ok: true, overlay: true }`, nothing sent |
| G8 | audio-only look | `src/api/routes-scene-take-audio-only.js:52-57` | 200 `{ ok: true }`, nothing sent |
| G9 | Draft → Live sync | `src/api/routes-project.js:108-111` | per channel `{ ok: true, skipped: true, reason: 'follower-fanout-pgm' }` (the only gate that says so honestly) |
| R1 | take-look → master | `src/api/routes-scene-take-look.js:59-68` | a PROGRAM take-look on a follower goes to the master as `look.take` with `relayed: true`; the answer is the master's (`viaMaster: true`) |
| R2 | `look.take` receiver | `src/cluster/cluster-call-actions.js:53-69` | on a follower, a program take that is not `relayed` goes on to the master; otherwise `handleTakeLook` runs locally |
| R3 | zone action | `src/tracking/zone-actions.js:46-52` | `look:<id>` on a follower goes to the master with `callMaster('look.take')` (without `relayed`, and without `mainIdx`) |
| R4 | receiver lock | `src/cluster/cluster-call.js:122` | the master's `accept_remote` duty refuses every relayed take (403) |
| F1 | fan-out on/off | `src/cluster/cluster-fanout.js:149` | on only when this box is master and the old pair is off (`routes-cluster.js:164-165`) |
| F2 | fan-out targets | `cluster-fanout.js:163-196`, `members` = **online** peers (`routes-cluster.js:166`) | one target for each online linked server, whatever its own role |
| F3 | fan-out plan | `cluster-fanout.js:72-94` | master channel → peer channel, only for destinations **cabled on the peer**, main-bus modes only (`:37`), held when sizes differ (`remote-destination.js:44-59`) |
| F4 | what is forwarded | `cluster-fanout.js:97-105` + `amcp-fanout.js:238-245` | allow-list PLAY/LOADBG/LOAD/STOP/CLEAR/PAUSE/RESUME/SWAP/MIXER/CG/CALL; the first channel number and `route://N` on mapped channels are rewritten; anything else is sent as it is |
| F5 | live forward | `cluster-fanout.js:291-311` | only to targets whose connection is up **right now**; lines for a disconnected target are dropped, and the journal keeps them |
| F6 | catch-up | `cluster-fanout.js:211-275`, check `cluster-peer-info.js:113-133` | on connect, a new target or a newly cabled destination: INFO the peer, keep channels that "match", replay the others from the journal |
| P1 | old pair fan-out | `amcp-fanout.js:250-301` | the leader mirrors **untranslated** lines to the one `peerCaspar`; the follower box blocks local PGM through `isAmcpFanoutReceiveBox` (`:148-170`) |

Two facts sit under the whole table:
- The fan-out goes **master node → peer's Caspar :5250 directly** (`routes-cluster.js:177-181` `PeerCasparConnection`;
  the WO-933 check also opens its own AMCP socket, `cluster-peer-info.js:22-62`). The peer's node never sees those
  lines. Its `liveSceneState`, playback tracker, air journal and GUI do not learn what is on its own screens (nothing in
  `src/cluster` writes `liveSceneState`; `air-state.js:18-28` reports only what the local store holds).
- The follower block (G2) is box-wide: **every** program channel, whether or not the master forwards anything to it.

### Per action

Short names: **M** = master, **F** = follower (G0 true), **X** = a destination cabled on another server.

| Action | On M | On F | For X (a destination on another box) |
|---|---|---|---|
| **Look take → PGM** (Godot deck `take-look`) | local take, then fan-out to every peer where the destination is cabled (F3–F5) | R1: goes to M as `look.take` and M takes it. M's answer says nothing about whether F's channel was actually forwarded (F's destination may be held, unplanned, or F offline in **M's** view). F's live store is not updated, so F's GUI shows nothing on air. | M plays it on **M's own channel** for X (it exists because channels follow the shared list) and forwards. A non-master cannot take for X except through M (R1/R2). |
| **Look take → PGM, direct `/api/scene/take`** (web, Companion, `restore-on-screens.js:28`) | local + fan-out | **G6: answers 200 ok, nothing on air, no relay to M** | as above |
| **Look → PRV** | local; the PRV lines **are forwarded** too (`cluster-fanout.js:88-89`), onto the peer's PRV | local PRV only (G2 lets PRV through) | M's PRV takes overwrite whatever the operator on that box staged on PRV |
| **Overlay look / audio-only look** | local + fan-out (CG/PLAY lines) | via take-look: relayed (R1). Via direct take: G7/G8 answer 200 ok, nothing on air. Overlay **stop** and audio-only **stop** (`routes-scene.js:63-67`) are not relayed: blocked by G4/G5 and answer ok. | through M only |
| **LED test card** (`routes-led-test-control.js:52-61`) | CG/PLAY on M's PGM; forwarded to peers where mapped (CG is allowed), so the test card also shows on every backup/extension | blocked at G4/G5; `applyCard` sees `202 OK`, so the route answers 200. `_ledTestPatternActive` claims it is on. **This is what the owner hit on A.** | only by being master |
| **Raw AMCP** `/api/amcp/raw`, `/batch`, `/raw-batch`, `/api/play`, `/loadbg`, `/load`… (`routes-amcp.js:105-240`) | sent + forwarded when the verb is allow-listed and the channel is mapped | PGM channels: 200 with a made-up `202 OK` / `skipped: true`, and `playbackTracker.recordPlay` (`routes-amcp.js:184`) records a clip that is not playing. A MIXER **query** gets an invented 202 too (WO-1028 #6). Other channels (inputs, multiview, operator GUI) pass. | through M's channel number only; if M and the peer differ, the channel number is translated only for mapped destination channels |
| **Media play on a layer** (Godot drag → look edit; web `/api/play`) | as raw | as raw: blocked, answers ok | as raw |
| **Timeline play** (`routes-timeline.js`, timeline engine) | ticker lines forwarded (layers 210+, `CALL … SEEK` allowed) | engine state says "playing"; every PGM line is blocked; **not relayed to M**; no gate or error in `routes-timeline.js` (grep: no follower check) | through M only |
| **FTB / clear** (`routes-ftb.js:84-111`, `engine/ftb-pgm-prv.js:97-128`) | per-layer `MIXER OPACITY 0` + `CLEAR` on PGM+PRV, forwarded | PGM lines blocked, PRV cleared; then `liveSceneState.clearChannel` for PGM (`routes-ftb.js:104`), so the local store says black while the screen still shows the master's look; answers 200 ok; **not relayed** | through M only |
| **Mixer changes** (`routes-mixer*.js`, live layer edits) | forwarded per property (journal keeps the last value) | PGM: blocked, answers ok | through M only |
| **Stream / record consumers** (`ADD/REMOVE`) | never forwarded (`DEFAULT_DENY` `amcp-fanout.js:54-70`); each box runs its own | allowed single-line (G3 `:215`). In a **batch** whose first line is a PGM PLAY/MIXER, G5 drops the whole batch, ADD included. The stream's **picture** (the PGM channel it attaches to, `routing-map.js:146-179`) comes only from M's fan-out, and only when that main destination is cabled on F. | — |
| **Zone / auto takes** | local take-look | R3: to M (no `relayed`, no `mainIdx`); if M refuses (R4) the zone detail shows it | through M only |
| **Shader live / restore on screens** | local (+ fan-out) | via `handleSceneTake`: G6 silent ok (`restore-on-screens.js:116` reports a `skipped` only for its own reasons) | — |
| **Draft → Live sync** (`routes-project.js:96-130`) | re-takes every channel | G9: reported `skipped` | — |

---

## 2. Bugs against the current design

### B1 — BLOCKER: a follower blocks its program channels even when the master forwards nothing to it (the incident)
`src/api/routes-cluster.js:192-198` (G0) and `src/replication/amcp-fanout.js:228-232` (G2).
- G0 asks only: "is the master online **in my view**?" Whether the master forwards to me is decided separately, by
  **the master's** view (F1/F2: `members()` = peers online in the master's snapshot, `routes-cluster.js:166`), its plan
  (F3: cabled, same sizes, same destination ids) and its Caspar connection (F5).
- These conditions are not symmetric. In the incident, A (new IP .36) could reach B, so A followed B. B still had A at
  .17, so B saw A offline and `plan()` dropped A's target (`cluster-fanout.js:164`). A blocked its PGM and nobody drove
  it. The same happens when:
  - the destination is `held` for a size mismatch (`remote-destination.js:44-59`, `cluster-fanout.js:82-86`);
  - the destination is not cabled on F in the master's cached device view (cached 15 s);
  - the shows are not shared (destination ids differ, so the plan is empty: G0 never checks `show.on`);
  - the master's TCP link to F's Caspar is down;
  - the program channel belongs to a main destination the master never forwards (live today: B blocks 4 program
    channels, the master forwards 1).
- Fix: block per channel, and only on positive evidence. The master already knows its plan for each peer. Publish it
  to that peer: a new exchange topic `fanout`, e.g. `{ to: <peer id>, channels: [peerCh…], connected, epoch }`,
  heartbeat on each poll. G2 then blocks channel `ch` only when a fresh (< 2 polls) report from the current master
  lists `ch` as forwarded and connected. Missing, stale or partial evidence → the box drives locally.

### B2 — MAJOR: blocked actions answer "ok"
G4 `amcp-client-transport.js:72-75`, G5 `amcp-batch.js:192`, G6 `routes-scene-take.js:225-233` (falls through to the
200 at `:479-493`), G7 `routes-scene-take-overlay.js:43-44`, G8 `routes-scene-take-audio-only.js:52-56`.
- Every path except take-look (R1) and Draft sync (G9) tells the operator "done" while nothing went on air: test card,
  raw AMCP, `/api/play`, direct `/api/scene/take` (web, Companion), overlay stop, audio-only stop, timeline play, FTB,
  mixer edits.
- Side effects are recorded as if the line had run: `playbackTracker.recordPlay` (`routes-amcp.js:184`), FTB clears the
  local live store (`routes-ftb.js:104`), `_ledTestPatternActive`, the timeline engine state.
- Queries are answered with an invented `202 OK` (WO-1028 #6).
- Fix: the gate returns a refusal the routes surface: `409 { error: 'Screen N is driven by <master> (linked servers)',
  drivenBy }`. Queries (a MIXER line with no value, INFO) must never be gated.

### B3 — MAJOR: a relayed take is "ok" even when it cannot reach the follower's screen
`routes-scene-take-look.js:65-67`, `cluster-call-actions.js:58-63`, `zone-actions.js:50-51`.
- The master runs the take on its own channel and answers 200. That answer does not say whether the requesting box's
  destination is in the master's plan, held, or whether its Caspar is connected.
- In the incident, A's take-look would have gone to B, B took it on B's channel and forwarded to nobody (A was offline
  in B's view); A's operator saw success.
- Fix: the `look.take` action answers with the fan-out status of the requesting peer for the taken channel
  (`fanout.status().peers[from.id]`: mapped? connected? held why?). R1 turns "not forwarded to you" into an error, or,
  better (see §3), takes locally.

### B4 — MAJOR: the batch gate looks at the first line only
`amcp-batch.js:105-116, 182-193`.
- The take-sync barrier (WO-574/814) and preset recalls send several channels' lines in one batch.
- First line on PRV, later lines on PGM → the PGM lines run on a follower.
- First line on PGM → the PRV lines and any `ADD` in the same batch are dropped too, which contradicts G3's WO-1026
  exemption.
- The regex needs `ch-layer`, so `MIXER 7 MASTERVOLUME`, `CLEAR 7` and `CALL` lines never count.
- Fix: decide per line. Filter the batch: send what is allowed, report what was refused (and see B2).

### B5 — MAJOR: catch-up "keeps" a channel whose journal is empty, or that has extra or missing layers
`cluster-peer-info.js:115` (`if (!want.size) return true`), `:5-10` ("layers the journal does not cover are not
compared"), `cluster-fanout.js:261-271`.
- **(a) A STOP/CLEAR missed while the peer was disconnected is never repaired.** F5 drops live lines while the
  connection is down. When it is back, the master's journal no longer has a producer on that layer, so `expectedLayers`
  does not list it, so the channel counts as "on air" and is kept. The peer shows a layer the master removed until the
  next take on that layer.
- **(b) PAUSE / RESUME / CALL / CG lines lost while disconnected are not re-sent on a kept channel.** Only MIXER lines
  are (`:266`). The peer keeps running a clip the master paused, or shows a stale lower third.
- **(c) Content put on a peer by someone else survives a master's catch-up.** For example, the peer was alone (master
  offline, G0 false) and its operator played things. When the master returns, its replay lays the journal over the top.
  Layers the journal does not touch stay, which mixes two operators' content. Both "replay over something already
  playing" and "keep stale" are possible depending on which layers overlap.
- Fix:
  - Compare both ways: any foreground layer present on the peer and absent from the journal makes the channel
    "differs".
  - Replay a differing channel as `CLEAR <ch>` + journal (only when the destination is master-held, see §3).
  - On a kept channel, re-send PAUSE/RESUME and the CG state too (or compare paused state from INFO).

### B6 — MAJOR: lines are lost for a briefly offline peer; nothing is queued
`cluster-fanout.js:294-295` (skips `!t.conn?.isConnected`), `:164` (a peer missing from `members()` is dropped).
- A peer that is "offline" for one cluster poll (5 s) loses its target. Lines in that window survive only as the
  compacted journal, and B5 makes that lossy.
- Fix: keep a per-target sequence number and a short ring of lines (e.g. 30 s). On reconnect, if the gap is inside the
  ring, send the missed lines instead of the INFO-and-guess path.

### B7 — MAJOR: channel numbers that are not destination channels go across untranslated
`cluster-fanout.js:97-105`.
- `route://N` for N not in the plan is sent as it is (WO-1027: the master's input channel N is something else on the
  peer, e.g. its LED PGM or another camera).
- `SWAP a-l b-l` rewrites only the first channel (the second is the master's number).
- Anything embedded in CG/HTML parameters or `PLAY … [HTML] http://127.0.0.1:4200/...` points at the peer's own node,
  which may serve different content (a guess; not traced).
- Fix:
  - Drop (do not send) any line whose `route://N` or second channel is not in the plan, and log it once per
    destination. Better: WO-1027's source-by-identity.
  - Translate SWAP's second channel, or refuse SWAP across boxes.

### B8 — MAJOR: the master's PRV takes overwrite the peer operator's preview
`cluster-fanout.js:88-89`.
- The PRV bus is mapped and forwarded unconditionally, while G2 leaves the follower's PRV free for its own operator. Two
  writers on one bus.
- For a backed-up destination that is correct (the same PRV on both). For an extension the follower's operator stages
  there, it is not.
- Guess (not run): a master take whose old look is flipped to PRV (`previewExchange`, routes-scene-take.js ~:255)
  lands on the follower's PRV too.
- Fix: forward PRV only for destinations that are in "backup" (cabled on both) or explicitly master-held (§3).

### B9 — MAJOR: the follower's node is blind to its own screens
- There is no write of `liveSceneState` from `src/cluster`, and the fan-out bypasses the follower node (it talks AMCP to
  its Caspar).
- So the follower GUI shows no look on air, its `air-state.programLooks` (`air-state.js:18-28`) reports nothing, zone
  air rules on other servers see nothing there, and FTB/collect-layers have no layer list.
- After a failover, the new master's first take diffs against an empty or stale store (it cannot clear layers it does
  not know about). This is inferred from the take path using `liveSceneState.getChannel(channel)` (`routes-scene-take.js:146`);
  not run.
- Fix: the master pushes its live entry per destination to the boxes it forwards to (exchange topic, keyed by
  destination id; the receiver maps to its own channel), or (§3) the node-to-node take, which updates the store
  naturally.

### B10 — MINOR: `followsMaster` does not require a shared show
`routes-cluster.js:192-198`.
- With `show.on` false, a relayed `look.take` resolves `sceneId` and `mainIdx` in the **master's** project
  (`routes-scene-take-look.js:73-81`): a 404, or a different look or screen with the same id/index.
- The plan is empty too (B1).
- Fix: G0 requires `show.role === 'follower' && show.in_sync`.

### B11 — MINOR: zone relay does not mark `relayed` and drops `mainIdx`
`zone-actions.js:50`.
- It duplicates R1 (take-look would relay anyway).
- If the receiver thinks it is a follower during an epoch change, the take goes back to the sender as `relayed`, is
  taken there, and is blocked by G2: silent ok.
- Fix: call `handleTakeLook` and let R1 relay (one path), or pass `relayArgs`.

### B12 — MINOR: split brain or a peer with its own pair is still a fan-out target
F2 forwards to every online linked peer (`routes-cluster.js:166`), whether or not it follows. A peer that runs the old
pair (`followsMaster` false there, `routes-cluster.js:195`), or that holds the claim itself during a split, is driven by
the master's fan-out **and** by its own operator: two writers on one channel. Fix: forward only to peers that report
`follows_master: true` for this epoch (the exchange already carries per-peer facts).

### B13 — MINOR: the old pair and the cluster switch each other off box-wide
- `pairEnabled()` (`routes-cluster.js:165`) turns the whole cluster fan-out off when the master has a pair. A third
  linked server then gets nothing, and the Servers card shows only "not forwarding".
- The pair fan-out (`amcp-fanout.js:250-301`) mirrors untranslated channel numbers and drops an entire batch when one
  line is not allow-listed (`:266-268`, `:297-299`).
- `isAmcpFanoutReceiveBox` treats a loopback `peerCaspar.host` as "I am the receiver" (`:158-160`) and blocks PGM even
  with replication otherwise idle.
- Fix: retire the pair into a cluster link kind "hot backup" (§3).

### B14 — MINOR: the AMCP typed path bypasses the gate (latent)
`amcp-client-transport.js:231-268`: the `useLibraryTyped` branch has no G3 check but does fan out. It is off today
(`connection-manager.js:76` passes no option); a future flip would let a follower drive PGM and fan it out.

### B15 — MINOR: cost of the gate
G1 runs `masterOf().view()` + `clusterOf().snapshot()` on every AMCP line. Cache the per-channel verdict per poll.

---

## 3. Gap against the owner's target model, and the smallest design that closes it

### The gap
- **Target 2 (local destinations always driveable locally) is broken by design.** G2 makes the whole box's program
  output the master's property. A follower can only ask the master to take a stored look for it (R1). Test card, media,
  raw AMCP, timeline, FTB and mixer cannot be relayed at all, and even look takes fail when the master cannot reach it
  (B1/B3).
- **Target 4 (drive the first box's screens from the second) works only by becoming master.** A non-master can drive
  another box's destination only by asking the master, which plays on its own copy channel and fans out.
- **Target 5 (two link kinds) does not exist.** There is one implicit kind: "the master drives every cabled destination
  everywhere". Backup vs extension is derived from cables (`cluster-fanout.js:4-7`). "Peers: two operators" is not
  representable: the second operator is always blocked.
- **Target 6 (node ↔ node, never AMCP between Caspars) is violated by the fan-out itself.** The master opens AMCP to the
  peer's Caspar (`routes-cluster.js:177-181`, `cluster-peer-info.js:22`). That is the cause of the channel-number
  translation, WO-1017 holds, WO-1027 routes, B7 and B9.

### Proposed design (smallest coherent change)

**Concepts**

1. **Destination owner = the server(s) it is cabled on** (already computed: `cabledIds`, `cluster-fanout.js:54-65`). An
   uncabled destination on a box is a "copy" channel: it never counts for blocking, and a take on it there is a local
   preview of someone else's screen.
2. **Link kind, one per cluster, carried in the signed master claim** (cluster-master.js claim
   `{ epoch, master, auto, kind }`, so every box agrees per epoch):
   - `one_operator` — master/follower; sub-mode per destination comes from cables:
     - **backup**: cabled on several boxes → same content everywhere;
     - **distribution**: cabled on one box → that box's screen.
   - `peers` — two operators; no master air authority (the master claim still orders shared-show edits only).
3. **Air holder per destination**: `{ server, seq }`, where `seq` = (epoch, Lamport counter), kept in the shared
   exchange. Every press on a destination, local or remote, bumps it. **Conflict rule: the last press wins** (owner D3
   already). Ties on equal Lamport counters are broken by server priority (master first). Both GUIs show the holder
   ("PGM 1 · driven from highascg5867 12 s ago").
4. **Every box always executes for the destinations it owns, through its own node.** Remote control is a signed
   node-to-node call to the owner, never AMCP into its Caspar. New `cluster-call-actions` entries keyed by destination
   id, so no channel numbers cross the wire:
   - `dest.take { destId, sceneId, target, opts }`
   - `dest.clear { destId, bus }` / `dest.ftb { destId, frames }`
   - `dest.testcard { destId, on }`
   - `dest.media { destId, layer, clip, opts }`
   - `dest.mixer { destId, layer, prop, value }`
   - `dest.timeline { destId, timelineId, op }`
   The receiver resolves destId → its own channel at call time, so channel maps may differ freely (removes F3's
   translation, WO-1017 holds and B7). Its `liveSceneState`, journal and GUI are updated by its own take path (fixes
   B9).
5. **Hot backup stays frame-tight**:
   - For `backup` destinations in `one_operator`, the master still mirrors, but through the node: `dest.take` to every
     other owner at the same moment as its own take, with the take-sync barrier deadline.
   - Keep the AMCP mirror (today's fan-out) only as an opt-in "frame-accurate backup" transport for identical boxes,
     the old pair's use case. Both the pair and the cluster fan-out then become this one transport (B13).

**Who may drive what**

| Kind | Own (cabled-here) destination | Another box's destination | The master |
|---|---|---|---|
| `one_operator` / distribution | always local; the press bumps the holder; the master's next press on it takes it back | `dest.*` call to the owner (allowed when the owner's `accept_remote` is on) | drives all through `dest.*` (target 3) |
| `one_operator` / backup | a local press is **relayed to the master** while the master is reachable (it must stay identical on both); if the master does not answer within 1 s, it runs locally and is marked "diverged" until the master's next take | as left | mirrors to all owners |
| `peers` | always local | `dest.*` call; the owner may lock a destination ("operator here only") | no air role |

**Gates that change**

- `amcp-fanout.js:228-232` `shouldFollowerSkipLocalPgmAmcp` → `airBlocked(ctx, channel)`. True only for a
  **backup** destination in `one_operator` whose holder is the master and whose master is reachable *and* reports this
  box as a connected mirror (B1's positive evidence). Never true in `peers`, never for distribution destinations, never
  for queries.
- G4 / G5 (`amcp-client-transport.js:61-77`, `amcp-batch.js:182-193`): per-line filtering; a blocked line rejects with
  a typed error (`code: 'AIR_HELD'`, `heldBy`), not a fake 202 (B2/B4).
- G6–G8 (`routes-scene-take.js:225`, `-overlay.js:42`, `-audio-only.js:52`), `routes-ftb.js`, `routes-amcp.js`,
  `routes-led-test-control.js`, `routes-timeline.js`: on `AIR_HELD`, relay the action as the matching `dest.*` call to
  the master (backup case) or answer 409. Never 200 for nothing.
- R1 `routes-scene-take-look.js:59-68`, R2 `cluster-call-actions.js:58`, R3 `zone-actions.js:48`: relay only under
  the backup rule above. A distribution or peers destination takes locally. If the destination is owned elsewhere
  (not cabled here), send `dest.take` to its owner instead of taking on the local copy channel.
- `routes-cluster.js:192-198` `followsMaster`: stays for the shared show. Air gating no longer uses it.
- `cluster-fanout.js`:
  - `plan()` only for the backup transport;
  - skip destinations whose holder is not the master;
  - catch-up = `CLEAR` + replay only while the master holds the destination (B5c);
  - never in `peers`.
- `cluster-call.js:122`: `accept_remote` per destination as well as box-wide (the "peers" lock).

**Conflict rule, stated once.** Each destination has one holder. Any press by an allowed operator becomes the holder
(last press wins, Lamport-ordered, master breaks ties). In `one_operator`/backup only the master can hold (the follower's
press is relayed). The holder change is broadcast; the losing GUI shows "taken by <server>". No two writers send to one
channel at the same time, because only the owner's node ever sends AMCP to its Caspar.

**What this would have done in the incident.** A owns its LED destination (distribution, cabled only on A). The test
card and media on A run locally whatever A's role. B never blocked or drove A's channels by AMCP. With the IP lost, B
simply cannot call `dest.*` on A until A is found again (the identity work in another slice).

---

## 4. Missing tests

Existing coverage: `tools/smoke/smoke-wo670-cluster-fanout.test.js`, `-catchup.test.js`,
`smoke-wo933-fanout-checks-before-replay.test.js`, `smoke-wo1026-two-box-follower.test.js`,
`smoke-wo712-cluster-call.test.js`, `smoke-wo1017-fanout-holds-stale-layout.test.js`. None of them covers the cases
below.

Against today's code (each should fail now and pass after the fix):
1. **Asymmetric reachability (B1):** follower F sees master M online; M's snapshot has F offline (or F's destination
   held, or not cabled, or `show.on` false) → `shouldFollowerSkipLocalPgmAmcp(F, ch)` must be false. A fake two-node
   harness where M's `members()` excludes F.
2. **Unforwarded program channel (B1):** F has 4 program channels, M's plan maps only 7 → F's channels 1/3/5 are not
   blocked.
3. **No fake success (B2):** on a follower, `/api/amcp/raw "PLAY <pgm>-10 x"`, `/api/play`, `/api/scene/take` (direct),
   overlay stop, audio-only stop, `/api/led-test-card/channel`, `/api/ftb`, timeline play → none answers 200 `ok: true`
   while sending nothing; `playbackTracker` and `liveSceneState` unchanged.
4. **MIXER query (WO-1028 #6):** `MIXER 7-10 OPACITY` on a follower PGM reaches Caspar (not an invented 202).
5. **Mixed batch (B4):** `[PLAY prv-10 a, PLAY pgm-10 b]` and `[PLAY pgm-10 b, ADD pgm STREAM …]` on a follower: per-line
   result; the ADD is sent; the PGM line is refused and reported.
6. **Relayed take reports forwarding (B3):** M accepts `look.take` from F, but F's destination is held or F is
   disconnected → F's take-look answer is an error naming why.
7. **Missed STOP (B5a):** target connected, journal `PLAY 7-10 a`; disconnect; M sends `STOP 7-10`; reconnect with INFO
   still showing `a` on layer 10 → the channel must be replayed/cleared, not kept.
8. **Missed PAUSE and CG (B5b):** the same with `PAUSE 7-10` and `CG 7-20 UPDATE …` → re-sent on a kept channel.
9. **Extra layer (B5c):** the peer's INFO has layer 30 that the journal lacks → "differs".
10. **Brief offline (B6):** the peer leaves `members()` for one poll while M takes → after it returns, the lines arrive
    exactly once, in order.
11. **Untranslated channels (B7):** `PLAY 7-10 route://5-1` where 5 is not in the plan → not sent; `SWAP 7-10 8-10` →
    both channels translated or refused.
12. **PRV ownership (B8):** for an extension destination, M's PRV take is not forwarded to F's PRV.
13. **Unshared show (B10):** `show.on` false → `isClusterFollower` false; relay is not used.
14. **Zone relay (B11):** a zone `look:<id>` on F carries `relayed` / `mainIdx`; no ping-pong when both think the other
    is master.
15. **Pair + cluster (B13):** with the pair on, a third linked server is reported "not forwarded (pair on)" per peer.
    `isAmcpFanoutReceiveBox` with loopback `peerCaspar` and replication disabled → false.

For the proposed design:
16. Distribution destination cabled only on F, kind `one_operator`: F's local test card, media, FTB and raw AMCP go on
    air; M's `dest.take` to it also goes on air; the holder flips each time; both GUIs show it.
17. Backup destination: F's local press goes through M while M is reachable; M unreachable (timeout) → runs locally,
    marked diverged; M's next take re-syncs.
18. `peers` kind: no air blocking on either box; A's `dest.take` on B's destination runs on B through B's node (B's
    `liveSceneState` updated); B's per-destination lock refuses it with 403.
19. Different channel maps (B has an extra input channel before the mains): `dest.take` by destination id lands on B's
    right channel, with no translation table.
20. Two operators press the same destination within 50 ms → one deterministic holder on both boxes (Lamport + priority);
    the loser's GUI shows "taken by …"; nothing interleaves on the channel.
21. Incident replay: A's IP changes, B keeps the old IP, B auto-fails over → A's own destinations stay driveable from A
    throughout (an e2e in `tools/e2e/two-box`).
