# WO-723 — Server duties come from config; "which server sends" is a choice only where it matters

**Area:** network
**Status: DONE (24.10.26 — offline suite + Godot units + a live two-box test: sandbox ↔ .4; owner QA on two boxes that both run this code)**

Owner, 24.10 (about WO-712 R1's "THIS SERVER DOES" ticks):
*"There is a new this server does this tick boxes which doesn't make sense. I meant that it is configured in the
devices which server displays a screen destination and plays media for it and which server gets cameras and has
setup tracking is set by user in various settings. It doesn't need to be a tick box. It gets resolved in config. But
when devices are connected there should be a choice for instance in tracking and artnet server which server should
send, receive etc."* — and: *"there is a second server on .4 you can run tests for connecting servers"*.

This supersedes **WO-712 R1's pick-list** (the stored ticks and the Devices block). WO-712 R2–R4 (signed calls, the
exchange, air rules) stay: they read `duties.has()` / the peers' ping `duties`, and those are now resolved, not ticked.

## Investigation

### What R1 built (and what decides each duty today)
- `src/cluster/server-duties.js`: seven stored booleans under `serverDuties` in the node persistence file, all default
  on: `detection zones auto lighting ptz presenters accept_remote`. Set through `POST /api/server/duties`, shown as
  seven ticks in `godot/client/features/devices/server_duties_block.gd` ("THIS SERVER DOES"), and read-only as
  "Does: …" on linked cards (`cluster_model.gd` `does_text`).
- Gates (each consumer calls `has(name)`; none of them changes in this WO):
  - `detect-service.js:73` `wanted = () => !stopped && dutyOn() && det.enabled && cams.length > 0` — **the config
    part already decides**: detection runs only where the project has detection on and cameras with a surface role.
  - `zone-service.js` (zones fire), `presenter-routes.js` (intake), `register.js` / `auto-routes.js` (the director's
    fixtures, the `OFF` answer), `follow-service.js:97-140` (DMX / sACN / PSN on the wire), `autoPtz.boot({allowed})`
    (VISCA).
  - `cluster-exchange.js` (R3a/R3b) routes by duties: `tracking.auto` goes to online peers whose ping says
    `auto: false`; `air` goes from a server without `zones` to peers with it.
