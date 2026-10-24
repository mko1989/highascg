# WO-732 — Linked servers that work as one: mutual link, one shared project, cable the other server from here

**Status: IN PROGRESS — investigation written (24.10.26); P1 (mutual link) done offline, live check on both boxes next; P2, P3 open.**

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

## P1 — what was VERIFIED (offline)

- WO-732 smoke 9/9. Mutation check: without the repair in `poll` 3 tests fail; without the race tombstone 1 fails.
- WO-725 3-sandbox smoke 14/14: real HTTP, real `localAddressTo` + `httpPort`, link once / unlink once.
- Cluster smokes (WO-670 ×4, WO-712, WO-723) 95/95 after the pin update.
- Godot 21492/0 (+5 `test_link_line_only_when_one_way`), `--check` boot OK.
- Clean export: `test:ci` 3170 tests, 3166 pass, 3 skipped, 1 fail (WO-498, export-only). Lint 214 warnings,
  max-lines, unwired-exports, repo-integrity, boot, contract unchanged.
