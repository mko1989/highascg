# WO-802 — Linking servers: only node servers link; Godot clients stay on their own node

**Status: OPEN (29.10) — bug report from the owner; investigation not started**

Owner, 29.10:
> i also need you to look into linking servers. it is flawed. when linking only the node servers should link the godot clients should stay connected to their respective node servers on their machines and all the communication should happen via node servers. i had a weird situation where even after unlinking i had the godot client connected straight to the second machine and i didnt even know it. i only was made aware when i did a shutdown and the other server shut down.

## Target behaviour (owner's rules)

1. **Linking is node ↔ node only.** A link joins two node servers (HighAsCG backends).
2. **A Godot client always talks to the node on its own machine.** It never opens a socket to the other
   machine's node directly, and never to the other machine's Godot.
3. **All cross-machine traffic goes node ↔ node.** The local node relays what the local client needs.
4. **Unlink must restore the local-only state visibly.** After unlink, the client's server is the local
   node; no residual remote connection. The UI must say which server the client is connected to, at all
   times ("on <host>" header cue — see `onbox-client-never-follows` memory).
5. **No silent fallback.** If a client is connected to a non-local server, the UI shows it, and the
   owner can see it before a shutdown.

## Known related work

- WO-670 (`670_WO_server_network_and_remote_godot.md`): server network, "link per destination as backup or
  extension, one client; remote Godot on another machine (video via `/api/video-feed`)". The current
  Godot-remote design is the likely source of the direct connection — to check.
- WO-746 (`746_WO_shared_project_across_linked_servers.md`): shared project across linked servers.
- Owner's earlier note (`next.md`, 23.10): different servers should act as tracking system and
  media system, exchanging information and able to react to each other.

## Investigation to do (agent to fill, file:line)

- How a Godot client picks its server: the connection config in the Godot client (search `server`, `host`,
  `base_url`, `ws` in `godot/client/` autoloads / `Api` / settings), and whether the picker can point to a
  remote host directly.
- What "link" does on the node: which code adds/removes the peer and whether the local node's
  `/api/...` and WS endpoints are proxied to the peer (search `link`, `peer`, `remote`, `failover` in
  `src/`).
- Why unlink did not clear the client's target: is the target stored in the client's own settings, in
  the project, or in the last-known server list?
- Whether the client reconnects to the last-used server after a restart, and whether the header shows it.

## Plan (after investigation)

1. Client: one fixed local server per Godot client (the local node). Remove any direct-remote target from the
   client's connection path. Remote data comes only via the local node.
2. Node: link/unlink manage the peer relation only. Unlink tears down all proxied routes to that peer.
3. UI: the header shows the server the client is connected to (host name + "local"/"linked"). Unlink
   shows the result in the status line.
4. Tests: a smoke that a client's base URL is always the local node after unlink; a test that a link does
   not create a client connection to the peer.

## Acceptance

- Link two boxes → node-to-node link up; each Godot client still on its own node (header shows local).
- Unlink → no remote socket left (check `ss -tnp` on each box for the other machine's port from the Godot
  process).
- Shutdown of the other box does not change the local client's connection.

## Verified

_(none yet — investigation first)_

## Investigation (29.10, Haiku read-only pass)

Read-only: no code changed, no git state operation. Paths are relative to the repo root. UNVERIFIED = not confirmed in code or by a run.

### 1. How a Godot client picks its server

- Autoload `Config` resolves `Config.origin` once in `_init`: `godot/client/core/config.gd:18-23`.
  Precedence: `--server=` arg (`:69-71`), then env `HIGHASCG_SERVER` (`:72`), then the followed cluster master
  from ui.cfg `[cluster] origin` (`:20-23`), then the active A/B profile from ui.cfg `[connection]` (`:23`, `:28`),
  then the default `http://127.0.0.1:4200` (`:10`, `:75-76`).
- Stored in `user://ui.cfg` (`config.gd:11`): `[cluster]` origin / servers / follow (`:33-45`), `[connection]` host_a / host_b / active
  (`godot/client/core/connection_profiles_model.gd:3-6`, `:73-78`).
- Only `Config.origin` drives the main socket and REST: `Api.base()` (`godot/client/core/api.gd:52-53`), `Ws.connect_to_url(Config.ws_url())` (`godot/client/core/ws.gd:89`).
- **Yes, a client can be pointed at a remote host directly**, by four routes: `--server=` / `HIGHASCG_SERVER`; A/B hosts
  (`godot/client/app/connection_menu.gd:74-82` `switch_to`, restart); cluster follow (`godot/client/app/cluster_follow.gd:156-180`, `_switch` writes ui.cfg origin then restarts);
  and the Devices "Edit" on a linked card: `godot/client/core/devices_target.gd:11-29` `edit_peer()` builds a second `Api` with `origin_override = peer_origin` (`:12-13`, `:25`).
  `edit_peer` is a direct client → peer HTTP path (no WS), in memory only, cleared by "Back" (`:33-44`). This is a direct client-to-remote-node link that is not the node relay WO-802 forbids.
- The last-known list of servers is `ui.cfg [cluster] servers`, written only when the snapshot has more than one server
  (`cluster_follow.gd:76-78`). Nothing clears it on unlink, so unlinked servers stay as probe candidates (`cluster_follow.gd:131`). UNVERIFIED: that a stale entry was probed in the owner's case.

### 2. What "link" does on the node

