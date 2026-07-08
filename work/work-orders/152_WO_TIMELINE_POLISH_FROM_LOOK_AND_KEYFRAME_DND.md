# WO-152 — Timeline polish: play-from-inside-a-look transition + keyframe drag-and-drop

**Status:** Planned
**Priority:** High (B152.1 is on-air quality; directly follows WO-139)
**Date:** 2026-07-07
**Source:** `work/todos07.07.26` (owner)
**Related:** WO-139 (direct take — shipped frame-locked crossfade for the Take button path), WO-93 (timeline enhancements).

---

## 1. Items

- [x] B152.1 **Timeline played from INSIDE a look pops instead of transitioning.** *Fixed 2026-07-08 — see work log; root cause was a triple-path flash race, not one bug.* Owner: "when played from inside a look it immediately disappears and appears instead of the next transition." WO-139 fixed the **Take-button** path (`runTimelineDirectTake`); the play-from-look path is different — a look layer with `source.type === 'timeline'` starting via scene take / transport `play()` (`timeline-playback-runtime.js` `play()`, `scene-take.js` timeline-layer handling, `scene-layer` timeline start). Bring that path up to the same standard: preset opacity before PLAY, DEFER fade batched with the look transition's commit (reuse `fadePhysicalLayersIn`/the WO-139 helpers — `collectClipOpacityFadeLayers`, single commit per channel). Reproduce first, confirm which code path fires (log AMCP lines), then fix.
- [x] B152.2 **Keyframe drag-and-drop.** Operator must be able to grab a keyframe in the timeline editor and drag it (in time; optionally across properties?). Client-side: `timeline-canvas-pointer.js` / `timeline-canvas-render.js` hit-testing + drag state; keyframe model updates via `timeline-state-keyframes.js`; snap to other keyframes/clip edges via existing `timeline-canvas-snap.js` machinery. Confirm scope with owner: drag in time only (recommended v1) vs also drag value. *Shipped 2026-07-08 as v1 = drag in time only; see work log for semantics + manual QA.*

## 2. Acceptance criteria

- [ ] A152.1 Starting a timeline from inside a look on PGM produces a proper transition (no disappear/pop) — operator confirms on real PGM; add/extend a smoke asserting the AMCP batch shape for this path (preset + DEFER + single commit).
- [ ] A152.2 Keyframes can be dragged with visible feedback, snapping, and undo-safe state updates; no regression in existing pointer interactions (clip drag, playhead scrub).
- [ ] A152.3 Gates green.

## 3. Work log

