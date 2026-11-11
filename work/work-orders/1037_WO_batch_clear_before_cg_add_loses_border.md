# WO-1037 — A PIP border new on a layer of a PGM-only screen never showed (batch: clear before CG ADD)
**Area:** amcp, engine
**Status: DONE (11.11 — box: take of the look, layer 264 present, ring on key and fill; f646399b)**

Owner, 11.11: *"tried it the border does not show up."*

## Investigation

- Take log: the border commands were sent (`CG 4-264 CLEAR`, `MIXER 4-264 CLEAR`, `CG 4-264 ADD 0 "pip_border" …`,
  all `202`), inside the take's BEGIN…COMMIT batch; `INFO 4` afterwards had no layer 264. Nothing later cleared it.
- The same `CG ADD` sent alone showed the ring on both outputs.
- Four batches on 4-264 (build 5c3373ec5): `MIXER CLEAR + CG ADD` → layer there; `CG CLEAR + CG ADD` → gone;
  `CLEAR + CG ADD` → gone; clear in one batch and add in the next → there. Inside one batch the clear lands after the
  add.
- The take strips the overlay slot when the border is new on that layer (`shouldStripPipSlotBeforeAdd`), and a
  PGM-only screen takes straight to program in one batch.

## What was done

`src/caspar/amcp-batch-cg-clear.js` `dropClearsBeforeCgAdd`, applied in `runBeginCommitBatch`: a `CG x CLEAR` /
`CLEAR x` that a later `CG x ADD` in the same batch makes redundant is left out (CG ADD replaces what is on the layer).

## Verified

- `tools/smoke/smoke-wo1037-batch-clear-before-cg-add.test.js` (4).
- Box: `POST /api/scene/take-look` of the look → layers 11, 264, 700; screenshot: white ring on the key output, red
  ring on the fill output, with the lower third.
- Not done: the Caspar-side cause (batch ordering of CG CLEAR) is not fixed in the server build.
