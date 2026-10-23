# WO-700 — calibrate heads from Lighting, on real stage marks

**Status: DONE (2026-10-23, R3 below: smoke-wo700 11/11 + wo624/wo630/wo615-follow-ik, test:ci 2859/2862 (known
pointer-confine), Godot 21182/0; live API probe on Focus Profile 1 returns an offset, nothing sent or written; R2's
pose-moving solve is SUPERSEDED by R3 — owner QA: calibrate one head on 1–4 marks)**

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

> **R2's solve is superseded by R3** (it moved the head — the owner's next test). Its controls, fold place, frame
> source and "applies per point" stay; the partial pose solve (prior, reach / floor / mark guards) was removed.

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

## R3 — correct where the beam points, never the head (23.10)

Owner, 23.10 (testing R2): *"calibrating the beam bu beam is on mark makes the fixture it self change position rather
then changing where the beam points."*

### Investigation

- R2 solved the head's pose (x, y, z, yaw) from the points and applied it per point, so the fixture body moved.
  Box: Focus Profile 1's patch pose had gone from (−2.5, −6, 2, yaw 0) to (−2.33, −5.67, 3.21, yaw 4.05).
- The previs turns a typed head's axis nodes by the server's decode (`gdtf-visual.js` `decodeVisual` → axes, applied
  in `fixtures_3d.gd:349`); right-drag / Point at aim through `gdtf-features.js` `aimValues` → `gdtf-ik.js`
  `aimFixture`. A pan / tilt offset in those two places changes where the digital beam points without touching the
  pose — what a console's head calibration does.

### What was done

- Patch entry `offset {pan, tilt}` (°, ±180; only stored when non-zero): `follow-patch.js`, Godot `normalize_fixture`.
- `decodeVisual(plan, buf, address, offset)` adds it to the Pan / Tilt axes (`follow-service.js` passes `fx.offset`);
  `aimChain` solves the geometric angle and sends angle − offset, so Point at / right-drag land the real beam.
- `calibrate-solve.js` `solveOffsets(pts, forward)`: least squares over (pan, tilt) offset (15° seed grid + LM, the
  generic `lm()` now shared with the pose solve); one point is enough; the smallest of the mirrored equal fits wins;
  warnings when marks disagree (rms > 2°) or the tilt offset exceeds 45° (wrong hang / beam not on the mark).
  The R2 prior / partial pose machinery was removed (restored `solveFixturePose` to its pre-R2 form + `lm`).
- `calibrate-session.js`: a live session needs a typed head with an Axis chain (else 409); points store the physical
  angles decoded from the frame like the previs; the solve is `solveOffsets`; `offset0` is the offset at start.
  `axisDeg` (R2) removed from follow-ik.js.
- Client: `apply_solve` with `offset` writes only the offset (none when 0); `_follow_points` applies per point and
  restores `offset0` when undone to no points; summary "N points · beam offset pan … tilt … (fit …)".
- Box data: Focus Profile 1's pose restored to (−2.5, −6, 2, yaw 0) via `POST /api/project/autosave` (rev 118 → 119;
  the doc before is in the session scratchpad).

### Verified

- `smoke-wo700` 11/11: one mark recovers a real offset (20°, −6°) to 0.1° from the Programmer bytes (`writeGdtf` of
  `aimValues` with the true offset), no pose in the solve, nothing sent, jog 409, no-chain head 409, no frame 409;
  four marks → every mark within 5 cm; disagreeing marks / a 127° tilt warn; patch keeps / clamps / omits the
  offset; `decodeVisual` shifts pan +20 / tilt −6; `aimValues` with the offset puts the real beam within 2 cm.
  wo624 / wo630 / wo615-follow-ik unchanged. Godot: summary, apply (pose untouched, 0 → no key), normalize.
- Box: API start / point / end on Focus Profile 1 → reads (1.06°, −0.53°), returns `{offset}` only; patch unchanged.
- NOT verified: a real head on real marks — owner QA (restart the GUI first: the running one has the R2 client).
