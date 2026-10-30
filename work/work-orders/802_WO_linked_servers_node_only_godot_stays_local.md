# WO-802 — Linking servers: only node servers link; Godot clients stay on their own node

**Area:** network
**Status: IN PROGRESS (29.10) — fix built and verified offline + boot check + live relay probe on this box; owner two-box QA open (see "Fix (29.10, Opus)")**

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

## Fix (29.10, Opus)

### Investigation (verified in code before any change; line numbers are the pre-fix files)

Client (Godot):

- **(a) Stored followed origin.** `core/config.gd:20-23` puts ui.cfg `[cluster] origin` ahead of the A/B profile and the
  default. The only guard is "home is loopback" (`:21`) or "the followed origin is this machine" (`resolve_target`); an
  off-box client goes straight back to the stored master after a restart. Only `app/cluster_follow.gd:179` (`_switch`)
  and `app/connection_menu.gd:77` ever write it. Unlink writes nothing on the client. Verified.
- **(b) "Stay here".** `cluster_follow.gd:29` declares `_stay_home`, `:60-62` sets it on Cancel, `:83` reads it; nothing
  resets it. One "Stay here" on a "Back to this server" dialog keeps the client on the remote server for the rest of
  the process. Verified.
- **(c) Devices "Edit".** `core/devices_target.gd:130-148` `edit_peer()` builds a second `Api` with
  `origin_override = peer_origin` (`:132`), probes `/api/replication/ping` on the peer and then sends every Devices
  request (device-view, settings, state, caspar-config/apply, host-live, audio, cluster …) straight to the peer's node.
  `features/devices/cluster_panel.gd:191-197` takes `peer_origin` from the card (`DTM.peer_origin(p)`). Nothing ends the
  edit when the peer is unlinked: `stop_editing()` runs only on "Back". Verified.
- **(d) Remembered servers.** `cluster_follow.gd:76-78` writes `[cluster] servers` whenever a snapshot has more than one
  server and never prunes. `:131` probes every remembered server directly (`_probe`, `:142-152`: `HTTPRequest` to
  `<origin>/api/cluster/master`). This box's own ui.cfg still holds
  `servers=["http://192.168.0.4:4200", "http://192.168.0.23:4200"]` (29.10), written while this box's client was on
  .4 (`servers()` lists the current origin first) and kept since.
- **(e) Follow mode = direct client socket.** `_switch` (`:171-180`) writes the master's address as the origin and
  restarts the client: from then on WS, REST, video feed and uploads all go to the other machine. The down-server
  probe (`:122-138`) does the same without a dialog. `DevicesTarget._resolve` (`:55-80`) then opens a second Api back to
  the box's home server, so one client talks to two nodes. All of it breaks rule 2.
- The owner's actual case (off-box client following, on-box client with an old origin, or "Stay here" pressed): still
  UNVERIFIED. The client logs on this box no longer hold `[cluster]` lines (rotated); ui.cfg `origin` is "" today.

Node (f), verified by reading `src/cluster/*`:

- **f1. The fan-out keeps forwarding after the last unlink.** `cluster-peers.js:356` stops the poll when the list is empty,
  and the fan-out is refreshed only from `afterPoll` (`routes-cluster.js:69-77`) or a client's GET /api/cluster
  (`:262`, which polls). A master whose last peer unlinks it from the other side (`DELETE …?link_back=0`) or is dropped
  by the repair (`cluster-peers.js:278-280`) keeps `active` and the peer's Caspar connection
  (`cluster-fanout.js:213`): every take still goes to the unlinked server's Caspar until a client happens to GET
  /api/cluster.
- **f2. The master claim outlives the unlink.** `routes-cluster.js:286` drops the claim only when the DELETE route
  leaves the list empty. The repair removal (`cluster-peers.js:280`) never drops it. With other peers left, a claim
  that names the unlinked server stays: `cluster-master.js:169-172` shows `master_id ''`, `pullAndFailover` (`:158-159`)
  never fails over (the master is not a member), and the claim can be re-adopted from a remaining peer (`:154`, no check
  that its master is linked here).
- **f3. A shared show on that server then reverts every local edit.** `shared-show.js:59` `follower()` is true for any
  claim with an epoch that is not this server's. `propose()` calls `callMaster` → `cluster-call.js:98-99` 409 "no other
  server is master" (no `epoch` in the body) → the "refused" branch (`shared-show.js:222-231`): the edit is saved as a
  conflict file and the project goes back to the old master's show. Each edit, until restart or relink.
