# WO-701 — Previs cut-outs: keep a person on one camera; cut only after another has been better for 2.5 s

**Status: DONE (2026-10-23, Godot 21178/0 (+20: facing, ranking, sticky timeline, cards with a clock), `run-client.sh
--check` OK; NOT watched live — detection was up on cam_1 / cam_2 but nobody was in frame — owner QA on the rig)**

Owner, 23.10: *"the cut out of a person in 3d should be less hectic with the changes. meaning it should keep on a
camera and only change a camera after the subject is facing the other camera for at least a 2 3 sec."*

## Investigation

- The cut-out's camera is chosen afresh on every `tracking:detections` snapshot (10–15 Hz):
  `person_cards.gd` `set_detections` → `person_cards_model.gd` `cards()` → `best_view()` = the largest box in raster
  pixels (coasting × 0.25). No memory between snapshots, so two cameras with similar box sizes swap the card's video
  (and its mask) several times a second as boxes jitter.
- "Facing" was never part of the choice: WO-665 left "frontal" for later (box area stood in for "closest"). The
  person's facing is known only when the WO-667 pose model runs ("Body pose"): world persons then carry 17 COCO
  `joints` (PSN). Solved tracking cameras carry `cam.pos_x / pos_y`.

## What was done

- **`person_cards_model.gd`**
  - `facing(joints)`: plan direction from shoulders + hips (left − right, turned a quarter clockwise; facing the
    audience left is +x, front is −y), ZERO without them.
  - `ranked_views()`: every view best first — box area, coasting × 0.25, and with a pose × (0.25 … 1) by how squarely
    the person faces that solved camera (an unsolved camera sits halfway). `best_view()` = its first.
  - `sticky(st, ranked, now)`: the shown camera stays while it still sees the person; another one takes over only
    after being the best for `SWITCH_HOLD_S` = 2.5 s without a break; first sight or the shown camera losing them →
    the best at once.
  - `cards(snap, cams, pick, now)`: with a clock the camera is sticky per world person (memory owned by the caller);
    without, as before.
- **`person_cards.gd`**: `_pick` memory per world id (dropped with the person, cleared with the layer); passes
  `Time.get_ticks_msec()`.
- Dummies mode is unchanged (it blends up to 3 cameras; only the cut-out card shows one camera).

Why a hold timer over a score margin alone: the owner asked for time ("at least 2–3 s"), and a margin still flips on
sustained near-ties; the run must be unbroken, so a camera that is only intermittently better never takes over.

## Verified

- Godot `test_person_cards_model.gd`: facing for 3 directions and missing joints; the camera in front wins over a
  bigger picture from behind and flips when the person turns; the sticky timeline (stay, broken run, 2.4 s no, 2.5 s
  cut, lost camera cuts at once); `cards()` with a clock waits 2.5 s for a bigger camera, without a clock does not.
  Full Godot suite 21178/0, client boot check OK.
- NOT verified live: no one was in frame (`/api/tracking/detections`: cam_1 / cam_2 live, 0 persons). Facing needs
  "Body pose" on; without it the hold still applies to the biggest picture.
