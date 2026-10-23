# WO-670 — Server network in the Devices view (backup / extension) + Godot GUI on another machine

**Status: IN PROGRESS — P1 (remote video) DONE 22.10 (offline + box-verified with a second Godot on the feed); P2a (linked servers shown in Devices) + P2b (Send media) DONE 22.10 (offline + box with stub peers, real rsync); P3a (master / epoch / auto failover) + P3b (clients follow the master; failover runs from boot) DONE 22.10 (offline + box with a stub running the real module); P4a (the master forwards takes per destination) + P4b (catch-up on join, PGM block on followers, Servers card status) DONE 22.10 (offline + box with a stub fake Caspar); P5 (two-box hardware) open**

Owner, `next.md` 22.10:
- *"the godot client can be multiplatform if im not mistaken? and to make it work we'd just need to get the operator
  channel to reach a godot gui and another machine. right?"*
- *"there was a backup workflow already in place earlier, and id want to expand on that. id like to be able to add
  servers to a network of devices then display them in the devices view. this way users can link servers toghether and
  either use the second server as backup when the same screen destination is connected to its outputs or as an
  extension for other screen destinations for instance but controlled from a single client. the second server could
  even run in headless mode then."*

> **23.10.26 correction ([WO-712](./712_WO_server_duties_tracking_media.md) investigation):** the Design's *shared project
> document carried by revision* was never implemented — no phase P1–P4b pushes the project between cluster members (only
> Send media + take forwarding). It is WO-712 R5 / a WO of its own.

## Investigation

### Godot GUI on another machine

- **Everything but live video already works remotely.**
  - The client's server is configurable: `core/config.gd:1-45` (`--server=`, `HIGHASCG_SERVER`, connection profiles
    from WO-608, default `http://127.0.0.1:4200`).
  - REST and WS (`/api/ws`) are plain HTTP.
  - Godot exports to Windows / macOS / Linux.
- **Live video is shared memory only.** `video/video_surfaces.gd` reads Caspar channels from `/dev/shm`, through the
  hshm GDExtension (Linux / macOS builds listed in `hshm.gdextension`) or a GDScript reader. That only exists on the
  box itself, so a remote GUI gets every panel but blank pictures.
- **Godot has no H.264 decoder built in** (Theora only). The WO-319 NVENC stream was removed with the kiosk (WO-660).
  - The cheapest path is server-side JPEG frames from the same shm surfaces, sent over WS, decoded by
    `Image.load_jpg_from_buffer`.
  - The server already reads shm stills (`src/tracking/hshm-read.js:36`).

### The existing backup workflow (WO-54 / 64 / 65 and follow-ups)

- **A strict two-box leader / follower hot backup.** Operator doc: `docs/reference/hot-backup-replication.md`. Code in
  `src/replication/` (≈45 files).
  - **Show data:** the show slice of the project (looks, timelines, destinations, routing) is pushed over HTTP
    (`replicate-projects.js`, `config-classify.js` splits show vs device-local).
  - **Media:** rsync over SSH, on demand (`sync-project-media-rsync.js`, WO-78 rsync-only key).
  - **Live air:** AMCP fan-out. The leader forwards every mutating AMCP command to the follower's Caspar
    (`amcp-fanout.js` allow-list, `peer-caspar-connection.js`).
  - **Playhead drift:** `playhead-sync.js` SEEK correction (soft 150 ms / hard 2 s).
  - **Pairing:** signed handshake (`replication-handshake.js`, `device-identity.js` ed25519); LAN discovery by an HTTP
    /24 scan of `/api/replication/ping` (`discover-leaders.js`).
  - **Wiring is never copied.** The follower regenerates its own `casparcg.config` from its own wiring
    (`follower-caspar-output.js`).
- **Status.**
  - Core shipped 06–07.2026, but every two-box hardware acceptance item in WO-54 / WO-65 is unticked (drift ≤ 200 ms,
    promote mid-clip, pull the network, old leader returns).
  - On this box `config/replication.json` is `enabled: false`; `playheadSync` is off.
- **Limits against the owner's goal.**
  - One peer only (`replication.peer` + `peerCaspar`).
  - Whole-box mirror only: fan-out has no per-channel or per-destination filter.
  - The Devices graph (`config/device_graph.json`) has exactly two nodes, `caspar_host` and `destinations`. Nothing
    models another server; the peer appears only as text in the Server inspector (`server_page_model.gd`).
  - The node server drives one Caspar (`config.caspar.host`).
  - The client talks to one origin.
  - No genlock / LTC between boxes (a WO-64 non-goal).

## Plan (phases, each shippable on its own)

