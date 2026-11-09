# WO-1017 — A screen destination rendered on the linked server (mapping node → the peer's DeckLink outputs)

**Area:** network, mapping
**Status: IN PROGRESS — investigation + design written (09.11); stage 1 (the fan-out holds a destination whose channel layout one Caspar has not applied yet) built and proven offline (smoke 8/8, mutation 4 fail; fan-out smokes 22/22). Not live: this box's node was not restarted (rule of the 09.11 round), and the link on highascg5867 was not accepted (blocked by the agent permission check), so the peer is unchanged. Owner decisions D0–D3 below.**

Owner, 09.11:
> i linked two servers now, made this one the master … shared the show and wanted to make a screen dest that would go
> thru a mapping node but connect its outputs directly to second machines decklink outputs, make the screen dest to
> actually be created and rendered on the second server.

## Investigation

### Live state, 09.11 ~13:30

This box is highascg7579/7580 (192.168.0.17), the peer is highascg5867 (192.168.0.10, build 2026-11-07T115214Z).

- **The link is only half made.**
  - `GET /api/cluster` here lists highascg5867 as online, but `linked_back: false`, `link_pending: true`,
    `link_back_error: "waiting for highascg5867 to accept"`.
  - On the peer, `peers: []` and `invites: [{ id: "highascg7579", host: "192.168.0.17" … }]`. This is the WO-739
    invite: it waits for the peer's operator. The peer is an unattended box, so nobody accepted it.
  - Journal here, 13:18–13:21:
    - `senders → highascg5867: not linked here`;
    - `master this server epoch 1 (operator)`;
    - `highascg5867: claim not taken (signed by a server not linked here)`;
    - `show: sharing switched on`;
    - `show: highascg5867: not linked here: link this server on the receiving server too`.
- **So the show is not shared.**
  - Here: `show.on: true, role: master, in_sync: false`, with the peer error above.
  - Peer: `show.on: false`, its own project `new_project_1`, `master.epoch 0`.
- **The fan-out is active but forwards nothing:** `fanout.peers.highascg5867.error = "no shared destination is cabled there"`.
- **The owner's destination, on THIS box** (`GET /api/device-view`):
  - `dst_mw989wyz_1` "PGM/PRV 3": `pgm_prv`, `mainScreenIndex 2`, custom 7680x2160 @ 50.
  - Cabled `dst_in_dst_mw989wyz_1 → mapping_mw98af0g_1_in`, the "Pixel Mapping 1" node in **this box's** graph:
    two 3840x2160 outputs, slices at x 0 and x 3840.
  - Both mapping outputs are uncabled. `mappingSlicePlans` shows `backend: "idle"`, `sink: null`.
- **The peer, standalone**, already has its own similar chain from an earlier session:
  - `dst_mw2fn9wr_1` "PGM/PRV 1", 6144x1024;
  - → its own `mapping_mw2fnwz5_1` (the same 2 × 3840x2160 slices);
  - → `dlsdi_3` / `dlsdi_4` (DeckLink 3/4, `backend: direct`);
  - running: `INFO` → `1 1080p5000, 2 6144x1024, 3 6144x1024`.
- **This box's generated layout ≠ the running one** (agent F's WO-1016 audit, confirmed here).
  - `configComparison`: `aligned: false`, server 8 channels, module 10.
  - The generator puts the PGM/PRV 3 pair at ch 5/6 and moves the DeckLink inputs to 7/9.
  - The running Caspar still has ch 5/6 = 1080p DeckLink inputs and ch 7 = 64x36 audio preview.
  - The channel map is built from the **config**: `channel-map-from-ctx.js:20` `getChannelMap(cfg)`. Only the sizes
    come from the running Caspar (`pickRes`, :27).
  - So `channelMap.programChannels = [2, 4, 5]` while `programResolutions[2] = 1920x1080`, the running input channel.
  - Side effect already live: journal `13:24:07 [route-heal] extraLiveSources re-pointed: "DeckLink 1": route://5-1 →
    route://7-1; "DeckLink 2": route://6-2 → route://9-2`. The Live DeckLink sources now point at the 64x36
    audio-preview channel and at a channel that does not exist, until this box is applied. That is agent F's and G's
    area; it is noted here because it has the same cause.
- **GPUs.**
  - Here: RTX PRO 4000 Blackwell, 17 % busy, 1.1 / 24 GB.
  - Peer: RTX 2080 SUPER, 78 % SM, 5.3 / 8 GB. Its Godot GUI uses the 78 %; Caspar is small.

