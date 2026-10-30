# WO-834 — Timeline end holds the last frame (D8)

**Area:** engine
**Status: DONE offline (30.10, smoke 4/4, Godot 23015/0) — live wire test on PGM pending the next node restart (batched with the sweep fixes)**
**Source:** WO-828 D8, owner 30.10: *"the timeline should end on last frame always (unless it was ofcourse set manualy to
something different), but when timeline end equal clip end then last frame."*
**Related:** WO-828, WO-829.

## 1. Investigation

`_tick` (src/engine/timeline-playback-runtime.js) calls `this.stop(airId)` when a non-looping timeline reaches
`tl.duration`. `stop()` runs `_stopAll`, so every layer goes to black at the end. A clip that ends exactly at the
timeline end is therefore never seen on its last frame.

The owner's answer to D8 ("hold the last frame or black"): hold by default, black only when set on the timeline.

## 2. What was done

- **`src/engine/timeline-playback-runtime.js`**
  - `_tick`: a non-looping end calls the new `_holdEnd()` unless `tl.endBehaviour === 'black'`, which keeps the
    old `stop()`.
  - `_holdEnd()`: stops the ticker and parks the playhead one timeline frame before the end (`duration − 1000/fps`),
    so a clip that ends with the timeline is still under it. It then PAUSEs the layers and runs the paused apply,
    which:
    - STOPs a layer whose clip ended earlier;
    - SEEKs a held layer to that exact frame, because the tick lands up to 40 ms late.
  - The timeline stays on air (`_airTimelineId`, transport cache kept), with `cell.endHeld = true`.
  - `play()` on a held timeline starts over from 0, as a `restart` + `seamless` play: a clip on air at both ends is
    re-PLAYed without a STOP. Resuming would only play the last frame and hold again. `seek()` and `stop()` clear the
    flag, so Play after a scrub resumes from the scrub point.
- **`src/engine/timeline-engine.js` `create()`** keeps `endBehaviour: 'black'`. `update()` already stores the whole
  body.
- **Godot `timeline_transport.gd`**: a **Hold** toggle after Loop (pressed = hold, the default). It stores
  `endBehaviour` on the timeline and saves through the normal `edited` commit. The web client keeps the field: its
  timeline model passes whole objects and `normalizeLoadedTimelines` doesn't strip keys. It has no toggle (Godot is
  the operator client).

## 3. Verified

- `tools/smoke/smoke-wo834-timeline-end-hold.test.js` passes 4/4:
  - the end PAUSEs the clip that ends with the timeline, parks at 9960 ms and stays on air;
  - `'black'` STOPs;
  - Play after the hold restarts from 0 with no STOP of the continuing clip;
  - a seek clears the hold.
- On the old code, test 1 fails: it STOPs 1-210.
- The WO-828 and WO-829 smokes still pass (29/0 together).
- Godot suite: 23015 passed, 0 failed. `timeline_transport.gd` parses; the only `--check-only` error is the
  `ProjectSync` autoload, which `-s` mode lacks.
