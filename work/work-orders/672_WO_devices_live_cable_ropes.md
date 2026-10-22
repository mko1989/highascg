# WO-672 — Devices rear panel: live hanging cables (Verlet ropes) with pendulum loops

**Status: DONE (22.10, box screenshots + Godot tests; owner QA = checklist 22.10 §G)**

Owner, `next.md` 22.10: *"i belive that when runnig inside a game engine we can make the cable loops gravity better."*

## Investigation

- `godot/client/features/devices/cable_model.gd` `build()` is a 1:1 port of the web's
  `device-view-cables-physics.js` (WO-605 slice 1):
  - a straight path plus coil circles;
  - then ONE relaxation: 200 iterations × 6 substeps, gravity added per iteration, no velocity.
- Rest lengths are the straight-line lengths, with **no slack**. Gravity can only stretch the cable against the
  constraints. On the box (loops = 2, `--probe-loops`):
  - long runs lie flat and taut;
  - a V-kink where the run meets the boot;
  - coils are perfect circles floating in the air, half the cable's length off to the side.
- `cable_layer.gd` could only afford this every so often: one rebuild per frame (35–75 ms each in GDScript), only
  after the ports were still for 150 ms. While cards moved, the old shape was warped linearly onto the new ends.
- Goldens (`tests/test_devices_cable.gd`) pin `build()` to the JS output, so `build()` stays as it is.

## What was done

- **`features/devices/cable_rope.gd` (new)** — a cable that lives across frames:
  - **Rope:** Verlet points with inertia and damping (0.97), gravity 0.45 px/step², 8 constraint iterations per frame.
    The two plug points at each end are pinned to the ports.
  - **Shape:** 6 % slack, so the cable hangs in a catenary. A weak hop-2 bend makes it a cable, not a chain. The
    run's rest lengths scale with the span, so dragging a card away pays out cable.
  - **Coils ("Cable loops"):** pendulums hung on the rope, at the web's positions and sizes
    (`CableModel.loop_specs`). Each loop:
    - hangs below the cable, 1.3× taller than wide;
    - starts and ends 0.45 rad past its top, so the cable crosses itself;
    - swings from the cable's sideways acceleration (damped).
  - **Sleep:** a rope sleeps after 40 still frames and wakes when an end moves.
- **First attempt, dropped:** coils as rings of distance constraints with across-the-loop struts. Under the run's
  tension they crumpled into kinks at every stiffness tried (0.06 … 0.5); verified by screenshots.
- **`cable_layer.gd`:**
  - rear-panel cables are now ropes, stepped once per frame while awake (redraw only then);
  - a new loop count re-lays them;
  - the settle timer, one-per-frame rebuild and end-warp are gone;
  - Node view (fanned Béziers) is unchanged.
- **`cable_model.gd`:** `path()` (the unrelaxed geometry) and `loop_specs()` split out of `build()`; `build()` gives
  identical output (goldens pass).

## What was VERIFIED

- **Godot `--test` 20863/0.**
  - `tests/test_devices_cable_rope.gd`:
    - a run settles and sleeps, plugged at both ports, middle hanging > 30 px below the boots;
    - two loops on a long run hang below their attach points, at rest straight down;
    - moving an end wakes the rope and swings the loops; then they settle;
    - one step of a long 2-loop cable costs 0.37 ms (95 points).
  - The JS goldens for `build()` still pass.
- `--check` boot OK; no file over 500 lines.
- **Box screenshots** (second windowed client, `--tab=4`, temporary `--probe-loops`, not committed):
  - **loops 0:** both cables hang in smooth catenaries from the card ports to the GPU DP ports;
  - **loops 2:** the same curves with two loops hanging from each (before: flat taut runs, a kink, floating circles).
- **Owner QA:**
  - Devices → Cable loops 1 / 2: the loops hang and swing.
  - Drag the Devices splitter or resize the window: the cables swing and settle within about 1 s.
