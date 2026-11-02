# WO-929 — Two-box cluster run with .31 (master / follower / failover on real servers); the sweep's media check failed since WO-830b

**Area:** network, testing-ci
**Status: DONE (02.11.26 — live e2e 9/0, real master restart / failover / hand back / follower restart green, sweep cluster 3/3; follow-up round the same day: fan-out playout on both real Caspars within one frame, failover with content on air, follower PGM skip — found WO-930..933; both boxes restored)**

Owner, 02.11.26: "push then run connection tests between servers. master follower backup etc."

## Investigation

- Boxes:
  - this box = **192.168.0.9** (highascg7580, live tree `e69af94a`);
  - **192.168.0.31** = highascg5867, the 02.11 ISO (`2026-11-02_074103`). Same hardware id as .4 in WO-772.
  - Both started standalone: 0 peers, epoch 0. Distinct device keys (5d8182e7aa99f561 / 5efabab811971d25), so the
    ISO clone carries no shared identity and the link is not refused as a cloned install (WO-670 P2b).
- Backups first, as WO-772:
  - `~/backups/highascg-config-20261102-093017.tar.gz` (0600);
  - .31 over its API in `~/backups/dot31-before-cluster-20261102-093017/` (device-view, settings, cluster, project
    "mhp harder").
- Projects at the time:
  - this box: "New project 1", Operator GUI only, no cables;
  - .31: "mhp harder", Operator GUI → gpu_p1. .31 has 4 GPU ports and no DeckLink.
- **The sweep's media check had failed on every run since WO-830b.** Its last step, `clean up: media/.highascg-check/
  emptied on the peer`, pushes with `rsync --delete`. WO-830b's wrapper allow-list refuses that option on purpose: its
  verification lists `--delete` among the refused options. So the security change is right and the check was stale:
  `rsync exit 12: highascg-replication-ssh: disallowed rsync option: --delete`. Its files are 3 bytes under a fixed set of
  names, and they are hidden from Caspar `CLS` and `/api/media` on .31 (0 matches).
- The first sweep `--peers` run also failed the media check earlier, with `Permission denied (publickey)`. That is the
  WO-753 design: the rsync-only key reaches a peer with the first **Send media**, and none had run since linking. After
  Send media (`new_project_1`, 1 path, done in 0.2 s), ssh worked.
- Side finding, this box only (not cluster): the sweep warned `running 1 channels, config says 1: apply the Caspar
  config`. The real difference is in `configComparison.issues`: Caspar runs ch1 `720p5000` with a screen, while "New
  project 1" expects `1080p5000` without one. The summary printed only the equal counts.

## What was done

- `tools/e2e/replication-check.js`: the last step is now `--delete is refused (WO-830b); media/.highascg-check/ holds
  only the check's own files`.
  - It asserts that the peer's forced command refuses `--delete`, so it now guards WO-830b.
  - It asserts that a pull returns exactly the check's files.
  - Header and `tools/sweep/checks-cluster.js` comment updated: the files stay and are overwritten by the next run.
  - The wrapper's allow-list is unchanged.
- `tools/sweep/checks-app.js`: the Caspar warn names the first `issues` entry when counts match.
- Hand acceptance script (scratchpad, not shipped):
  - link, then this box master with auto failover;
  - master restart through `/api/system/setup/restart-app`;
  - failover by `SIGSTOP` of this box's node for 30 s, then `SIGCONT`;
  - hand back, then follower restart through .31's `restart-app`;
  - status from `GET /api/cluster` on both.

## What was VERIFIED

- `run-cluster-e2e.js --live=192.168.0.9:4200,192.168.0.31:4200 --yes`: **9 pass, 3 skip (sandbox-only), 0 fail**.
  - link + invite accept: 10 ms;
  - master agreed in 2–4 ms on each epoch;
  - signed look-take calls: .9→.31 p50 19.8 ms / p95 38.3; .31→.9 p50 12.8 / p95 14.6;
  - clocks 10 ms apart;
  - API timing alone ≈ linked.
- Sandbox, this box:
  - `--servers=3`: **12/12**, including the master restart, failover and follower-restart steps;
  - `--scenario=show`: **10/10** (shared show, edits both ways, concurrent edits).
- **Real two-box steps** (the ones the live mode skips), all ✓:
  - linked at epoch 4, this box master;
  - **master restart**: down 5.5 s, epoch stays 4 after +16 s, no failover;
  - **failover**: this box's node frozen; .31 master at epoch 5 **9.6 s** after the freeze. AMCP `INFO` on both Caspars
    showed `PLAYING` before and during the freeze. On `SIGCONT` this box stepped down in 0.2 s (both: epoch 5, .31
    master). No split brain.
  - **hand back**: Make this server master → epoch 6 on both at once;
  - **follower restart**: .31 down, back in 9 s, linked, still naming this box master at epoch 6.
- Fan-out while linked: `active`, **connected to .31's Caspar at 192.168.0.31:5250** across the LAN, `error: "no
  shared destination is cabled there"` (Operator GUI destinations are never forwarded). `.31 follows_master: true`.
- Sweep `--peers`:
  - before: 25 pass / 4 warn / 1 fail (media check);
  - after Send media and the check fix: the `--only=cluster` part **3/3**;
  - replication-check against .31 **5/5**: forced-command refusals, push and pull with spaces / `&` / quotes /
    brackets, single named file, `--delete` refused.
