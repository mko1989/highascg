# WO-956 — The same loop on the same layer in two looks is reloaded on every take (relative start lands 0 … −13 frames off)

**Area:** engine
**Status: DONE (05.11.26 — same loop: 10 takes, 0 discontinuities in 2900 frames (barcode probe on PGM); different clips: every on-time take landed 0 / ±1 frame inside the incoming clip, wraps included; smokes + offline suite green) — owner QA**

Owner 05.11: *"check if the start clip relative to the last one on that layer acts as it should. the idea is that i can
have different looks but on the first layer i have the same loop running, and changing between looks shouldnt restart
the loop"*. After the report: *"yes. but we also need a way for different clips to also be able to start relative to the
clip playin on that layer."*

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

- **Different clips (after the owner's go).** The relative seek reads the playhead of whatever is on air on that layer
  (`scene-play-seek.js` → `projectRelativeSeekFrames`), so a different clip already got the outgoing clip's position.
  But the position was wrapped only by the **outgoing** clip's length. A shorter incoming clip could therefore be sent a
  SEEK past its own end, and a seek past the incoming trim-out also dropped its LENGTH (`scene-take-lbg-jobs.js`
  "trim-out ≤ start → no LENGTH"), so the untrimmed tail played.

## 2. What was done

- **Same clip, same layer, keeps playing.** `src/engine/scene-transition.js` `relativeLayerKeepsPlaying(cur, incoming)`
  is true when all of these hold:
  - the incoming layer is "Relative to the clip playing on this layer";
  - the on-air layer shows the same thing (`layerVisuallyEqual`: source, box, opacity, loop, audio, effects, PIP …);
  - it has the same trim in / out;
  - it is not a playlist and not a timeline.

  `buildTakeJobs` takes a new `keepRelativeLayers` option. Such a layer gets no job, and the existing WO-218 path SWAPs
  it to the new bank (`SWAP 2-10 2-110 TRANSFORMS`). The WO-359 sweep keep-set already protects it, and it logs
  `[buildTakeJobs] layer N keeps playing (relative start, unchanged)`. Only the two PGM take calls in
  `routes-scene-take.js` pass the option (pgm/prv path and pgm-only path). PRV staging, the PGM → PRV exchange and
  replication keep `skipLayerVisualEquality` as before. "Start from beginning" layers still reload and restart.
- **Different clips start relative too.** `scene-play-seek.js` `fitRelativeSeekToIncomingClip` places every relative
  seek inside the **incoming** clip's own span: trim-in … trim-out, else 0 … its length from the media cache.
  - Past the end, a looping clip wraps; a one-shot starts at its in point.
  - A seek inside the span, or a clip of unknown length, is unchanged.

  Every relative branch (OSC projection, client playSeekFrames, live read, last frame, matrix) goes through it, and
  each projected seek logs `[relative-seek] 2-110 → L10 <clip>: playhead P → SEEK F`.
- `tools/smoke/smoke-scene-relative-seek-in-point.test.js`: the WO-570 case "trim-out before a relative start point
  sends no LENGTH" encoded the black-tail bug. A relative seek of 264 with trim-out 4 s sent no LENGTH and played the
  untrimmed clip. It is replaced by the stronger rule: the seek wraps to 64 inside the 200-frame loop and LENGTH 200 is
  kept. A new case checks that a one-shot starts at its in point.
- `tools/smoke/smoke-wo956-relative-layer-keeps-playing.test.js` (curated, 3 tests):
  - an unchanged relative loop gets no job and is listed for the SWAP;
  - "beginning", another clip, moved, another trim, a playlist, and no `keepRelativeLayers` all still take;
  - the seek fit: inside the span, a wrap, a one-shot, trim 50…250, unknown length.

## 3. Verified

- Smokes: the take-engine set (70 files) has 472 passing; the 1 failure is the known flaky `recordPause`. The full
  offline suite has 5306 passing and the 4 known box failures (real ffmpeg, WO-40a, 3-head layout, recordPause).
  `check-max-file-lines`, `check-unwired-exports` and `check-require-integrity` are OK; eslint is clean.
- Live, second dev box, PGM ch 2 at 50 fps, with the barcode probe on L10's area:
  - **Same loop, A ↔ B, 10 takes:** `layer 10 keeps playing` 10 times, `SWAP 2-10 2-110 TRANSFORMS` / back each time,
    and **0 discontinuities in 2900 frames (58 s)**. Before the fix the same test had 4 × +1 and 1 × −13 in 14 takes.
    INFO afterwards shows one copy of the loop (2-110) and the right marker (2-111).
  - **Different clips, A (white, 500 frames) ↔ C (blue, 300 frames), 12 takes:**
    - the seek log shows the wrap, e.g. `playhead 376 → SEEK 76`;
    - on the probe, every take whose PLAY was acknowledged on time (≈ 385 ms) landed **0 or ±1 frame** from the outgoing
      clip's position, wraps included;
    - three takes whose PLAY was acknowledged late landed −3, −3 and −11 frames (lead 451, 436 and 581 ms). The lateness
      is Caspar's, the WO-582 limit of reloading a clip, and only a different clip is reloaded now.
  - A first different-clip run before the seek log existed had one take land at 515 mod 300. That run had no seek log,
    so its source was never identified. It did not recur in the 12 logged takes; the per-seek log line is kept so a
    recurrence shows its numbers.
- Cleanup: probes removed; the three test looks deleted through the deck; the test media deleted
  (`/api/media/delete`, 4 files); `CLEAR` sent for 2-10/11/110/111 and 3-10/11. PGM is back to layer 1 only.

## Notes

- A layer that keeps playing changes nothing on Caspar for that layer; its other layers take as usual.
- With "keeps playing" on a higher layer and a changed layer below it, the changed layer loads on the new bank (1xx)
  and is drawn above the kept layer until the post-mix SWAP. That is the WO-218 behaviour; the owner's case (loop on
  the first layer) is not affected.