- **f4. Shared-show per-peer state.** `shared-show.js:49` `peerState` is never pruned; `view()` (`:310`) keeps listing
  the unlinked server under `show.peers`.
- Succession: the signed claim's `succession` (`cluster-master.js:112`) keeps the fingerprint (it cannot be edited
  without re-signing). Failover only picks fingerprints seen online among linked members (`:161-162`), so it is never
  chosen; only the view listed it (id '').

### Decisions

- **Rule 2 makes following moot.** The client's origin is resolved once from `--server` / `HIGHASCG_SERVER` / the A/B
  profile / the default, all explicit and shown in the header. The cluster never changes it. `app/cluster_follow.gd`,
  `core/cluster_follow_model.gd`, the "This client follows the master" box and the `[cluster]` ui.cfg section are
  removed. A stale `[cluster]` section is erased when the client starts (`Config._init`), so neither a stored origin
  nor stored servers survive. (a), (b), (d) are closed by removal, not by repair: nothing reads or writes them.
- **What a client sees of a linked master comes from its own node**, which already relays it: WS / GET `cluster:peers`
  (master, peers, fan-out, shared show), the master's fan-out on PGM (WO-670 P4), the shared show (WO-746). New: the
  Devices "Edit" goes through `GET|POST|DELETE /api/cluster/peers/:id/relay/<path>` on the local node
  (`src/cluster/cluster-relay.js`). The relay only reaches linked servers, refuses `/api/system/*` (power, update,
  dock: never another machine from this client), `/api/ws` and nested relays, and passes the status and body through.
- `Api.origin_override` is removed: every `Api` in the client talks to `Config.origin`. `DevicesTarget`'s second
  "home" Api (WO-732 P3a) is removed with it, since a client is never on another server than its home.
- The header always says where the client is: "local" (muted) on its own machine, amber "on <host>" otherwise.
- **Reduced scope, stated:** a client whose node follows a master drives that node. Its PGM takes stay skipped there
  (follower gate, WO-670 P4b); only zone actions and signed `look.take` already hand a take to the master
  (`zone-actions.js:48-50`, `cluster-call-actions.js:52-60`). Handing a client's own deck take to the master through
  its node is a follow-up, not done here. Before, an off-box client followed the master to drive it; now that needs
  an explicit A/B host (visible in the header).

### What was done (per file)

Node:
- `src/cluster/cluster-relay.js` (new, 97 lines): `createRelay` — GET/POST/DELETE to a linked server's `/api/…`, status,
  content type and body passed through, 14 s timeout (under the client's 15 s, so the client hears this server name
  the silent one: 502 "<name>: no answer"). Refuses: not linked here (404), outside /api/ or `..` (403), `/api/ws`,
  `/api/system/*`, a relay of a relay (403), other methods (405). No credentials are added (same as the old direct call).
- `src/api/routes-cluster.js`: the three relay routes; `onRemove` → `removed(ctx, saved)`: master `dropped(saved)`,
  fan-out `refresh()` now (f1), broadcast. The DELETE route's own `forget()` stays for a master not built yet.
