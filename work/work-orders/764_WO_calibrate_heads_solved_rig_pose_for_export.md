# WO-764 — Calibrate heads: solve each head's real pose from its marks (for the desk, never the previs)

**Area:** lighting, tracking-vr
**Status: DONE (16.11.26 — offline: 10 synthetic smokes + Godot suite; end to end on the Hilton Wawer rig through the real calibration sessions with a simulated mis-rig; Inspector line on glass. Not tried on a real rig.)**

Owner 25.10 (`for_LDs.md`): the LD workflow is pre-show in Capture / HighAsCG from one MVR, then on site "fix the
position of the heads to points in real world and digital world, calibrating all the heads then exporting this
calibration data (preferebly via mvr) to the desk".

## Investigation

- Calibrate heads (WO-700 R7) stores only per-head beam corrections: `offset {pan,tilt}` (manual trim) and
  `offset_map` pins (`src/fixtures/beam-offset.js`, inverse-distance² blend). The Lighting session replies with a map
  (`src/fixtures/calibrate-session.js:46-55` `liveSolve`, `:106`), and `follow_model.gd:278 apply_solve` writes only
  `offset_map` / `offset` for it (`:282`, `:290`). The patch pose is never touched.
- That is deliberate. WO-700 R6, owner 23.10: "the calibration cant move the position of the fixture in 3d
  enviroment, just make it point the beam at the mark." R4's "Move head" was removed. The solved place survives only
  as warning text (`src/fixtures/calibrate-solve.js:303-307` `solvePlace`, wording at `:294`).
- An MVR file can't carry pins. Per fixture it carries one world Matrix. A desk's 3D stage aims stage-space positions
  from that alone, so what the desk needs is a pose: position plus rotation.
- A pose solver already exists: `solveFixturePose(pts, {hang})` (`calibrate-solve.js:209`, `MIN_POINTS = 3` at `:21`).
  It solves x, y, z and yaw for a fixed hang. It is used by the camera / follow session (`calibrate-session.js:106`,
  non-live branch), not by Calibrate heads.
  - Missing for a desk-grade pose: pitch and roll, since a head on a raked pipe or a turned clamp isn't level. MVR
    import already reads them (`src/stage/mvr-patch.js:80 poseFromMatrix` → `{x,y,z,hang,yaw,pitch,roll}`).
  - Also missing: a fit report per head (RMS, spread, worst mark).
- Calibrate heads' points are `{pan, tilt, x, y, z}` pairs against `project.fixtures.marks`, so they can feed the
  solver as they are.

## Note from WO-804 (29.10)