- Peer list: `createCluster` in `src/cluster/cluster-peers.js:144`. Stored under persistence key `clusterPeers` (`:29`, device-local, never in the project).
- Link: `add(raw)` (`cluster-peers.js:309`). It asks the peer to link back (`linkBack`, `:254`, `:343`).
  Invites in WO-739 (`cluster-invites.js`). Self-repair: `heal(p)` (`:271`) and `poll()` (`:287`).
  Routes: `POST /api/cluster/peers` (`src/api/routes-cluster.js:266`).
- Unlink: `unlink(id, {linkBack})` (`cluster-peers.js:366-381`). It removes the peer from the map and store (`remove`, `:353-359`), tombstones it if the peer does not confirm (`tombstone`, `:371-372`), and sends `DELETE …/peers/<me>?link_back=0` to the peer (`:373-374`). Route: `DELETE /api/cluster/peers/:id` (`routes-cluster.js:284-285`). When the list is empty it also drops the master claim (`routes-cluster.js:286` → `cluster-master.js:176-183` `forget()`).
- Downstream effects: the fan-out drops targets whose members left (`src/cluster/cluster-fanout.js:136-143`, `drop` at `:109-114`). Change → WS `cluster:peers` (`routes-cluster.js:235`).
- **Proxying:** none. No node module proxies client `/api/*` or WS traffic to a peer. `src/server/http-server.js:205` only notes the old nginx proxy was removed. Node-to-node traffic is signed calls (`src/cluster/cluster-call.js`), fan-out AMCP (`src/cluster/cluster-fanout.js`, `src/replication/peer-caspar-connection.js`), media (`src/cluster/cluster-media.js`), and the shared show (`src/cluster/shared-show*.js`). The Devices read of a peer is `GET /api/cluster/peers/:id/device-view` (`routes-cluster.js:9-16`, `cluster-peers.js:410`).
- **Does unlink tear down every route to the peer?** Node-side: the peer is removed from `clusterPeers`, its tombstone blocks repair, its fan-out target is dropped, and the master claim is dropped when no peers remain. Not confirmed: whether the master claim's `succession` list or the shared-show state still names the peer after a unlink with other peers left (`cluster-master.js`, `shared-show.js`). UNVERIFIED.
- **Client-side the unlink does not clear anything the client holds:** `ui.cfg [cluster] origin` is cleared only by the client's own `follow_over` countdown (`godot/client/app/cluster_follow.gd:82-85`, `_countdown` `:94-102`, `_follow` `:156-168`, `_switch` `:171-180`).

### 3. Does a Godot client reconnect to its last-used server on restart?

- **Yes, for the followed master.** `Config._init` trusts the stored `[cluster] origin` without checking the snapshot (`config.gd:20-23`). A client restarted after an unlink therefore opens the old remote server's WS first. It returns home only after the first snapshot: WS connect → `_fetch` (`cluster_follow.gd:39-41`, `:64-70`) → `_on_snap` → `follow_over` (`cluster_follow_model.gd:109-118`) → 5 s countdown (`cluster_follow.gd:16`, `:94-109`).
- **The countdown can be dismissed.** "Stay here" sets `_stay_home = true` (`cluster_follow.gd:60-62`). It is never reset to false in this file (grep: `:29`, `:61`, `:83` only), so for the session no further automatic return home happens (`:83`). Whether the owner pressed it: UNVERIFIED.
- **Down-server path:** after `DOWN_MS` 8 s without a socket, probes go to the remembered servers and home; home is picked when no master answers (`cluster_follow.gd:122-138`, `cluster_follow_model.gd:90-103`).
- **On-box exception:** on a box with loopback home, a stored followed origin is dropped (`config.gd:21-22`, `cluster_follow.gd:33-36`, `cluster_follow_model.gd:39-41`). Off-box clients have no such guard. The owner's "weird situation" is therefore most likely an off-box client (laptop) or a box client with `Stay here` pressed. UNVERIFIED: which applies.
- **Header cue:** `godot/client/app/header_project.gd:41-47` shows "on <host>" when `Config.origin` is not local. Status tooltip `godot/client/app/shell.gd:230` shows the origin. The cue is hidden on box clients (`header_project.gd:47`), which is correct there.

### Failure modes that match the owner's report (code-level only)

1. A followed origin in ui.cfg outlives the unlink until a snapshot arrives. A restart goes straight to the old remote (`config.gd:20-23`).
2. `Stay here` (`cluster_follow.gd:60-62`) disables the auto-return for the session (`:83`).
3. Devices "Edit" uses a direct client-to-peer `Api` (`devices_target.gd:11-29`) that WO-802 forbids.
4. `ui.cfg [cluster] servers` keeps unlinked servers (`cluster_follow.gd:76-78`).

### Files read

- work/work-orders/802_WO_linked_servers_node_only_godot_stays_local.md, 670_…, 746_…
- godot/client/project.godot (autoload list), core/config.gd, core/api.gd, core/ws.gd, core/devices_target.gd, core/devices_target_model.gd, core/cluster_follow_model.gd, core/connection_profiles_model.gd, core/platform.gd
- godot/client/app/cluster_follow.gd, app/connection_menu.gd, app/header_project.gd (lines 41-47), app/shell.gd (line 230)
- src/cluster/cluster-peers.js, cluster-master.js, cluster-fanout.js, cluster-call.js (header only)
- src/api/routes-cluster.js (header, lines 229-300), src/server/http-server.js (line 205)
