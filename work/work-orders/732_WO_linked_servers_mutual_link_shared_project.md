# WO-732 — Linked servers that work as one: mutual link, one shared project, cable the other server from here

**Area:** network
**Status: DONE (24.10.26; P2 moved to WO-746) — P1 (mutual link) DONE 24.10.26 (offline + live on this box ↔ .4: the half link found live repaired itself, unlink / link round trip from .4); P3a (Devices shows this machine) DONE 24.10.26 (Godot tests + live: this box's kiosk unchanged, a client following .4 showed this machine on top); P3b (edit any linked server from here) DONE 24.10.26 (Godot tests + live Edit / Back on .4 from a client following .4); P2 (shared project) → [WO-746](./746_WO_shared_project_across_linked_servers.md): it replaces the show on both boxes, so the owner says when.**

Owner, 24.10: *"i cant establish a meaningful connection between servers and connect screen destinations etc. my
thinking is that when connected they both show up in each other's devices and can have connections made etc."*

## Investigation

Live state when the owner asked (this box highascg7580 192.168.0.23 ↔ .4 highascg5867 192.168.0.4):
- This box lists .4 as linked and online, and is master (epoch 1). **.4 lists no linked server at all**
  (`GET /api/cluster` on .4: `peers: []`, master epoch 0).
- After the WO-725 live run at 16:42 both boxes were cleanly unlinked (.4 journal: `no linked servers left`). The
  owner then linked .4 from this box's Devices at 17:04. This box's journal shows the link was half made:
  - `senders → highascg5867: not linked here: link this server on the receiving server too`;
  - `highascg5867: claim not taken (signed by a server not linked here)`.

Three gaps between what the owner expects and what WO-670 / WO-712 built:

**1. A link is one-sided.** `cluster-peers.js add()` stores the peer only on the server where the operator clicked.
Nothing tells the other server. Everything that changes something on a peer trusts **only servers in the receiver's
own list**:
- signed calls (`cluster-call.js handle`: `not linked here: link this server on the receiving server too`);
- master claims (`cluster-master.js`, `claim not taken (signed by a server not linked here)`);
- Send media (`cluster-media.js`, "trust = both linked", WO-670 P2b).

So one click gives a link that shows on one side and does nothing useful. WO-670 answer 2 ("each server keeps its
own peer list for safe keeping") was implemented as "each server links by itself". The owner's picture is one link
that both servers show.

**2. Destinations do not match across servers.** Cables reference destinations by id. Each box has its own project,
so the "same" destination has different ids: `dst_mvi3swp8_1` here, `dst_mvm43woy_1` on .4 (WO-724). Fan-out
(`cluster-fanout.js`) matches by destination id, so **two separately made projects can never forward a take**. The
shared project is in WO-670's design ("the project document … carried by revision") and in WO-712 as R5. The owner
already ruled it required (WO-712 D2: "both work on the same project"). It was never built.

What exists to build it on (the hot-backup pair, WO-54/64):
- `config-classify.js`: `screenDestinations` is show data; `deviceGraph` (the cables), `casparServer`, `osDisplay`,
  GPU topology are device-local. `stripDeviceLocalFromProject` + `mergeSharedProjectIntoLocal` keep each box's own
  hardware slices.
- `replicate-projects.js`: `pushProjectToPeer` / `receiveProjectFromPeer` / `commitReplicatedProject`.
  - Activation writes the project and applies `screenDestinations`.
  - Caspar is regenerated only when the active slug changes.
  - These are tied to `replication.enabled` + `pairId` (a single peer), not to the cluster.

**3. The other server's rear panel is read-only.** WO-670 P2a: `cluster_panel.gd` builds the peer's rear panel from
its `/api/device-view` and freezes it (buttons hidden, input off). To cable .4 the operator has to run a client
against .4. The server has no "change that server's cables" call: `/api/cluster/peers/:id/device-view` is GET only,
and the signed-call allow-list (`cluster-call-actions.js`) has no device-view action.

**Trust for a link-back.** Both boxes run `enforceAuth: false` (`config/security.json`). There, `POST
/api/cluster/peers` is already open to anyone on the LAN, so a server asking the other to link it back gains nothing
an outsider couldn't do. When a box enforces auth, the plain route answers 401 and the link stays one-way. That must
show on the card, not stay silent.

**Mixed versions.** .4 runs 4c267126 plus its own config (WO-724 drop-update; no git checkout, ISO `BUILD_STAMP`
2026-10-23). Its `add()` ignores unknown body fields. Every new field has to degrade to today's behaviour against
an older server.

## Plan

- **P1 — one link, both sides.**
  - Linking a server makes it link this one back. Unlinking unlinks both.
  - A half link found on a poll (the peer's ping lists who it is linked with) is repaired.
  - A link-back that is refused shows on the card.
  - An unlink that could not reach the other server leaves a tombstone, so that server's repair attempt drops its
    side instead of re-linking.
- **P2 — one shared project (WO-712 R5).** The master pushes the show (stripped of device-local slices) to every
  linked server over the signed channel, by revision with epoch fencing. Each server keeps its own cables and Caspar
  wiring. Destinations then have the same ids everywhere.
- **P3 — cable the other server from this client.** The peer's rear panel in Devices becomes editable. Cable edits
  go to that server through a signed call and land in its own device graph (still device-local).

## P1 — what was done (24.10)

`src/cluster/cluster-peers.js`:
- **Link-back.** An operator link (`add` without `link_back: false`) asks that server to link this one back:
  `POST /api/cluster/peers { address: <this box's address on the route to it>:<httpPort>, link_back: false }`.
  - The address comes from the socket's local address (`localAddressTo`), not from a guessed interface. That's the
    address the other server can actually reach. The port is `config.server.httpPort`.
  - An older server ignores `link_back` and simply links. It has no link-back code, so nothing loops.
  - The answer is `link_back: { ok, error }`. A 401/403 says "it needs sign-in: link this server there".
- **The ping lists who a server is linked with** (`clusterLinked`: device-key fingerprints, `linkedFingerprints`).
  The peer view gains `linked_back` (true / false / null = unknown or older) and `link_back_error`.
- **Repair (`heal`, after every poll).** A peer that is online and doesn't list this server is asked again, at most
  every `HEAL_MS` (60 s). An older server (no `clusterLinked`) is asked once per server start.
- **Mutual unlink (`unlink`).** `DELETE /api/cluster/peers/<this server's id>?link_back=0` goes to the other server.
  The id is the same `idFromPing` rule `add` uses there.
- **Tombstones (`clusterUnlinked`, device-local persistence).**
  - On every unlink: 2 × HEAL_MS, so a repair racing the DELETE is refused rather than taken.
  - 30 days when the other server didn't confirm (offline). Its repair is then answered 409 `unlinked`, and it drops
    its own side.
  - An operator link of that server clears its tombstone.
  - A repair never drops a link its own operator made within 2 × HEAL_MS (that operator's link stays, and is repaired
    once the guard runs out).

Wiring:
- `src/api/routes-cluster.js`: `selfPort` + `log` into the cluster; DELETE goes through `unlink`, honouring
  `?link_back=0`. Contract comment updated.
- `src/api/routes-replication-get.js`: ping field `clusterLinked`.

Godot (`cluster_model.gd` `link_line`, `cluster_panel.gd`): an orange line on the server's card, "One-way: B does not
list this server (reason)". Also, the Send media tooltip no longer tells the operator to link both servers.

Tests:
- `tools/smoke/smoke-wo732-mutual-link.test.js` (new, in FILES), 9 tests. Two or three real cluster instances on an
  in-memory LAN routed like the HTTP routes: link both, unlink both, half-link repair + rate limit, a missed unlink
  dropped via tombstone then cleared by an operator link, the race guard + operator-link guard, sign-in refusal shown,
  an older server asked once, three servers, wiring pins.
- `smoke-wo670-cluster.test.js`: the stored-peer pin now includes `linked_at`. The test stubs `localAddress` (it had
  started probing 10.0.0.6 for real).
- `tools/e2e/cluster-scenario.js` (WO-725) now tests the new contract:
  - link each pair **once** and require `link_back.ok`;
  - unlink each pair **once** and require both sides empty.
  The old "link both ways" loop would now be a re-link, and the old unlink loop a 404.

Why the plain `POST /api/cluster/peers` and not a new signed endpoint: the receiver can't verify a key it doesn't
trust yet. With `enforceAuth` off that route is already open, so no trust is added. With it on, the link-back fails
**visibly** (one-way line) rather than silently trusting any key on the LAN.

## P1 — what was VERIFIED

- WO-732 smoke 9/9. Mutation check: without the repair in `poll` 3 tests fail; without the race tombstone 1 fails.
- WO-725 3-sandbox smoke 14/14: real HTTP, real `localAddressTo` + `httpPort`, link once / unlink once.
- Cluster smokes (WO-670 ×4, WO-712, WO-723) 95/95 after the pin update.
- Godot 21492/0 (+5 `test_link_line_only_when_one_way`), `--check` boot OK.
- Clean export: `test:ci` 3170 tests, 3166 pass, 3 skipped, 1 fail (WO-498, export-only). Lint 214 warnings,
  max-lines, unwired-exports, repo-integrity, boot, contract unchanged.

Live, this box (192.168.0.23) ↔ .4 (192.168.0.4):
- **This box restarted on e4c07993 with .4 still on 4c267126 (older: no `clusterLinked`).**
  - The repair asked .4 once. Journal `[cluster] highascg5867 did not list this server: linked back` at 18:26:03,
    3 s after start.
  - .4 then listed `highascg7580 @ 192.168.0.23`, online, and **followed the master** (`master highascg7580 epoch 1,
    follows: true`).
  - Signed calls now travel: `POST /api/cluster/send look.take` → .4 answers 404 "look … not found", the action's own
    answer. Before: 403 "not linked here".
- **.4 put on e4c07993** the WO-724 way:
  - `git archive` → `rsync -ac` with `config/server-update-rsync-excludes.txt` + `/config/`, `/dist-web/`,
    `template/shaders/sh-test.html` excluded. 45 files (26 new incl. WO-730/731, 19 changed).
  - Replaced files are kept in `~/highascg-pre-update-<ts>/` on .4; `.updated-from` names the commit.
    `package.json` is identical, so no npm install.
  - Up in 7 s. Both sides `linked_back: true`; .4's ping `clusterLinked: ['87f0da5337ca6e2d']` (this box).
- **Round trip from .4's side:**
  - `DELETE` on .4 → 200 in 13 ms, `link_back ok`, both lists empty, master epoch 0 on both.
  - `POST` link on .4 → `link_back ok`, both list each other, `linked_back: true` on both.
  - Master put back as it was (`master/set self, auto`): this box epoch 1, .4 follows.
- .4's kiosk still runs its old Godot client. The one-way line shows once it restarts. The client restarts itself
  when its server restarts (connection_menu.gd); not checked on .4's screen.

## P3a — Devices shows this machine first (24.10)

Owner, 24.10: *"on the second / follower server the master is on top and that server is at the bottom, kind of weird,
always the local machine should be at the top."*

### Investigation

- Screenshot of .4's screen: its kiosk is connected to **this box** (`This server: highascg7580` in Devices →
  Servers). This is WO-670 P3b by design: the client follows the master (owner answer 1, 22.10: the client connects
  to one main server). So the top of Devices (destinations, rear panel, cables) is the master's. .4 is one of the
  master's linked servers, shown read-only under it.
- The Devices tab only ever talks to the connected server:
  - ~60 `Api.` calls across 17 files in `features/devices/`;
  - ~50 `Settings.` uses (the `settings_state.gd` autoload: casparServer, screenDestinations, streaming), with 21
    `load_from_server` calls;
  - `Store.get_value` for `channelMap`, `configComparison`, `templates`, `hostOperatorFullscreen`;
  - WS events `cluster:peers`, `gpu_topology_changed`, `log_line`.
  So a client that follows another server cannot show or edit its own machine at all.
- The client already knows its own machine: `Config.home_origin()` (WO-726; the profile origin without the
  followed master, `http://127.0.0.1:4200` on a box).
- A laptop's default profile is also `127.0.0.1:4200`, with no server behind it. "Home is local" alone is not
  enough: the home must answer as HighAsCG.
- `/api/state` carries `channelMap`, `configComparison`, `templates` and `hostOperatorFullscreen` in one answer.
- The project uses no `class_name`: there is no editor class cache, and a new class name fails to parse. Types go
  through preloaded scripts.

### What was done

- `core/devices_target.gd` (new autoload `DevicesTarget`):
  - Decides once at start whose devices the tab works on. It is the home server when this client runs on a box
    with its own server (local origin, `/api/replication/ping` answers `appId: highascg`) and is connected to
    another server. Otherwise it is the connected server.
  - `api`: the global `Api` when it is the connected server. When it is the home server, its own ApiClient with the
    home origin. Requests made before the decision wait (`held`), so nothing lands on the wrong server.
  - `settings`: the global `Settings`, or its own `settings_state.gd` copy that reads and saves through that client.
  - `value(key)` (the Store keys above) and `refresh_state()` (one `/api/state` from home before each Devices load).
  - `origin()`: host-live webpage URLs are built from it.
  - Pure rule in `core/devices_target_model.gd` `pick` (tests run without autoloads).
- `core/api.gd`: `origin_override`, `held` / `open()`, `base()`. `core/settings_state.gd`: an injectable `api`.
- `features/devices/*`: every `Api.` → `DevicesTarget.api.`, `Settings.` → `DevicesTarget.settings.`, the four Store
  keys → `DevicesTarget.value`, `Config.origin` → `DevicesTarget.origin()`.
  - The sender picker keeps the global `Api`: sender choices are the same on every linked server
    (`cluster.senders`), and Previs uses it too.
- `cluster_panel.gd`: with a home target, the followed server's `cluster:peers` push is ignored (that is its view,
  not this machine's), and `/api/cluster` is polled every 3 s instead.
- `devices_tab.gd`: `refresh()` awaits `DevicesTarget.refresh_state()` first.
- `features/settings/network_pane.gd`: an injectable `api`. The Devices server page passes the target.

Why not reorder the cards only: the local machine on top but read-only, with the master's panel editable under it,
would be the same confusion upside down. Why not stop kiosks following the master: owner answer 1 (one main server),
and before P2 the kiosk would run a different project.

For this box's own kiosk (home = connected) nothing changes: the target is the global `Api` / `Settings` / `Store`,
the very objects used before.

### What was VERIFIED

- Godot 21498 passed, 0 failed, including `test_devices_target.gd`:
  - the `pick` rule: following from a server box → home; connected home, no server at home, a home that is not this
    machine → the connected server;
  - a source pin: no direct `Api.` / `Settings.` left in `features/devices` except the sender picker. Mutation: one
    `Api.` put back in `snapshot_dialogs.gd` → the pin fails.
- `--check` boot OK. Smokes that read Devices files (WO-623, WO-716, WO-723): 25/25.
- **Live, this box** (kiosk restarted, home = connected): Devices exactly as before: its own panel and cable on top,
  `This server: highascg7580`, .4 listed below. Journal line `[devices] …` absent, as it should be.
- **Live, the follower case:** a second client on this box under Xvfb, with its own user dir, set to follow .4
  (ui.cfg `[cluster] origin = http://192.168.0.4:4200`, follow off so it stays there).
  - Log: `[devices] this client follows http://192.168.0.4:4200: the Devices tab works on this machine
    (http://127.0.0.1:4200)`.
  - The client ran .4's project (`New project 1`, .4's media folders), yet Devices showed **this machine** on top
    (`This server: highascg7580`, its rear panel and Operator GUI cable, editable) with .4 under it. That is the
    mirror of .4's kiosk.
- **.4** got b16d368f (WO-724 drop update), and its kiosk was restarted. Log: `[devices] this client follows
  http://192.168.0.23:4200: the Devices tab works on this machine`.
  - The screen was not clicked: .4 was in the middle of the owner's `do-release-upgrade` to 26.04 in an xterm on
    that display.
  - Seeing it there = owner QA, or the next session once the upgrade is done.
- Not done: other servers' cards stay read-only (P3b: edit any linked server from here).

## P3b — edit any linked server from here (24.10)

### Investigation

- Each server's Devices data (`/api/device-view`, `/api/device-graph`, cables, destinations, Apply) is the ordinary
  HTTP API on port 4200. The same calls a client connected to that server makes work from here, so no new server
  route and no signed call are needed. The plan's "signed call" (P3) would have duplicated every Devices route.
- WO-732 P3a already sends every Devices request through `DevicesTarget.api` / `settings` / `value()`. Pointing those at
  another server points the whole tab at it.
- Pointing **all** of `DevicesTarget` at the peer would be wrong. It also serves box-local features that must stay on
  this machine:
  - `updates_pane.gd` (an install would go to the peer);
  - `operator_dock.gd` / `operator_dock_menu.gd` (the dock window lives on this box's X);
  - `boot_question.gd` (start-up question);
  - `shell.gd:120` (dock wanted);
  - `shell.gd:214` (cluster invite check).
- A pending cable gesture (selected edge, undo, restart flag) belongs to the server it was drawn on. Kept across a
  switch, an undo would land on the other server.

### What was done

- `core/devices_target.gd`:
  - `box_api` / `box_origin()` = the old `api` / `origin()` (this machine). `api`, `settings`, `value()` and `origin()`
    return the edited server's while `editing != ""`.
  - `edit_peer(origin, name)`:
    - probes `/api/replication/ping` (appId `highascg`), so a peer this client cannot reach says so on the card and
      nothing switches;
    - then creates its own ApiClient and Settings copy, prints `[devices] editing …` and emits `target_changed`.
  - `stop_editing()` frees them and emits `target_changed`.
  - `polled()`: the edited server's WS does not reach this client, so its views are polled (as P3a's remote case).
- `core/devices_target_model.gd`: `peer_origin(peer)` → `http://host:port` from a cluster peer (default 4200, IPv6
  bracketed, "" for an empty or malformed host).
- Box-local files repointed to `box_api` / `box_origin()`: the 4 files above and `shell.gd` lines 120 and 214.
- `features/devices/cluster_panel.gd`:
  - an **Edit** button on each online peer card with a known origin;
  - the self label reads `Editing: <name>` while editing;
  - a **◀ Back to this machine (now editing X)** button;
  - reloads on `target_changed`.
- `features/devices/devices_tab.gd`: on `target_changed`, `_gesture.forget()` then `refresh()`.
  `cable_gesture.gd` `forget()` drops the selection, the undo and the restart flag.

### What was VERIFIED

- Godot 21632 passed, 0 failed. `test_devices_target.gd`:
  - `test_edit_linked_server`: `peer_origin` rules; `api` / `origin()` follow `editing`, `box_api` / `box_origin()` do
    not; Back restores.
  - A source pin: the box-local files contain neither `DevicesTarget.api` nor `DevicesTarget.origin()`. Mutation:
    `updates_pane.gd` back to `DevicesTarget.api` → the pin fails (restored).
- `--check` boot OK.
- **Live:** a second client on this box under Xvfb (`:377`, own user dir), following .4. This is the hardest case: the
  connected server, this machine and the edited server are three different targets.
  - Devices tab: this machine on top (`This server: highascg7580`, Operator GUI → DP-5), .4's card with **Edit**.
  - **Edit** → log `[devices] editing highascg5867 (http://192.168.0.4:4200)`. The tab showed .4's rear panel and
    cable (Operator GUI → HDMI-0), `Editing: highascg5867 · 2026-10-24T195734Z` and the Back button. Its server list
    showed this box (`highascg7580`) with its own Edit.
  - **Back** → this machine again (DP-5 cable, `This server: highascg7580`).
  - No SCRIPT ERROR in the log.
  - No cable was changed on .4 (its show is live), so a cable drawn while editing is owner QA. It uses the same calls
    as a client connected to .4.
- Not done: **P2 (one shared project pushed to every linked server)**, now [WO-746](./746_WO_shared_project_across_linked_servers.md). It would replace the show on the live box and
  on .4, so the owner decides whether and when. Until then destinations still differ per server, but each one can now
  be cabled from any client.
