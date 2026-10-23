# WO-700 — calibrate heads from Lighting, on real stage marks

**Status: DONE (2026-10-23, R7 below — each mark pinned exactly + a manual beam offset; smoke-wo700 13/13 (R3's two duplicated tests removed) + wo624, test:ci
2858/2859 (known pointer-confine), Godot 21185/0, run-client --check OK; the owner's 4 + 3 live points re-solved
offline; R2's pose-moving solve is SUPERSEDED by R3 — owner QA: calibrate Focus Profile 1 again; if marks 2 / 3 still
miss, check its patched position by hand)**

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

## R4 — one offset cannot fix a head patched in the wrong spot (23.10) — Move head SUPERSEDED by R6

Owner: "yes it has offset but the offset is calculated wrong" → "mark 1 and 4 calibrated position correctly but 2
and 3 didnt point to the actual marks on the 3d."

### Investigation

The solve was not miscalculated; the offset-only model cannot fit these points. The owner's 4 live points on Focus
Profile 1 (patched floor, X −2.5 Y −6 Z 2; read pan / tilt → mark):
(33.51, 111.65) → Mark 4 (3.03, 1.68); (23.89, 107.54) → Mark 1 (2.97, 4.52); (−18.69, 114.06) → Mark 3
(−2.93, 1.70); (−13.03, 108.49) → Mark 2 (−2.87, 4.64).

- The calibration read equals the previs decode of the same frame (checked), so it is not a read / decode mismatch.
- Best single offset at the patched spot: (+8.06°, −7.1°), rms 5.46° (per mark 5.9 / 4.5 / 7.4 / 3.1). Changing only
  the height does not help (z 2..6 → rms 5.5..4.9).
- The left / right pan spread is 52° observed against 39° from the patched spot: the real head is closer to the
  marks and more central than patched. Fits (session scratchpad `an/fit.js`):
  - x, y + offset (z 2, yaw / hang kept): **X −1.04 Y −4.21, offset (+1.0°, −4.1°), rms 0.28°** (every mark < 0.4°);
  - x, y, z, yaw with no offset: X −0.93 Y −4.26 Z 2.62 yaw 0.3, rms 0.77°;
  - offset + pan / tilt scale at the patched spot: scales 0.77 / 0.79 with a 16° tilt offset, rms 1.23° (a GDTF
    range error would be needed on both axes; much less plausible);
  - pose + tilt offset with z free: z 28 m (nonsense).
- A single offset on a misplaced head lines up the marks on one side and misses the other, which is what the owner saw.
- The owner's next live session (3 points, incl. two new marks near the centre line, saved in
  `an/session-r3-live.json`): offset-only rms 3.17°; x, y + offset X −2.46 Y −4.08 rms 1.06°. All 7 points
  together: X −1.39 Y −4.15, rms 1.62° (one centre mark 3.7°). **Y ≈ −4.1..−4.2 is consistent; X is less certain**
  (3 points with 4 unknowns).

### What was done

- `calibrate-solve.js` `solveOffsets(pts, forward, {pose})`: from 3+ marks with an offset fit worse than 1° RMS,
  `solvePlace` fits the head's floor position (x, y; height, yaw, hang kept) together with the offset (LM from the
  patched spot ± 2 m). It is returned as `place {x, y, offset, rms_deg}` only when it at least halves the RMS and
  stays within 10 m of the patch; the warning then names the spot. `forward(pan, tilt, pose = fx.pose)`
  (calibrate-session.js) evaluates the chain from a trial pose.
- The head never moves by itself (R3 stays): the client's `_apply` button, hidden in Lighting, appears only with a
  `place` as "Move head to X … Y …"; it applies `{offset: place.offset, place}`, so `apply_solve` sets pose x / y and
  the offset that goes with them. Summary line adds "Moved there it fits …". How-to text mentions it.
- Why not solve z / yaw too: with 3–4 marks they trade off against x / y / the offsets (z 28 m fits); the height is
  measurable and yaw is the pan offset.

### Verified

- `smoke-wo700` 10/10, including R4: a head truly at (2.5, −1.5) patched at (1, 0), real offset (20°, −6°), 4 marks
  → rms > 1°, no pose, `place` within 5 cm and the offset within 0.5°, every mark within 5 cm from there; a
  session patched at that spot solves rms < 0.2° with no place and no warning. wo624 7/7.
- Owner's 4 points: place X −1.04 Y −4.21, then offset (1.05°, −4.07°), rms 0.28° with no further place (9 ms).
- Godot 21185/0 (apply_solve with place moves x / y only, keeps z / yaw / hang; summary line); run-client --check OK.
- Gates: max-file-lines 0, unwired-exports no new, lint 0 errors, format:check, `index.js --no-http`, npm audit OK.
- NOT verified: Move head on the rig. Owner QA: measure the real head (or Move head), then check marks 2 / 3.

## R5 — the solve picked the flipped-over mirror (23.10)

Owner: "the focus 1 now seems to be reacted like its been repositioned / 2nd is ok".

### Investigation

- Patch after the owner's next session (2 points, Mark 6 + Mark 3, 3.2° apart): Focus Profile 1 `offset` = pan −167.83°,
  tilt +139.15° (rms 3.18°). That is the mirror of the small offset (pan + 180, tilt flipped about the head): nearly
  the same beams, but the previs draws the yoke turned round and the head flipped over → "repositioned".
