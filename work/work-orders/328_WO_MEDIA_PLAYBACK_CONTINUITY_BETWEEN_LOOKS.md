# WO-328 — Layer media must continue playback between looks

**Source:** todos24.07.26 — "Layer media continue playback between looks."
**Status: OPEN — needs a live repro first.** Written 2026-07-24 from a read-only code
survey. Important: substantial continuity machinery ALREADY exists — this WO is
"find which path breaks and close it", not "build continuity".

## Verified current state (2026-07-24, source read)

The take pipeline already has three continuity mechanisms:
1. **Visually-equal skip** — `buildTakeJobs()` (`src/engine/scene-take-lbg-jobs.js` ~27-135)
   skips a layer entirely (no LOADBG/PLAY) when `layerVisuallyEqual()`
   (`src/engine/scene-transition.js` ~47-120) says source AND fill, rotation, opacity,
   straightAlpha, audioRoute, loop, contentFit, volume, muted, fadeOnEnd, effects,
   pipOverlays are all identical. Media keeps playing untouched.
2. **Bank-flip SWAP (WO-218)** — skipped layers are SWAPped to the new bank with
   `SWAP ch-old ch-new TRANSFORMS` (`src/engine/scene-take-lbg.js` ~399-421), preserving
   playback position across the A/B flip (banks: logical N ↔ physical N/N+100,
   `src/engine/program-layer-bank.js`).
3. **Seek-resume (WO-33)** — when the same media reloads because a PROPERTY differs,
   `resolvePlaySeekFramesForSceneLayer()` (`src/engine/scene-play-seek.js` ~103-253) seeks
   the incoming copy to the live playhead (OSC state → Caspar vars → matrix → remembered
   frame → layer.playSeekFrames → clip.inPoint, in that order).

So if the owner sees a restart-from-zero, one of these is failing. Ranked suspects:
- **a) Different layer numbers between looks.** All three mechanisms key on the SAME
  logical layer. Same file on layer 12 in look A and layer 14 in look B = cold restart by
  design. If this is the repro, that's a feature decision (match by source across layers),
  not a bug fix.
- **b) Property delta forces reload + seek lands wrong.** Any fill/opacity/volume delta
  reloads with seek-resume; if `getLivePlayheadFrames()` returns null (OSC gap — note this
  box's OSC has the little-endian float history) the fallback is frame 0 (~236-245).
  A scaled copy of the same clip in look B (WO-326 territory) would hit exactly this path.
- **c) Loop-flag delta** (~line 102 scene-transition.js) — loop on in one look, off in the
  other → not visually equal → reload.
- **d) Source path identity** — `sourceEqual()` (~50-52) compares resolved values; same
  file reached via different casing/paths won't match.
- **e) SWAP TRANSFORMS edge cases** on 2.6-dev — verify position actually survives the
  swap on this binary.

## Verify at pickup (live, ~15 min, coordinate with owner)
Build two looks that differ ONLY in one property vs. also in layer number; take between
them while watching `INFO` / OSC frame counters. Identify which suspect (a-e) reproduces
the owner's complaint. Log findings in this file before coding.

## Fix direction (per suspect)
- (a): add cross-layer source matching in `buildTakeJobs`: when an incoming layer's source
  is currently playing on a DIFFERENT outgoing logical layer, prefer seek-resume from that
  layer's playhead (or route/SWAP if the old layer is being cleared). Decision needed from
  owner on whether audio continuity matters more than a mixer-line crossfade here.
- (b): harden playhead resolution — if OSC is stale, fall back to time-based estimate
  (last-known frame + wall-clock delta at channel fps) instead of frame 0; add one log
  line naming which source resolved the seek.
- (c)/(d): normalize before compare (loop-only delta → keep playing + send CALL LOOP;
  case/path-normalize `sourceEqual`).
- (e): if TRANSFORMS drops position on 2.6-dev, replace SWAP with seek-resume LOADBG on
  the new bank for skipped layers (slower but correct), gated by a config flag.

## Acceptance
- The owner's exact repro plays through a take without a visible restart (frame counter
  monotonic across the take, ±2 frames tolerance for a reload path).
- Visually-equal skip and bank SWAP behavior unchanged for the already-working cases
  (existing WO-218/WO-33 smoke tests stay green).
- New offline test in tools/smoke/ covering the identified failing path's decision logic.
- `npm run test:ci` → 0 fail. Engine change = node service restart to apply
  (kill -TERM per box runbook); no client rebuild unless the inspector is touched.

## Constraints
- LIVE box: takes on the program channel are involved — schedule the live repro with the
  owner, and keep the rollback (git checkout of touched engine files + restart) noted in
  the commit message.
- Do not weaken `layerVisuallyEqual` into false positives — a wrongly-skipped layer means
  stale content on air, which is worse than a restart.
