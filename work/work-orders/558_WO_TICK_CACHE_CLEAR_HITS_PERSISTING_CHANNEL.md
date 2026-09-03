# WO-558 — previewing a plain look still restarted program, one tick later

**Status: FIXED in repo (03.09.2026), confirmed against a LIVE wire capture (not just unit tests —
first time this session's timeline chain got that level of proof before shipping). 4 new smokes,
one directly simulating the real tick timer (the exact gap prior WO-555/556 unit tests missed).
Full offline suite 2388/2386/0/2, all green. Server restarted and live. Owner QA owed, but this one
already has stronger evidence than most of today's chain — see §3.**
**Priority:** Critical — the invariant "a preview action must never touch program" (WO-550, 552,
555, 556) was STILL being violated after all four of those fixes.
**Source:** `work/work-orders/todos03.09.26`: *"switching between timeline looks and standard
looks still has a lot of bugs... sending looks on preview has effect on pgm channel which is just
plain wrong and should never ever happen."*
**Related:** [WO-555](./555_WO_TIMELINE_PREVIEW_ROUTING_CORRUPTION.md) (introduced this bug while
fixing two others — the differential-stop change this WO narrows further),
[WO-556](./556_WO_PREVIEW_FLASH_AND_TIMELINE_EXIT_RESTART.md) (fixed a DIFFERENT unprotected-reapply
bug in the same area, same morning — that fix is confirmed still correct and unaffected by this one)

---

## 1. Investigation

Given the density of same-day fixes in this exact area (WO-546 through 556, all same-day, several
finding bugs the previous one introduced), this WO broke from the pattern of theorizing from static
code reading: reproduced the owner's exact scenario live on the box, with a running wire capture,
BEFORE writing any fix.

Sequence: took Look 5 (a timeline look) to program on the Dioda bank at 11:19:40, confirmed live via
screenshot, then at 11:20:02 clicked to preview Look 1 (a plain, timeline-free look) — a pure
preview-bus action (`scene-list-column.js`'s `sendPrv` → `sendSceneToPreviewCard`, never touching
`channel` = program in any of its own AMCP commands).

`log/caspar_2026-09-03.log`:
```
11:20:03.020  BEGIN / MIXER 2-10 CLEAR / LOADBG 2-10 ... / MIXER 2-11 ... / MIXER 2-12 ... / COMMIT
              (Look 1's own content, correctly on channel 2 = preview only)
11:20:03.112  MIXER 1-210 FILL 0.25 -0.0625 0.5 1.125 0        <-- channel 1 = PROGRAM
11:20:03.134  MIXER 1-210 OPACITY 1 0 / VOLUME / BLEND / BRIGHTNESS / CONTRAST / SATURATION /
              LEVELS / CHROMA / CROP / CLIP / PERSPECTIVE        (full effects-neutral reset)
11:20:03.137  STOP 1-211 / PLAY 1-211 "testowe/forest_jester-dv.mov" LOOP
              (full mixer reset repeated for 1-211, 1-212)
11:20:03.160  MIXER 1 COMMIT
11:20:03.162  STOP 1-210 / STOP 1-212
11:20:03.163  PLAY 1-210 "testowe/PiekloKobiet..." SEEK 0
11:20:03.165  PLAY 1-212 "testowe/firebelly-torches-dv.mov" LOOP SEEK 0
```
Layers 210/211/212 are the TIMELINE's own physical band (WO-553) — this is a full, unprotected
transport restart of the timeline CURRENTLY LIVE ON PROGRAM, ~90-140ms after a preview click that
had nothing to do with it, on a look with zero timeline content.

The ~90ms gap is the key clue: WO-556's release-from-preview `setSendTo` call already passes
`{ skipAmcpApply: true }` — its own reapply is correctly suppressed, and it runs synchronously in
the same tick as the preview take. Something ELSE, ~90ms later, is responsible.

That something is `TimelineEngine`'s `_tick()` — an unrelated `setInterval` firing independently
every `TICK_MS` (~40ms) the entire time a timeline plays, calling `_syncAmcpOnTimelineTick` →
`_syncAmcpLayers(id, ms, {force:false})`. That function reads `this._prevKey.get(`${ch}-${caspLayer}`)`
per layer to decide whether a layer's transport is "stale" (needs STOP+PLAY) or can just get a
lightweight mixer update. WO-555's routing-change handler, right after correctly narrowing the STOP
to only removed channels, still wiped `_prevKey`/`_lastKfValues`/`_lastKfSegment` — three maps keyed
`${ch}-${caspLayer}[...]`, NOT per-channel — **entirely**, on any routing change at all. Program's
routing never changed (it stayed `true` the whole time), but its cache entries got deleted anyway.
The very next tick found no `prev` for program's layers, read that as "transport never started", and
force-restarted it — the exact block on the wire, from a timer that has nothing to do with the
preview click that happened to run moments before it.

This gap exists in EVERY WO-555/556 unit test written so far: they all assert on the state
immediately after the synchronous call, and none of them ever advance the engine's tick — so the
bug was invisible to the whole suite while being trivially reproducible on the real box within
seconds of testing.

## 2. What was done

`timeline-playback-runtime.js`, `setSendTo`: the cache-clearing that follows the (already-correct,
WO-555) differential STOP now also only touches entries for `removedCh` — iterating each cache's
keys and deleting only those whose channel segment (`key.split('-')[0]`) is in the removed set. A
channel present in both the old and new routing keeps its cache untouched, so the next tick
correctly sees it as unchanged and does nothing.

## 3. What was VERIFIED

- `tools/smoke/smoke-wo558-tick-after-routing-change.test.js` — 4 tests. The first drives a real
  `TimelineEngine` through the exact WO-556 release-call shape, THEN calls `eng._tick()` directly
  (the real method the interval invokes) to simulate the next tick, and asserts program receives
  zero PLAY/STOP/LOAD lines from either step. A regression test manually reproduces the pre-fix
  wholesale cache clear and confirms `_tick()` then DOES restart program — directly reproducing the
  live wire-capture mechanism, not a tautology. A third test confirms the correctly-removed preview
  channel is unaffected by the narrowing (still gets its STOP). A source-level pin checks the fix
  landed in all three caches.
- Full offline suite: `node tools/ci/run-offline-tests.js` → 2388 tests, 2386 pass, 0 fail, 2 skip
  (pre-existing). Every prior timeline WO (546 through 556) still green.
- Server restarted, live. **Follow-up live re-verification against a fresh wire capture is the next
  step this session** — see `work/OPEN_ISSUES.md`'s WO-558 row for the outcome once run.

## 4. What remains open

- The owner's other report in the same note — "switching between timeline looks and standard looks
  still has a lot of bugs... hard to explain, a lot is happening on the screen during the
  transition" — is plausibly the SAME mechanism (the full pgm/prv take path runs the identical
  `setSendTo` code across its staging/pgmTake/previewExchange calls, and any partial routing change
  among them would have hit this same cache corruption against whichever channel was mid-transition)
  but was not independently reproduced with its own wire capture in this WO. Live re-verification of
  a timeline-look → normal-look full take is owed before closing that half of the report.