- **Media / playout** never had a tick: which server shows a destination is the WO-670 cables in Devices (a linked
  server's output cabled to the destination = backup / extension; the master forwards takes only where cabled).
  That is exactly the owner's "configured in the devices".

### Where the senders / receivers are configured
- **Lighting out** (follow engine): `project.fixtures.output` `{protocol: psn | artnet, psn, through}` — edited in
  Tracking → Follow (`follow_output.gd`). Art-Net / sACN to the heads, PSN to a console, and with `through` the box
  also *receives* the console's universes (`follow-through.js`). One server should do all of it.
- **PTZ out** (VISCA, WO-711): Tracking → PTZ (`ptz_section.gd`), driven by the Auto director.
- **Lighting input** (Art-Net / sACN from a desk → screen borders, WO-601/446): `config.dmx.artnetInput*`
  (device-local) + the border slot's `artnetListenEnabled`; UI Live → global border → "Lighting input"
  (`border_artnet_section.gd`). A server applies it to the screens IT shows, so by default every server listens.
- None of these knows about linked servers. Two linked boxes holding the same patch with output on both transmit
  the same universes (the WO-712 hazard; R1's answer was "untick one").

### Identity across two servers
- A peer's `id` is its hostname as seen by the linker (`cluster-peers.js` `add`), so "server X" chosen on box A has
  no meaning on box B. The device-key **fingerprint** (`cluster-media.js` `fingerprint`, also in
  `GET /api/cluster/identity`) is the same on both ends: A has B's key from linking, B has its own.
- Live: this box `fingerprint` ≠ .4's (`/api/cluster/identity` on both, 24.10), so the cloned-install guard (409)
  does not trip although .4 was installed from an `eggs --clone` ISO of this box.

### The second server (.4)
- `192.168.0.4:4200` = `highascg5867`, standalone, ping already carries `duties` (all on) → it runs the 23.10 ISO
  build (WO-712 R1–R4). Not a Syncthing peer, SSH refused (publickey) → it cannot get new code from here; a two-box
  test is **mixed-version** (this code ↔ its 23.10 code).
- Linking the LIVE :4200 server is not an option: master election could make it a follower, which skips its own PGM
  takes (`routes-scene-take.js:216`). The two-box test uses a sandbox server (`HIGHASCG_SANDBOX=1`) on this box.
- **Found: the sandbox signs with the live box's device key.** `device-identity.js:8` hard-codes
  `config/device-identity.json` (no env override, no sandbox guard). A sandbox linked to .4 would be recorded there
  under the live box's key, and a sandbox started where the file is missing would write it into the repo `config/`.

## Design

**Duties are resolved, not stored.** `server-duties.js` keeps its API (`has / get / onChange`) and computes:

| duty | resolved from |
|---|---|
| `tracking` (new) | this server's project has detection on and ≥ 1 camera (the detect service's own config check) |
| `detection` | = `tracking` (kept for older peers' cards; no gate reads it any more — `wanted()` is config) |
| `zones` · `auto` · `presenters` | `tracking` here, or no online linked server is doing tracking |
| `lighting` · `ptz` · `artnet_in` | the **sender choice** below |
| `accept_remote` | stays a stored device-local setting (WO-712 D3 "lockable"); one tick on the Servers section |

A standalone box (no linked servers, or the cluster service never started) resolves everything to on: today's
behaviour.

**The sender choice** — `lighting` (DMX / PSN out + read-through), `ptz` (VISCA), `artnet_in` (lighting input):
- Stored device-local as `clusterSenders: {kind: {by: '' | fingerprint, at: ms}}`; `''` = Auto.
- `by` = this server's fingerprint → here. `by` = a linked server's → not here (even while it is offline: an
  explicit choice never silently doubles). Unknown fingerprint → Auto.
- Auto: `artnet_in` → every server. `lighting` / `ptz` → among this server + the online linked ones: the one doing
  tracking; with none or several, the master; with no master online, the lowest fingerprint. Both servers compute
  the same answer from the same pings.
- **Kept in agreement:** a change is pushed to every online linked server as a signed info call
  (`cluster.senders`, the WO-712 R2 transport); the receiver keeps, per kind, whichever entry is newer (`at`). A
  server that comes online is sent the current set. An older server answers 400 (unknown action) and is reported.
- **Shown only when servers are linked:** a "Sent by" / "Received by" picker in Tracking → Follow output, Tracking →
  PTZ and Live → Lighting input. Items: "Auto — <who>", then each server. Nothing appears on a single box.
- The R1 block is removed. Linked cards keep one read-only line, now resolved ("Does: tracking · lights · PTZ").

**API.** `GET /api/server/duties` → the resolved booleans (unchanged shape + `tracking`, `artnet_in`).
`POST /api/server/duties` accepts only `accept_remote` (anything else: 400 "resolved from config").
`GET /api/server/senders` → `{senders: {kind: {by, at, here, who}}, servers: [{fp, name, self, online}]}`;
`POST /api/server/senders {kind, by}`; WS `server:senders` on every change.

**Sandbox fix.** `HIGHASCG_DEVICE_IDENTITY_PATH` overrides the identity file; `tools/e2e/sandbox-server.js` points it
into the sandbox root.

## What was done

**Server**
- `src/cluster/server-senders.js` (new): `normalize`, `resolve(kind, entry, view)`, `createSenders` (stored
  `clusterSenders`, `set` validates kind + fingerprint and keeps `at` monotonic, `merge` = newer `at` wins per kind),
  `createSendersSync` (push after each poll to online peers that have not taken the current set).
- `src/cluster/server-duties.js` rewritten: the duties are computed (table above), cached ≤ `REFRESH_MS` (1 s,
  `has()` sits in the DMX send path), `refresh()` notifies only on a real change and runs at construction so the
  first `provide()` that changes the answer notifies. `set()` takes only `accept_remote`; any duty name → 400.
  `provide({tracking, cluster})` plugs in the detect service and the cluster service.
- `src/tracking/detect-service.js`: the duty gate is gone; `wanted()` (detection on + ≥ 1 camera) is provided as
  `tracking`, and `refresh()` runs after each apply / stop.
- `src/artnet/dmx-border-receiver-base.js`: the lighting input also needs `has('artnet_in')`.
- `src/api/routes-server-duties.js`: `GET/POST /api/server/duties` (accept_remote only), `GET/POST
  /api/server/senders`; WS `server:duties` / `server:senders` (deduped).
- `src/api/routes-cluster.js`: `dutiesView(ctx)` (peers with fingerprint, online, ping duties, refusal), the sync
  runs after each poll, and `cluster.senders` joins the signed info actions. `cluster-peers.js` `view()` carries `fp`.
- Messages in zone-service / presenter-routes / register / follow-service / air-rules now say "a linked server does
  tracking" instead of pointing at a tick.
- **Sandbox fix:** `device-identity.js` honours `HIGHASCG_DEVICE_IDENTITY_PATH`; `tools/e2e/sandbox-server.js` points
  it into the sandbox root, so a sandbox signs with its own key.

**Client (Godot)**
- `server_duties_block.gd` deleted. The Servers master row gets the one stored setting as a checkbox, "Linked
  servers may press here" (`accept_remote`).
- `features/devices/sender_picker.gd` (new): "Sent by" / "Received by" OptionButton, hidden unless ≥ 2 servers;
  items "Auto — <who>" then each server, "(not in sync)" with the reason as tooltip for a server that refused the
  choice. Placed in Tracking → Follow output (lighting), Tracking → PTZ (ptz), Live → Lighting input (artnet_in; it
  survives the border section's rebuilds).
- `cluster_model.gd`: `DOES` (tracking / lights out / PTZ out) for the linked card's read-only line, and
  `sender_items / sender_of / sender_index` for the picker.

**Why this shape:** a stored duty is a second source of truth beside the config that already decides it (cameras,
cables), which is what the owner objected to. The only thing config cannot decide is *which of two capable boxes
transmits*, so that alone is a choice, placed next to the setting it affects and invisible on a single box. The
fingerprint, not the peer id, names a server because it is the same string on both ends.

**Found on the two-box test and fixed:** the sync treated a 4xx as final. The first push to .4 got 403 "not linked
here" because .4 had not linked back yet, and it was never retried. A refusal is now retried every 60 s
(`REFUSED_RETRY_MS`), no answer at the next poll, a change or a server coming online at once (smoke added).

**Mixed versions:** a server on older code (like .4's 23.10 ISO) answers `unknown action "cluster.senders"`. It keeps
its own R1 ticks and does not follow the choice; the picker shows it as "(not in sync)" with that reason.

## What was VERIFIED

**Offline**
- `xvfb-run -a npm run test:ci`: 3081 tests, 3079 pass, 0 fail, 2 skipped (CI-only skips).
  `smoke-wo723-duties-from-config` 14/14 (resolution table, Auto ordering, offline chosen peer, merge by `at`,
  4xx retry cadence, routes 400s, identity override, block removed); wo712 smokes repointed to the resolved duties.
- Godot units (`tests/run_tests.gd`): 21473 passed, 0 failed (new `does_text` + `sender_items` cases).
- lint 0 errors, `check-max-file-lines` 0 over 500, API contract docs regenerated.
- GitHub CI green on `3a29bdf1` (verify + build-client + godot). Two pushes before it were red on gates `test:ci`
  does not run: `check-require-integrity` (the identity smoke's child `-e` string read as a relative require → now an
  absolute path) and `check-unwired-exports` (`validatePatch` / `SETTABLE` exported but unused → dropped).

**Live two-box (sandbox `HIGHASCG_SANDBOX=1` on 192.168.0.23:4290 ↔ .4 `highascg5867`; the live :4200 never linked)**
- Fingerprints: sandbox `ef4808054f790cce` (its own key, not the live box's `87f0da5337ca6e2d`), .4 `1166d54ccd133944`.
- Sandbox linked .4 and .4 linked back. Auto resolved lighting / ptz to .4 (no tracking, no master → lowest
  fingerprint) and artnet_in to every server, as designed.
- The signed `cluster.senders` reached .4, its signature was accepted, and it was refused with `unknown action`
  (old code). Logged once, shown as refused. Before the retry fix the first push hit 403 and stopped (bug above).
- Choosing the sandbox → `lighting` here; choosing .4 → not here; an unknown fingerprint → 400; POST of a resolved
  duty → 400 "resolved from this server's config".
- Real Godot client against the sandbox (temporary e2e scenario, 2/2, deleted afterwards): Devices shows no "THIS
  SERVER DOES" block and has the "Linked servers may press here" tick; Follow output shows "Sent by:
  highascg5867 (not in sync)" and PTZ "Sent by: Auto — highascg5867".
- Cleanup: .4 unlinked (`DELETE /api/cluster/peers/highascg7580` → peers `[]`, standalone), sandbox stopped, live
  server PID unchanged throughout.

**Owner QA (not provable here):** with two boxes that both run this code, pick "Sent by" in Tracking → Follow on one
and see it on the other; only the chosen box transmits DMX. .4 needs the new code (an ISO or a sync) for that.
