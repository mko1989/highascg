# WO-795 — VR programmer tablet: smooth the ray pointer

**Area:** tracking-vr
**Status: DONE (27.10, Godot suite 21905 / 0 + filter measurements); owner QA in the headset**

Owner, 27.10:
> the programmer tablet in vr is too sensitive. it needs smoothing.

Parent: [WO-757](./757_WO_vr_programmer_panel.md) (the Programmer on the left wrist, worked by the right controller's
ray).

## Investigation

- `godot/client/features/previs/xr/xr_panel.gd:76-88` (before): `point()` turns the ray's hit on the quad straight
  into a mouse move every frame, with no filtering.
  - The tablet is 0.30 m wide at 600 px (2 px per mm).
  - Hand tremor of about 0.3° at about 0.5 m is about 2.5 mm, i.e. ±5 px of jitter on sliders and wheels. Both
    hands move, because the tablet rides the left wrist.
- Pulling the trigger rotates the controller slightly. The press lands a few px from where it was aimed, and a held
  trigger on a slider drags it at once.

## What was done

- **`xr_walk_model.gd` (pure, tested): `euro(state, px, dt)`**, a One-Euro filter (Casiez et al. 2012).
  - Its cut-off is `EURO_MIN_HZ` (1 Hz) + `EURO_BETA` (0.004) × speed in px/s, so a still hand is smoothed hard and
    a quick sweep follows with little lag.
  - Picked over a fixed low-pass, which trades jitter against lag everywhere.
  - Also `PRESS_SLOP_PX` (10).
- **`xr_panel.gd`:**
  - `point(from, dir, dt)` smooths the pixel; the state resets when the ray leaves the panel, so it doesn't slide in
    from the old spot.
  - While the trigger is held, the pointer stays at the press point until the smoothed ray moves 10 px away. A click
    lands where it was aimed, and a real drag still drags.
  - `hit_at` (where the drawn ray ends) follows the smoothed point.
- **`xr_walk.gd`:** passes the frame's `dt`.
- Stage picking, box select and the fan are unchanged; only the tablet pointer is filtered.

## Verified

- `tests/test_xr_walk.gd::test_pointer_smoothing`: the first sample is taken as is, ±4 px tremor stays under 1 px, a
  600 px/s sweep lags under 40 px, and the slop is a small move. Godot suite **21905 passed, 0 failed**.
- Probe of the filter at 72 Hz:
  - alternating ±4 px tremor → worst 0.51 px;
  - random ±3 px → worst 1.03 px;
  - sweep lag after 0.5 s: 7.9 px at 200 px/s, 13.3 px at 600 px/s, 19.2 px at 1500 px/s (4–10 mm on the tablet).
- **Owner QA in the headset:** the feel. EURO_MIN_HZ / EURO_BETA / PRESS_SLOP_PX are the knobs: lower EURO_MIN_HZ
  for steadier, raise EURO_BETA for less lag.