1. **P1 — remote video for the Godot GUI** (also needed to show another server's outputs).
   - Server: `GET /api/video-surfaces/<role>.jpg` and a WS frame feed. It JPEG-encodes the leased shm surface,
     downscaled, at a chosen rate (e.g. 960 px, 10–25 fps).
   - Godot: `video_surfaces.gd` uses shm when the server is local and the JPEG feed otherwise. The same `Texture2D`
     reaches every panel, so nothing else changes.
   - Then export presets for Windows / macOS.
   - Proof: a GUI on a laptop shows PGM / PRV / the look editor with live pictures.
2. **P2 — servers in the Devices view.**
   - "Add server…": LAN scan (reuse the ping scan) or an IP, then the signed handshake. The list is stored device-local
     on the main server.
   - Each linked server is a node with its own outputs (read from its `/api/device-view`): online state, version,
     Caspar parity (reuse `channel-parity.js` / `caspar-parity.js`).
   - Headless servers are fine: they need no GUI.
3. **P3 — backup link per destination.**
   - Cable the same screen destination to outputs on two servers, and the second becomes that destination's backup.
   - Generalise the AMCP fan-out from "whole box" to "the channels of linked destinations". Show slice, media rsync
     and playhead correction are reused.
   - The existing whole-box pair becomes the case where every destination is linked.
4. **P4 — extension link.**
   - A destination cabled only to server B is played on B's own Caspar, driven from the one client through the main
     server, which forwards that destination's takes / looks to B.
   - Media for those looks goes to B by the existing rsync.
   - The Live view shows B's pictures through P1.
5. **P5 — two-box hardware acceptance:** the WO-54 / WO-65 checklist, plus a backup takeover and an extension take on
   real outputs.

## Decisions for the owner

1. **Topology.** The client connects to one main server, which talks to the others (recommended: auth, one project
   owner, works through one IP). Or the client connects to every server itself.
2. **Project ownership.** The main server owns the project; others receive the show slice, as today (recommended). Or
   each server keeps its own project for its own destinations.
3. **Media.** Push the media a look needs to the server that plays it, on save (automatic) or by a button (today's
   rsync)?
4. **Sync.** Without genlock / timecode between boxes, takes on two servers land within a few frames, not frame-exact.
   That is fine for a backup; is it fine for an extension, i.e. one show across screens on two boxes?

## Owner answers, 22.10

1. *"yes but we need a way to change masters if the one fails seemlessly. also in most cases the master would be running
   its own client and connecting to second box for backup and/or additional screens. but we need to prepare for more."*
2. *"we need to get creative here, whats the best approach, i think each server should keep their own devices view
   connections as they may differe as well as peers just for safe keeping. and the project including
   media/looks/timelines should be shared."*
3. *"i think i want is as a button still as i think the spread of media should be at user chosen time."*
4. *"sync we get as close as possible. its not meant to be used as one single large screen from two servers, as that
   would never work without hardware sync."*

## Design (from the answers)

**A cluster = servers sharing one project.**

- **Shared, the same on every member:** the project document (looks, timelines, destinations, routing, settings that
  belong to the show), carried by revision.
  - The media list is shared too. The media FILES move only on the operator's button (answer 3), and each server shows
    what it is missing.
- **Device-local, never copied:** the Devices view wiring (device graph, outputs, cables, `casparcg.config`). Each
  server's hardware differs (answer 2).
- **Device-local, kept by every member:** its own copy of the peer list (ids, addresses, priority, last seen).
  - "Peers just for safe keeping": any survivor knows the whole cluster, and a returning box can find it again.

**A destination's role follows each server's own cables. Nothing extra is set.**

- A destination is shared. Which outputs it reaches is decided in each server's own Devices view:
  - cabled on the master and on B → B is that destination's **backup** (B plays the same, fan-out);
  - cabled only on B → B is its **extension** (B plays it, driven through the master);
  - cabled nowhere → it isn't played.
- So a box with fewer outputs simply backs up fewer destinations.

**The master and seamless failover.**

- One master at a time. It holds the authoritative project, runs the takes, and forwards AMCP for linked destinations.
  Usually it is the box with the operator's own client (answer 1).
- **Epoch fencing.** The master's claim carries an epoch number. Every member accepts project pushes and AMCP only
  from the highest epoch it has seen. A box that comes back with an old epoch demotes itself, so there is no split
  brain. This finishes WO-54 T4.3 / WO-65 D4.
- **When the master dies:**
  - every Caspar keeps playing what it had, because outputs never depend on the master's process;
  - the next server by peer-list priority promotes itself after a timeout (or on an operator click, set per cluster);
  - clients hold the whole peer list and reconnect to the new master by themselves (the Godot connection profiles grow
    from A/B to N).
  - Destinations that were the dead master's own extensions go dark unless another server backs them up. That is what
    backup links are for.
- **More than two boxes:** nothing above assumes a pair. Fan-out goes per destination to whichever servers are cabled
  to it.

**Sync, best effort (answer 4).**

- AMCP fan-out at the same instant, plus playhead correction (WO-65).
- Cross-box take timing is measured and shown, never promised frame-exact. A single canvas spanning two boxes is out
  of scope.

## Phase order (unchanged, now with the design)

1. **P1 remote video.**
2. **P2 cluster + peers in Devices:**
   - add / scan;
   - handshake;
   - per-server peer lists;
   - each server's outputs read from it;
   - media parity badges + "Send media" button.
3. **P3 master / epoch / failover:** promote, demote on return, client reconnect.
4. **P4 per-destination fan-out:** backup and extension, derived from cables.
5. **P5 two-box hardware acceptance.**

## P1 — what was done (22.10)

**Server: `GET ws://<box>:4200/api/video-feed`.** Client sends `{"roles":[…]}` (the set it draws now); the server sends
binary `[u8 n][role][JPEG]`.
- `src/system/video-feed.js` — its own `httpServer.on('upgrade')` listener (`ws-server.js` is at the 500-line cap and
  leaves other paths alone), same `isOriginAllowed` / `checkWebSocketAuth` as `/api/ws`; attached in `index.js` next to
  `attachWebSocketServer`.
  - Roles validated `/^[A-Za-z0-9_-]{1,32}$/` → `/dev/shm/highascg-<role>` (role = shm name, as in `video-surfaces.js`).
  - A role several clients want is encoded once, at the largest width / fps and best quality asked.
  - A client with ≥ 2 MB unsent skips frames instead of queueing latency.
  - The worker thread exists only while someone watches; when the last role goes it gets `{type:'stop'}`, closes its
    ffmpegs and exits (a bare `terminate()` left ffmpeg running until its stdin closed).
- `src/system/video-feed-worker.js` — one encoder per wanted role, JPEGs transferred back to the main thread.
- `src/system/video-feed-encoder.js` — polls the segment at `fps` (`readLatestFrame(…, { into })` reuses one buffer),
  packs stride padding, feeds ONE long-lived ffmpeg (raw BGRA → `scale=min(width,iw)` → MJPEG) with one frame in
  flight; a size change restarts ffmpeg.
  - **`-threads 1` on decoder and encoder is load-bearing.** With frame threading ffmpeg 6.1 holds every frame until
    the next one arrives, and one-in-flight pacing then waits forever (measured: first JPEG after write 2 without,
    after write 1 with). The first real-ffmpeg test hung exactly this way.
- `src/tracking/hshm-read.js` — `into` option (caller buffer for the pixels).

**Godot.**
- `video/video_feed.gd` — one WebSocketPeer, reconnect with the `core/ws.gd` backoff; `RoleReader` has the
  `shm_reader.gd` face (`poll` / `signal_lost` / `width` / `height` / `frame`), decodes only the newest JPEG
  (`Image.load_jpg_from_buffer` → RGBA8).
- `video/video_surfaces.gd` — feed when the origin host is not loopback; `--video=feed` / `--video=shm` force it
  (`--video-width=`, `--video-fps=`). Holders, leases and the Texture2D objects are unchanged, so no panel changed.
- `video/shm_texture.gd` — `update_rgba()`: same Texture2D, RD texture recreated as R8G8B8A8 when the source format
  switches (the shm paths stay BGRA8).

**Not done in P1:** Windows / macOS export presets (nothing to test them on here; done 22.10 in [WO-686](./686_WO_godot_client_multi_platform.md)); JPEG decode runs on the main thread
(≈ 3 ms per 960 px frame; move to `WorkerThreadPool` if many roles are watched remotely).

## P1 — what was VERIFIED

- `tools/smoke/smoke-wo670-video-feed.test.js` 9/0: param clamps, ffmpeg args, splitter across chunks, `into` reads,
  one-in-flight + size-change restart + stride packing, framing, merge of several clients, worker lifecycle and slow
  client skip, and a REAL ffmpeg round-trip from a HASCGSHM segment (64×36 stays 64×36; skipped when ffmpeg is
  missing). Added to the curated list.
- `npm run test:ci` 2763 tests, 2761 pass, 0 fail; lint 214 warnings (cap 216); prettier, max-lines, unwired-exports
  clean.
- Godot `--test` 20847/0 (`tests/test_video_feed.gd`: wanted/URL rules, frame parse, real JPEG decode keeps red red,
  RGBA texture path); `--check` boot OK.
- **Box, live:**
  - A node WS client on `opgui`: first frame 133 ms after connect, 960×540, 15.3 fps, ≈ 12 KB/frame (≈ 1.5 Mbit/s).
    The JPEG showed the operator channel's PGM/PRV with correct colours.
  - ffmpeg gone within 100 ms of the client leaving.
  - A second Godot instance with `--video=feed`: Live tab shows live PGM / PRV pictures (`video_native:false`,
    holds `opgui`).
- **Owner QA:** the Godot GUI on a laptop with `--server=http://<box>:4200` (checklist 22.10 section F).

## P2a — what was done (22.10)

P2 split: **P2a** = link servers and show them (this); **P2b** = the "Send media" button (rsync to a linked server)
and the signed handshake, which only matter once a link can change something on the peer (P3/P4). P2a never writes to
a peer: it reads `/api/replication/ping` and `/api/device-view`, both open GETs already.

**Server**
- `src/cluster/cluster-peers.js` (new): the peer list, device-local in the node's persistence file (`clusterPeers`;
  `.highascg-state.json` is git- and Syncthing-ignored, and a temp file under `node --test`). A peer must answer the
  ping as `appId: highascg` with another `instanceId` (this server is refused). Polled every 5 s while the list is not
  empty: online, version, role, leader epoch, program channels, project media. Media parity = this server's project
  media slug + signature against the peer's: `same | differs | other-show | unknown`. An offline peer keeps its last
  known facts plus the error. The peer's device view is cached 15 s. Scan = every private /24 of this box on :4200
  (350 ms timeout, ~0.4 s), skipping itself and linked servers.
