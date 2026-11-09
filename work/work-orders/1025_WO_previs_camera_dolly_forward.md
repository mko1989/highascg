# WO-1025 — Previs camera: zoom stops at the orbit point and nothing moves forward
**Area:** godot-client, tracking-vr
**Status: DONE (09.11 — wheel goes on through the orbit point, left + right drag dollies; Godot suite 26604/0; tried live in the owner's GUI on Narvil)**

Owner, 09.11: "i cant zoom in anymore in previs view and i cant seem to move the camer forward (left-right hold maybe)."

## Investigation

- **`previs_stage.gd` is an orbit camera.**
  - The wheel only scales `_dist` (the distance to `_target`), clamped at 2 m.
  - Left-drag orbits and middle-drag pans in the screen plane (WO-1008).
  - Nothing moves `_target` forward.
- **Why it showed now:** with the WO-1003 venue model, Fit frames the whole Narvil hall, so `_target` lands mid-audience.
  The wheel stops 2 m from that point, and the stage (tens of metres on) cannot be reached.
- **Right button:** in `previs_tab.gd` `_on_3d_input`, a right press goes to `aim_drag` (WO-679) first. With fixtures
  selected it starts a floor aim, so a left + right combo has to claim the right button before the aim does.

## What was done

- **`previs_stage.gd` `dolly(m)`:** moves `_target`, and with it the camera, `m` metres along the view.
- **Wheel up:** once the orbit distance hits `MIN_DIST` (2 m), the wheel dollies on, `max(0.5, dist × 0.1)` per notch.
- **Left and right held together** (`_buttons` = 3): a drag up moves forward and a drag down moves back,
  `dist × 0.004` m per pixel (at least 4 m × 0.004). There is no orbit while both are held.
- **`dolly_event(e)`:** a right-button event while the left is held belongs to the dolly.
  - `previs_tab.gd` skips `aim_drag` for it (one line).
  - A right press on its own is still the fixture aim.

## What was verified

- **Godot `tests/test_wo1025_previs_dolly.gd`:**
  - the wheel at its stop moves the target and the camera forward, and the distance stays 2 m;
  - left + right with a drag up goes forward, a drag down goes back, with no orbit;
  - the release is routed to the dolly; with left alone again it orbits;
  - a right press on its own is not the dolly's.

  The WO-1008 middle-pan test still passes. Suite 26604/0.
- **Live in the owner's GUI (xdotool):**
  - Fit, Front, then 25 wheel notches: the camera passed the old stop and moved through the tables toward the stage.
  - Left + right held with 300 px of drag up: it moved forward over the next table to the dance floor.
  - Screenshots in the session scratchpad (`d01.png`, `d12.png`).