- `solveOffsets` preferred the smallest correction only among fits equal to 1e-8 in cost. The lens sits off the tilt
  axis, so the mirror is not an exact twin: with marks that disagree it fit 0.06° better (3.18° vs 3.24°) and won.

### What was done

- `calibrate-solve.js`: the tie-break compares RMS degrees, `MIRROR_TOL_DEG = 1` — a larger correction must fit
  at least 1° better to beat a small one.
- Box data: Focus Profile 1 offset (−167.83, 139.15) → (12.18, −8.35), the fixed solve of the same 2 points,
  via `POST /api/project/autosave`.

### Verified

- `smoke-wo700` 11/11; the new R5 test (a misplaced head, 1..3 marks, every solve |pan|, |tilt| < 45°) fails on the
  R4 solver (2 marks → −176.65°, −61.26°) and passes now. The owner's 2 live points → (12.18°, −8.35°); 4 old → same as R4.

## R6 — the calibration never moves the head (23.10)

Owner: "the calibration cant move the position of the fixture in 3d enviroment, just make it point the beam at the mark."

- R4's "Move head to X Y" button and `apply_solve`'s `place` branch removed (`calibrate_section.gd`,
  `follow_model.gd`): a Lighting calibration only ever writes the pan / tilt offset (least squares over the marks).
- `place` stays in the server solve as a hint: the warning reads "…the head is not where it is patched: the marks
  put it near X … Y … — check its position in the patch." That way the operator knows why one offset misses some
  marks; any change to the position is done by hand in the patch.
- Verified: smoke-wo700 11/11 (R4 test now pins the hint wording); Godot 21184/0 (a solve with `place` keeps the
  pose, sets only the offset); `run-client.sh --check` OK.

## R7 — pin every mark; the beam offset by hand (23.10)

Owner: "it needs to give the user the ability to position the digital 3d light beam adjusting the pan tilt offset
without moving the artnet fixture. now when i tell it that its pointing at the mark it adjusts position of the beam
correctly for first 2 marks then it starts to drift especially on the other side of the stage. ive added multiple
points because adding a point moved the 3d beam closer to the mark i wanted to calibrate to."

### Investigation

- R3–R6 solved ONE least-squares offset over all marks. With the head patched ~2 m off (R4: Focus Profile 1's
  marks fit X −1.0 Y −4.2, not −2.5 / −6), no constant offset lands on every mark, and the compromise moves with
  each mark added. The marks added first look right until the far side pulls the fit away ("drift"), and adding
  the same mark again only weights the fit towards it.
- The owner's 4 points re-run with pins (scratchpad `an/r7.js`, real Focus chain): after each pin, every pinned
  mark is within 4 mm on the floor (before: 1.3–2.5 m off on the marks not yet pinned); halfway between marks 3 / 4
  the beam lands 0.22 m from the midpoint; `sentFor` returns the read angles to 1e-4°.

### What was done

- `src/fixtures/beam-offset.js` (new): `offset` = the operator's trim; `offset_map` = pins `{pan, tilt, dpan,
  dtilt}` (physical angles + correction over the trim); `offsetAt(fx, pan, tilt)` = trim + inverse-distance²
  blend of the pins (exact on a pin, nearest wins); `sentFor` inverts it (damped fixed point, best step kept);
  `addPin` replaces a pin within 1°; `normalizeMap` clamps / keeps ≤ 64.
- `gdtf-visual.js` `decodeVisual(…, offset)` also takes `offset(pan, tilt)`; `follow-service.js` passes
  `offsetAt(fx, …)`. `gdtf-ik.js` `aimChain` sends `sentFor(geometric)` (constant offset → the R3 formula).
- `calibrate-session.js`: each live point stores the exact one-point correction over the trim (`dpan`, `dtilt`);
  the solve is `{map: map0 + pins, pinned, rms_deg, warning}` — the one-offset fit only as the "patched in the
  wrong spot" hint. `map0` = the pins at start (undo to none restores them).
- Patch: `offset_map` kept by `follow-patch.js` and Godot `normalize_fixture` (`normalize_offset_map`).
- Client: `apply_solve` with `map` writes only the pins; summary "N marks pinned — the digital beam is on each"
  (+ the one-offset miss when > 1°). Calibrate heads → **Beam offset Pan / Tilt** spin boxes (the trim, live,
  nothing sent) and **Clear** (ends the session, drops trim + pins). How-to text updated.

### Verified

- smoke-wo700 13/13: one mark → one pin at the real offset (0.1°), no pose / offset in the solve, nothing sent;
  4 marks → each within 5 cm; a head patched 2 m off → after every mark all marks so far within 5 cm, rms hint
  warns, Point at with the pins matches the real head's angles (0.05°), the same mark replaces its pin; pins stay
  small (no mirror); pin unit tests (normalize / exact / nearest / replace / sentFor / decode function / patch).
  test:ci 2874/2875 (known pointer-confine). Godot 21190/0; run-client --check OK; lint 0 errors, format, lines.
- Incident: the owner's GUI relaunched at 13:40 mid-edit and loaded a follow_model.gd that did not compile
  ("Nonexistent function 'normalize'") → marks could not be placed, programmer gobos gone; GUI relaunched 13:44 on
  the finished files, 0 script errors.
- NOT verified: on the rig — owner QA: Clear Focus Profile 1, pin 4+ marks incl. the far side.
