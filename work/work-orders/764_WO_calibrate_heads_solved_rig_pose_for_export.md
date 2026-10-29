# WO-764 — Calibrate heads: solve each head's real pose from its marks (for the desk, never the previs)

**Status: OPEN (25.10) — not started; blocks WO-765**

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

## Plan (to confirm with the owner before building)

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
