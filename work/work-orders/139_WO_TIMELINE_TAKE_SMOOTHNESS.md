# WO-139 — Looks → timeline Take smoothness (flash race, atomic crossfade, teardown)

**Status: REOPENED 13.08.2026 — A139.2 was never done, and the owner is now reporting the exact failure the un-QA'd path can produce. One fail-dark bug found and fixed (§5, WO-519); the rest of A139.2 still owed.**
**Priority:** High (operator-facing on-air quality)
**Date:** 2026-07-07
**Depends on:** WO-138 (tree must be stable and gates green first).

---

## 1. Problem

Requirement: an operator with a look on Caspar PGM must transition to a timeline via the Take button (or start a timeline from inside another look) with **zero visible artifacts** — no black frames, no opacity pops, frame-locked crossfade.

Path: Take button (`client/components/timeline-transport.js` ~line 342) → `src/api/routes-timeline.js` ~line 88 → `runTimelineDirectTake` (`src/engine/timeline-take.js`) → `playForTake` (`src/engine/timeline-playback-runtime.js` ~line 80).

Confirmed hazards in `src/engine/timeline-take.js`:
1. **Flash race:** `playForTake` fires before opacity is preset to 0 — timeline content can pop in full-bright for one AMCP round-trip before snapping to 0 and fading in.
2. **Non-atomic crossfade:** fade-in and fade-out are two separate `batchSendChunked` + `mixerCommit` calls — they can start on different frames.
3. **Wall-clock teardown:** `waitMs((duration/fr)*1000)` then hard-clear of look layers; Node timer jitter can clear a layer mid-tween (visible pop).
4. **Timeline→timeline:** `play()` in `timeline-playback-runtime.js` hard-stops the previous air timeline with no fade.

---

## 2. Tasks

- [x] T139.1 Preset opacity BEFORE `playForTake` in `runTimelineDirectTake`: MIX presets 0 (kills the full-bright flash race); CUT presets 1 (a stale 0 from an earlier fade-out can no longer make a CUT take invisible). The old preset inside `fadePhysicalLayersIn` is no longer on the take path (function kept intact for its `scene-take.js:285` caller).
- [x] T139.2 Frame-locked crossfade: `runTimelineDirectTake` now builds ONE batch per program channel (timeline fade-in DEFER lines + look fade-out DEFER lines) and issues ONE `mixerCommit` — in-fade and out-fade start on the same frame. Went further than planned: `playForTake` → `_applyAt(..., {take:true})` batches clip lead-opacity keyframe segments as DEFER tweens and skips its own commit, so **clip fades fire on the same single commit as the take crossfade**. Layers whose active clip owns its opacity via keyframes are excluded from the layer-level fade (new `collectClipOpacityFadeLayers`) — previously both wrote MIXER OPACITY on the same layer and the last writer won.
- [x] T139.3 Teardown wait now `((duration + 3) / fr) * 1000` — 3-frame margin against Node timer jitter.
- [x] T139.4 **Decision: timeline→timeline take remains CUT.** All timelines share the same physical layers (`TIMELINE_LAYER_BASE + i`), so a true crossfade needs double-buffered layer allocation (alternating layer banks) — a separate feature, not a take-path patch. Mitigation shipped: the incoming timeline is preset to opacity 0 (MIX) and fades in over the transition, so the switch reads as a fast fade-in rather than a raw pop. Follow-up candidate noted for a future WO.
- [x] T139.5 Verified by reading: `collectOccupiedLookLayersOnChannel` unions the AMCP playback matrix + OSC-occupied layers + live scene state, with `isLookPhysicalLayer` and `PGM_BANK_B_OFFSET` bank normalization covering LBG (bank B) layers; `isPgmAudioTrackPhysicalLayerOnChannel` guards audio-track layers from teardown. `smoke-scene-take-pgm-only` passes in test:ci.

---

## 3. Acceptance criteria

- [x] A139.1 `node --test` both smokes: `pass 1 / fail 0` each; full `npm run test:ci` exit 0 after the changes. (The two smokes were adopted from WO-138 triage — they encoded this WO's target batch/DEFER behavior. One amendment: the opacity-fade smoke's direct `_applyClipMixer` call now passes `scheduleLeadTween: true`, the flag `playForTake` sets internally — a bare force-apply is also the scrub/seek path, which must NOT schedule tweens.)
- [ ] A139.2 Manual QA on the playout box, watching REAL PGM output (not the GUI preview):
  - (a) look on PGM → Take with MIX/25f — no black frame, no opacity pop
  - (b) CUT take — instant, clean
  - (c) timeline started from inside another look — smooth
  - (d) take while a previous timeline is playing — defined behavior per T139.4, no glitch
  - (e) return from timeline to a look — smooth