### What happens today when a mapping node's outputs should go to the peer's DeckLinks

1. **UI and model: not possible as one cable.**
   - A cable lives in one server's device graph. `deviceGraph` is device-local (`config-classify.js:20`, the
     `DEVICE_HARDWARE_SLICES` at :103), so mapping nodes and cables never travel with the show.
   - The Godot cable code (`cable_*.gd`, `destinations_*.gd`, `mapping_*.gd`) has no notion of another server.
   - The peer's rear panel on this box's Servers card is read-only (WO-670 P2a, `cluster_panel.gd:284`).
   - The only way is Devices → Servers → highascg5867 → **Edit** (WO-732 P3b, relayed node ↔ node, WO-802). Then
     cable `dst_in_<dest>` → a mapping node → its DeckLinks **in the peer's own graph**.
   - The owner built the mapping node here, so it reaches no output (idle).
2. **Where the destination's channels are generated: on every box that holds the destination list.**
   - Channels follow the destinations, not the cables. `routing-map.js:101-106`: screen count = highest
     `mainScreenIndex` + 1 of the main destinations.
   - `cluster-fanout.js` header: "the master's own channel for it exists anyway".
   - So this box generates PGM/PRV 3 at 7680x2160 as ch 5/6 at its next Apply, with no consumer. The idle mapping
     node adds none.
