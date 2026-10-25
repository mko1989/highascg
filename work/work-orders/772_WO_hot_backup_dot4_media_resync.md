# WO-772 — .4 as this box's hot backup (cluster link + shared show + cabled PGM/PRV 1); a backup that gets its media late stayed black

**Status: IN PROGRESS (25.10) — linked and forwarding live (both Caspars play the same clip after a take); fix offline-verified (smoke 3/3 + WO-670 fan-out 12/12, test:ci 3360/0); failover round + soak below**

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
