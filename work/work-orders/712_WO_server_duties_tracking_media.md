# WO-712 — Server duties: a tracking box and a media box that exchange, react and impose

**Status: OPEN (23.10.26) — investigation + design written; owner decisions D1–D3 below; nothing implemented yet**

Owner, `next.md` 23.10: *"per multiple devices/servers interoperability config. id like this to work in a way that
different servers are sometimes treated as tracking system mostly while the other is handling media mostly. but they
exchange information and can both react and impose to/on the other."*

Builds on [WO-670](./670_WO_server_network_and_remote_godot.md) (linked servers, master / epoch, take forwarding).

## Investigation

Read-only sweep of `src/cluster/*`, `src/api/routes-cluster.js`, `src/tracking/*` and `src/fixtures/follow-service.js`
(a Sonnet agent; the lead re-checked the load-bearing claims).

### What a link is today
- **Peer record** (`cluster-peers.js:223-224`): `{id, host, port, name, added_at, device_key}`.
  - It is device-local, under `clusterPeers` in `.highascg-state.json`.
  - `device_key` is the peer's ed25519 public key, taken at link time (trust on first use).
  - Polling: `GET /api/replication/ping` every 5 s.
- **Only two peer requests are verified:** `/api/cluster/ssh-key` (`cluster-media.js:32-46`) and the master claim
  (`cluster-master.js:68-80`). Both are ed25519-signed bodies from a linked peer's device key.
  - Every other peer call (`getJson` / `postJson`, `cluster-peers.js:28-70`) carries no auth.
  - So the cluster works only while `enforceAuth` is off (`src/server/auth.js:149`, default false).
- **There is no generic "call that server's API" primitive.** The only non-poll call is the device-view proxy
  (`cluster-peers.js:241`).

### The shared project in WO-670's design was never built
- WO-670's Design says *"the project document … carried by revision"*. No phase P1–P4b implements it.
- The lead grepped `src/cluster` and `routes-cluster.js`: the only project code is the media plan for **Send media**
  (`routes-cluster.js:135-145`, `cluster-media.js:70`). Nothing pushes, pulls or revisions the project document.
- The only project push is the hot-backup pair's single-peer `pushProjectToPeer`
  (`replication/replicate-projects.js:76-102`, leader + `replication.enabled` + `pairId`).
- `stripDeviceLocalFromProject` (`config/config-classify.js:86-102`) does **not** strip `project.fixtures` or
  `project.previs.tracking`. So a pair follower receives the fixture patch and the tracking setup.

### Nothing in tracking or lighting knows which box should do it (hazard)
- `follow-service.js:121-156` applies `project.fixtures` and starts the Art-Net / sACN / PSN engine on every box.
  - Its only guard is self-loop (`:99-106`).
  - **Two boxes holding the same patch with output on both transmit the same universes.** This is possible today with
    the hot-backup pair, and with any shared project.
- `detect-service.js:196-226` starts the detection sidecar wherever detection is on and cameras exist.
- `zone-service.js:48-70` fires zone actions on every box.
- Presenters: `register.js:475`, a per-box `/tmp` roster.
- The lead checked: `rg cluster|follower|isMaster|replication` over these files finds nothing.
- The only per-box switch is `features.tracking: false`. It removes the whole module: hub, PSN, everything.

### Cross-box actions don't exist
- A zone `look:` action on a follower ends in `routes-scene-take.js:216` (*"follower amcp-fanout: skip local PGM
  AMCP"*). It is **dropped**, not forwarded to the master.
- `companion:` presses go to the local Companion only (`zone-actions.js:44-53`).
- `tracking:*` WS events are local only. Godot's `Ws` has one origin, and `cluster_follow.gd` restarts to change it. No
  server relays another server's tracking state.

### UI
- The Servers cards are `features/devices/cluster_panel.gd` `_card()` (`:119-176`), added at `devices_tab.gd:205`.
- **"Roles" is already taken** there: it means backup / extension per destination from the cables (`cluster_model.gd`).
  So the new per-server setting is called **Duties**.

## Design (proposed)

**Duties are per server and device-local, set on each Servers card.**
- Media: plays looks, timelines and destinations (what every box does today).
- Tracking: cameras → detection → markers, zones, presenters, the Auto director (WO-708/709), and the lights and PTZ it
  drives (WO-711).
- A box can hold both. A single box holds both by default, so nothing changes until a second box is linked.
- In a cluster, each duty normally sits on one box.

**R1 — duty gates (safety first).**
- A box without Tracking does not:
  - start the detection sidecar;
  - fire zones;
  - transmit DMX / PSN / VISCA. Its follow engine still computes, so its previs beams keep working.
- Today's double-output hazard goes away whatever the project holds.
- Each server's Duties are shown on its card, read from `/api/replication/ping`.

**R2 — one signed peer call, and "impose".**
- `cluster.call(peer, action, args)`: an ed25519-signed body with the device keys that are already exchanged (the
  master-claim scheme, with ts and to-fingerprint). It is independent of `enforceAuth`.
- The receiver runs a short allow-list of actions, as if its own operator pressed them:
  - `look.take {look, target}` → the box with Media duty. If it is a follower, the call goes on to the master, which
    drives air.
  - `tracking.auto.pin / slot / home`, from the overlay on the media box's GUI.
  - `fixtures.look`.
  - `companion.press`.
- A tracking box's zone `look:` goes to the media box through this call instead of being dropped.

**R3 — exchange (information).**
- The tracking box streams its `tracking:auto` / markers / zones / detections summary to linked peers. Peers
  re-broadcast it, tagged with the source server.
- So the media box's GUI shows the tracking box's people in the WO-710 overlay, and the overlay's buttons go back over
  R2.
- The media box streams its air state (the live look per destination, timeline position, look taken) to the tracking
  box.

**R4 — react.**
- Triggers on the air state: "when look X goes to PGM → Auto home / pins / fixtures look Y".
- They mirror the zone actions the other way.

**R5 — the shared project.** This is the missing WO-670 piece: the master pushes the show slice by revision with epoch
fencing, and the device-local slices are kept. See D2.

## Decisions for the owner

- **D1.** Two duties (**Media**, **Tracking**, where Tracking includes the lights and PTZ it drives), or three (Media,
  Tracking, **Lighting** as its own box)? *Recommended: two. "Tracking mostly / media mostly" is a two-box picture, and
  a third duty can be split out later.*
- **D2.** The two boxes share one project (WO-670's design, never built, would be R5 first). Or each keeps its own
  project, and the tracking box picks the media box's looks from a remote list? *Recommended: build R1–R3 so they work
  on either. Do R5 next as its own WO, since WO-670 answer 2 already asked for a shared project.*
- **D3.** When the other box "imposes" (e.g. the media box pins a person or homes the fronts), does it act exactly
  like a local operator press, with the last press winning? Or can a box lock its duty against remote changes?
  *Recommended: act like a local press, and add a per-box "accept remote" tick on its card (default on).*

## What was done

Nothing yet: investigation and design only.

## What was VERIFIED

The investigation claims above. The lead re-ran the greps for project sync and for role checks in tracking / follow.