- `src/api/routes-cluster.js` (new): `GET /api/cluster`, `POST /api/cluster/scan`, `POST /api/cluster/peers
  {address}`, `DELETE /api/cluster/peers/:id`, `GET /api/cluster/peers/:id/device-view`; WS `cluster:peers` on change
  (`last_seen` alone is not a change). Registered in `router.js`.
- `tools/dev/fake-cluster-peer.js` (new): a stub second server (ping + a copy of this box's device view) for testing
  with one box.

**Godot**
- `features/devices/cluster_panel.gd` (new): "SERVERS +" under the cables list, scrolling in the rest of the column.
  "+" → Link a server (address or Scan the network; errors inline). Per server: ● online / offline, name, facts line
  (orange when media differs), ✕ unlink (confirm), "Roles (from its cables)", its own rear panel built by
  `devices_model.gd` from its device view and frozen read-only (buttons hidden, input off), its cables as text.
- `features/devices/cluster_model.gd` (new): the pure part: destinations cabled in a payload, the per-destination role
  (cabled here and there → backup, only there → extension), the facts line.
- `devices_tab.gd`: +2 lines (preload, add the panel).

## P2a — what was VERIFIED

- `tools/smoke/smoke-wo670-cluster.test.js` 5/0: address parsing, media parity, private-/24 hosts; add refuses a
  non-HighAsCG answer, silence and itself, persists device-local, re-add updates; reload from persistence, offline
  keeps facts, parity follows the peer; device view through a REAL HTTP stub peer, cached then refetched; scan skips
  self; routes through the registry. Added to the curated list.
- Godot 20894/0 (+7 `test_devices_cluster.gd`), `--check` boot OK.
- Box (server restarted): `GET /api/cluster` self = highascg7580; adding 192.168.0.23 → "that is this server"; scan
  0.37 s, nothing else on the LAN. Stub peers on :4301/:4302/:4303: linked (201, media same), device view proxied,
  persisted in `.highascg-state.json`.
- Second Godot window, Devices: fake-b card green with facts, "Operator GUI: backup · PGM/PRV 1: backup", its rear panel
  read-only and its cables. Stub killed → red "offline: connect ECONNREFUSED" within one poll, live over WS. Two
  peers → the list scrolls. Dialog: a dead address shows "no HighAsCG server at 127.0.0.1:4309"; a live one links and
  closes the dialog; ✕ + Enter unlinks. Peers and stubs removed afterwards.
- NOT verified: a real second box (none on the LAN), so "extension" and "media differs" were only seen in tests.

## P2b — what was done (22.10)

**Trust = both servers linked each other** (each keeps its own list, answer 2). The hot-backup SSH exchange
(`exchangeReplicationSshWithPeer`) needs a paired peer, and installing a key on anyone's say-so over HTTP would let
any LAN host write into `media/`. So:
- Linking records the peer's **device public key** (`GET /api/cluster/identity`, ed25519 from
  `config/device-identity.json`). The operator's link is the trust decision (trust on first use). A peer with the SAME
  device key but another process is refused as a cloned install (409, with the fix: delete `device-identity.json` on
  one). `instanceId` is random per process, so it cannot be the trust anchor.