- `src/cluster/cluster-peers.js`: `opts.onRemove(saved)` from `remove()`, i.e. every removal path (unlink here, unlink
  there, the repair's drop, f1/f2).
- `src/cluster/cluster-master.js`: `dropped(saved)` (alone → forget; the master itself left → forget with the reason);
  a claim whose master is neither this server nor linked here is refused when pushed (409) and not taken when pulled;
  a claim kept from before (stored) is dropped at the next tick; an epoch `floor` (highest seen / dropped) keeps the
  next claim made here ahead of the cluster's; the view's succession lists only this server and linked ones (f2, f3).
- `src/cluster/shared-show.js`: `prune()` of `peerState` to the linked servers on every tick and view (f4).

Client:
- `core/config.gd`: the origin is `home_origin()` only (`--server` / env / A/B / default). `forget_cluster()` erases
  ui.cfg `[cluster]` on start and logs it (a, d). `cluster()` / `save_cluster()` removed.
- `app/cluster_follow.gd`, `core/cluster_follow_model.gd`, `tests/test_cluster_follow.gd` (+ .uid): deleted (b, d, e).
  `app/main.gd` no longer adds the node; `app/connection_menu.gd` no longer clears the followed origin.
- `core/api.gd`: `origin_override`, `held`, `open()` removed: every Api talks to `Config.origin`. New `relay_peer`
  → `base()` = `Config.origin + /api/cluster/peers/<id>/relay` (c).
- `core/devices_target.gd`: rewritten. No second "home" Api (the client is always home). `edit_peer(id, name, origin)`
  builds a relayed Api and pings the peer through it; `editing` keeps the peer's listed origin only for Caspar-side
  URLs. The edit ends by itself when this server's `cluster:peers` no longer lists the peer (`ended` says why) (c).
- `core/devices_target_model.gd`: `pick` removed, `still_linked` added. `core/platform.gd`: `host_of` moved here.
- `features/devices/cluster_panel.gd`: "Edit" by id; the "This client follows the master" box removed; the "no longer
  linked" note shown once. `app/shell.gd`: the invite title no longer checks `DevicesTarget.remote` (gone).
- `app/header_project.gd`: the server cue is always shown: muted "local", amber "on <host>" (rule 5).
- `core/settings_state.gd`: comment only.

Rules / docs: `RULES.md` "Linked servers" (the owner's five rules). `docs/wiki/api/contract/http.md` regenerated
(`node tools/dev/gen-api-contract.js`: +3 relay routes, 515).

Tests: `tools/smoke/smoke-wo802-node-only-links.test.js` (new, 10 tests: relay unit + real HTTP peer + router order;
master after unlink with three servers; onRemove on all three removal paths; routes wiring; shared show after unlink),
in `tools/ci/offline-test-files-2.js` (the first list is at 500 lines). Helpers: `tools/smoke/lib/cluster-lan.js`
passes `onRemove`; `tools/e2e/shared-show-harness.js` gains `unlink(a, b)`. Godot `tests/test_devices_target.gd`: the
DT.pick test and the old "Edit → edit_peer(at, …)" source pin replaced (that pinned the direct peer origin, which
rule 2 forbids) by: no `origin_override` / old follow state anywhere in the client, HTTPRequest / WebSocketPeer /
StreamPeerTCP only in the known Config.origin users, `Api.base()` pinned, `Config._init` pinned, `forget_cluster` on a
real file, `still_linked`, Edit by id through `relay_peer`, unlink ends the edit, no follow switch.

### Verified (29.10)

- Offline suite `node tools/ci/run-offline-tests.js`: 3429 tests, 3427 pass, 0 fail, 2 skipped. Related cluster smokes
  alone (wo670 ×5, wo712, wo723, wo725, wo732, wo739, wo746 ×3): 132/0 before the new file was added.
- `node tools/ci/check-max-file-lines.js`: 0 files over 500.
- Godot `--script res://tests/run_tests.gd`: 21911 passed, 0 failed (baseline 21930/0: −39 removed follow / pick
  assertions, +20 new).
- `godot/client/run-client.sh --check`: boot OK (no script errors).
- Headless boot with a seeded ui.cfg `[cluster] origin="http://192.0.2.1:4200"` + 2 servers (TEST-NET address, nothing
  answers there): log `[client] WO-802: dropped the old cluster follow state (origin http://192.0.2.1:4200, 2
  remembered servers)`, then `[client] server http://127.0.0.1:4200`; the `[cluster]` section was gone from ui.cfg.
- Box (node restarted with `kill -TERM` MainPID, dev mode): `GET|POST|DELETE /api/cluster/peers/nosuch/relay/…` →
  404 "no such server (not linked here)" from the relay; `DELETE /api/cluster/peers/nosuch` → 404 "no such server"
  (the unlink route, not swallowed). Journal clean. This box has no linked servers now, so no relay to a real peer
  was made (the other machine was not contacted).
- NOT verified: two real boxes (link, Edit through the relay, unlink from either side, fan-out stops, header cue);
  the owner's running GUI was not relaunched, so it still runs the old client code until its next start (that start
  erases this box's stale `[cluster] servers` = .4 / .23).

### Residual gaps

- A client on a follower node drives that node: its own deck PGM takes stay skipped there (WO-670 P4b follower gate);
  only zone actions and the signed `look.take` hand a take to the master. Handing `/api/scene/take-look` (with mainIdx,
  transition override, take group) to the master through the node is a follow-up WO.
- An off-box client (laptop) is on whatever server its operator chose (A/B host or `--server`); it no longer moves to a
  new master after a failover. The header says where it is.
- The relay carries no credentials: a peer with `enforceAuth` on answers 401 through it, as it did to the direct call.

