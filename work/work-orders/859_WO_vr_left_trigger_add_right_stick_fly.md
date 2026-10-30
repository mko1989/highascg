# WO-859 — VR: the left trigger held adds to the selection, the right stick flies

**Area:** tracking-vr, godot-client
**Status: IN PROGRESS (30.10) — built, Godot suite 23417/0; not yet tried in the headset**

Owner, 30.10:
> for vr, when the first trigger is held down it acts as ctrl/cmd for files managers, so user can select multiple
> fixtures by clicking one by one.
> the righthand analog should allow "flying" by moving up and down. pressing the trigger resets to ground.

## 1. Investigation

- `godot/client/features/previs/xr/xr_walk.gd` (WO-741/774/841). The right trigger (the "first trigger", index
  finger) selects. The right grip (the "second trigger") points. The add-to-selection modifier was only the left grip
  (`_add_held()`), and left grip + right grip is the pan/tilt fan.
- The right stick's x snap-turns (`Walk.snap`). Its y only scrolled the wrist Programmer while the ray was on it
  (`_point`). Off the panel, y did nothing, so flying needs no new axis.
- The rig's floor is `XROrigin3D.position.y = 0` (set at the start pose).
- The left trigger was unbound: the left controller only handles `by_button` (panel show/hide).
- Reading the request: the right trigger already clicks, so the "first trigger held" that acts as ctrl/cmd must be
  the **left** one. "Pressing the trigger resets to ground" cannot be the right trigger, which selects. It is mapped
  to **pressing the right stick** (`primary_click`, in `openxr_action_map.tres`). The owner can say otherwise.

## 2. What was done

- `xr_walk_model.gd`: added `fly(height, stick, dt)` (1.5 m/s at a full push; 0.2 dead zone; only while |y| > |x|;
  never below 0), `turn_x(stick)` (no snap turn while y dominates, so a diagonal flight never turns) and
  `add_held(left_trigger, left_grip)`.
- `xr_walk.gd`:
  - `_add_held()` is now the left trigger or the left grip.
  - The right grip's fan check uses `_left_grip()` only, so the left trigger held plus the right grip still points.
  - The right stick flies when the ray is off the panel, and still scrolls on it.
  - `primary_click` on the right controller lands back on the floor.
- `help/vr-walk.md`: the controls table now lists the left trigger, fly and back-to-floor.
- Tests: new `tests/test_xr_fly_wo859.gd`. The `test_xr_box_fan_wo774` hook pin is repointed to `_left_grip()`, which
  keeps the same intent: the right grip goes to `grip()`, and the fan needs the left grip.

## 3. Verified

- Godot suite 23417 passed, 0 failed (the new fly / turn / add cases included).
- Not yet in the headset. It needs a WiVRn session (on demand) and someone wearing it. Check: hold the left trigger
  and click heads one by one, they add up; right stick up/down rises and sinks; stick click drops to the floor; on the
  Programmer the stick still scrolls.
