# WO-359 — Route layers rock solid on takes (cut-take sweep was clearing skipped sources)

**Status: DONE (2026-07-27, live-verified 6-cycle drill on the box)** · Source: owner: "playing a
look with a layer and then routes of that layer doesn work consistently, probably race conditions
are wrong due to the routes. this needs to be rock solid."

## Investigation

- Route machinery audit: remap (`remapIntraLookRoutesForTakeChannel`, bank-aware), ordering
  (`sendStaggeredTakePlays` two-phase atomic batch: source PLAYs before route PLAYs in ONE
  BEGIN…COMMIT) — all correctly wired. `partitionTakeJobsPlayOrder`/`resolveRoutePlayDelays`
  exports are consumed via sendStaggeredTakePlays (the standalone staggered path is rollback-only).
- Empirical: on THIS 2.6-dev build a route producer created against an EMPTY layer FOLLOWS
  content played later (split-screen PRINT probe on PRV: route-only half YAVG≈156, not black).
  So creation order was not the failure mode.
- Saved project data clean (`route://1-10`, logical) — no physical-layer leak.
- **ROOT CAUSE:** the cut-take orphan sweep (`shouldClearOrphans`, scene-take-lbg.js) builds its
  keep-set from `takeJobs` phys layers ONLY. WO-218 visually-equal skipped layers are NOT
  takeJobs — but their producer is on air (current bank now, target bank after the WO-218 SWAP
  that runs post-staging). On CUT takes (fadeDur=0 → sweep runs) of a look whose source layer is
  unchanged (retakes, or consecutive looks sharing the source), the sweep CLEARED the source
  producer; the later SWAP moved an empty layer; the routes then routed nothing. Crossfade takes
  skip the sweep entirely → worked — hence "doesn't work consistently".

## Done

scene-take-lbg.js: the sweep keep-set now includes, for every visually-equal skipped layer,
BOTH its current physical layer and its post-SWAP target (`phys(layerNumber, inactiveBank)`).

## Verified

Live drill on PGM ch1 with the owner's real "Look 12" (shader L10 + route://1-10 on L11+L12):
3× cut retakes + MIX cycle to the copy look and back + MIX retake — 6 consecutive takes, each
probed via INFO stage XML: source producer + both route producers present on exactly the active
bank, other bank clean, banks alternating correctly. test:ci 1555/0 (wo160b pgm-only smoke 8/8).
PRV probe layers cleaned after the experiment.
