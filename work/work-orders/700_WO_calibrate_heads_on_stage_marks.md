# WO-700 — calibrate heads from Lighting, on real stage marks

**Status: DONE (2026-10-23, R2 below: smoke-wo700 8/8 + wo624/wo630 10/10, test:ci 2856/2859 (known pointer-confine),
Godot 21158/0; no-hold session probed over the API on the box's Focus Profile 1 (reads its DMX, sends nothing, a mark
it is not on is refused); fold order checked in a second client — owner QA: calibrate one head on 3–4 marks)**

Owner, 23.10: *"how to calibrate the heads? it should be done by pointing the lights at markers in real life than
clicking this position of pan tilt is this marker and it calibrates"*

## Investigation

- The solver already does exactly this (WO-624 E3, `src/fixtures/calibrate-session.js` + `calibrate-solve.js`): `start`
  parks the head, `jog` moves it, `point` pairs the head's pan / tilt with a stage position — a tracking `marker` or
  (WO-630 F1) `at: [x, y, z]` — and from 3 pairs it solves x / y / z / yaw (and says when Invert pan is wrong).
- But it was only reachable in Camera mode → Tracking cameras → Follow → Calibrate (`follow_section.gd` →
  `calibrate_section.gd`), and its "points" were tracking markers you drag onto the beam or a click in a camera
  picture — no notion of a fixed, measured floor spot ("markers in real life").
- `output_enabled` in the session reply was `engine.enabled` = the FOLLOW output. A typed head sent by the DMX master
  (fixtures.dmx, WO-615 T4) moves with the follow output off, yet the summary said "Art-Net output is off — the head
  will not move" (this box: `[follow] … output off (artnet)` while DMX master sends Art-Net 100).

## What was done

- **Stage marks** `project.fixtures.marks: [{id, name, x, y, z}]` (PSN metres) — `follow_model.gd normalize_marks`,
  kept by `normalize` (a save no longer drops them). Drawn on the previs floor (`calib_marks_3d.gd`: cross + name tag,
  a child of the previs stage — `fixtures_3d.gd` frees its own children on every rebuild).
- **Lighting → Calibrate heads** (`calibrate_fold.gd`, between "Selected heads — patch" and "DMX output"):
  - marks list; **Place mark** (toggle) → the next 3D floor click drops "Mark N" there (`fixture_selection.gd`
    `mark_pick` / `floor_picked`, handled first in `fixtures_3d.gd click`); name + X / Y / Z (m) for the measured
    position (stored to the millimetre); Remove mark;
  - for exactly one selected head, the WO-624 session (`calibrate_section.gd` with `camera_tools = false`: no tracking
    marker / camera picture rows, its own how-to): Calibrate position… → Pan / Tilt jog → pick the mark the real beam
    is on → **Beam is on <mark>** (`add_floor_point([x, y, z])`) → from 3 marks the fit → **Apply pose** writes it into
    the head's patch entry → Done.
- `follow-engine.js isLive(fx)` = the head's universe goes on the wire (follow output or DMX master); the session's
  `output_enabled` uses it; the summary line now reads "DMX output is off for this head's universe".
- The Camera-mode Calibrate (markers, Find beam spot, camera clicks) is unchanged.

## Verified

- `tools/smoke/smoke-wo700-calibrate-heads-lighting.test.js` 3/3: real engine — DMX master on → output_enabled true,
  off → false; a mark position becomes the point; source pins for the wiring. wo624 + wo630 calibrate smokes 10/10.
  Godot 21156/0 (+`test_stage_marks_normalize`). Full gate list: test:ci 2851/2854 (only the known pointer-confine),
  lint 214, format, line limit, unwired exports, audit, `--no-http`, `run-client.sh --check`.
- Box, second client (Previs → 3D → Lighting → Calibrate heads): Place mark + floor click → `GET /api/project`
  `marks: [{id 1, "Mark 1", x -0.21, y 2.36, z 0}]`, "Mark 1" drawn on the stage; typed "DS centre", Tab, "1.5", Tab →
  saved `{name "DS centre", x 1.5}` (Tab lands in the next field, text selected); Remove mark → `marks: []`. One head
  clicked in 3D → "Calibrate position…" shown.