3. **What the peer does with it today: nothing.** It has neither the link nor the show, so it has no `dst_mw989wyz_1`.
4. **"This destination belongs to server X": only derived, never stored.**
   - WO-670's rule: cabled on the master and on B → B is its **backup**; cabled only on B → B is its **extension**.
     It is computed in `cluster-fanout.js:54` `cabledIds` + `channelPlan` and in Godot `cluster_model.gd:34` `roles`.
   - `server-duties.js:13` says it outright: "Media / playout is not a duty: which server shows a destination is the
     WO-670 cables in Devices". `server-senders.js` covers lighting / ptz / artnet_in only.
   - Caveat: "cabled" means the `destination_in` has any edge. A destination cabled to a mapping node with no output
     cables (this box's PGM/PRV 3) counts as cabled. Godot would label it "backup", not "extension", once the peer
     cables it too.

### How the shared show reaches the peer

- With a mutual link and "Share the show" on both, the master pushes the show over signed calls (WO-746
  `shared-show.js`). `screenDestinations` is show data (`config-classify.js:33`), so the **destinations travel with
  the same ids**.
- The peer's `commitShow` (`shared-show-ctx.js`) persists the project and applies `screenDestinations` to its config.
  It never restarts Caspar. The peer shows "Caspar layout differs" (G10) until its operator applies.
- The peer then generates its casparcg.config from **the shared destination list + its own device graph**: its
  cables, its mapping nodes, its DeckLinks.
- Simulated with this box's generator on the peer's `/api/settings` (backup below):
  - the shared destinations replaced;
  - the peer's existing Pixel Mapping 1 re-cabled from its old destination to `dst_in_dst_mw989wyz_1`.

  Result (`~/backups/dot10-before-wo1017-20261109-133701/peer-after-share.config.xml`):

  | ch | mode | consumers |
  |---|---|---|
  | 1 | 1080p5000 | shm (operator GUI) |
  | 2 / 3 | 3072x1024 | none (PGM/PRV 1, not cabled there) |
  | 4 | 1080p5000 | none ("to zoom", not cabled there) |
  | **5** | **7680x2160** | **decklink device 3, src 0,0 + port device 4, src 3840,0, both 2160p5000** |
  | 6 | 7680x2160 | none (PRV 3) |

  So the existing model **does** create and render the destination on the peer, mapping and DeckLinks included. It
  needs only the link, the share and the peer-side cable. The cost: the peer also renders every other shared main
  destination it has not cabled (ch 2–4).

### How takes reach the peer

- The master plays the look on **its own** channel for the destination. Every AMCP line goes through the
  `amcp-fanout` sink. `cluster-fanout.js` translates master channel → (destination id, PGM/PRV) → the peer's channel
  for that id (`channelPlan`, from the peer's `/api/device-view`) and sends it to the peer's Caspar.
- The air journal catches a peer up on connect (WO-933 checks first).
- A follower's own PGM takes are skipped (`routes-cluster.js:192` `followsMaster`). A take pressed on the peer goes
  to the master (`cluster-call-actions.js` `look.take` → `callMaster`).
- So a look taken here on screen 3 is played on this box's PGM 3 channel and forwarded to the peer's ch 5.
- **Hazard found:** the translation uses the channel map from the *generated* config, but the running Caspar may still
  have the old layout.
  - Today: master "PGM 3" = ch 5 = the running DeckLink input 1 channel.
  - The moment the peer cabled PGM/PRV 3, the fan-out would map this box's ch 5/6 (DeckLink inputs) to the peer's
    LED channel. The catch-up would replay the input commands from the journal (`PLAY 5-1 DECKLINK …`) onto it.
  - A take on screen 3 here would also compute its fills against 1920x1080: `scene-native-fill.js:149` normalises to
    `programResolutions[screen]`, the running size.
  - The same happens in the other direction while the peer has not applied the shared list.

### Preview / thumbnail on this box

- With a channel here (the model today), Live's PGM/PRV pictures and thumbnails come from this box's own channel.
  Nothing is streamed back.
- Without one, the pictures would have to come from the peer. WO-670 P1 `/api/video-feed` is a WebSocket; the
  WO-802 relay carries HTTP only (`cluster-relay.js`, `/api/ws` refused), so that would be new node ↔ node streaming.

## Design

Consistent with how the cluster already divides duties: **placement follows each server's own cables (WO-670), the
destination list is shared (WO-746), the master runs takes and forwards (WO-670 P4).** A "destination rendered on the
peer" is a WO-670 *extension*. Nothing new is stored.

1. **The peer** generates the destination's channel(s) plus its mapping consumers at its own Apply. Its mapping node
   and cables live in its own graph; the shared list gives it the destination with the same id. *(Exists.)*
2. **Takes** for the destination run on the master and are forwarded per destination id; the journal catches up a late
   peer. *(Exists.)*
3. **Forwarding only when both Caspars run the destination's channels** (stage 1, built here). Without it, the window
   between adding a destination and applying it on both boxes sends the wrong channels' commands to the other box's
   outputs. That is exactly today's live state.
4. **This box** needs a channel for the destination so that the take engine has a canvas and Live has a picture
   → **D1** (owner).
5. **The peer** renders every shared main destination, cabled there or not → **D2** (owner).
6. **One-gesture cabling across servers** (draw from here to the peer's DeckLinks): a later UX stage → **D3**.

## Owner decisions

- **D0 — finish the link (an action, not a design question).**
  - On highascg5867, accept this box's invite. In Devices → Servers it shows as an invite; or `POST
    /api/cluster/invites/highascg7579/accept` on the peer.
  - Then tick "Share the show" there.
  - The peer's own project `new_project_1` (6144x1024 → mapping → DeckLink 3/4) is backed up to its
    `projects/_cluster/new_project_1.before-share-*.json` and replaced by `narvil`.
  - The agent tried the accept and was stopped by its permission check. An owner OK (or the owner's click) is needed.
- **D1 — what THIS box renders for a destination that only the peer outputs.**
  - **(a) A full-size mirror channel pair with no consumer (today's model, no code).**
    - Cost here: 2 × 7680x2160 @ 50 on a GPU at 17 %.
    - The inputs move from ch 5/6 to 7/9 at the next Apply here (route-heal already points there).
    - Preview, thumbnails and take maths are exact.
  - **(b) A scaled proxy channel** (e.g. 1920x540).
    - Needs the engine to normalise fills to the destination's logical size instead of the running channel
      (`scene-native-fill.js`, `multiview-*`), plus a generator split of logical vs render size.
    - Medium work. CG/HTML renders scaled in the preview.
  - **(c) No channel here.**
    - Takes for that destination are executed on the peer: the signed `look.take`, or a fan-out from a virtual
      channel.
    - The preview comes back from the peer as a new relayed video feed.
    - Large: the take path, timelines and Live for that screen all assume a local channel.
  - **Recommended: (a) now.** It is what the owner's words need ("created and rendered on the second server": the
    mapping and the DeckLink outputs are on the peer, nothing is streamed). (b) only if this box's GPU load matters
    later.
- **D2 — should a follower render shared destinations it has not cabled?**
  - The peer would run PGM/PRV 1 (3072x1024 pair) and "to zoom" (1080p) for nothing: fan-out only ever sends to its
    cabled destinations. This is on an RTX 2080 SUPER that is already 78 % busy.
  - Recommended: no. As a stage 2, a follower generates channels only for destinations cabled on it.
  - This needs sparse screen slots (`programChannels` with holes), so it is its own WO.
  - Trade-off: after a failover, that box has no canvas for those screens. They are dark there anyway, because they
    are uncabled.
- **D3 — cross-server cabling UX.** Today: Edit the peer and cable there. Later: the peer's rear panel on this box's
  Servers card accepts a cable from a shared destination and writes it into the peer's graph through the relay. This
  box's idle "Pixel Mapping 1" (`mapping_mw98af0g_1`) can then go; it is harmless meanwhile (`backend: idle`).

### To get the owner's case on air with D0 + D1(a)

1. **D0** on the peer.
2. **Peer:** Edit highascg5867 → cable `PGM/PRV 3` → its Pixel Mapping 1 input. Its outputs already go to DeckLink
   3/4, with slices that split exactly 7680x2160. Then Apply & restart **on the peer**.
3. **This box:** Apply when the lead allows it (renders the 7680x2160 pair as ch 5/6).
4. The stage 1 guard releases PGM/PRV 3 when both Caspars run it at 7680x2160. The fan-out then catches the peer up
   and forwards takes.

## What was done (stage 1)

- `src/cluster/remote-destination.js` (new, 62 lines):
  - `runningSizes(view)`: destination id → its running PGM/PRV sizes, from `channelMap.programResolutions` /
    `previewResolutions` (filled from each Caspar's INFO CONFIG).
  - `staleLayout(own, peer, id, peerName)` → `''` or the reason. A destination is forwarded only while its PGM (and PRV
    when both have one) runs at the same size on both Caspars.
  - Both boxes generate the same mode from the same shared destination, so a difference means one has not applied it.
  - Views without sizes (older peers, older tests) are not judged.
  - Why sizes rather than comparing against the destination's declared width/height: the generator lets a standard
    `videoMode` win over width/height, and several destinations can share a screen. Equal-on-both is the invariant
    that always holds.
- `src/cluster/cluster-fanout.js`:
  - `channelPlan(own, peer, peerName)` skips a stale destination into `held: [{ id, why }]`.
  - `plan()` passes the peer's name.
  - The peer's `error` is the first hold reason when nothing is forwarded, e.g. *"PGM/PRV 3 (7680x2160): PGM runs
    1920x1080 here, 7680x2160 on highascg5867; Apply the Caspar config where it differs"*.
  - `status()` carries `held`.
  - When the layouts match again, the destination enters the map unsynced, so the existing catch-up replays it (WO-933
    check first).
- `tools/smoke/smoke-wo1017-fanout-holds-stale-layout.test.js` (new): 8 tests on the live case's numbers.

## What was VERIFIED

- `node --test tools/smoke/smoke-wo1017-fanout-holds-stale-layout.test.js`: 8/8.
  - Running sizes; the live case is held with its reason; a peer not yet applied is held; both applied → 5→5, 6→6;
    only the stale destination is held; older views are not judged.
  - The forwarder: `error` + `held`, and `PLAY 5-1 DECKLINK DEVICE 1` stays on this box.
  - Source pin.
- **Mutation:** with `staleLayout` stubbed to `''`, 4 of 8 fail.
- Existing fan-out smokes (`wo670-cluster-fanout`, `wo670-cluster-catchup`, `wo933-fanout-checks-before-replay`,
  `wo772-media-sent-resync`): 22/22.
- Run on the **live** device views (this box's `/api/device-view` + a peer view with PGM/PRV 3 cabled and applied):
  `map: []`, `held: [PGM/PRV 3 … PGM runs 1920x1080 here, 7680x2160 on highascg5867 …]`.
- The peer-side rendering was checked by simulation only (the table above), not on the peer's Caspar. It was not
  linked (D0).
- Not live: this box's node still runs the old fan-out (no node restart in this round). Load it with the guarded
  `kill -TERM` of the node before the peer gets PGM/PRV 3 cabled.

## Backups

- The peer's state before this WO is in `~/backups/dot10-before-wo1017-20261109-133701/` (0600):
  - its `/api/{device-view,settings,cluster,project,state}`;
  - `dot10-highascg-config.tgz` (its `config/`, `projects/`, `casparcg.config`, `.highascg-state.json` over SSH).
