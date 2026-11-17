# WO-1113 — Previs decode honours a patch that runs pan / tilt against the GDTF file

**Area:** lighting, tracking-vr
**Status: DONE (17.11.26 — smoke + on the box: MagicQ Focus Hold beams meet at the target in the previs)**

Found while porting the Narvil MagicQ show to gutmanny 26 ([WO-1112](./1112_WO_gutmanny26_magicq_show_from_narvil.md)).

## Investigation

- MagicQ Focus Hold on stage centre (all 252 heads), previs in visualise mode: the beams did not meet. Comparing
  `GET /api/tracking/fixtures` axes with `POST /api/fixtures/program/aim` for the same point: Robin 54/54 equal;
  Quantum 36/36 and Focus Profile 24/24 equal pan, tilt of opposite sign; Vizi Beam both signs opposite; X-Dot Max
  pan opposite. The desk personalities count those axes the other way than the GDTF files.
- `src/fixtures/gdtf-patch.js` applyType folded the patch's `pan.invert` / `tilt.invert` into one flag with the file's
  falling range, used only when HighAsCG writes an aim (gdtf-ik.js toPhys). `src/fixtures/gdtf-visual.js` decodeVisual
  read pan / tilt straight from the file's physical range — a patch invert never reached the previs.

## What was done

- `gdtf-patch.js` applyType keeps the patch's own flag as `fx.pan.flip` / `fx.tilt.flip`.
- `gdtf-visual.js` decodeVisual takes `flip { pan, tilt }` and negates that axis (before the calibrated offset).
- `follow-service.js` visual() passes the fixture's flip.
- Project gutmanny 26: `tilt.invert` on Quantum + Focus Profile, both on Vizi Beam, `pan.invert` on X-Dot Max (100
  fixtures); the Pan / Tilt numbers stored in the nine lighting looks negated for those axes (934 values) so the looks
  keep their picture. Snapshot before: scratchpad `snap/gutmanny_before_flip.json`.
- `tools/smoke/smoke-wo1113-visual-patch-flip.test.js` (in the curated list); the source-text assertion of
  smoke-wo700 repointed.

## What was verified

- Smokes wo1113, wo615-visual, wo615-programmer, wo700: 27 pass, 0 fail. eslint clean, line limit OK.
- Box, node restarted: Focus Hold at stage centre → previs screenshot shows the beams meeting there; desk angles equal
  HighAsCG's own aim for Quantum, Focus Profile, Vizi Beam, Robin.

## Not verified

- No UI for the flag on a typed fixture (set in the project data). X-Dot / X-Dot Max still differ (see WO-1112).
- The stored looks were not viewed one by one after the sign change.
