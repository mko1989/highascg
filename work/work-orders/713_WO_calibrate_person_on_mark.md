# WO-713 — Calibrate on a person standing on a mark (heads, PTZ cameras, tracking cameras)

**Status: IN PROGRESS (23.10.26) — investigation written; R1 heads + R3 tracking cameras (agent A), R2 PTZ cameras
(agent B) in progress**

Owner, 23.10: *"there should be additional calibration method for a person standing on mark # where i can position
camera or a head to person standing on the mark making the calibration more precise per each device."*

## Investigation

**Heads (WO-700).**
- Lighting → Calibrate heads pins **"Beam is on ‹mark›"** (`godot/client/features/previs/fixtures/calibrate_fold.gd:153`).
- The server pairs the head's live angles with the marker's own `x, y, z` (`src/fixtures/calibrate-session.js:137-165`,
  `{action:'point', id, marker}` or `at:[x,y,z]`).
- In live mode each point becomes an R7 pin `{pan, tilt, dpan, dtilt}` in `offset_map`. These are blended by inverse
  distance² in pan / tilt space (`src/fixtures/beam-offset.js` header).
- Marks are floor spots (WO-703 preset marks sit on the grid at z = z_offset), so **every pin is taken at floor
  height**.
- Following aims at `marker + aim_z` (`follow-engine.js` tick: `[m.x, m.y, m.z + fx.aim_z]`; `aim_z` defaults to 1 m,
  `follow-patch.js:84`).
- So a head is corrected exactly where its beam hits the floor, but it follows at chest height, where pan / tilt
  differ. The offset map is keyed by angle, and the following angles are not the pinned ones. With the head's patched
  position off, that is the drift the owner saw on the far side (WO-700 R7).
- **A person on the mark gives a pin at the following height**, which is the precision the owner asks for.

**PTZ cameras (WO-711).**
- The aim is pure geometry (`src/ptz/ptz-model.js aimAngles`: pose → bearing / elevation, clamped, × units_per_deg).
  There is no calibration at all.
- Pose, yaw and units_per_deg are typed by hand, and the units_per_deg defaults are unconfirmed (WO-711).
- One pin per mark (the operator jogs the camera onto the person, then "Camera is on the person at ‹mark›") fixes pose
  and scale errors where they matter. The beam-offset.js angle-keyed blend is the same maths.

**Tracking cameras (WO-616 T3).**
- Calibration is `godot/client/features/previs/tracking/camera_refine.gd calibrate(cam, points)`: Levenberg–Marquardt
  over the pose, fov and lens, from clicked `{world, screen}` pairs (`calibrate_section.gd`).
- A person standing on a known mark gives such a pair without clicking: the person's feet in that camera's picture
  (the detection box's bottom centre; detect-pin's `pin_point: bottom` uses the same cast) ↔ the mark on the floor.
- The tracking cameras can't be "positioned". But "per each device" includes them, and every mark the person visits
  adds a point where people actually stand.

## Plan

- **R1 heads.** The Calibrate heads fold gets "**Person on the mark**" (a tick). With it, "Beam is on the person at
  ‹mark›" pins the mark raised by **that head's own `aim_z`**: server `point` gets `height` in metres above the mark.
  - While detection runs, the fold shows whether a person is seen near that mark, and how far off.
  - Floor pins and person pins live in the same `offset_map`.
- **R2 PTZ cameras.**
  - A calibrate fold in PTZ cameras: pick a mark; jog pan / tilt (and zoom) through the server, so the camera holds and
    the director is ignored while calibrating; "Camera is on the person at ‹mark›" pins it.
  - `offset_map` per camera goes in `project.previs.tracking.ptz[i]`, written by the client (the slice is client-owned).
    The ptz-model aim applies it with the beam-offset.js blend. Clear / undo.
- **R3 tracking cameras.** Camera calibration gets "**Person is on ‹mark›**": with exactly one person detected in that
  camera, it adds `{world: mark, screen: feet pixel}` to the camera's points, then solves as today.
