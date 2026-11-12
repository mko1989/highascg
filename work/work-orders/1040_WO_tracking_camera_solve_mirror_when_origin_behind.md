# WO-1040 — Tracking camera solve: camera 2 lands under the deck, facing away (stage out of the picture)

**Area:** tracking-vr, godot-client
**Status: IN PROGRESS (12.11 — fix + regression test in, Godot suite green; live re-solve of camera 2 pending)**

Owner, 12.11: *"from camera 2 for tracking i have center stage visible i do calibration based on a couple of points
that the camera sees and after solving the stage is out of the picture."*

## Investigation

Live project `narvil` (`previs.tracking.cameras[1]`, `cam_2`, role in2, 1920×1080): 16 clicked points, all on the deck
plane z 2.3 (grid rows Y0 = 18.24 m and Y10 = 28.24 m, plus LED wall 1 / LED wall 2 bottom corners). Stored solve:

```
pos (0.16, 7.59, -3.41)  pitch -22.2  yaw -174.6  roll 1.9  fov 24.1   rms 14142.1
```

rms 14142 = √2 · 10⁴, the residual `camera_refine.gd` gives a point **behind the lens** — every point. The camera
sat 5.7 m *under* the deck facing downstage; Ghost / overlay drew nothing where the stage is.

Reproduced headless (Godot `-s` probe on the stored points): the floor seed (`homography.gd` `decompose_homography`)
already returned the mirror pose (pos_z -2.99, yaw -164); LM refine only polished it. Root cause: the homography is
known only up to sign, and the port (OpenFollow `decompose_homography`) picks the sign that puts the **world origin
(PSN 0,0)** in front of the camera (`if v3[2] / lam < 0`, `v3[2]` = depth of the origin). Camera 2 stands at
y ≈ 7 m looking upstage at y 18–28 m: the origin is *behind* it, so the "front" test chose the mirror branch.
Camera 1 (y -13.4, origin in front) solves fine — that is why only camera 2 broke. `solve_floor`'s 20 px gate did
reject it, but `camera_refine._floor_seed` falls back to the raw decompose ("a noisier seed is still a good start"),
and `calibrate()` returned `ok: true` at rms 14142, so `tracking_page.solve()` stored it.

## What was done

- `godot/client/features/previs/tracking/homography.gd` — `decompose_homography(…, front := [0, 0])`: the sign is
  chosen so the plane point `front` is in front of the lens (depth ∝ `h31·x + h32·y + h33`). Default keeps the old
  origin behaviour for any other caller.
- `camera_model.gd` — `centroid(plane)`; `solve_floor` passes the clicked points' centroid (a point the camera sees,
  by construction) as `front`.
- `camera_refine.gd` — `_floor_seed`'s fallback decompose passes the centroid too; `calibrate()` now refuses
  (`ok: false`, "N of M points end up behind the camera — check each click is on its mark") instead of storing a pose
  that cannot see its own points. The page shows that as "Not solved: …" and keeps the previous pose.
- `godot/client/tests/test_tracking_calibrate.gd` — `test_camera_upstage_of_origin_looking_away`: a camera at
  (-0.2, 7, 8) looking upstage at two grid rows 18.24 / 28.24 m (camera 2's geometry) must solve above the deck,
  facing upstage; mirrored clicks must never come back `ok` with points behind the lens.

Why the centroid rather than trying both signs and keeping the lower reprojection error: one line, no second solve,
and it is exactly the invariant the origin test was approximating (the calibration points are what the camera sees).

## What was verified

- Godot unit suite (`run-client.sh --test`): 28092 passed, 0 failed with the fix. With the old `homography.gd`
  swapped back the new test fails (3 asserts: "16 of 16 points end up behind the camera") — it guards this bug.
- Camera 2's stored points through the fixed `calibrate()`: pos (-0.20, 7.06, 8.04), pitch -21.6, yaw +5.2,
  roll 3.1, fov 22.7, rms 54.3 px (lens fit: 51.5 px). Above the deck, facing upstage.
- Remaining click quality (not this bug): `obj:led_wall_2:1` misses by 178 px (clicked at 124,159; the solve puts it
  ~180 px lower) — either a wrong click or LED wall 2's previs position is off; the far grid row (Y10) was clicked at
  screen y 2–7 px, at the frame edge, with errors up to 70 px. Without the LED wall 2 point rms is 25 px.
