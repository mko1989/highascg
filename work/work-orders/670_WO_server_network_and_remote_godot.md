# WO-670 — Server network in the Devices view (backup / extension) + Godot GUI on another machine

**Status: OPEN — plan, waiting for the owner's answers to the four decisions below (22.10)**

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

## What was VERIFIED

- Investigation only. The file and line references above were read or grepped this session. `replication.json`
  (`enabled: false, autoPromote: false`) and the two-node device graph were checked on the box.
