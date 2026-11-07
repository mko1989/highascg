# WO-979 — Linked-servers role-split test environment: media playout ↔ camera tracking / previs

**Area:** testing-ci, network, tracking-vr
**Status: DONE (07.11.2026; sandbox leg 15/0/0; live two-box leg with the imitated camera (detection.simulate) on highascg5867: 12 pass / 0 fail / 3 sandbox-only skips; WO-725 general scenario live 9/0)**

The owner asked on 06.11: *"i also want you to create a test enviroment to check server linking in a way where one
is responsible for media playout the other is responisible for camera tracking and previs etc."*

## Investigation

**What decides who does what. Nothing new is needed; this is all WO-723 / WO-712.**
- `src/cluster/server-duties.js`:
  - `tracking` is true when detect-service `wanted()` holds: detection is enabled and there is at least one camera
    (header lines 9–12).
  - `zones`, `auto` and `presenters` follow: they are on when this box tracks, or when no online peer tracks.
  - `lighting`, `ptz` and `artnet_in` come from the sender choice in `server-senders.js` `resolve`. Under Auto this
    is the single tracker.
  - `accept_remote` is the only stored setting (line 28 `SETTABLE`).
- So the role split is a property of the **shows**:
  - the media show has no detection and no camera;
  - the tracking show has detection and a camera.
- The test environment has to give each server the right show. It does not set any flag.

**The exchange** (`src/cluster/cluster-exchange.js`):
- Topic `tracking.auto` goes from the server with the auto duty to peers without it. It arrives as WS
  `tracking:auto` with `source`.
- Topic `air` goes from a server without zones to peers with zones. It arrives as WS `cluster:air` and calls
  `zoneService.onAir('peer:<id>')`.
- Heartbeat is 5 s and expiry is 15 s (lines 24–25).
- R4 air rules (`src/tracking/air-rules.js:70`):
  - a source's first update only seeds;
  - an empty program deletes the key from `on_air.now`;
  - so the seed can only be observed through `GET /api/cluster/exchange` → `air.source`.

**What a sandbox can and can't do.**
- `tools/e2e/sandbox-server.js` already gives node-only servers: `--no-caspar`, their own root, HOME, keys and
  ports.
- What was missing was a tracking server **with a camera**:
  - detect-service spawns `HIGHASCG_TRACKING_PYTHON -u sidecar.py` over JSON lines;
  - it only checks that the model file exists in `HIGHASCG_TRACKING_MODELS`.
  - So a fake sidecar process can stand in for camera, venv and model with no change to production code.
- The simulated Caspar doesn't write `data/amcp-last50.txt`. It logs `[AMCP SIM] Executing: <cmd>` to stdout
  (`src/caspar/amcp-simulated.js:232`), so a take is proven from `server.log`.
- A project load must use `broadcastProject: true`. Without it, the follow, detect and zone services stay on the
  old project and the duties never change. This is noted, not changed.

**Bug found (RULES "Linked servers" 4: unlink restores local-only state at once).**
- After an unlink, the media server kept showing the tracking server's people and air state for **16.8 s**
  (measured, run3). That is the 15 s exchange expiry plus one tick.
- Cause: `removed()` in `src/api/routes-cluster.js:94` told the master service, but not the exchange. The peer's
  inbox only aged out through `expire()` (cluster-exchange.js:116).

## What was done

**Production (small, tested fix):**
- **`src/cluster/cluster-exchange.js`** adds `drop(peerId)` (line 132). It:
  - deletes that peer's inbox entries;
  - broadcasts `{…empty, source, gone: true}` once per topic, the same shape `expire()` sends, so clients already
    handle it;
  - calls `onData` with an empty payload, so zone air state forgets `peer:<id>`;
  - removes the `|peerId` out-state keys;
  - returns a count, and calling it twice returns 0.
- **`src/api/routes-cluster.js`**: `removed(ctx, saved)` now calls `ctx._clusterExchange?.drop(saved.id)` right
  after `dropped(saved)`. This covers every removal path: unlink here, unlink there, and the repair.
- Result: data is gone 5–6 ms after an unlink, instead of 16.8 s.

