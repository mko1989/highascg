# WO-724 — Two real servers: interoperability and performance, together and one by one

**Status: DONE (24.10.26) — single-box and two-box test pass run live on both boxes; two fixes proven live (Send media
with spaces, kiosk stays home after a failover) + offline suites and CI green; link torn down. Follow-ups under Open.**

Owner, 24.10: *"You can restart now. Dev machine in the shop. Continue running multiple tests to check interoperability
and performance of both servers and one by one."* — this box (192.168.0.23, `highascg7580`) is a dev machine in the
shop from today, so the live :4200 server may be linked to the second box (192.168.0.4, `highascg5867`) for these tests
(the WO-723 test had to use a sandbox).

Builds: this box = `main` (WO-723 + this WO). .4 = the 23.10 ISO (`BUILD_STAMP 2026-10-23_194203`): WO-670 P1–P4b and
WO-712 R1–R4, not WO-723. .4 cannot be updated from here (SSH refused, no Syncthing, the last GitHub release is older
than its build), so **every two-box result below is mixed-version**.

Hardware: this box i7-14700KF (28 threads), 64 GB, RTX PRO 4000 Blackwell; .4 i9-10900 (20 threads), 32 GB, RTX 2080
SUPER. LAN round trip 13 ms (first) / ≈1 ms (keep-alive).

## Investigation

### Found before the tests
- **The pointer confine was off since the 07:55 New project (WO-722).** Server restart 12:48 (owner OK): back in 7 s,
  journal `[Pointer confine] XFixes barriers on DP-5 @ 0,0 1920x1080`, helper `confine-pointer-barriers.py DP-5` running.
- **This box's Caspar ran the ISO factory config since the 23.10 19:41 ISO build.** The running Caspar (PID 292986,
  started 23.10 19:41:32) logged a 1-channel 720p50 windowed-screen config; HighAsCG expected 5 channels and got
  `PLAY 4-1 DECKLINK 1` / `PLAY 5-2 DECKLINK 2` → ERROR every 20 s, and `/dev/shm/highascg-opgui` did not exist (the
  operator GUI picture and the remote feed were dead). Cause, from the journal + `build-highascg-egg.sh`:
  `reset-iso-operator-config.sh:42` copies `config/casparcg.config.iso` over the live `config/casparcg.config`; the
  npm step's pause/restore restarts `casparcg-server` at 19:41:30 on that file; the real config only comes back at the
  end (`highascg-exfat-remount-sync.sh`, mtime preserved) and nothing restarts Caspar after it. **Every ISO build
  leaves the build host on the factory Caspar config until the next Caspar restart.** Fixed now by the app's own
  `POST /api/caspar-config/apply {force:true}` (12:55): 5 channels up, `shm[opgui|1920x1080] publishing`, 0 AMCP
  errors after. The build script itself is not changed yet (see Open).
- **Clocks.** Both boxes run with NTP off and read ≈2 h ahead of real UTC (this box `Etc/UTC` 12:50 vs
  `Date:` 10:49 GMT from the web; .4 `Europe/Warsaw` 14:50). Between them: **.4 = this box − 17.17 s** (5 ping
  samples, ±1 ms). Signed cluster calls allow ±60 s (`cluster-call.js:114`, `cluster-media.js:19`), so this works
  today, but with NTP off the boxes drift and past 60 s every signed call fails ("stale call (check both clocks)").
  WO-723's "newer `at` wins" is Lamport-safe for causal changes (`set` uses `max(now, at + 1)` after a merge).

### Single box (each measured from this box; read-only GETs, 200 sequential + 200 at 10 concurrent, keep-alive)

| route | .4 seq p50 / p95 | .4 10-conc p50 / rps | here seq p50 / p95 | here 10-conc p50 / rps |
|---|---|---|---|---|
| `/api/replication/ping` | 1.1 / 1.3 ms | 4.5 ms / 2198 | 1.3 / 1.8 ms | 6.7 ms / 1504 |
| `/api/cluster/identity` | 0.3 / 0.3 | 0.5 / 14286 | 0.1 / 0.2 | 0.6 / 14286 |
| `/api/device-view` | 1.2 / 1.3 | 6.8 / 1325 | 0.6 / 1.0 | 5.5 / 1709 |
| `/api/video-surfaces` | 0.3 / 0.4 | 1.1 / 7692 | 0.1 / 0.3 | 0.7 / 12500 |
| `/api/system/version` | 10.7 / 11.3 | 102 / **96** | 17.5 / 20.5 | 174 / **58** |
| `/api/state` | 10.6 / 11.3 | 101 / **97** | 24.6 / 27.5 | 232 / **42** |

