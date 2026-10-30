# WO-834 — Timeline end holds the last frame (D8)

**Area:** engine
**Status: DONE (30.10) — smoke 5/5; live on the box after the node restart: hold at duration − 1 frame, then the Godot client's seek + Play restarts from 0 (§4)**
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

## 4. Regression found by the WO-836 test agent (30.10)

Card `wo836d` 02 step 8 (Godot, Play after the hold) resumed at the held frame and held again instead of restarting.
`timeline_transport.gd toggle_play()` POSTs `/seek {ms: playhead}` before `/play`. The playhead is parked at
duration − 1 frame, and `seek()` cleared `endHeld` unconditionally
(`src/engine/timeline-playback-runtime.js`), so `play()` never saw the hold. Its restart test also compared `from`
against `duration − 1`, which a one-frame-short playhead never reaches.

Fix in `timeline-playback-runtime.js`:

- `seek()` keeps `endHeld` when the target is the paused held position (within 1 ms). Any real move still clears it.
- `play()` restarts when `from ≥ held position − 1`, not `duration − 1`.

Verified: new smoke case "the clients' seek-to-playhead before Play keeps the hold" passes, and so does the old
"a seek after the hold clears it" case. All timeline smokes pass 177/0.
- Live, after the node restart (30.10, PRV only): the timeline "Timeline" (66276 ms) was played from 64500 ms. It
  parked at 66236 ms with `endHeld: true` and `playing: false`. Then the Godot client's exact Play sequence ran
  (`/seek {ms: 66236}`, `/sendto`, `/play {from: 66236}`). The result was `playing: true` and `position: 1515` 1.5 s
  later, so it restarted from 0. It was stopped afterwards.