- [ ] A139.3 No regression in look→look takes (spot-check MIX + CUT between two looks).

- [x] A139.3 No regression in look→look takes: full `test:ci` green including `smoke-scene-take-pgm-only` (code path untouched; `fadePhysicalLayersIn/Out` kept intact for `scene-take.js`). Operator spot-check still advised alongside A139.2.

## 5. WO-519 — reopened: the take could leave layers playing invisibly

Owner 13.08: *"transitions between looks and timelines doesnt work correctly, either some of the
layers play or nothing at all. this already happend so there should be a wo about that."* This WO.

**T139.1 presets every timeline layer to opacity 0 on a MIX take**, and something must then bring it
up: either the layer-level fade, or the clip's own keyframe tween for layers that
`collectClipOpacityFadeLayers` deliberately excludes (T139.2, so the two do not both write MIXER
OPACITY and fight).

That exclusion tested only keyframe **times**, never their **values**:

```js
if (times.length >= 2 && pos - clip.startTime < times[times.length - 1]) set.add(...)
```

So any clip with ≥2 opacity keyframes was excluded — including one whose track never reaches a
visible value from the take position onward. The layer-level fade skipped it, the clip's tween drove
it to 0 or held it there, and the preset 0 stood. **The layer plays and is invisible.** Some clips
keyframed gives *"some of the layers play"*; all of them keyframed gives *"nothing at all"* — the
owner's two symptoms, exactly.

This is the same class T139.1 already patched once on the CUT path (*"a stale 0 from an earlier
fade-out can no longer make a CUT take invisible"*), reappearing on the MIX path through a different
door.

**Fix:** exclude only when the clip's opacity track actually reaches a visible value at or after the
take position. Deliberately **fail bright** — re-including a layer that also tweens its own opacity
risks the double-write T139.2 fixed, which is cosmetic; leaving it out costs a missing layer on air.
Those are not comparable, so uncertainty resolves toward visible.

Verified: `tools/smoke/smoke-wo519-take-fails-bright.test.js`, 8 tests. A fade-in still owns its
opacity (T139.2 preserved); a fade-OUT taken at its **start** is still owned by the clip (it opens
visible — rescuing it would fight the intended fade); a fade-OUT taken **past** its last visible
keyframe is rescued; an all-zero track is rescued; only keyframes at/after the take position count;
single/no-keyframe clips are unchanged. Suite 2141/2139/0.

**Two of those expectations were wrong on my first pass** and the tests caught it: I had asserted a
fade-out should always be rescued, which would have fought a legitimate fade. Corrected — the
distinction is whether anything *ahead of the take position* is visible.

**Still owed: A139.2 (a)–(e) on real PGM output.** This fixes one specific fail-dark path found by
reading; it does not discharge the operator QA that was never done, and the owner's report may have
more than one cause.

## 4. Work log

- 2026-07-07 — WO created from stabilization triage; hazards confirmed by code reading of `timeline-take.js` / `timeline-playback-runtime.js`.
- 2026-07-07 — Implemented. Changes: `src/engine/timeline-take.js` (preset-before-play, single-batch crossfade + one COMMIT per channel, `collectClipOpacityFadeLayers`, +3-frame teardown margin), `timeline-playback-runtime.js` (`playForTake` → `_applyAt({take:true})`), `timeline-playback-amcp-send.js` (`take` option threads through `_syncAmcpLayers`; commit skipped in take mode), `timeline-playback-amcp-schedule.js` (`scheduleLeadTween` branch in `_applyKeyedMixerProp`: lead opacity segment batched as instant start + DEFER tween, `_lastKfSegment` recorded so ticks don't re-send).
- 2026-07-07 — Take order is now: preset opacity (instant) → PLAY + schedule clip DEFER tweens → one batch of layer fade-in + look fade-out DEFER lines → ONE `MIXER COMMIT` per channel fires everything frame-locked → wait duration+3 frames → teardown. CUT: preset 1, commit right after `playForTake` (fires clip lead tweens only).
- 2026-07-07 — Verification: both smokes pass, full test:ci exit 0, eslint clean on all touched files. Remaining: operator PGM QA scenarios (a)–(e).
