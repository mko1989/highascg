# WO-929 — Two-box cluster run with .31 (master / follower / failover on real servers); the sweep's media check failed since WO-830b

**Area:** network, testing-ci
**Status: DONE (02.11.26 — live e2e 9/0, hand run of the sandbox-only steps on both boxes all green, sweep cluster 3/3 after the check fix; boxes unlinked again). Forwarded playout on .31's real Caspar NOT run: it needs a destination cabled on .31 (owner decision, below)**

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