0 errors in 4800 requests. **`/api/system/version` and `/api/state` block the event loop**: `getVersionInfo`
(`server-update.js:106`) runs three synchronous child processes per call (`mountpoint` ×2, `apply.sh
--print-retain-mode`; 8.8 ms measured in-process), `/api/state` serializes 40–114 KB. Neither is a hot path (Settings
→ Updates; client load / reconnect / seq gap) → recorded, not changed.

Remote video feed (`ws /api/video-feed`, opgui 960 px): .4 14.7 fps @15 / 24.6 fps @25, first frame 116–170 ms, 5 KB
frames, gap p95 42 ms @25. Here (after the Caspar fix) 14.8 / 24.8 fps, first frame 98–129 ms, 9 KB frames. Server
RSS +190 MB while a feed runs; **no leak**: 6 open/close cycles → .4 324→370→331→…→332 MB, here 468→…→288 MB.
HighAsCG CPU under the 10-concurrent GET load: 55–58 % of one core on both; Caspar idle here 4 % (75 % once the real
5-channel config ran), .4 30 %.

### Two boxes (this box ↔ .4, live :4200 on both)

- **Link** both ways (`POST /api/cluster/peers`): 201 in 37 ms / 6 ms, both online in 79 ms. Fingerprints: here
  `87f0da5337ca6e2d`, .4 `1166d54ccd133944`. Both record the other's `added_at` 17 s apart (the clock skew).
- **WO-723 sender choice:** Auto = lowest fingerprint without tracking / master → lighting + PTZ on .4, artnet_in on
  every server; `cluster.senders` refused by .4 (`unknown action`), logged once, shown `(not in sync)`.
- **Master:** `POST /api/cluster/master/set {master:'self', auto:true}` → epoch 1; .4 shows it **26 ms** later and
  `follows_master: true`. Auto then moves lighting + PTZ here (Auto = master). **Mixed-version hazard, now concrete:**
  .4's 23.10 build keeps its own R1 `lighting` tick on, so with a fixture patch on both, both would transmit. Two
  boxes on this code agree; until .4 is updated, untick lighting / PTZ on .4.
- **Take forwarding (P4a):** active, this box connected to .4's Caspar (192.168.0.4:5250), sent 0, `"no shared
  destination is cabled there"`. Both projects have a "PGM/PRV 1" destination but with different ids
  (`dst_mvi3swp8_1` / `dst_mvm43woy_1`) and neither box cables it; forwarding matches by destination id, and the
  project is not shared between linked servers (WO-712 R5 open). **Two independently made projects can never
  forward takes.** A real extension / backup take needs the same project on .4 plus a cable there (owner decision).
- **Signed calls (R2)**, `look.take` of a look that does not exist (whole signed path, no air effect), 50 each way:
  here → .4 p50 11.9 / p95 12.5 / max 13.7 ms; .4 → here p50 18.8 / p95 21.6 / max 35.7 ms; 404 "look … not found";
  a non-allow-listed action → 400 `unknown action "system.shutdown"`. Mixed versions interoperate.
- **Exchange (R3):** empty on both — no box has cameras / detection, both have zones on, so neither tracking data nor
  the air heartbeat is due. Needs a camera on one box to test.
- **Master survives a restart:** this server restarted (SIGTERM, systemd, ≈7 s) while master; .4 polled every 0.5 s and
  kept `highascg7580 epoch 1` throughout (failover timeout `FAILOVER_MS` 12 s, `cluster-master.js:27`).
- **Send media (P2b) failed on names with spaces** — see below.
- **Failover drill (P3a/P3b), twice:** this server frozen (SIGSTOP 25 s, Caspar keeps playing) while master.
  Run 1: .4 master (epoch 2) at **+12.8 s**; on SIGCONT this box followed .4 **0.3 s** later (epoch fencing, never two
  masters). Run 2: +11.8 s (epoch 4), stand-down 0.1 s. Failback (`master/set self`): .4 shows the new epoch in 23 ms.
  The kiosk client followed both ways (`[cluster] following the master: … → http://192.168.0.4:4200`, ≈7 s after
  the stand-down, a client restart). Cosmetic: the follow dialog popped while a Devices confirmation was open
  (Godot "parent window already has another exclusive child"); it still followed.
