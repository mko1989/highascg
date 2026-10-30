# WO-841 — VR: the second trigger (grip) points the selected heads; the first trigger only selects

**Status: DONE offline (30.10) — headset QA = owner**
**Source:** owner 30.10: *"fix for vr. make the pointing of selected heads in the vr world with the second trigger on the
controller. the first trigger should be only selecting."*
**Related:** WO-774 (trigger picks + aims on release, right grip fans, left grip = add), WO-741, WO-757, WO-795.

## Change of mapping (right controller)

| Input | Before (WO-774) | After |
|---|---|---|
| Trigger (index finger) | pick a head; drag = box select; release on the floor = aim the selection there | selection only: pick, box select. A release on the floor no longer aims |
| Grip (middle finger, "second trigger") | held + moved = fan pan/tilt | held = the selected heads point where the ray hits; they follow the ray while it is held |
| Left grip + right grip | — | the fan (the WO-774 motion fan moves here, so it is not lost) |

The fan's new place is the coordinator's choice (the owner did not say); it reuses the left grip, which is already the
modifier.

## 1. Investigation

- WO-774's mapping (xr_walk.gd at HEAD): `_trigger` ran on the trigger press (head hit / near -> `sel.pick`; else the
  press waited in `_press` with the floor PSN already computed by `Walk.trigger`), `_release` then either selected the
  box or, not dragged, called `tab.aim_drag.aim(p.aim)`. The right grip started `xr_fan.gd`; the left grip is the add
  modifier (`_add_held`).
- Mouse right-drag aiming (`aim_drag.gd`, WO-679) has **no time throttle**: one request in flight, the newest target
  overwrites `_next`, so the request rate is the server round trip. At 72 Hz in a headset that is a flood of
  `/api/fixtures/program/aim` rounds and, worse, `sel.aimed` fires after every drained batch (`aim()` end) and
  `programmer_section._on_selection` rebuilds all controls (2 GETs) on it. The mouse path avoids that with
  `active` (the `aimed` waits for the button release), but `active` also makes `aim_drag.input` aim on **mouse motion**,
  which would fire from the desktop mirror while a grip is held — so it was not reusable as the VR hold flag.
- `grip_click` is the squeeze action on both hands (WO-774 investigation 5), so left/right grip state is available at
  the right grip's press edge.

## 2. What was done

- `xr_walk_model.gd` (pure): `trigger(hit, near, add)` now only returns `pick` or `press` (no floor aim, no selection
  / ray params); new `grip_mode(left_held, has_sel, on_panel)` -> `fan` / `point` / `none`; `point_psn(from, dir)` (the
  floor PSN `[x, -z, 0]` the trigger used to compute, `null` in the sky); `AIM_MIN_S` = 1/15 s, `AIM_MIN_M` = 0.05 m and
  `aim_due(st, psn, now)` (first spot at once, then at most 15 Hz and only when the floor spot moved >= 5 cm from the
  last one *sent*, so a held hand always converges and a still hand sends nothing).
- `xr_walk.gd`: grip press/release go through `grip(pressed, left_held)`; the mode is decided at the right grip's press
  and kept to its release (letting the left go does not turn a fan into pointing). `point`: `_xr_move` calls
  `_grip_aim(from, dir, now, on_panel)` every frame -> `Walk.point_psn` + `Walk.aim_due` -> `tab.aim_drag.aim(psn)`
  (nothing on the wrist panel, in the sky, or if the selection went empty). `fan`: exactly the WO-774 path
  (`_fan_p0`, `_fan.start/move/end`). `_release` no longer aims; `_press` has no `aim` key. Header doc, `trigger`
  doc and `_add_held` doc updated; `xr_panel.gd` header names the new mapping. No in-headset label text describes the
  controls (the only text is `help/vr-walk.md`, outside this WO's scope — coordinator, see report).
- `aim_drag.gd` (small, backwards compatible): `hold` flag + `end_hold()` — while the VR grip holds, `aim()` does not
  announce `aimed` per batch; `end_hold()` announces once (sliders follow) when the last request is back. Mouse path
  untouched.
- Tests: `tests/test_xr_grip_wo841.gd` (new), `test_xr_walk.gd` (`test_trigger` rewritten), `test_xr_box_fan_wo774.gd`
  (release-aims test inverted to "never aims", grip hook pin repointed); e2e `06_xr_walk.gd` got a WO-841 step.

## 3. Verified

- Godot suite (`godot --headless --path godot/client --script res://tests/run_tests.gd`): all WO-841 / xr / aim_drag
  tests pass; the only 2 failures in the run are `test_numeric_field::test_resolve` / `test_math_line` (another agent's
  concurrent edit, not in this scope). 23064 passed / 2 failed. `run-client.sh --check` boot OK. No file > 500 lines
  from this WO (`xr_walk.gd` 372).
- New test cases: trigger release on the floor with a selection -> no aim, selection kept; grip down with a selection
  -> aim at PSN, `hold` set; held + moved -> throttled re-aims (inside 1/15 s or < 5 cm nothing; a 72 Hz sweep sends
  <= 16/s); sky / panel while held -> nothing; release -> `end_hold` once; second press restarts the throttle; grip with
  an empty selection or on the panel -> nothing and no hold; left + right grip -> fan start/end, no aim; `aim_drag`
  hold/end_hold announce once.
- GUI e2e in a sandbox (`node tools/e2e/run-gui-e2e.js --e2e=06_xr_walk --xr`, Xvfb, nothing on :0): the live tree's
  server cannot start right now (another agent's in-progress deletion of `src/sampling/*`), so it ran on a
  `git archive HEAD` copy with this WO's Godot files overlaid. New step "WO-841: the grip points the selection ... a
  trigger release aims nothing" PASS. Pre-existing and unrelated (identical on pure HEAD): "Left-drag looks around"
  (yaw 3.027, skips the rest) and "The Programmer panel works by ray" (store said '').
- Not verifiable here: headset feel (AIM_MIN_S / AIM_MIN_M, whether the grip is comfortable to hold while the left grip
  is also the add modifier). Owner QA: trigger on a head selects; trigger on the floor does nothing; hold the right grip
  with a selection and sweep the floor -> heads follow; left grip + right grip and move -> fan as before.