- `src/cluster/cluster-media.js` (new):
  - **Sender** (`POST /api/cluster/peers/:id/send-media`): POSTs `{from_key, to (receiver key fingerprint),
    ssh_public_key, ts}` + ed25519 signature to the receiver's `/api/cluster/ssh-key`; on 403 → 409 "B has not linked
    this server: on B, Devices → Servers → + → this server, then Send again". Then the existing
    `buildProjectMediaRsyncPlan` + `runProjectMediaRsync('push', …)` (rsync over SSH, replication key), in the
    background: 202, progress in the peer's `media_send` {state sending | done | failed, percent, files, error} → WS.
    One send per peer at a time.
  - **Receiver** (`POST /api/cluster/ssh-key`): the sender's device key must belong to a server linked HERE, `to` must
    be this server's fingerprint, `ts` within 60 s, the key a plain ssh public key, and the signature valid over all
    four fields. Then the existing `installPeerAuthorizedKey` = forced command `highascg-replication-ssh`
    (`rsync --server` into media/ and template/ only), `from=` the caller's address.
- Peers linked before P2b have no recorded key → Send says "unlink and link it again".
- Godot `cluster_panel.gd`: "Send media" per online server, a line under the name (progress %, "Media sent (N
  paths)", red refusal / failure text). `cluster_model.gd`: `send_line` / `sending` / `send_failed`.
- `tools/dev/fake-cluster-peer.js`: own ed25519 identity, the REAL `acceptSshKey` with the real server as its linked
  peer, key written to `--trust-file` (never `~/.ssh/authorized_keys`); `--trust=none` = has not linked us.

## P2b — what was VERIFIED

- Smoke 8/0 (+3): link records the key, clone refused; receiver refuses unlinked / other target / stale / non-key /
  swapped key under a valid signature and installs nothing, installs with `from=` on a valid request (real ed25519
  keys); sender signs, stops on 403 with the message, runs rsync only after trust, progress → done, one at a time,
  relink hint.
