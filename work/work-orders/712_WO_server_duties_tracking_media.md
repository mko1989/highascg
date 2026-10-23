# WO-712 — Server duties: a tracking box and a media box that exchange, react and impose

**Status: OPEN (23.10.26) — investigation + design written; owner answered D1–D3 (23.10, below); R1 (duty gates) DONE 23.10.26 (offline + box: API live after a router-order fix; `auto` + PTZ `allowed` wired by the lead); owner QA pending; R2–R5 open**

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

## Owner answers, 23.10

- **D1:** *"id like it to be more custom from the get go. meaning users pick and choose what each server does by
  configuring it in its devices, but both work on the same project and interact with each other."*
  - So there is **no fixed two/three-duty split**. Each server gets a pick-list of **what this server does**,
    set in **its own Devices view** (device-local, like its cables).
  - A single box ticks everything (today's behaviour). The pick-list:
    - **Playout**: its destinations, by cables, as today.
    - **Detection**: cameras → sidecar.
    - **Zones & automations**.
    - **Auto follow** (the director).
    - **Lighting out**: DMX / PSN.
    - **PTZ out**: VISCA.
    - **Presenter intake**.
  - The R1 gates hang off these ticks, one by one. R2/R3 route each action to the server that ticks the matching item.
  - The servers' Devices views show each linked server's ticks read-only, as they already do for its rear panel.
- **D2:** *Duties first, shared project next.* R1–R4 work without the shared project. R5 (the shared project document,
  the missing WO-670 piece) follows as its own WO. The owner's "both work on the same project" makes it required, not
  optional.
- **D3:** *Like a local press, lockable.* A remote action counts as this server's own operator pressing it, and the
  last press wins. Each server gets an **accept remote** tick (default on).

## What was done

Nothing yet: investigation and design only.

## What was VERIFIED

The investigation claims above. The lead re-ran the greps for project sync and for role checks in tracking / follow.

## R1 — what was done

The pick-list of what THIS server does, and one gate per service on its own tick. Every tick defaults to on, so a
single box behaves exactly as before.

- **`src/cluster/server-duties.js`** (new): `has(name)`, `get()`, `set(patch)`, `onChange(fn)`; `createServerDuties({persistence})` for tests.
  - Names: `detection`, `zones`, `auto`, `lighting`, `ptz`, `presenters`, `accept_remote` (D3, default on).
  - Stored device-local under `serverDuties` in the node persistence file, like `clusterPeers` (never in the project: two servers
    share a project, not their duties). `set` rejects an unknown name or a non-boolean with `.status = 400` and changes nothing.
  - **`playout` is left out of R1**: it has no gate yet, and a tick that does nothing is not shipped (owner's minimalism). It is added when playout gets a gate.
  - Test isolation is `utils/persistence.js`'s own: under `node --test` (`NODE_TEST_CONTEXT`) it writes a scratch file in the OS temp dir, never `.highascg-state.json`.
- **API** (`src/api/routes-server-duties.js`, registered on the cluster line of `router.js:488`; router.js is at the 500-line limit, so no new line):
  - `GET /api/server/duties` → `{detection, zones, auto, lighting, ptz, presenters, accept_remote}` (booleans).
  - `POST /api/server/duties {patch:{lighting:false}}` → the saved object, plus WS `server:duties` with the same object. 400 `{error}` for an unknown name / non-boolean.
  - `GET /api/replication/ping` carries `duties` (`routes-replication-get.js:100`).
  - `cluster-peers.js`: `liveFrom` keeps the peer's `duties` (`:131`), the peer view and `self` carry it, so `/api/cluster` has `peers[].duties` and `self.duties` (`null` from an older server that sends none).
- **Gates**, each with `deps.duties` (same interface as the module) defaulting to this server's own duties, so they are live without wiring:
  - `lighting` — `follow-service.js:97-112`: the engine's `send` is wrapped, so it still computes aims (previs beams, `status()`) but no Art-Net / sACN datagram reaches the socket (counted in `packets_blocked`). PSN is configured `enabled && lighting` (`:140`) and re-configured on the duty change (`:168`). Status and the WS snapshot carry `output_blocked: 'server-duties' | null` (`:188`, `:198`). `follow-engine.js` is untouched.
  - `detection` — `detect-service.js:73`: `wanted()` includes the duty, so the sidecar never starts / is stopped (SIGTERM) on the change event (`onDuty`, `:202`), the lease is dropped. Snapshot / status: `off_by_duties`, and `error` explains why.
  - `zones` — `zone-service.js:22,30`: occupancy is still evaluated and shown; each transition is logged in `recent` with `detail` "not run: zone actions are off for this server" and no action runs. `status().actions_off`; the snapshot gets `actions_off: true` only while off.
  - `presenters` — `presenter-routes.js:26,53,62`: the phone page (`GET .../intake`) and new intake (`POST /api/tracking/presenters`) answer 409 with a plain message; roster GET (`intake_enabled`), operator edit / assign / release stay. `handlePresenters` takes an optional `duties`.
  - `ptz` — `ptz-service.js:29,114`: `createPtzService({allowed})`, default `() => true`; while false `step()` sends nothing and forgets each camera's aim (so it resends on resume); status rows get `blocked_by_server: true`. **The lead wires `allowed: () => duties.has('ptz')` where the service is created.**
  - `auto` — NOT gated here (it lives in `auto-*.js` / `register.js`, which WO-708 is editing). The flag is `require('../cluster/server-duties').has('auto')`; **the lead wires it into the director** (a director that is off should hold, not aim lights / PTZ). Likewise `accept_remote` has no reader until R2.
- **Godot**: `features/devices/server_duties_block.gd` (new, "THIS SERVER DOES": seven tick boxes, top of the SERVERS panel, POSTs the one changed key, follows `server:duties`); `cluster_model.gd` gets `DUTIES` + `does_text()` and `cluster_panel.gd` shows "Does: Detection · Lighting out" read-only on each linked server's card. The word "Roles" is not used (it means backup / extension there).

Why gate inside the services rather than at the sinks: the double-output hazard (two boxes, one patch) is closed whatever the project holds, and the engine / director keep their state, so a box with lighting off still previews.

Known edges: the calibrate session (`calibrate-session.js`) reports `output_enabled` from `engine.isLive`, so while lighting is off it can say "live" for a head nothing is driving. Art-Net / sACN resume within the engine's 1 s refresh after lighting is ticked back on (PSN at once).

## R1 — what was VERIFIED

- `node --test tools/smoke/smoke-wo712-server-duties.test.js`: 12 tests, 12 pass (defaults all on and no playout; set / validate / notify; shared instance writes the scratch file and leaves `.highascg-state.json` untouched; routes + `server:duties` broadcast + 400s; ping `duties`; cluster snapshot `peers[].duties` / `self.duties` / `null`; lighting off → 0 packets while `status()` still aims, back on → sends, PSN configure follows; detection off → no spawn / SIGTERM on tick-off / status text; zones off → no action but occupancy; ptz `allowed` false → 0 sends, true → sends; presenters off → 409 and roster stays; auto flag).
- Existing smokes that pin these files, all still green: wo616-follow-artnet 8, wo700-calibrate 14, wo698-dmx-nic 4, wo695-repatch 4, wo670-cluster 8, wo675-presenters 8, wo616-zones 11, wo665-cutouts 5, wo675-bodies 9, wo616-detect 9, wo711-ptz 25, wo667 7.
- Godot: `run-client.sh --check` boot OK; headless suite 21320 passed, 0 failed (includes `test_does_text_lists_a_linked_servers_ticks` in `test_devices_cluster.gd`).
- eslint clean on every touched JS file; prettier clean on the new files and the two touched files that were already prettier-clean (follow-service, ptz-service); `check-max-file-lines` 0 over; `check-unwired-exports` no new orphan. `npm run test:ci`: 2925 tests, 2922 pass, 1 fail (the known WO-308 pointer-confine test, `smoke-wo308-pointer-confine-split`); the new smoke is not in that curated list yet.
- Not run on the box: no server restart, no GUI relaunch, no packets to a real network (the sender is stubbed; the PSN `configure` is stubbed so no multicast socket opens).

**Owner QA** (after the lead restarts the server and relaunches the GUI; the smoke `smoke-wo712-server-duties.test.js` still needs adding to `tools/ci/run-offline-tests.js`):
1. Devices tab, SERVERS panel: "THIS SERVER DOES" shows seven ticks, all on. Untick Lighting out: `GET /api/server/duties` shows `lighting:false`, the DMX monitor / `tcpdump` on a test universe goes quiet, the previs beams still move, `GET /api/tracking/follow` status shows `output_blocked: "server-duties"`. Tick it back: output resumes within ~1 s.
2. Untick Detection: the sidecar process ends (`pgrep -f tracking-detect/sidecar.py`) and the detection status says it is off for this server.
3. Untick Zones: walking into a zone logs the transition in the zone list but runs no look / Companion press.
4. Untick Presenter intake: the phone page and a new presenter answer "Presenter intake is off on this server".
5. Restart the server: the ticks are kept. With a linked server, its card shows "Does: ..." matching its own Devices view within ~5 s (the next cluster poll).
6. PTZ and Auto: nothing to see until the lead wires `allowed` and the director.

### R1 — lead wiring + live box (23.10.26)
- **Wiring.**
  - `auto` duty: register.js pinTick passes `fixtures: []` to the director when it is off, so there is no Auto pool,
    the lanes leave the hub, and the heads hold.
  - `ptz` duty: `autoPtz.boot(ctx, { allowed: () => duties.has('ptz') })`.
  - smoke-wo707's wiring pin was repointed to the new line.
- **Bug found on the box.** `GET /api/server/duties` answered 404. The router matches in registration order, and
  Caspar's `routes.get('/api/server/*')` (router.js:452) came before the duties routes, which were registered at :488.
  - Fix: register the duties routes on the line ahead of `/api/server`. router.js stays at 500 lines.
  - smoke-wo712 now asserts that order; the lead checked that the assertion fails on the old router.
  - After the restart: `/api/server/duties` → all seven true, `/api/server` (Caspar state) still answers, and
    `/api/cluster` `self.duties` is present.
- **Owner QA.**
  - Devices → SERVERS → "THIS SERVER DOES": untick **Lighting out**, and the DMX viewer / node shows no Art-Net from
    this box while the previs beams still move. Tick it back on.
  - The panel layout (2 columns) has not been looked at on screen.
