# WO-700 — calibrate heads from Lighting, on real stage marks

**Status: DONE (2026-10-23, smoke-wo700 3/3 + wo624/wo630 10/10, Godot 21156/0; marks placed / edited / removed in a
second client on the box; the session itself NOT run on the live heads — owner QA: calibrate one head on 3–4 marks)**

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