- NOT run: a calibration session on the owner's live heads (it parks a real head) — owner QA.

## R2 — calibrate with the Programmer's controls, the digital head corrected per point (23.10)

Owner, 23.10: *"the calibrate has different controls than the programer. calibrate should be just above programer."*
→ *"rather just below the programer."* → *"calibrating the light should work light that. point the real light at the
real marker on stage. click calibrate, which doesnt output artnet but moves the digital beam to light at the marker.
the position pan/tilt of the digital gets corrected each calibration point is added."*

### Investigation

- The R1 fold reused the WO-624 camera session: `start` parks the head with `engine.hold` and its own Pan / Tilt jog
  rows drive it in the follow engine's commanded degrees — a second set of aim controls next to the Programmer
  (`programmer_section.gd`, GDTF physical degrees), and the session itself transmits (the hold is output).
- A typed head the Programmer drives is drawn by the previs from its bytes through the type's Axis chain
  (`follow-service.js` `visual()` → `gdtf-visual.js`; forward kinematics = `gdtf-ik.js` `beamOf`, file sense), not by
  `follow-ik.js` `beam` — so a pose solved in the generic model need not put the *digital* beam on the mark.
- The solve needed 3 pairs before anything changed (`calibrate-solve.js` `MIN_POINTS`), and Apply was by hand.
- Live probe (box, Focus Profile 1: floor hang z 2, at pan ≈ 1° / tilt ≈ −0.5° — beaming straight up — and a test
  point on a floor spot 9 m away it was not aimed at): the first prior-only partial solve "fitted" it by moving the
  head to (0, 3, −0.56) — a beam that starts at its target points at it in every direction. Guarded (below).

### What was done

- **Server** (`calibrate-session.js`): `{action: 'start', hold: false}` = a live session — nothing is held or sent;
  `jog` → 409. Each `point` reads the pan / tilt the real head gets from `frame(fx)` (`follow-service.js`
  `liveFrame`: the console's input in visualiser mode, else our output while it is sent; none → 409) through
  `follow-ik.js` `axisDeg` (new, `axisBytes` backwards). `liveModel(fx)`: a typed head with an Axis chain is read in
  the file's sense and solved with `beamOf` (what the previs draws, one pan sense); else the old model. The session
  keeps `pose0` (the patch pose at start) as the solve's prior. Wired in `tracking/register.js`.
- **Solver** (`calibrate-solve.js`): `opts.forward` / `extra` / `senses` / `prior`. With a prior, 1–2 points give a
  `partial` solve: the pose nearest the patch that fits them (light weights, so the points are met exactly where
  possible), the head kept within 2 m of the patch, above the floor and 0.5 m off every mark; a partial fit worse
  than 2° is refused with a warning and moves nothing. 3+ points: the full solve as before.
- **Client**: `calibrate_section.gd` `lighting` mode — no jog rows, no Find / reference, no Apply pose; every point /
  undo reply is applied to the patch at once (`_follow_points`; undone to no points → back to `pose0`); "Beam is on
  <mark>" sits in the Undo point row. `calib_summary` shows a partial solve and a refusal's reason. The "Calibrate
  heads" fold moved to just below "Programmer" (`fixtures_section.gd`).

### Verified

- `smoke-wo700` 8/8: axisDeg ↔ axisBytes round trip; no-hold start does not park, jog 409, points read the frame;
  output off → 409; **test-spot.xml head patched 0.6 m / 25° off: after every one of 4 points the chain beam passes
  within 5 cm of every mark so far, the 4-point pose is the real one, nothing sent**; the live teleport repro is
  refused; source pins (fold order, auto-apply, wiring). wo624 / wo630 unchanged (route pin repointed).
- Box, server restarted: API start (hold false) / point / end on Focus Profile 1 — reads pan 1.06 / tilt −0.53 from
  its DMX, the far floor spot is refused (rms 92°, warning), nothing written to the project.
- Second client: "Calibrate heads" directly under the Programmer's All / None / Release row.
- NOT verified: a real head on real marks — owner QA.