- Godot 20901/0 (+7 `test_send_line`), `--check` OK.
- Box, server restarted: identity endpoint (fingerprint e7cb256dd250bfa6). Stub fake-b linked (identity true) →
  `send-media` 202 → the stub accepted the signed key (trust file: `from="127.0.0.1" ssh-ed25519 AAAAC3…IIzA…`, this
  box's replication key) → REAL rsync: journal `[replication] rsync push 3/3 path(s) → 127.0.0.1`, state done. The
  "Send media" button in a second Godot window did it again (journal 11:50:53). Stub fake-c `--trust=none`: 409 and
  the red line "fake-c has not linked this server: on fake-c, Devices → Servers → + → this server, then Send again."
- The rsync landed on this box's own media folder (same paths, nothing changed); the forced-command wrapper on a real
  receiver is the existing hot-backup one, not re-tested here. Real two-box send = owner QA.

## P3a — Investigation (22.10)

- The hot-backup pair already has an epoch: `src/replication/promote.js` (`promoteToLeader` = `leaderEpoch + 1`,
  `leaderYield`, `demoteToFollower` when the peer's epoch is higher, `peer-client.js:210`) and auto-promote on a lost
  peer (`peer-client.js:243–258`, FAILOVER_MS 5 s). It is one peer only (`replication.peer`), token-authenticated,
  and its role also follows the operator WS count (`role-state.js:55`). It runs the AMCP fan-out, live-state mirror and
  playhead sync, ≈45 files. Generalising it to N peers in place would touch all of that while it is the only
  hardware-proven path, so the cluster master is a separate, small module. P4 decides how the fan-out follows it.

## P3a — what was done (22.10)

- `src/cluster/cluster-master.js` (new). The master is named by a signed CLAIM
  `{epoch, master, succession, auto, by, ts, sig}`:
  - `master` and `succession` are device-key fingerprints;
  - `by` is the signer's device key, and the signature is ed25519 over every field.
- Any server of the cluster may sign a claim ("Make master" on any of them). A server takes a claim only when:
  - the signer is itself or a server ITS operator linked (trust = links, as in P2b);
  - the claim beats the one it holds: a higher epoch, or the same epoch with the lower master fingerprint. Two halves
    of a split network that each promoted converge on one master when they meet.
- Claims travel both ways:
  - pushed: `POST /api/cluster/master` to every linked server when a claim is made;
  - pulled: `GET /api/cluster/master` from every online linked server after each cluster poll (5 s,
    `cluster.afterPoll`).
  - So an old master that comes back sees the higher epoch and steps down (journal: `stepped down: X is master`).
- **Auto failover** (`auto` lives in the claim, so it is one setting for the whole cluster; default on):
  - when the master has been unseen for 12 s (`FAILOVER_MS`, counted from this process's start at the earliest), the
    first server of the succession still seen online claims epoch + 1, and the others wait for its claim;
  - outputs never depend on the master's process.
- `POST /api/cluster/master/set {master: 'self' | peer id, auto?}` is the operator's control; every change is a new
  epoch. The claim is stored in the persistence file (`clusterMaster`, device-local), and unlinking the last server
  drops it.
- `GET /api/cluster` and WS `cluster:peers` carry `master`:
  `{epoch, master, master_id ('self' | peer id), is_master, auto, succession [{key_id, id, name}]}`.
- Godot `cluster_panel.gd` / `cluster_model.gd`:
  - under SERVERS, the line "Master: … · epoch N · auto failover", plus an "Auto failover" checkbox and "Make this
    server master";
  - a MASTER tag on the master's card, and "Make master" on the other online cards, both behind a confirm.
- `tools/dev/fake-cluster-peer.js`: runs the REAL module, with the real server as its one linked peer. Its claim and
  key are kept in `--state-file`, so a restarted stub comes back with its old epoch.
- **P3a decides and shows who the master is. Nothing yet follows it:**
  - clients reconnecting to the master is P3b;
  - fan-out from the master is P4;
  - the hot-backup pair's own leader / epoch is untouched.

## P3a — what was VERIFIED

- Offline:
  - smoke `smoke-wo670-cluster-master.test.js` 7/0: three servers with real keys on a switchable network;
  - covers ordering, push to all, refusals (unlinked signer, tampered, malformed, older), failover after the window
    only by the first online successor, an old master's step-down, auto off, split-brain convergence, routes and
    forget;
  - P2 smoke 8/0; Godot 20908/0 (+7 `test_master_line`); `--check` OK.
- Box (server restarted, stub fake-b on :4301):
  - `master/set {master: fake-b}`: both sides at epoch 1, the stub `is_master`.
  - **Failover:** killed the stub at 11:59:38. The real server became master at 11:59:49, epoch 2 (journal
    `master this server epoch 2 (failover: fake-b unseen 15 s)`).
  - **Step-down:** restarted the stub with its stored epoch-1 claim. It started as master, and after one tick it logged
    `stepped down: highascg7580 is master (epoch 2, from highascg7580)`. The real server stayed at epoch 2.
- Second Godot window, Devices:
  - the line "Master: this server · epoch 2 · auto failover";
  - "Make master" on fake-b → confirm → OK: fake-b MASTER at epoch 3 on both sides, and "Make this server master"
    appeared;
  - unticking "Auto failover" gave epoch 4 with `auto: false` on both.
  - Unlinking fake-b dropped the claim (`claim: null`, journal line).
- Not proven: two real boxes (owner QA, checklist §F); the network pulled between them.

## P3b — what was done (22.10)

- **Server: the cluster starts at boot** when servers are linked (`routes-cluster.js` `startIfLinked`, called from
  `index.js` next to the video feed). Before this change, polling, and so failover, began only with the first
  `/api/cluster` call. That call came from a client opening Devices.
- **Godot: the client follows the master:**
  - `app/cluster_follow.gd` (a node under `main.gd`), with its pure rules in `core/cluster_follow_model.gd`.
  - From every `cluster:peers` snapshot, it remembers all servers of the cluster in ui.cfg `[cluster] servers`. A peer
    listed as loopback by its server is reached at that server's host.
  - **Its server names another online server as master** (after a failover or "Make master" there):
    - a "Master changed" dialog counts down 5 s, then reconnects;
    - "Reconnect now" skips the wait; "Stay here" stays until the next epoch;
    - it reconnects only to a server that says `is_master` itself, so two servers naming each other cannot bounce the
      client.
  - **Its server is gone for 8 s** (or never answered since start): every 3 s it asks the remembered servers and its
    home origin (`GET /api/cluster/master`). It reconnects, without a countdown, to the one that is master (highest
    epoch), or home when no master answers.
  - The followed origin is ui.cfg `[cluster] origin`. `core/config.gd` puts it after `--server` / `HIGHASCG_SERVER`
    and before the A/B profile. Picking A/B clears it.
  - Devices → Servers has "This client follows the master" (default on). The master line now sits on its own row,
    because the controls had squeezed it to "Master: fake-b · ep".
- **The reconnect is a client restart**, as the A/B switch already did: every autoload starts on the new origin. The
  restart now starts the new process BEFORE quitting. Every quit of this client crashes (WO-676), which had silently
  killed `OS.set_restart_on_exit`, the A/B switch's restart included.

## P3b — what was VERIFIED

- Offline: Godot 20923/0 (+15 `test_cluster_follow.gd`), `--check` OK; server suite below.
- Box (stub fake-b running the real master module; a second Godot window with no `--server`):
  - **Make master on the server.** `master/set {master: fake-b}`: the window showed "Master changed — fake-b is now
    the master. This client reconnects to it in 3 s (http://127.0.0.1:4301)" (screenshot). A new process started at
    12:09:21 on 127.0.0.1:4301, and `[cluster] origin` was set.
  - **Master back on this server while the client sat on the stub.** The stub has no WebSocket, so to the client it
    was gone. 12 s after starting, it probed, found this server as master, and restarted onto it (12:09:33). `origin`
    went back to "" (home). Screenshot: connected, "Master: this server · epoch 4", with the controls on their own
    row.
  - **Boot start.** Made fake-b master, killed it, restarted the node with no client open. At 12:10:22 the journal
    showed `master this server epoch 6 (failover: fake-b unseen 14 s)`.
- Cleanup: unlinked fake-b (claim dropped), removed ui.cfg `[cluster]`, killed the stub and the test window.
- Not proven:
  - the 5-s countdown when "Stay here" is clicked (code path only);
  - a client on another machine following two real boxes (owner QA, checklist §F).

## P4a — Investigation (22.10)

- **Channels follow the shared destination list, not the cables.** Mains are numbered 1..n in screen order
  (`routing-map.js:226-254`: `pgm = ch++; prv = previewEnabled ? ch++ : null`). The screen count is
  `max(1, maxMainScreenIndex+1, graph usage)` (`routing-map.js:99-103`). Cabling only picks the outputs inside a
  channel. So the master already plays every destination on its own Caspar, cabled there or not. The fan-out only
  has to forward, per destination, to the servers where that destination is cabled.
- **Takes pick the channel by screen index** (`routes-scene-take-look.js:34-37`: `programCh =
  map.programChannels[mainIdx]`). Two boxes whose destination lists differ in order therefore use different channel
  numbers for the same destination. Lines must be translated through the destination id.
- **The existing fan-out** (`src/replication/amcp-fanout.js`) is the hot-backup pair's. It has a single peer, sends
  lines unchanged with the same channel numbers, and is gated on the pair (leader role, `peerCaspar`). All sends pass
  through two choke points:
  - `fanoutSingleCommand`, from `amcp-client-transport.js:103` and `:244`;
  - `fanoutBatchPayload`, from `amcp-batch.js:325`.
- **A peer's own `/api/device-view` has everything needed:**
  - `screenDestinations.destinations[]` gives `{id, mode, mainScreenIndex}`;
  - `live.caspar` gives `{host, port, channelMap}`. The host is as the peer sees it (127.0.0.1), so the master uses
    the peer's address with that port;
  - `graph` gives the cables. "Cabled" means a `destination_in` connector, with `externalRef` set to the destination
    id, is the `sourceId` of an edge with a sink: the same rule as Godot `cluster_model.gd` `cabled()`.

## P4a — what was done (22.10)

- **`src/cluster/cluster-fanout.js`** (new): pure helpers plus a forwarder.
  - `mainChannels(view)` maps each main-bus destination id to its `{pgm, prv}` channels on that box. Multiview,
    stream and operator GUI destinations are left out.
  - `cabledIds(view)` lists the destinations cabled there. `channelPlan(own, peer)` maps master channel → peer channel
    for each destination cabled on the peer. That one rule covers both link kinds: a destination cabled on both boxes
    is backed up, one cabled only on the peer is extended there.
  - `rewriteLine` applies the same allow-list as the pair (`shouldFanOutCommand`), swaps the channel, and translates
    `route://N` when N is mapped. A line whose channel is not mapped is not sent.
  - `createClusterFanout` keeps one `PeerCasparConnection` per online linked server. The Caspar is the peer's address
    plus its device view's port; a loopback host is the peer's own address. The plan refreshes after each cluster
    poll (5 s; device views are cached 15 s), with a busy guard. Batches go out as one batch of the lines that apply.
    It is active only while this server is master and `replication.enabled` is off: with the pair on, both fan-outs
    would drive the same Caspar twice. It broadcasts only when something other than the sent counters changes.
- **`src/replication/amcp-fanout.js`**: `setClusterFanoutSink(fn)`. `fanoutSingleCommand` and `fanoutBatchPayload`
  hand every payload to the sink first, inside a try (a cluster error never breaks a local take). Every send path
  is covered without touching the transports.
- **`src/api/routes-cluster.js`**: `fanoutOf(ctx)` builds it (own view = `normalizeScreenDestinations` plus
  `buildChannelMap(ctx)`, the same sources as `/api/device-view`). The poll hook is now master `tick()`, then
  fan-out `refresh()`. `GET /api/cluster` and WS `cluster:peers` carry `fanout: {active, peers: {id: {caspar,
  connected, sent, error, destinations: [{id, label, pgm: [master, peer], prv}]}}}`.
- **`tools/dev/fake-cluster-peer.js`**:
  - `--amcp-port=N`: a fake Caspar that prints every line and answers 202, reported as the stub's Caspar;
  - `--cabled=dst_a,…`: keep only those destinations' cables;
  - `--offset=N`: shift the stub's channel numbers, so the translation shows.
- Not in P4a (→ P4b):
  - catching a server up on what is already on air when it joins or reconnects;
  - blocking local PGM takes on a server that is not master;
  - showing the forwarding state in the Godot Servers cards. The data is in the snapshot; no UI yet.

## P4a — what was VERIFIED

- Offline: `tools/smoke/smoke-wo670-cluster-fanout.test.js` 5/0. It covers:
  - the plan between two boxes with differently ordered lists (master 3→1, 4→2, 1→3; no preview on the peer → master
    ch 2 stays local; the operator GUI is never forwarded; an edge with no sink is not a cable);
  - the line rewrite, `route://` included, plus deny-list and unmapped lines;
  - the forwarder (the loopback host becomes the peer host, lines and batches translated, sent counters, no broadcast
    on counters alone);
  - off when not master or with the pair on; peers that leave are dropped; stepping down closes the connections;
  - the sink receiving single and batch sends, and a throwing sink not breaking the send.
  The WO-670 smokes are 20/0 together; the full `test:ci` is 2791 tests, 0 fail. Lint is 214 warnings (cap 216), no
  file is over 500 lines, and the API contract has 470 routes (none new).
- Box (stub fake-b with `--amcp-port=5261 --offset=10`, linked, this box made master, epoch 1):
  - **Plan.** `fanout.peers.fake-b` showed `caspar 127.0.0.1:5261, connected, destinations [{dst_mvi3swp8_1 "PGM/PRV
    1", pgm [1, 11], prv [2, 12]}]`. The journal showed `master: forwarding takes to the linked servers` and `fake-b:
    forwarding to its Caspar 127.0.0.1:5261`.
  - **Forwarding.** `POST /api/amcp/raw-batch [MIXER 1-299 OPACITY 1, MIXER 2-299 OPACITY 1]` and `POST /api/clear
    {1, 299}` ran locally (202), and the stub printed `MIXER 11-299 OPACITY 1`, `MIXER 12-299 OPACITY 1`, `CLEAR
    11-299`; `sent` was 3.
  - **Uncabled.** The stub was restarted with `--cabled=dst_none`. `error: "no shared destination is cabled there"`,
    destinations `[]`, and a `CLEAR` reached the stub 0 times.
  - **Step down.** `master/set {self}` on the stub (epoch 2). The journal showed `stepped down: fake-b is master` and
    then `not forwarding takes`, and `fanout` became `{active: false, peers: {}}`.
  - Side effect, which confirms P3b again: the open Godot GUI followed the stub when it became master, and went home
    by itself once the stub was killed (ui.cfg `[cluster] origin` was "" again, new pid running).
- Cleanup: unlinked fake-b and killed the stub.
- Not proven:
  - a real second Caspar playing the forwarded take;
  - a real scene take, as opposed to the raw AMCP routes. The take uses the same `amcp-batch.js` path;
  - two real boxes (P5, owner QA).

## P4b — Investigation (22.10)

- **The pair's catch-up does not fit.** `replication-reconcile.js` `catchUpLiveStateFromLeader` has the follower pull
  the leader's live intent and re-take the look locally (`mirror-apply.js`). In the cluster, the master writes
  straight to the other box's Caspar, so that box's node never takes anything. The master itself has to rebuild the
  air on a Caspar that (re)connects.
- **The pair's local-PGM block is reusable.** `amcp-fanout.js` `shouldFollowerSkipLocalPgmAmcp` gates every local
  path:
  - the scene take (`routes-scene-take.js:216`);
  - the audio-only take and the project route;
  - batches (`amcp-batch.js:183`);
  - single commands (`amcp-client-transport.js:57`).
  It skips program channels only; preview stays free.
- **A bug in that skip path, found on the box.** A skipped single command resolved its promise, but its waiter stayed
  queued in `response_callback[verb]` (pushed at `amcp-client-transport.js:49-50`). The next reply with the same verb
  went to that dead waiter, so the next real command timed out. On the box: PGM `CLEAR 1-299` skipped, then PRV
  `CLEAR 2-299` → `AMCP response timeout: CLEAR 2-299`. The same happens to a hot-backup follower today.

## P4b — what was done (22.10)

- **`src/cluster/cluster-air-journal.js`** (new): what is on air, kept per channel-layer as the AMCP lines that put it
  there:
  - producer: a PLAY / LOAD with a clip starts over; LOADBG + bare PLAY compact to the last pair; PAUSE / RESUME /
    CALL are kept in order; STOP / CLEAR empty it;
  - the last MIXER line per property (DEFER stripped; queries ignored); MIXER … CLEAR empties it;
  - CG lines since the last CG CLEAR;
  - channel-level MIXER per property.
  `replay(channels)` returns the lines that rebuild those channels.
- **`cluster-fanout.js`:**
  - every line this server sends is recorded after it is forwarded;
  - when a server's Caspar connects (first time or again; new `PeerCasparConnection` option `onConnected`) or a
    destination gets newly cabled there, `catchUp` replays the journal of the channels that server has not had yet,
    translated, in batches of 50, before any new line;
  - status carries `caught_up {at, lines}`.
- **`routes-cluster.js`:**
  - `airJournalOf(ctx)`: the journal starts at boot (`startIfLinked`), so a server linked later gets what went on air
    before. The cluster itself still starts only with linked servers;
  - `followsMaster(ctx)`: another server is master, it is online, and the hot-backup pair is off. It is registered
    in `amcp-fanout.js` `setClusterFollowerCheck`, so `shouldFollowerSkipLocalPgmAmcp` also skips local PGM takes on
    a cluster follower. A throwing check counts as "not a follower";
  - `GET /api/cluster` / WS carry `follows_master`.
- **`amcp-client-transport.js`:** the skip path drops its waiter (the bug above).
- **Godot:**
  - `cluster_model.gd` `fanout_line`: each card shows, while this server is master, "Takes forwarded: PGM/PRV 1 (ch
    1→11, 2→12) · N sent · caught up (N lines)", or "Takes not forwarded: …" in red;
  - `follow_note`: under the master line, on a follower, "PGM here is driven by the master: local PGM takes are
    skipped (PRV still works)."
- Not done:
  - replayed clips start from their first frame (no SEEK to the master's position);
  - after a failover, the new master's journal holds only what it sent itself. While it was a follower, its PGM came
    from the old master, so a third server joining then gets no PGM history;
  - AMCP sent before `startIfLinked` at boot is not journaled.

## P4b — what was VERIFIED

- Offline:
  - `tools/smoke/smoke-wo670-cluster-catchup.test.js` 7/0. It covers:
    - the journal: producer/mixer/CG per layer, compaction, the resets;
    - catch-up: on connect before new lines; a new line is sent once, not replayed too; full replay after a
      reconnect; a destination cabled later is caught up once;
    - `followsMaster`: only an online other master, and not with the pair;
    - the follower gate: PGM only, a throwing check is ignored, the source-pinned call sites;
    - the waiter-leak regression. **That test fails without the transport fix** (`no stale waiter`) and passes
      with it.
  - The WO-670 smokes are 27/0. `test:ci` is 2798 tests, 0 fail. Godot 20932/0 (+9 in `test_devices_cluster.gd`),
    `--check` OK. Lint is 214 warnings, no file over 500 lines, 470 routes.
- Box (stub fake-b, `--amcp-port=5261 --offset=10`):
  - **Catch-up of what went on air before linking.** After a restart, sent `PLAY 1-299 "#00000000"`, `MIXER 1-299
    OPACITY 0.7`, `MIXER 2-299 OPACITY 0.9`, then linked fake-b and made this box master. The stub received one batch
    (`BEGIN`, `PLAY 11-299 "#00000000"`, `MIXER 11-299 OPACITY 0.7`, `MIXER 12-299 OPACITY 0.9`, `COMMIT`). Journal:
    `fake-b: caught up on channels 1, 2 (3 lines)`.
  - **Reconnect.** Killed the stub, sent `MIXER 1-299 OPACITY 0.6`, restarted the stub. The journal showed
    `ECONNREFUSED`, then `connected`, then `caught up … (3 lines)`, and the stub got the batch with `OPACITY 0.6`.
  - **Follower.** `master/set {self}` on the stub, then `follows_master: true`:
    - PGM `CLEAR 1-299` → `{"skipped": true}`, not sent;
    - before the fix, the following PRV `CLEAR 2-299` timed out;
    - after the fix and a restart, PGM / PRV / PGM / PRV each answered in 5-8 ms (`skipped` / `202 CLEAR OK`).
  - **Card.** Screenshot of a second Godot window on Devices: "Takes forwarded: PGM/PRV 1 (ch 1→11, 2→12) · 0 sent ·
    caught up (0 lines)". "caught up (0 lines)" is now hidden.
  - The main GUI followed the stub while it was master and came home by itself afterwards (P3b).
- Cleanup: unlinked fake-b, killed the stub and the test window.
- Not proven:
  - the follower note on screen (Godot test only);
  - a real second Caspar rebuilding a look from the replay;
  - two real boxes (P5).

## What was VERIFIED

- Investigation only. The file and line references above were read or grepped this session. `replication.json`
  (`enabled: false, autoPromote: false`) and the two-node device graph were checked on the box.
