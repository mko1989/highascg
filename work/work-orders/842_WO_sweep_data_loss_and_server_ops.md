# WO-842 — Sweep: data loss, replication boot and server-side ops bugs

**Status: OPEN (30.10)**
**Source:** code sweep 29.10 (`work/sweep-29.10.2026/REPORT.md` §4e, 4g–4l, §5 Replication + Ops scripts); owner 30.10
*"there are a lot of bugs to fix… continue what wasnt finished in the sweep"*.

Items: 4e replication boot reload no-op + leaderYield role not persisted; 4g project rename onto an existing slug
overwrites it; 4h deleting the last look never persists; 4i unparsable general.json not quarantined; 4j
atomic-file-write fixed `.tmp` name; 4k dev-push.sh remote cleanup deletes data/.private/projects; 4l non-standard
multiview emits `<video-mode>custom</video-mode>` with no custom mode. §5 Replication: timeline id traversal,
connectToLeader saves follower config before the leader answers, playhead export SEEK 2000 vs 1000 @25 fps. §5 Ops:
exFAT late-plug pipeline, DeckLink install "ok" on failed dpkg, flash-stick exFAT format failure as success, Caspar
supervisor crash-loop give-up never fires, tailscale-up `--hostname 0`, power button listener picks Sleep. §7e
`tools/sweep/sweep-util.js` request never settles; `tools/wiki/md-to-html.js` escaped code in link labels.
