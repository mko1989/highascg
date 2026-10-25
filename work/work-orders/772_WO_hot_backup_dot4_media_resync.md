# WO-772 — .4 as this box's hot backup (cluster link + shared show + cabled PGM/PRV 1); a backup that gets its media late stayed black

**Status: DONE (25.10) — linked and forwarding live; late-media fix proven live (CLEAR → Send media → .4 plays again); failover by freezing the master proven (.4 took over at epoch 2, both Caspars kept playing, handback at epoch 3); test:ci 3360/0, Godot 21801/0, cluster e2e live 9/3 skip/0, sandbox 10/10 + 12/12. PGM audio on both boxes → WO-773**

Owner 25.10:
> back up my config on this machine. connect with server .4 and make it a hot backup. run tests to see if everything
> works correctly … work until all tests pass. include checking of playout. these are dev machines in the shop now.

## Investigation

1. **Backup first.** `~/backups/highascg-config-20261025-215730.tar.gz` (13.6 MB, 0600): `config/`, `projects/` (no
   `_trash`), `.highascg-state.json`, `casparcg.config`, `.private`, `~/.highascg/{audio-desk,gdtf-share}.json`,
   `~/.config/wivrn`, `~/.config/systemd/user`. .4 (no SSH from here) snapshotted over its API before any change:
   `~/backups/dot4-before-hotbackup-20261025-220146/{device-view,settings,cluster,caspar-config_generate}.json`.
