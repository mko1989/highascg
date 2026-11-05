# WO-956 — The same loop on the same layer in two looks is reloaded on every take (relative start lands 0 … −13 frames off)

**Area:** engine
**Status: OPEN (05.11.26 — measured on the second dev box; fix proposed, waiting for the owner's go)**

Owner 05.11: *"check if the start clip relative to the last one on that layer acts as it should. the idea is that i can
have different looks but on the first layer i have the same loop running, and changing between looks shouldnt restart
the loop"*

Related: [WO-328](./328_WO_MEDIA_PLAYBACK_CONTINUITY_BETWEEN_LOOKS.md) (OPEN: the three continuity mechanisms),
[WO-582](./582_WO_relative_start_moves_loop_point.md) (relative seek: IN 0, a fixed PLAY deadline),
[WO-218](./218_WO_BANK_DRIFT_SKIPPED_LAYERS_MIXER_STATE.md) (SWAP of skipped layers when the bank flips).

## 1. Investigation

- **Setup (live node, PGM ch 2 at 50 fps).**
  - Look `zz_loopcode`: L10 = `zz_loopcode.mp4`, 500 frames at 50 fps, loop on, "Relative to the clip playing on this
    layer"; L11 = a yellow 200 px marker in the top-left corner.
  - Look `zz_loopcode (copy)`: a duplicate whose L11 is a magenta marker. L10 is byte-identical in both looks (field
    diff `{}`).
  - The clip is a **barcode**: 9 black/white stripes hold the frame number, and a 10th stripe is a white reference.
    `tools/test-live/pgm_barcode.py` (new) reads the stripes from a temporary SHM consumer on PGM for every channel
    frame. `pgm_barcode_report.py` (new) lists every frame where the clip did not advance by exactly 1.
  - A first attempt that coded the frame in RGB values was too noisy after H.264 4:2:0 (a "−1" every few frames in
    steady play) and was discarded.
- **Steady play:** 301 channel frames, a loop wrap included: no discontinuity.
- **Takes A ↔ B (double-click = TAKE, about 5–7 s apart), 14 takes in two runs:**
  - The loop **never restarted**.
  - 9 takes landed exactly (0 frames). 4 landed **+1** frame ahead (one frame skipped). 1 landed **−13 frames (0.26 s)
    behind**, a visible jump back. No blended frames were seen on L10.
  - The −13 take is the one whose PLAY was acknowledged late: journal `relative seek lead ch2: 655ms`, against
    380–396 ms for every clean take.
- **Why it is re-seeked at all.** On every take the journal shows `[buildTakeJobs] layer 10 changed. Diffs: ["_"]`.
  - `"_"` is `skipLayerVisualEquality`: `src/engine/scene-take-lbg-jobs.js:154-156` turns off the WO-328 / WO-218
    "visually equal → leave it playing (SWAP on a bank flip)" path.
  - Every take path in `src/api/routes-scene-take.js` passes `skipLayerVisualEquality: true`: PRV staging (210),
    timeline variants (286, 372, 400) and the PGM take (431). Replication does too (`mirror-apply.js:122`).
  - So an identical layer is always reloaded on the other bank, with `LOADBG … LOOP IN 0 SEEK <projected frame>`
    (WO-582). It is only as precise as the PLAY deadline projection: 0 / +1 frame normally, more when Caspar
    acknowledges late.
  - No WO records why the flag is on for takes; the history this repo has starts at the WO-842 import. The likely
    reason is that "Start from beginning" must restart a clip even when the incoming layer equals the outgoing one.

## 2. Proposed fix (not done — owner's call)

For a PGM take, a layer whose clip start is **"Relative to the clip playing on this layer"** and which is visually equal
to the layer on air is **left playing**: no LOADBG / PLAY; on a bank flip, the existing WO-218 SWAP moves it. "Start
from beginning" layers keep today's behaviour (reloaded and restarted).
- PRV staging and replication stay as they are.
- To verify live with the same barcode probe: 0 discontinuities over 10+ takes, the WO-359 route / sweep keep-set, and
  audio continuity (a reload also restarts the audio decoder).

## 3. Verified

Measurements only (above). Test looks `zz_loopcode` / `zz_loopcode (copy)` and `media/zz_loopcode.mp4`,
`zz_mark_a.png`, `zz_mark_b.png` were left on the box for the fix's verification; the probes were removed.
