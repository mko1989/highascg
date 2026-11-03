# WO-938 — The mouse arrow's tail showed on the Dioda wall when parked at the operator monitors' right edge

**Area:** os-iso, devices-config
**Status: DONE (03.11.26 — on .10: live layout DP-4 0 / DP-6 1920 / DP-0 3968, canvas 7808x1792 grown live without a
nodm restart; pointer pushed right with relative XTEST motion stops at 3839, the x11grab with the cursor drawn shows the
arrow ending in the dead strip; offline full 5115/0, curated 5279/0)**

Owner, 03.11.26: "i have an issue with mouse pointer being visible on the program output "dioda" when i move the mouse
to the far right … the pointer gets blocked that it can fully go to the pgm output but its "ass" sticks out. the
pointer should never be visibile and be able to reach program outputs, only operator monitor/s".

## Investigation

`confine-pointer-barriers.py DP-4,DP-6` fences the union 0..3840 and the right barrier stops the cursor **hotspot** at
x=3839, as designed. X then draws the whole cursor sprite from there: Adwaita here is 36x36 with the hotspot at (4,1),
so about 31 px of the arrow land on x 3840..3871, which is DP-0 (the Dioda wall, Caspar ch2). No barrier can fix this:
it bounds the hotspot, never the image. Only the left and top edges of the fence were safe, because the arrow reaches
right and down from its tip. A centred shape (I-beam, resize arrows) also reaches left.

## What was done

The layout leaves **`OPERATOR_CURSOR_GAP_PX` = 128** of X canvas that no CRTC scans between operator heads and
every other head. Any part of the sprite drawn there is invisible. 128 covers any themed cursor up to size 96 on
either side of the hotspot. Operators lose no pixels; the barriers are unchanged and still keep the hotspot out of the
gap.

- `os-layout-calculator-place.js` — the running x jumps by the gap whenever the placement steps between an
  `operator_gui` head and a non-operator one (screens, multiview, PRV), in both orders, so legacy layouts
  (operator GUI last) get it too. Manually pinned heads (`*_os_x`) are left alone.
- `os-layout-calculator.js` `operatorFirstLead` — the pixel-mapping canvas (and its slice windows, via
  `mappingCanvasOffsetX`) starts past the gap. This is the box's own case: Dioda is a slice window on DP-0.
- `os-layout-calculator-offset.js` — legacy order + pixel mapping: the operator heads were shifted flush onto the
  canvas edge, so they get the gap on top of that shift when nothing auto-placed came before them.
- Operator heads still touch each other, so the WO-903 fence around their union holds no dead canvas.

Everything downstream reads the plan: xrandr apply/verify, the Caspar screen consumer `<x>`, slice windows, GUI
windows and the confine rect. On the box the full apply changed exactly one line of casparcg.config (`<x>3840` →
`<x>3968`).

## What was verified

- New `smoke-wo938-operator-cursor-gap.test.js`: gap ≥ 96, and in four layout families (screen rig and pixel-mapping
  rig, each in operator-first and legacy order) the minimum horizontal clearance between any operator rect and any
  other rect sharing its rows is exactly the gap. Operator heads still abut.
- Goldens re-captured, diff reviewed: `wo868/off.layout.json` operator GUI 3840→3968, `on.layout.json` +
  `on.caspar.xml` PGM1 1920→2048. `off.caspar.xml` and both channel maps unchanged. The WO-869/920/868-switch
  assertions now state the gap explicitly. The mapping rig moved to `fixtures/wo869-box-config.js` and is shared.
- On the box (.10), after `kill -TERM` node + `POST /api/caspar-config/apply`: `xrandr` → `current 7808 x 1792`,
  DP-0 `+3968+0`; the Caspar `Screen consumer [2|3840x1792]` window sits at 3968,0; the barrier daemon rebuilt
  itself from the RandR event. `xdotool mousemove_relative` ×6 (+1200 px) from 3700 stops at **3839**. A
  `ffmpeg x11grab -draw_mouse 1` grab of x 3760..4080 shows the arrow ending around x 3860, in the black dead strip,
  with DP-0 starting at 3968.
- Remaining owner check: look at the physical wall while pushing the mouse right (the grab draws the cursor in
  software, while the hardware cursor plane is what the wall shows; positions are the same).