- **Kiosk came back to its own box under the LAN address** (run 1 failback): `[cluster] following the master:
  http://192.168.0.4:4200 → http://192.168.0.23:4200`, saved as `ui.cfg [cluster] origin`. The client counts only
  loopback as local (`platform.gd:11` `is_local_origin`), so the operator monitor then drew its own box over the JPEG
  feed (960 px / 15 fps; journal `Upgrade … /api/video-feed`) instead of shared memory, and a later DHCP change would
  have left the kiosk pointed at a dead address. Cause: `.4` lists this box by its LAN IP, and `cluster_follow.gd`
  `_switch` treats "home" only as the exact loopback origin.
- **Idle cost while linked:** this server 2.6–5 % of a core (vs 2.1–2.6 % alone; the 5 s cluster poll). .4 went from
  2.8 % to ≈11 % while it was master **with this box's kiosk as a remote client** — that is the JPEG feed encode for a
  remote GUI (P1), not the link. Re-sampled with the kiosk home (3 samples each): .4 HighAsCG 0–5 %, Caspar 30–35 %;
  this server 11–25 % (the kiosk is now its local client), Caspar 72–75 %.
- **Load while linked:** the same benchmark against both boxes **at the same time** (both clients run on this box),
  linked, this box master. Cheap routes unchanged (ping 1.1 / 1.3 ms seq p50, identity, device-view, video-surfaces
  within noise); the two blocking routes 25–60 % slower (.4 version 10.7→15.7 ms, state 10.6→14.0; here version
  17.5→27.6, state 24.6→30.7 seq p50); feeds unchanged (14.8–14.9 / 24.7–24.9 fps); 0 errors. HighAsCG at 53 % (.4)
  / 62 % (here) of a core under load. The link held: each side read its peer `online: true` once a second throughout
  (29 of 31 samples on both; in 2 the read of .4's `/api/cluster` itself took > 2 s, during its concurrent
  `/api/state` burst; the event-loop blocking above, not the link).
- **Teardown:** `DELETE /api/cluster/peers/…` on both → both `peers: []`, master epoch 0 / none. The kiosk stayed on
  `127.0.0.1` (`ui.cfg` origin `""`). Media sent to .4 for the test is still there (`projects/godot_test`,
  `projects/npcc/Tlo Orange Ball/BAZA 2.mp4`, ≈100 MB).