2. **Which "hot backup".** Two exist: the WO-54 / WO-65 leader / follower pair (rsync + SSH, its own fan-out) and the
   WO-670 cluster (link, master with auto failover, per-destination backup = the same destination cabled on both,
   WO-746 shared show). The cluster is the one WO-670 built to replace / extend the pair ("there was a backup
   workflow already in place earlier, and id want to expand on that"), and the two fan-outs exclude each other
   (`cluster-fanout.js:128`). Used the cluster.
3. **Baseline.** Both standalone, unlinked (`GET /api/cluster`: no peers, epoch 0). `run-cluster-e2e.js
   --live=192.168.0.10:4200,192.168.0.4:4200 --yes`: 9 pass, 3 sandbox-only skipped, 0 failed; both restored.
4. **What a backup needs** (`cluster-fanout.js` `channelPlan`): the destination in both boxes' lists (shared show) and
   a cable from its `destination_in` on the backup. This box: PGM/PRV 1 (`dst_mvo4vpa4_1`, custom 3840×1792 @ 50) →
   `audio_1` (portaudio hw:1,3) only. .4: only the Operator GUI destination, no audio output defined, one monitor
   (HDMI-0, its operator screen), 4 DeckLink IO. The custom 3840×1792 mode cannot go to a DeckLink; a GPU screen
   consumer on .4 would open over its operator monitor → mirrored this box: PGM/PRV 1 → audio_1 (hw:1,3, NVidia HDMI 0).
5. **Linked** (25.10 ~22:00): `POST /api/cluster/peers {192.168.0.4:4200}` here → invite accepted on .4 →
   `master/set {self, auto:true}` here: epoch 1, succession [this box, .4]. Shared show on, on both: .4 took the show
   (hash `b79767400997f402` on both, `in_sync: true`), its own project backed up to
   `projects/_cluster/untitled.before-share-20261025T210012.json`, `caspar_apply: true` (G10: layout differs).
   `.4 POST /api/settings {audioOutputs:[audio_1 hw:1,3]}`, `addEdge dst_in_dst_mvo4vpa4_1 → audio_1`. Generated
   configs then identical on both (ch1 3840×1792 portaudio, ch2 3840×1792, ch3 1080p5000 shm). `.4 POST
   /api/caspar-config/apply` → restarted, `caspar_apply: false`. Fan-out: `destinations [{PGM/PRV 1, pgm [1,1],
   prv [2,2]}]`, `caught_up 16 lines`.
6. **Found: the backup stayed black.** AMCP `INFO 1` on .4: nothing, while this box played `LOOP czysty.mov`. .4 had
   the show's slug but **0 of 25 media files** (`media_parity: differs`). `POST /api/cluster/peers/highascg5867/
   send-media` → done in ~11 s (785 MB, parity `same`) — `INFO 1` on .4 still empty. The P4b catch-up
   (`cluster-fanout.js` `catchUp`) runs on connect / on a newly cabled destination only; it ran while the files
   were missing, every PLAY failed there, and nothing replays after the media arrives. A re-take of Look 3 here then
   played on both (`LOOP czysty.mov` on layer 10: @3.28 here, @3.02 on .4 — the two INFO reads are sequential).

## What was done

- `src/cluster/cluster-fanout.js` `resync(id)`: clears that server's synced channels and catches it up again.
- `src/cluster/cluster-media.js` `sendMedia`: `deps.onSent?.(id)` after a successful rsync (never after a failed one);
  `routes-cluster.js` `mediaDeps` wires it to `ctx._clusterFanout?.resync(id)`. So "Send media" to a backup ends with
  it playing what is on air, not black until the next take.
- `tools/ci/offline-test-files.js` hit 500 lines → continued in `offline-test-files-2.js` (spread at the end).
- Local gate hygiene: 11 untracked Syncthing conflict copies from June (`projects/{,_autosave/}untitled{,777}.sync-
  conflict-*`) failed `check-require-integrity.js` here (never in CI). Moved, not deleted, to
  `~/backups/sync-conflicts-2026-06/` (also in the tarball).

## What was VERIFIED

- `tools/smoke/smoke-wo772-media-sent-resync.test.js` 3/3 (curated): resync replays once more to that server only, a
  refresh alone never does; onSent only after a good rsync; the route wiring. WO-670 catch-up + fan-out smokes
  12/12. test:ci 3360/0, eslint 0 errors, 500-line 0 over, `check-require-integrity` OK.
- Live (before the fix): link, master, shared show in sync, identical Caspar layouts, forwarded take plays on both.
- See "Live rounds" below for the post-deploy checks.

## Live rounds (25.10, after the fix was deployed)

- **Late media → resync:** `CLEAR 1` on .4, then Send media → the fan-out replayed 16 journal lines to .4 only and its
  ch1 played KV LOOP.mp4 again. The replay restarts the clip from 0 (no seek) — the backup's playhead is then up to
  the clip age behind the master's; good enough for a black-avoiding backup, noted, not fixed.
- **Failover:** this box's node frozen with `SIGSTOP` for 20 s (timed `SIGCONT`). .4 became master at epoch 2 within
  ~10 s and its fan-out went active; both Caspars kept playing throughout (Caspar is a separate process). On resume
  this box saw the higher epoch and stepped down (fencing — no split brain). `POST /api/cluster/master/set
  {master:'self',auto:true}` here → master again at epoch 3, .4 next in succession. A node restart (< 12 s) caused
  no failover, as designed.
- **Known limit:** the air journal is in memory — a master node restart forgets it, so a backup that joins (or gets
  media) after that catches up only from the next take.
- **Playout:** Look 2 → PGM and Look 4 → PRV taken here: the same files play on both boxes, playheads within 0.04 s
  (AMCP `INFO 1`/`INFO 2` on 127.0.0.1 and 192.168.0.4).
- **Tests:** live cluster e2e (`run-cluster-e2e.js --live`) 9 pass / 3 skip / 0 fail before linking; sandbox
  `--scenario=show` 10/10; `--servers=3` 12/12; `run-sweep.js --peers` 24 pass / 6 warn / 0 fail (warns: the sweep's
  kiosk check takes the VR client for the kiosk, root helpers differ, DeckLink deb missing, disk space, .4 on an older
  highascg build, Caspar error lines — the last one was the PortAudio failure, WO-773).
- **Backups:** `~/backups/highascg-config-20261025-215730.tar.gz` (0600: config/, projects/ minus _trash,
  .highascg-state.json, casparcg.config, .private, ~/.highascg/{audio-desk,gdtf-share}.json, ~/.config/wivrn,
  ~/.config/systemd/user); .4's state before linking in `~/backups/dot4-before-hotbackup-20261025-220146/`; .4's own
  project kept on .4 as `projects/_cluster/untitled.before-share-20261025T210012.json`.

