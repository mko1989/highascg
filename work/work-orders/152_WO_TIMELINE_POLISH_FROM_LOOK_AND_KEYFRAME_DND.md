# WO-152 — Timeline polish: play-from-inside-a-look transition + keyframe drag-and-drop

**Status:** Planned
**Priority:** High (B152.1 is on-air quality; directly follows WO-139)
**Date:** 2026-07-07
**Source:** `work/todos07.07.26` (owner)
**Related:** WO-139 (direct take — shipped frame-locked crossfade for the Take button path), WO-93 (timeline enhancements).

---

## 1. Items

- [ ] B152.1 **Timeline played from INSIDE a look pops instead of transitioning.** Owner: "when played from inside a look it immediately disappears and appears instead of the next transition." WO-139 fixed the **Take-button** path (`runTimelineDirectTake`); the play-from-look path is different — a look layer with `source.type === 'timeline'` starting via scene take / transport `play()` (`timeline-playback-runtime.js` `play()`, `scene-take.js` timeline-layer handling, `scene-layer` timeline start). Bring that path up to the same standard: preset opacity before PLAY, DEFER fade batched with the look transition's commit (reuse `fadePhysicalLayersIn`/the WO-139 helpers — `collectClipOpacityFadeLayers`, single commit per channel). Reproduce first, confirm which code path fires (log AMCP lines), then fix.
- [ ] B152.2 **Keyframe drag-and-drop.** Operator must be able to grab a keyframe in the timeline editor and drag it (in time; optionally across properties?). Client-side: `timeline-canvas-pointer.js` / `timeline-canvas-render.js` hit-testing + drag state; keyframe model updates via `timeline-state-keyframes.js`; snap to other keyframes/clip edges via existing `timeline-canvas-snap.js` machinery. Confirm scope with owner: drag in time only (recommended v1) vs also drag value.

## 2. Acceptance criteria

- [ ] A152.1 Starting a timeline from inside a look on PGM produces a proper transition (no disappear/pop) — operator confirms on real PGM; add/extend a smoke asserting the AMCP batch shape for this path (preset + DEFER + single commit).
- [ ] A152.2 Keyframes can be dragged with visible feedback, snapping, and undo-safe state updates; no regression in existing pointer interactions (clip drag, playhead scrub).
- [ ] A152.3 Gates green.

## 3. Work log

- 2026-07-07 — WO created from `work/todos07.07.26`. B152.1 is the highest-value item: it completes what WO-139 started, covering the second of the two operator paths onto a timeline.