**Test environment (new):**
- **`tools/test-env/fake-detect-sidecar.js`**:
  - speaks the sidecar.py protocol: `ready`, then `tracks` per camera every `interval_ms` (minimum 33), and
    `status` every 1 s;
  - `FAKE_DETECT_PERSONS` (default 1, maximum 4) people ping-pong across the picture;
  - exits when stdin ends;
  - opens nothing but its own stdio.
- **`tools/e2e/duties-fixture.js`**:
  - **Shows.** Two shows, saved and loaded with `broadcastProject`:
    - MEDIA: one screen (pixel-map-fixture `sandboxConfig`) and looks Opener, Closer and Credits on media
      `E2E_RED/BLUE/GREEN`;
    - TRACKING: detection on, camera `cam_fake`, and on-air rules `Opener → auto:home` and
      `closer → look:duties_credits`.
  - **PSN.** Both shows send PSN to the admin-scoped group 239.255.97.9 out of 127.0.0.1, with no DMX patch, so
    nothing leaves the machine.
  - **Ears.** Per-server PSN listeners on loopback.
  - **Puppet.** The WO-978 puppet runs as marker 7 on each server, through the API only (WO-978 files are
    untouched).
- **`tools/e2e/duties-probes.js`**: small API and WS probes (duties, senders, exchange, air, take, send, and a `ws`
  tap on `/api/ws`).
- **`tools/e2e/duties-scenario.js`**: 15 steps, listed in the results table below.
  - It reuses cluster-scenario's link, clock and restart steps.
  - Steps that need a look are skipped on `--live` unless `--look` is given.
  - `accept_remote` is always put back.
- **`tools/e2e/run-cluster-e2e.js`**:
  - adds `--scenario=duties`, which runs per-role sandboxes `sb-media` and `sb-tracking`;
  - adds `--live --peer=host[:port] --yes [--self=media|tracking] [--look=<id>]`, which picks this box's same-/24
    address;
  - keeps the existing `--live=<a>,<b>`.
- **`tools/e2e/cluster-nodes.js`**: `startSandboxNodes(root, ids, {extra(id, root)})` passes per-node sandbox
  options. They are asked for again on restart.