### Send media: names with spaces
`POST /api/cluster/peers/highascg5867/send-media` (project godot_test, 3 paths) → `failed`:
`media/projects/npcc/Tlo Orange Ball/BAZA 2.mp4: highascg-replication-ssh: disallowed path token: Orange\`. Paths 1–2
went through. rsync 3.2.7 (≥ 3.2.4) backslash-escapes the remote path on the remote command line
(`…/Tlo\ Orange\ Ball/`); the receiver's forced command `tools/runtime/highascg-replication-ssh.sh:69` splits that
line with `read -r` on spaces and rejects the token `Orange\`. Every push of a project whose media or template path
holds a space (or `&`, `;`, `|`) fails, on every box.

## What was done

- `src/replication/sync-project-media-rsync.js`: new pure `rsyncArgs(direction, rel, o)` builds each path's argv. A
  **push** now names only `<remoteRoot>/media/` (or `template/`) on the remote side and carries the rest in rsync's
  file list (`--relative` + a `/./` anchor: `media/./projects/npcc/Tlo Orange Ball/BAZA 2.mp4` → `…/media/`), so the
  remote command line holds no name at all. Same files at the same places as before (directories: contents into the
  same folder). Pulls keep naming the remote path (unchanged; a pull of a spaced path still fails — Open).
- **Why not the wrapper:** making the forced command parse rsync's escapes (split without `-r`, check metacharacters
  outside escapes) was the first attempt and was **blocked as weakening a security control**; it is reverted
  (`git diff` empty). The sender-side change needs no receiver change, so it also works into .4's 23.10 wrapper, and
  the wrapper keeps checking every remote path it is given.
- `tools/smoke/smoke-wo724-media-send-paths.test.js` (new, in FILES): real rsync through the real wrapper, with a fake
  `ssh` that hands the command over as sshd does (`SSH_ORIGINAL_COMMAND` = the joined words), into a scratch root:
  spaced folder + file, a project folder with `&` / `(1)` / a spaced sub-folder, a template, the wrapper still refusing
  a destination outside media/template, and the old argv reproducing the box error (`disallowed path token: Orange`).

- **Kiosk stays home (Godot):** `core/cluster_follow_model.gd` `resolve_target(origin, home, local_addrs)` (+ `port_of`):
  an origin that is this machine under one of its own addresses, on home's port, while home is loopback → home.
  Used in `app/cluster_follow.gd` `_switch` (every follow, both the snapshot and the probe path) and in
  `core/config.gd` `_init` (a LAN-address origin already saved, like this kiosk's, heals at start). A remote client
  (home not loopback) and another port on this machine (another server) are left as they are.

- **ISO build leaves Caspar on the real config:** `tools/eggs/live-usb/build-highascg-egg.sh` now runs
  `systemctl try-restart casparcg-server.service` right after `highascg-exfat-remount-sync.sh` has synced the real
  config back (the file returns with its old mtime, Oct 22 21:53, so nothing watching it noticed). `try-restart`
  restarts only a running Caspar; a failure warns, never fails the finished build. Smoke
  `smoke-wo724-build-restarts-caspar.test.js` (in FILES) pins it after the factory-config reset and the sync, and
  before the WO-462 completion sidecar.

## What was VERIFIED

- Smoke 6/6. `xvfb-run -a npm run test:ci` 3087 tests, 3085 pass, 0 fail, 2 skipped; repo-integrity, max-lines,
  unwired-exports, `--no-http` boot, lint, format:check all green (clean export).
- **Live:** this server restarted onto the change; Send media to .4 (old wrapper) → `done`, 3/3 paths, 2.1 s
  (`[replication] rsync push 3/3 path(s) → 192.168.0.4`); .4's `GET /api/media` lists
  `projects/npcc/Tlo Orange Ball/BAZA 2.mp4` at 99685797 bytes (the source size).

- Godot units 21481 passed / 0 failed (+8 `test_resolve_target_keeps_the_on_box_client_home`).
- **Live, kiosk:** restarted as openbox does (`run-client.sh --autostart` on :0) with the saved
  `origin="http://192.168.0.23:4200"` → `[client] server http://127.0.0.1:4200`, no `/api/video-feed` upgrade, a shm
  lease on `pgm1`. Then failover run 2 + failback: `following the master: http://192.168.0.4:4200 →
  http://127.0.0.1:4200`, `ui.cfg` origin `""`, no feed.
- Build script: `bash -n` clean; smoke 4/4 + the other build smokes (WO-462/464/465, build stamp) 22/22;
  `test:ci` 3091 tests, 3089 pass, 0 fail, 2 skipped. **Not run on a real ISO build** (owner QA on the next build:
  journal `casparcg-server` restarted after `Remount bridge/USB`, then `PLAY 4-1 DECKLINK` with no ERROR).
- CI: 6af5c6d9 green; 329919d1 first run's verify step hung after the suite printed `fail 0` (runner, past its 15-min
  timeout) → cancelled + re-run → green.

## .4 updated to `main` (24.10, after the owner gave the SSH login)
- SSH as `casparcg` with the password works (no sudo). .4 is a disk install without a git checkout. Code copied the way
  a drop-update applies it: `git archive 4c267126` → `rsync -ac` with `config/server-update-rsync-excludes.txt`, plus
  `/config/` (all of .4's own settings kept), `/dist-web/` and `template/shaders/sh-test.html` excluded; 243 files,
  every replaced file kept in `~/highascg-pre-update-20261024-145147/` (46 files) on .4; `~/highascg/.updated-from`
  names the commit. `package.json` differs only by a script, so no npm install. `BUILD_STAMP` stays the ISO's.
- highascg restarted (SIGTERM, systemd): up in 6.5 s, the same two boot warnings as its 10:00 start (no ArtNet border,
  previs without three), no new errors; it now answers WO-723's `/api/server/senders`. The WO-725 live run passed on it.
- **.4's kiosk still runs the old client code** (restarting the operator GUI on .4 was refused by the session's
  permission check); a reboot of .4 or a kiosk restart there picks it up.

## Open
- P4a take forwarding needs the same project on .4 and a destination cabled there (owner decision, WO-712 R5).
- ~~A pull of a spaced path still fails at the wrapper~~ → fixed in WO-727 (wrapper understands rsync's escapes,
  installed on .4; updates now refresh the installed copy).
- ~~Clocks 17 s apart, NTP off~~ → NTP on for both (WO-727, offset ≈2 ms). Still worth having: each peer's clock
  offset (ping `serverTimeMs`) on the Servers card, warn past 30 s.
