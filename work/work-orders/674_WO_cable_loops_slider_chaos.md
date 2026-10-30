# WO-674 — Devices: Cable loops slider 0 · 1 · 2 · 4 · 8 · 16 · 32 · chaos

**Area:** godot-client
**Status: DONE (22.10, box screenshots 8 / 32 / chaos + Godot tests; owner QA = checklist 22.10 §G)**

Owner 22.10, after WO-672: *"these loops are nice, but i dont know why in your tests the loops go to 2 and then
straight back to 0, but they stay on the screen. with loops that nice id like to be able to add more of them. the
slider going 1 2 4 8 16 32 chaos in chaos its not loops only but just a total cable mess."*
Then, on the first chaos: *"the chaos should disregard the gravity and just make a mess in between connections."*
Then: *"ok, but it cant be over any actual buttons."*

## Investigation

- **"Slider at 0, loops on screen":** the WO-672 screenshots used a temporary `--probe-loops` flag in `main.gd`. It set
  `cable_layer.loops` directly, bypassing the toolbar slider, so the slider still read 0. Not a product bug. The
  slider position was not saved either, so every client start went back to 0.
- `devices_toolbar.gd`: the slider was 0–2 in steps of 1, value = loop count.
- `cable_model.gd` `loop_specs()`: only the web's 1 and 2 (radius 20–32, at fixed t ± jitter); anything else gave 0.

## What was done

- **`devices_toolbar.gd`:**
  - `LOOP_STEPS = [0, 1, 2, 4, 8, 16, 32, CHAOS]`; the slider moves over the index; the label shows the number or
    "chaos".
  - The index is saved to `devices.cfg [view] loops` and restored at start (`saved_loops()`), per client.
- **`cable_model.gd`:** `CHAOS = -1`. `loop_specs()` > 2 → `_many_loops()`: evenly spread with jitter, smaller the
  more there are, capped at one per 22 px of run (so 32 on a short run is fewer). The web's 1 / 2 are unchanged
  (goldens pass).
- **`cable_rope.gd`, chaos (first try dropped):** gravity, ~2× slack, a jittered start and a floor at the bottom of
  the view. It hung in a big sagging pile; the owner wanted no gravity. Replaced by:
  - **a weightless tangle:** boot → boot is laid 3× denser than a hanging run, displaced by summed waves across AND
    along it (the along waves make it double back and cross itself), fading out at both boots, spread ≤ 60 px;
  - the rest lengths are taken from that tangle, with a stiff bend (0.3), so it holds its shape; moving an end drags it;
  - 6–40 loops of radius 6–34, curled at any angle.
- **Off the controls:** `cable_layer.gd` `_controls()` collects every visible Button / Range (slider) / LineEdit of the
  tab (3 px margin) plus a fence around the tab itself. The rope pushes any point inside one to its nearest edge
  (no bounce). A loop that would touch one is not drawn. Refreshed whenever the anchors change. Chaos only: the
  hanging modes behave as in WO-672.

## What was VERIFIED

- **Godot `--test` 20880/0**, `--check` boot OK. `tests/test_devices_cable_rope.gd` adds:
  - 8 loops on a 600 px run; 32 capped to 27 there; 32 on 900 px; specs in order; a rope with 8 settles;
  - chaos: plugged at both ports, stays centred on the boots (no gravity), spreads > 40 px, doubles back, holds its
    laid shape, settles;
  - chaos with a control across the run: no point and no drawn loop rests on it, and it still settles.
- **Box screenshots** (second windowed client, `--tab=4`, `devices.cfg loops=<index>`, restored afterwards):
  - 8 and 32: loops spread along both catenaries, smaller at 32;
  - chaos (gravity): a sagging pile — dropped;
  - chaos (weightless): a smooth tangle between the ports, but over the toolbar and the `+` buttons;
  - chaos (keep-out): the same tangle, toolbar, `+` buttons and tab bar clear.
- **Owner QA:** step the slider through every value; restart the client: the slider keeps its value.