- **`tools/test-env/linked-roles.js` + `linked-roles.sh`**: a standing environment, described in the runbook below.
- **`tools/smoke/smoke-wo979-linked-roles.test.js`**, added to `tools/ci/offline-test-files-3.js`:
  - unit tests for the sidecar, the fixture safety (group, loopback, no patch, only the tracking show tracks, the
    rules parse, the rule's look exists on media), and `drop()`;
  - source pins on `removed()` and the runner;
  - the whole scenario as an e2e block on two sandboxes.

**Why sandboxes and not the live server.**
- The owner rule is that the live :4200 server is never linked for a test, and there is no second box online.
- Node-only sandboxes run the real cluster, duties, exchange, detect-service, follow and PSN code. Only Caspar is
  simulated.

## What was VERIFIED

`node tools/e2e/run-cluster-e2e.js --scenario=duties` (run6, 07.11, HEAD d5bb3ff3) gave **15 pass, 0 skipped,
0 failed**. These are the numbers measured on the wire and the API:

| step | measured |
|---|---|
| alone | each server has every duty; PSN media 41 / tracking 41 packets in 0.7 s |
| clocks / link / master | spread 4 ms; link 17.7 ms; epoch 1, follow 2 ms |
| duties | media: tracking/zones/auto/presenters/lighting/ptz false. tracking: all true. Media auto is off_by_duties, follow output_blocked `server-duties`, presenter intake 409 |
| psn (sender choice) | Auto: media 0 / tracking 42. Media picked on the tracking box: media 40 / tracking 0. Back to Auto: media 0 / tracking 41 |
| exchange tracking → media | person `cam_fake:1` moves −1.06 → −0.97 m, first seen in 1 ms, moved in 102 ms, 11 WS `tracking:auto` messages tagged with the source |
| overlay media → tracking | signed pin slot 1 round trip in 202 ms, then unpin, then home forced |
| air media → tracking | take of `duties_opener`: media self air and tracking `peer:sb-media` air; sim AMCP `LOADBG 1-110 E2E_RED IN 0 SEEK 0`, `PLAY 1-110` |
| rules (R4) | Opener → `auto home` ran on the tracking box; Closer → `look duties_credits → master` taken on media in 201 ms |
| impose tracking → media | signed `look.take` on air in 0 ms after the reply; unknown look 404; `system.shutdown` 400 (not allow-listed) |
| refusal | accept_remote off: 403 "this server refuses remote actions" both ways; exchange tracking.auto and air still fresh (< 6 s) |
| relay (rule 3) | `/api/cluster/peers/:id/relay/…` answered by the other node; 9 checks; each peer record is a node address, no client |
| unlink (rule 4) | peers [] and epoch 0 on both, duties back, the other server's data gone in **6 ms** (was 16 848 ms before the fix), both send PSN again (41 / 42) |
| restart | the restarted media server has no stored remote origin |

**Other gates:**
- **Smoke:** `node --test tools/smoke/smoke-wo979-linked-roles.test.js` gave **23/23** in 11 s.
- **Neighbouring smokes:** wo712-exchange, wo712-air-rules, wo712-cluster-call, wo802, wo752, wo725-cluster-e2e and
  wo746 gave **76/76**.
- **Offline suite:** `node tools/ci/run-offline-tests.js` gave **5448 tests: 5443 pass, 0 fail, 5 skipped**.
- **Static checks:** `check-max-file-lines` 0 over (duties-scenario.js is the largest at 467). eslint is clean on
  every touched file, `npm run format:check` passes, and `bash -n` passes on linked-roles.sh.
- **Runbook commands:**
  - Run in order: `linked-roles.sh up → status → take → status → down`.
  - `status` showed:
    - media `exchange.people=1`;
    - media air `{"self":["duties_opener"]}`;
    - tracking air `{"peer:sb-media":["duties_opener"]}`.
  - After `down`: no leftover processes and the state dir was removed.
- **Live server:** :4200 was never linked (peers 0 throughout).

**Not proven:**
- **The two-box live leg (`--live --peer`).**
  - The guards are checked: without `--yes` the run exits 101 with "changes the real servers"; a bare `--live`
    exits 101 with "needs addresses".
  - A run against a real second box has not happened. Every known peer is silent, and the auto-mode classifier
    blocked even the silent-peer probe.
  - On a real rig the overlay `home` step really sends the Auto fronts home, and the take steps need `--look`.
- **Raw hub markers to the media box.**
  - Only the `tracking.auto` snapshot crosses: people from detection. The puppet and hub markers of the tracking box
    do not.
  - WO-712's design lists "markers / zones / detections summary". The sender hook belongs in
    `src/tracking/register.js`, which is WO-978's file and is at 499 lines. This is a follow-up.

## Live two-box leg (07.11, ~10:00)

Peer found by scanning :4200 (WO-990: never scan :5250): **highascg5867 at 192.168.0.10**, a different machine
(MAC 2c:f0:5d:3b:16:eb) running the 03.11 build (`appVersion 2026-11-03T105448Z`, i.e. before f7aeb180).
Both were unlinked, with Auto senders, before the run. This box = media, `--look=` WSS-10s, under the box2 lock.

**`linked-roles.sh live 192.168.0.10 --self=media --look=b5c5…`: 6 pass, 3 skipped, 6 failed.**
- Passed on the real wire: clocks (spread 23 ms), link (18 ms, invite accepted), master (epoch 1, follow 6 ms),
  overlay signed calls (`home` forced on the peer), impose (signed `look.take` on air in 1 ms; unknown look 404;
  `system.shutdown` refused), unlink (duties back in 1 ms, data gone in 18 ms).
- The 6 failures all have **one cause: neither show tracks.** `previs.tracking.cameras` is empty on both, so
  `duties.tracking` is false everywhere and the duties never split. Then by design (`cluster-exchange.js:9-15`)
  `air` goes only to a server that holds `zones`, and `tracking.auto` only comes from an `auto` server to an
  `auto: false` one. So nothing was exchanged: alone (assertion), duties, exchange, air seed, refusal, and the relay
  `tracking: true` assertion (the relay itself answered 200).
- Skipped: psn, rules, restart (sandbox only).

**`run-cluster-e2e --live=192.168.0.17:4200,192.168.0.10:4200 --yes` (WO-725 scenario): 9 pass, 0 fail, 3 skipped**
(restart and failover are sandbox only).
- alone and linked API timing, no errors; clocks spread 7 ms; link 53 ms.
- Refusals; master on each in turn (agree 5–55 ms).
- Signed calls **7579 → 5867 p50 43 ms / p95 55 ms, 5867 → 7579 p50 3 ms**. The peer answers signed calls about
  14× slower. Unexplained: older build or hardware; worth a look if it grows.
- Sender choice 2 ms; unlink 6 ms.

**After both runs:** peers 0, epoch 0, follows false, fanout off, senders `""` on both boxes.
- While this box was master the fan-out connected to the peer's Caspar, but it forwarded nothing. The only
  destination id both boxes share is `dst_operator_gui`, which is not a main bus; the PGM/PRV destinations are
  `dst_mw3u8hcn_1` vs `dst_mw2fn9wr_1`.
- The peer's empty PGM layers predate the run: its log shows the `zz_loopcode` media deleted on 05.11.
- This box's PGM/PRV was put back (PGM empty, PRV neon loop). That restore found **WO-989**, an FTB state bug, fixed.
- The scan that found the peer had also wedged both Caspars' AMCP acceptors: **WO-990**. This box was recovered with
  a Caspar restart; the peer still needs one.

**highascg5867 updated, then re-run (07.11, ~12:05).** The owner allowed updating 5867 and restarting anything on both
(unattended warehouse dev boxes).
- 5867's config and projects were backed up to `~/backups/pre-update-<stamp>/` first.
- Its Caspar was restarted (WO-990 dead acceptor), then `POST /api/system/update/apply {confirm:true}` installed
  release `2026-11-07_110413` (= 06ec34e0, CI run 42366406554 green). It was on the new build 35 s later.
- Post-update sweep: 25 pass / 2 warn / 0 fail / 3 skip. The warnings: `highascg-network-apply.sh` under
  /usr/local/lib differs (needs the install script with sudo), and Caspar "DeckLink 8K Pro failed to enable external
  keyer". Its project was unchanged (`new_project_1`, 0 looks before and after). The GUI was relaunched on the new
  client and is on Live.
- Its OS watchdog now warns "DP-2/DP-3 connected expected=connected actual=null". That is not the update:
  boots on 05.11 saw 2 displays and matched; xrandr now shows only HDMI-0, so DP-2 is unplugged or off.
- WO-725 live again on the same build: **9 pass / 0 fail / 3 skip**. Signed calls 7579 → 5867 dropped from **p50 43 ms
  to 2.7 ms** (5867 → 7579 3.2 ms), so the 43 ms belonged to the 03.11 build. Clocks spread 4 ms, link 17 ms.

**Still to prove live:** the tracking half (duties split, exchange, air → rules, refusal, the relay `tracking`).
That needs one box with a tracking show: `previs.tracking.cameras` with a camera surface and detection on.
Neither box has a camera set up, and building one into a show is the owner's call. Fail-fast idea for the runner:
in `--live` duties mode, check `duties.tracking` on the tracking box first and stop with one clear message instead of
6 cascading failures.

## Imitated camera + live tracking half (07.11, ~12:50)

Owner, 07.11: *"We need to run tests without the tracking camera for now. Imitate it."*

**Investigation.**
- The sandboxes already imitate the camera. `duties-fixture.js` points `HIGHASCG_TRACKING_PYTHON` at
  `tools/test-env/fake-detect-sidecar.js` and `HIGHASCG_TRACKING_MODELS` at an empty model file
  (`src/tracking/detect-service.js:48-49` reads both env vars).
- Neither works on a live box:
  - node runs from the system unit `highascg.service`, and its environment needs root to change (only the restart is
    in the NOPASSWD allowlist);
  - releases don't ship `tools/test-env/` (absent on highascg5867, a release install);
  - 5867 has no `~/.local/share/highascg/tracking-venv` or `models` at all.
- So the imitation had to become a server feature, switched from the show, not from the environment.

**What was done** (commit 5967f7aa):
- `src/tracking/detect-sim.js`: the fake sidecar moved here, so it ships in releases. `tools/test-env/fake-detect-sidecar.js`
  stays as a 9-line shim, so the sandboxes are unchanged. The walkers come from config `sim_persons`, else
  `FAKE_DETECT_PERSONS`.
- `detect-model.js`: `detection.simulate` (only a real `true`) and `sim_persons` (0–4, default 1).
- `detect-service.js`, when `simulate` is set:
  - spawns `process.execPath detect-sim.js` instead of `python -u sidecar.py`, with no venv or model check;
  - leases **no** camera surface, because nothing reads `/dev/shm`;
  - a real ↔ imitated switch halts the running child and starts the other;
  - the snapshot carries `simulated`, and the config line carries `sim_persons`.
- Godot `detect_model.gd` mirrors the two keys. Its status line reads **"Running (imitated camera) — …"**, so a fake is
  never taken for a camera. A `String == bool` compare is a GDScript error, hence the `is bool` guard.
- `duties-fixture.js`: `liveTrackingProject()` is the tracking show with `simulate: true`, for a live box.

**What was VERIFIED.**
- `smoke-wo979-detect-simulate.test.js` 5/5 (in the curated list), including one end-to-end run with the real child:
  2 persons with floor points within 100 ms. The full offline suite: 5527 tests, 5519 pass, 0 fail (the rest are the
  known WO-983/986 todos). `smoke-wo616-tracking-detect` defaults updated. Godot `run-client.sh --test`: **26186
  passed, 0 failed**.
- Lint, prettier and the line limit are clean. CI run 42369767487 is green, giving release `2026-11-07_115214` (= 5967f7aa).
- highascg5867:
  - Backed up (`~/backups/pre-update-20261107-125301`), then updated through `/api/system/update/apply`. It was on the
    new build after 60 s, and its Caspar stayed on 379d81917 (WO-990).
  - `e2e_duties_tracking.json` (`liveTrackingProject()`) was copied into its projects dir and loaded with
    `broadcastProject`.
  - `/api/tracking/detections` → `enabled, simulated, running`, no error, camera `cam_fake` fresh, 1 person at floor
    [-0.92, -2.85, 0].
- **`linked-roles.sh live 192.168.0.10 --self=media --look=b5c5a625… --out=…`: 12 pass / 0 fail / 3 skipped**
  (psn, rules, restart are sandbox only). The morning's 6 tracking failures all pass now:
  - alone: tracking server `tracking:true`;
  - duties resolve in 2 ms: media defers everything except `artnet_in` and `accept_remote`;
  - exchange: the imitated person on the media server, API 104 ms, WS at once;
  - overlay pin `cam_fake:1`, round trip 202 ms;
  - air: tracking server 2 ms after the take;
  - refusal: both ways "this server refuses remote actions";
  - relay: 9 relayed answers;
  - unlink: 13 ms.
- **Restored afterwards:**
  - This box: FTB, then preview-push of the neon look → PGM empty, PRV ch3 layer 10 = ffmpeg, as found.
  - 5867: `new_project_1` loaded again, the test show file removed, detection off, no `detect-sim` process, GUI
    still running.

**Use:** in a show, set `previs.tracking.detection = { enabled: true, simulate: true, sim_persons: 1 }` with a
camera that has a surface role and a solved pose. Turn it off before a show with a real camera; the status line
says when it is on.

## Runbook

```
tools/test-env/linked-roles.sh up        # two sandboxes, linked, media = master; prints both URLs + PIDs
tools/test-env/linked-roles.sh status    # duties / peers / master / exchange.people / air per server
curl -s -XPOST <media-url>/api/scene/take-look -H 'content-type: application/json' \
     -d '{"sceneId":"duties_opener","forceCut":true}'      # watch the tracking box's air state + rules
tools/test-env/linked-roles.sh down      # SIGTERM by exact PID, scratch roots removed
tools/test-env/linked-roles.sh run       # the 15-step scenario once on fresh sandboxes
tools/test-env/linked-roles.sh live <peer[:port]> [--self=media|tracking] [--look=<id>]
                                         # = run-cluster-e2e --scenario=duties --live --peer=… --yes; owner's go only,
                                         #   not on air; links this box's live server for the run and unlinks after
```

The state dir is `${HIGHASCG_LINKED_ROLES_DIR:-$TMPDIR/highascg-linked-roles-<uid>}`. PSN stays on 239.255.97.9
out of 127.0.0.1.

## Follow-ups

- An exchange topic for raw hub markers from tracking to media. It needs a hook beside WO-978's register.js.
- `/api/project/load` without `broadcastProject` leaves the tracking, follow and zone services on the old show.
  Decide whether load should always notify them.
- Live leg run 07.11 (above); the tracking half ran with the imitated camera (above). A run with the real camera
  stays to do once one is set up.
- Fail-fast idea (not built): in `--live` duties mode, check `duties.tracking` on the tracking box first.
