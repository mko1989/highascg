# WO-670 — Server network in the Devices view (backup / extension) + Godot GUI on another machine

**Status: IN PROGRESS — P1 (remote video) DONE 22.10 (offline + box-verified with a second Godot on the feed); P2–P5 open**

Owner, `next.md` 22.10:
- *"the godot client can be multiplatform if im not mistaken? and to make it work we'd just need to get the operator
  channel to reach a godot gui and another machine. right?"*
- *"there was a backup workflow already in place earlier, and id want to expand on that. id like to be able to add
  servers to a network of devices then display them in the devices view. this way users can link servers toghether and
  either use the second server as backup when the same screen destination is connected to its outputs or as an
  extension for other screen destinations for instance but controlled from a single client. the second server could
  even run in headless mode then."*

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

**Not done in P1:** Windows / macOS export presets (nothing to test them on here); JPEG decode runs on the main thread
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

## What was VERIFIED

- Investigation only. The file and line references above were read or grepped this session. `replication.json`
  (`enabled: false, autoPromote: false`) and the two-node device graph were checked on the box.
