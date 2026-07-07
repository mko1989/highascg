# WO-139 — Looks → timeline Take smoothness (flash race, atomic crossfade, teardown)

**Status:** Planned
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

- [ ] T139.1 Pre-set `MIXER <ch>-<L> OPACITY 0 0` on `collectTimelinePhysicalLayers(tl)` BEFORE `playForTake` (or pass an `initialOpacityZero` option into `playForTake`); remove the now-redundant preset from the fade-in batch.
- [ ] T139.2 Merge fade-in and fade-out into one deferred batch with a single `mixerCommit` per channel so the crossfade is frame-locked.
- [ ] T139.3 Add a 2–3 frame safety margin to the teardown wait (or verify tween completion against Caspar OSC frame time) before `clearSceneProgramLookStackLayers`.
- [ ] T139.4 Decide + implement crossfade for take-while-a-timeline-is-playing (timeline→timeline path in `timeline-playback-runtime.js` `play()` / `_stopAll`). Document the decision in this WO.
- [ ] T139.5 Cross-check `collectOccupiedLookLayersOnChannel` against the look→look path (`src/engine/scene-take.js`, `scene-transition.js`, `scene-take-lbg.js`, `scene-exit-layers.js`) so LBG/PGM-only layers from the Jul 2–4 work are fully covered. Reference: `work/WALKTHROUGH_client-agent-pgm-look-take.md`, WO-59/60/63/72/75.

---

## 3. Acceptance criteria

- [ ] A139.1 `node --test tools/smoke/smoke-timeline-take.test.js tools/smoke/smoke-timeline-opacity-fade.test.js` green (output in work log).
- [ ] A139.2 Manual QA on the playout box, watching REAL PGM output (not the GUI preview):
  - (a) look on PGM → Take with MIX/25f — no black frame, no opacity pop
  - (b) CUT take — instant, clean
  - (c) timeline started from inside another look — smooth
  - (d) take while a previous timeline is playing — defined behavior per T139.4, no glitch
  - (e) return from timeline to a look — smooth
- [ ] A139.3 No regression in look→look takes (spot-check MIX + CUT between two looks).

## 4. Work log

- 2026-07-07 — WO created from stabilization triage; hazards confirmed by code reading of `timeline-take.js` / `timeline-playback-runtime.js`.