- 2026-07-07 — WO created from `work/todos07.07.26`. B152.1 is the highest-value item: it completes what WO-139 started, covering the second of the two operator paths onto a timeline.
- 2026-07-08 — **B152.2 done (v1 = drag in TIME only, per WO recommendation).** The pointer state machine already had a skeletal `keyframe-drag` mode; brought it up to standard:
  - **Hit-test fixed (value-aware):** opacity/volume diamonds are drawn at value height inside the clip row, but `hitKeyframe` tested only the bottom lane — an opacity keyframe at value 1 was ungrabbable. Marker geometry is now shared (`keyframeMarkerOffsetY` / `hitTestKeyframeIndex` in `timeline-canvas-snap.js`) between drawing (`timeline-canvas-clip.js`) and hit-testing (`timeline-canvas-render.js`). Hit radius 8px, nearest marker wins on overlap. Hovering a keyframe shows a `pointer` cursor.
  - **Stale-index bug fixed:** `updateKeyframeTime` used splice+push+sort, so the drag's captured index went stale as the array re-sorted (dragging past ANY other keyframe — even of another property — could start moving the wrong keyframe). It now mutates the keyframe **in place** and re-sorts; the drag state holds the keyframe by object identity and re-derives the index each move.
  - **Clamp semantics (documented choice — simpler than swap):** a dragged keyframe is clamped to its clip (`0..duration`) and cannot cross an adjacent keyframe of the **same property** (stops 1ms short; `clampKeyframeDragTime` in `timeline-state-keyframes.js`, enforced both in the pointer and in the state helper). Keyframes of other properties are not barriers.
  - **Snapping:** same machinery/threshold as clip drags (`SNAP_THRESHOLD_PX = 8`) via new `collectKeyframeSnapCandidates` — playhead (with the wider now-pointer magnet), flags, every clip edge (incl. own clip), and all other keyframes (absolute time, dragged one excluded by identity).
  - **Visual feedback:** grabbed/dragged keyframe renders enlarged with a white outline while dragging, blue (`#58a6ff`) outline while selected (canvas-local selection, cleared when clicking a clip body/empty track).
  - **Commit path (parity with clip drags):** mousemove updates local state only (`timelineState.updateKeyframeTime` → `_save`, localStorage + change event); mouseup fires `onKeyframeDragEnd` **only if the time actually changed** → `syncToServer(tl)` then re-`seek` to refresh the frame (same handler path as before, `timeline-editor-handlers.js` untouched). Note: the timeline editor has no undo stack (clip drags have none either) — "undo-safe" here means identical commit semantics to clip drag; a future undo system hooks the same `_save` path.
  - **Smoke:** `tools/smoke/smoke-timeline-keyframe-dnd.test.js` (13 tests, pure logic: hit radius + value-aware Y, clamp, snap candidates, snap+clamp pipeline, in-place mutation/no-op-no-save) — green. `node --check` + eslint clean on all touched files; all files < 500 lines.
  - **Manual QA (operator) for A152.2:**
    1. Open the timeline editor, drop a media clip, double-click inside it → opacity keyframe appears. Add a second one further right. Drag one keyframe with the value curve visible: the diamond must follow the cursor in time, enlarge with a white ring while dragging, and the dashed value curve must update live.
    2. Value-aware grab: set an opacity keyframe to value 1 (top of the clip row) and confirm it can be grabbed AT the curve height (old bug: only the clip bottom edge responded).
    3. Clamp: drag a keyframe hard left/right — it must stop at the clip start/end; drag it into its same-property neighbour — it must stop just short (no crossing, no reorder). With a `fill_x`/position keyframe present between two opacity keyframes, the opacity keyframe must pass over it freely.
    4. Snap: park the playhead mid-clip and drag a keyframe near it → it must magnet onto the playhead; likewise near clip edges, flags, and another keyframe. Zoom in/out — snapping stays ~8 screen px.
    5. Server sync: release the drag, then check the network tab / server log for one project sync + one `POST /api/timelines/<id>/seek`; scrub across the keyframe → PGM/PRV output reflects the new keyframe time. Click-without-move on a keyframe must NOT trigger a sync.
    6. Persistence "undo-safety": reload the page — the moved keyframe time persists (localStorage + project); no duplicate/lost keyframes after dragging past other properties' keyframes repeatedly.
    7. Regression pass: clip drag + snap, clip edge trim (left/right), playhead scrub in the ruler, flag drag, layer-divider resize, layer reorder via header drag, double-click add-keyframe — all unchanged.

#### 2026-07-08 — B152.1 fixed (orchestrator)

**Root cause (exactly matches the owner's "immediately disappears and appears"):** all three
scene-take paths started look-embedded timelines with plain `timelineEngine.play()` — content
POPPED in at full opacity — and then (standard path only) `fadePhysicalLayersIn` preset those
layers to 0 (content VANISHED) before fading back in. On PGM-only there was no fade-in at all.
Discovery en route: `src/engine/scene-take.js` (`runSceneTake`) is DEAD CODE — no callers; the
live paths are `runSceneTakeLbg` (standard) → `runSceneTakePgmOnly` (PGM-only channels).
scene-take.js left untouched; flagged for future deletion.

**Fix (mirrors WO-139):** new shared `startSceneTimelineLayer` in `timeline-take.js` — presets
the timeline's physical layers to opacity 0 BEFORE PLAY (skipMixerPreCommit batch), starts
playback, returns the layers to fade in (clip-keyframe-owned layers excluded). Wired into:
- `scene-take-lbg-jobs.js` (timeline branch; merge transitions keep plain play — their fade
  batches never run) → `timelineFadeInPhys` returned to `scene-take-lbg.js`.
- `scene-take-lbg-amcp-pipeline.js`: fade-in lines ride the bank-crossfade batch (same commit
  as the look fades). Also fixed a PRE-EXISTING drop: with zero takeJobs (timeline-only look)
  `sendStaggeredTakePlays` silently discarded all suffix crossfade lines — now sent directly.
- `scene-take-lbg.js`: non-crossfade fade batch extended with the fade-in lines (+ condition).
- `scene-take-pgm-only.js`: fade-in DEFER lines join `flatMixer` (fired by the take's leading
  COMMIT); exiting-timeline fade-out skips layers the incoming timeline owns; explicit COMMIT
  fallback for timeline-only looks (also fixes a pre-existing never-fired fade-out there).

**Verification:** new `tools/smoke/smoke-scene-timeline-start.test.js` (4/4: preset-before-play
order + skipMixerPreCommit, cut path untouched, clip-kf exclusion, position semantics);
existing `smoke-scene-take-pgm-only` + timeline take/opacity smokes green; eslint 0 on all five
touched engine files. A152.1 operator check remains: put a look on PGM, start a timeline from
inside another look (MIX) — must fade in with the transition on both LBG and PGM-only channels.