- Cleanup: both unlinked (0 peers, epoch 0, `follows_master` false, fan-out off on both).
- **Not run: playout through the fan-out on .31's real Caspar** (backup / extension). It needs:
  - a PGM destination in the shared show;
  - shared show switched on, so .31's active project "mhp harder" is replaced by this box's show (its own is kept as
    `projects/_cluster/…before-share…`);
  - a cable on .31, which regenerates .31's Caspar config.
  This round was proven on the same hardware as .4 in WO-772 (playheads within 0.04 s). Owner decision whether to run it
  again on .31.

## Follow-up round, 02.11.26: playout through the fan-out on both real Caspars

Owner: "You can do what's needed on both servers, they are in dev mode. I need you to run tests on both servers".

Setup:
- Linked at epoch 7 (this box master, auto failover), shared show on.
- Destination "WO929 PGM" (pgm_prv, 1080p5000) added in the shared show. Channel map PGM 2 / PRV 3 on both boxes.
- On .31 it is cabled to `gpu_p0`. DP-0 is unplugged, so the screen consumer sits at x=1920, off its single 1920-wide X
  screen, and the operator GUI on HDMI-0 stays clear.
- Caspar config applied on both: 3 channels at 1080p5000.
- Send media: 2 paths. A look with `projects/airport/8. Tło Bankietowe - Wolniejszy Glow.mp4` on PGM.
- Playheads read with simultaneous `INFO 2-110` on both Caspars (scratchpad `playheads.js`, Δ corrected for reply skew).

| step | result |
|---|---|
| take on the master | fan-out 11 lines; same clip on ch2 of both; **Δ median 0.001 s, spread 0.021 s** (one frame) |
| .31 Caspar `RESTART` | catch-up 8 lines within 1 s; clip back, but from frame 0 (Δ 35.6 s) — documented WO-670 limit |
| failover with content on air (this box's node `SIGSTOP` 30 s) | .31 master at epoch 8 after 9.6 s; both Caspars PLAYING throughout; this box steps down in 0.2 s on `SIGCONT`; Δ 0.002 s after |
| .31 as master | its fan-out reaches this box's Caspar; "no shared destination is cabled there" (correct: not cabled here) |
| hand back | epoch 9 at once on both |
| take sent to the follower (.31) | first failed `Cannot find module …/client/lib/…` → **WO-931**; after the fix `ok`, `skip local PGM AMCP ch=2 (leader fan-out drives air)`, .31's ch2 untouched (Δ 0.001 s) |
| .31 node restart / hand back | the master replays its journal to .31's Caspar, which never stopped: clips jump to frame 0 → **WO-933** (OPEN) |
| this box's node restart | journal empty after restart (0 lines replayed), .31 stays in sync |

Found on the way:
- **WO-930**: on stick-booted .31 the shared show's committed project (rev 600) was replaced within 0.1 s by the stick's
  23.10 copy (rev 25). `copyIfSrcNewer`'s "or larger" clause caused it. Fixed, and the fix is copied onto .31.
- **WO-931**: ISO installs had no `client/lib`. Every take through the API failed.
- **WO-932**: sweeps on both boxes:
  - this box: 26 pass / 3 warn / 1 fail;
  - .31: 25 pass / 3 warn / 1 fail / 1 skip after the fix;
  - fixed: 7 failed snap mount units on every clone, and the require check on ISO installs.
  - The remaining fail on both boxes is the test project's stale DeckLink tiles plus the WO-869 probe's logged 403.
- Spurious `diverged` backups on the follower: recorded in WO-930, not diagnosed.

Restore (all verified afterwards):
- shared show off, unlinked: 0 peers and epoch 0 on both;
- this box: the 09:30 backup's `.highascg-state.json`, `device_graph.json`, `screen_destinations.json`, `casparcg.config`
  and `new_project_1` restored. Caspar back on 720p5000 + screen (its pre-round state, including the pre-existing
  mismatch with the project); X layout unchanged.
- .31:
  - my cleanup first loaded "mhp harder" **with** `applyHardware`. That replaced .31's live rig with the rig stored in the
    show (3 destinations, cables to `dlsdi_4`, `gpu_p0/2/3`) and re-saved the show (rev 599, .31 fingerprint, a
    180 KB pixel-mapping proposal).
  - Undone:
    - the six config slices written back from the pre-round API backup (`settings.json`: casparServer, audioRouting,
      audioOutputs, screenDestinations, deviceGraph; `screen_count` / `screen_n_os_rate` in general.json);
    - the show from `projects/_cluster/mhp_harder.before-share-20261102T085603.json` (rev 597, byte for byte);
    - `casparcg.config` from the pre-round copy;
    - a plain load to restore the WO-821 hold; node and Caspar restarted.
  - Result: Operator GUI → `gpu_p1` only, 1 channel at 1080p5000, `aligned: true`, X on HDMI-0.
  - The replaced files are kept in .31's `~/wo929-restore/undo/`.
- Left on .31, which is a live ISO and loses everything below at its next boot except the stick:
  - the WO-930 `project-volume-sync.js` and WO-931 `client/lib` + `client/package.json` + `client/fixtures`;
  - `tools/sweep` and `replication-check.js` at HEAD.
- **On .31's stick (persists):** `projects/new_project_1.json` + autosave now hold the test show. The stick's previous
  copy (rev 25, a 23.10 snapshot of this box's "New project 1") is gone: the WO-930 bug replaced the local copy with it,
  and the shared show then pushed over it. This box's own "New project 1" is unaffected (09:30 backup restored).