- `calibrate-solve.js solvePoseForward(pts, forward, {pose})` now solves x, y, z, yaw through the head's own GDTF
  model (the live points are physical GDTF angles, so `solveFixturePose`'s generic beam does not fit them). WO-804's rig
  flow writes `calibrated_pose {x, y, z, yaw, pitch, roll, hang, source, residual_m, rms_deg}` per head
  (`follow_model.gd apply_rig`, kept by `normalize_fixture`). Still open here: pitch / roll, the per-head Inspector
  line, Clear dropping it.

## Plan (as written 25.10; decisions below)

- Keep R6: the previs head stays where it is patched, and the pins keep making the 3D beam exact.
- Server: from the head's Calibrate heads points (3+), solve `{x, y, z, yaw, pitch, roll, hang}`. Start from the
  patched pose, use 6-DOF least squares, and keep the hang flip. Return it with `rms_deg`, `max_deg`, `spread_m` and a
  warning.
- Store it next to the pins as `calibrated_pose` on the fixture: export-only data, never read by the previs. Clear
  drops it together with the pins.
- Inspector line per head: "Desk pose: X … Y … Z … yaw … (fit … °)", or "needs 3 marks", plus the existing warnings.
- **Owner question:** should the previs offer a "use the desk pose in the 3D view" toggle (pins off), so the LD sees
  what the desk will aim? That would be an explicit, opt-in exception to R6.

## Acceptance

- Smoke: synthetic rig (known pose, including pitch / roll) → simulated pan / tilt on 4+ marks → the solved pose is
  within 1 cm / 0.1°; 3 collinear marks → warning; fewer than 3 → `need`.
- Godot test: `apply_solve` writes `calibrated_pose` and leaves `pose` unchanged (R6 guard).
- Live: one real head on 4 taped marks; the solved pose lies within the measured hang.

## Decisions (16.11, taken on evidence — the owner question was not asked)

- **No "desk pose in the 3D view" toggle.** R6 stays absolute: the previs head never moves, the pins keep the 3D beam
  exact, and the measured pose is shown as one Inspector line ("Desk pose (measured · 4 marks): 0.39 m from the patch,
  turned 2.5° — good: …"). Reason: the pins already make the previs beam land where the real one does; a second
  geometry in the same view would show two different "truths" and the owner's R6 rule (23.10) forbids moving the head.
  The desk sees the pose through the export (WO-765).
- **Pitch / roll only when the marks prove them.** A 6-DOF fit is kept only when (a) the 4-DOF fit with the patch's
  pitch / roll is contradicted (χ² drop > 9.21, 2 dof at 99 %, σ 0.3° aim noise), (b) the marks pin the tilt
  (sd ≤ 3°) and (c) the change is tame (≤ 30°, `MAX_TILT_CHANGE_DEG`). Otherwise pitch / roll stay as patched and the
  note says so. Reason: with 4 marks near the floor, a free 6-DOF fit trades tilt against position and invents
  several-degree tilts from 0.3° of aim noise (seen in the harness before the gate).
- **Rig flow asks 4 marks per anchor** (`rig-anchors.js MARKS_PER_ANCHOR`, was 3): 3 marks solve 4-DOF exactly
  (no residual, so no verdict); the 4th gives the fit check.
- **A row inherits a rake only from agreeing anchors** (`rig-infer.js ROW_TILT_AGREE_DEG = 2`, 2+ anchors of the row
  all solved 6-DOF and within 2°). Reason: the harness showed one tilted anchor (a turned clamp) carried to its
  row-mates made them worse than the patch.

## What was done

- `src/fixtures/calibrate-pose.js` (new) `solveHeadPose(points, forward, {pose, mirrorPan})`: 4-DOF (x, y, z, yaw)
  then the gated 6-DOF through the head's own GDTF chain (`calibrate-solve.js` `lm` / `solveLinear`, now exported),
  floor hang kept. Returns `{ok, pose, dof, rms_deg, max_deg, errors_deg, floor_m (per mark), worst, spread_m,
  verdict good | weak | bad, note, warning}`; <3 marks → `{ok:false, need}`. Verdicts: bad = pan runs mirrored (a
  flipped-pan fit beats the straight one), a mark missing by > 0.25 m on its floor (named) or fit rms > 2°; weak =
  marks within 0.3 m of a line, a desk aim sd > 0.1 m over the marked area, a tilt hint the marks can't pin, or only
  3 marks; else good.
- `calibrate-session.js`: the live (WO-700) session solves after each pin and replies `pose_fit`; pins carry the
  mark's `at` and `name`. `rig-calibrate.js` solves anchors with `solveHeadPose` and passes verdict / note / dof /
  marks; `rig-infer.js` the agreeing-rake rule above.
- Godot: `follow_model.gd normalize_calibrated_pose` keeps `max_deg, verdict, note, dof, marks, method`
  (marks | rig); `apply_solve` writes `calibrated_pose` (source measured, method marks) from `pose_fit` and drops a
  marks-made one when the fit goes away; `pose` is never written (R6 guard test). `apply_rig` sets method rig.
  `desk_pose_model.gd` (new) builds the Inspector line; `calibrate_fold.gd` shows it under the trim, and **Clear**
  erases `calibrated_pose` with the pins. `calib_summary` adds "Desk pose: …" / "N more mark(s) to solve where it hangs".
- Commits: dce3fbf4 (server), 7d28e68d (client + export), 84ca5d2a (row rake rule).

## What was verified

- `tools/smoke/smoke-wo764-head-pose-solve.test.js` — 10 tests, all pass: noise-free 6-DOF recovery < 5 mm /
  0.05°; level head + 0.3° noise → good, 4-DOF; tilted head on a grid → dof 6; 3 marks → weak; collinear → weak;
  mirrored pan → bad; one mark 1 m wrong → bad naming it; floor head; rig-infer rake rule; pins keep `at` / `name`.
- Godot suite 28985 passed / 0 failed, incl. `test_pose_fit_writes_desk_pose_only` (pose untouched).
- **End to end, Hilton Wawer (8 × ADJ Focus Profile, front truss), harness outside the live server** (scratchpad
  `e2e.js`): reality = truss +0.25 m x, +0.2 m y, −8 cm z, turned 3°; each clamp ±0.1 m / ±2°; head 3 pitched 5°,
  head 6 rolled −4°, head 8 pitched −3° / rolled 2°. Angles generated from the TRUE poses on the 9 WO-703 preset
  marks with 0.3° noise, fed through the real `createCalibration` / `createRigCalibration` sessions. "Desk aim" = how
  far a desk aiming from the pose lands from the floor point it wants (rms / worst over a 5 × 5 grid):

  | run | measured heads | inferred heads |
  |---|---|---|
  | rig flow (3 anchors) + single flow on head 2 | pos 0.01–0.24 m, rot 0.17–1.32°; aim 0.04–0.09 m rms (worst ≤ 0.24) vs patch 0.32–1.24 m | pos 0.22–0.39 m, rot 2–5°; aim 0.45–1.33 m — no better than the patch (per-clamp error can't be inferred) |
  | rigid truss (no per-clamp error) | same | pos ≤ 0.07 m, rot 0.17°; aim 0.04–0.05 m rms |
  | every head measured | all good; aim 0.02–0.09 m rms (worst ≤ 0.24) vs patch 0.32–1.46 m | — |

  Position error along the beam (head 8: 0.24 m) barely moves the aim; the aim error is what a desk sees.
- On glass (16.11): the Inspector line for head 1 with the rig pose written through autosave; the project was then
  restored (marks [], no `calibrated_pose`; equal to the pre-test snapshot apart from rev / savedAt).
- **Not verified:** a real head on taped marks (the Live acceptance item); a real raked pipe; inferred heads on a rig
  whose clamps are individually off are not better than the patch — measure the heads that matter.
