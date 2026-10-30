# WO-713 — Calibrate on a person standing on a mark (heads, PTZ cameras, tracking cameras)

**Area:** tracking-vr
**Status: DONE (23.10.26) — R1–R3 built; offline suite + Godot tests green, server routes probed live on the box;
the GUI paths and real PTZ cameras / people on marks are owner QA (checklist C)**

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

## What was done

**R1: heads** (79d63a63)
- `src/fixtures/calibrate-session.js` `heightOf()`: `point` takes `height`, which can be:
  - absent / null / '' / false → the floor (0), as before;
  - `'aim'` / `true` → the head's own `aim_z`;
  - a number from 0 to 3 m;
  - anything else → 400.
- The pair is taken at `mark.z + height`, in both live (R7 pin) and hold mode. The point carries `height` when it is not
  zero.
- `calibrate_fold.gd`:
  - a **Person on the mark** tick. With it, the button reads "Beam is on the person at ‹mark›" and sends
    `height: 'aim'`;
  - one status line from WS `tracking:detections` (only while ticked and visible): "Person 0.30 m off Mark 2", with
    "is someone on the mark?" past 0.5 m.
- `follow_model.gd calib_summary`: "N marks pinned (M on a person)".
- Floor pins and person pins share the head's `offset_map`.

**R2: PTZ cameras** (32f972d7)
- `src/ptz/ptz-service.js` `hold / release / holdOf / camera`: a held camera gets the operator's angles, and the
  director's target is never asked for it.
  - The hold has a 60 s TTL, refreshed by any action. The ptz duty gate still applies. Its state shows as
    `calibrating`.
- `src/ptz/ptz-calibrate.js`: `POST /api/tracking/ptz/calibrate`, served by `auto-routes.js handleAuto`, so register.js
  and router.js are not touched. The actions are:
  - start | jog `{dpan, dtilt, pan, tilt, zoom}` | point `{marker | at}` | undo | clear | end;
  - `GET` lists the open sessions.
  - A pin = the geometric angles at mark + `aim_z`, with `dpan / dtilt` = held − geometric. The same spot within 1°
    replaces its pin (beam-offset.js `addPin`).
- `src/ptz/ptz-model.js`:
  - `offset_map` is kept: at most 32 pins, validated and clamped as for heads;
  - `geomAngles` is the pure geometry;
  - `aimAngles` = geometry + the inverse-distance² blend (beam-offset.js `blend`), exact on a pin.
  - The Godot twin is `ptz_model.gd`.
- `ptz_calibrate_fold.gd` (new) in PTZ cameras:
  - mark picker (`project.fixtures.marks`, as the heads fold), Pan / Tilt ±5 / ±0.5, zoom;
  - "Camera is on the person at ‹mark›", Undo, Clear, Done, and the pin count;
  - a 20 s keep-alive.
  - Done writes the pins into the camera's `offset_map` through `ptz_section.gd`'s normal save. Closing without Done
    releases the camera and writes nothing.

**R3: tracking cameras** (79d63a63)
- The camera calibration is `tracking_page.gd` (Solve → `camera_refine.calibrate`), not `calibrate_section.gd` as the
  plan said; that file is the heads' session UI.
- New `person_mark_row.gd` under Solve: mark picker + **Person is on ‹mark›**.
- `person_mark_model.gd person_point()` builds the point. With exactly one fresh person (age_s 0) in THAT camera, it
  adds `{id: "person:<mark>", world: mark, screen: feet}` (box bottom centre × the camera raster, the same cast as
  `detect-model.js boxPoint`) and solves.
- It refuses with one line when detection is off, the camera is stale, nobody / several people are seen, or the feet are
  cut off at the frame bottom.
- The same mark again replaces its point. `tracking_overlay.gd` no longer labels these points "(gone)".

## What was VERIFIED

**Offline**
- `test:ci`: 3008 tests, 3005 pass, 2 skipped, 1 fail (the known WO-308 pointer-confine test).
- New smokes: `smoke-wo713-ptz-calibrate` 17/17 and `smoke-wo713-person-on-mark` 7/7. Both are registered in
  run-offline-tests.js.
- wo700 / wo707–712 smokes unchanged.
- Godot `run_tests.gd`: 21367 passed, 0 failed. This includes `test_person_mark_model.gd` (8) and the new
  `test_tracking_ptz.gd` offset_map parity / aim-on-pin tests.
- `run-client.sh --check`: boot OK.
- Lint: 0 errors. Prettier is clean on the touched files. max-lines: 0 over (tracking_page.gd 495). No new unwired
  exports.

**Live on the box** (server pid 1411684 after the restart)
- `GET /api/tracking/ptz/calibrate` → `{"sessions":[]}`. start on an unknown camera → 404. A bad action → 400 listing
  the six actions. The route is reachable through the router.
- A heads session on Focus Profile 1 1 (`start hold:false`, then `point at:[0,3,0] height:'aim'`) pinned
  `{x 0, y 3, z 1, height 1, dpan 6.23, dtilt 0.86}`. The head's aim_z is 1 m. `height: 9` → 400.
- The session was ended without Done, so nothing was written to the project.
- The GUI was relaunched on this build (pid 1412803) with no script errors in its log.

**Owner QA, not proven**
- The heads tick + person line with someone actually on a mark.
- The PTZ fold on a real camera: jog direction, whether the pin lands the person in frame, and the blend between marks.
  The VISCA units are still the WO-711 assumption.
- The tracking-camera row against a live person. Box space vs. the calibration raster is checked from source only
  (detector.py un-letterboxes to the full frame, and `adopt_size` keeps the raster in step).
