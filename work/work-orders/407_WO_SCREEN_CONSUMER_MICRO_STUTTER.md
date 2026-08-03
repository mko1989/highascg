# WO-407 — Screen-consumer micro-stutter while the same channel is smooth in the operator GUI (todos03.08.26 item 3)

**Status: OPEN (triaged 2026-08-03 — config-level suspects identified; needs live repro with displays actually driven)**
**Priority:** High (on-air output quality)
**Source:** `work/work-orders/todos03.08.26` item 3 — "micro stutters on screen consumer. the same channel in the operator gui is smooth, yet on the actual output it stutters a little"
**Related:** WO-80 (xrandr forced custom modes), WO-314 (NVIDIA prime service env), WO-391 (mouse-lag/pointer watchdog on the same X server), WO-243/263 (operator-GUI CEF channel — the "smooth" comparison path), WO-401/405 (caspar at 431 % CPU — load-induced frame misses are a competing hypothesis)

## 1. Investigation so far (2026-08-03, config + live probes)

### Why the comparison matters

The operator GUI shows the SAME channel through `route://` layers on the Operator GUI
channel (ch 3) seen through holes in Firefox — a different consumer path entirely. Smooth
there + stutter on the PGM screen consumer means the producer/mixer side is fine and the
fault is in the screen-consumer presentation path (swap timing), not in decode or routing.
(Caveat: ch 3 is ALSO a screen consumer — if the operator monitor picture is the smooth one,
then "screen consumer" per se isn't broken; the difference is per-output.)

### Config facts (live `config/casparcg.config`)

- ch 1 PGM: custom mode **1728x960@50** (`time-scale 50000/1000`), screen consumer
  `device 1`, `vsync true`, windowed+borderless+always-on-top, at 0,0 1728×960.
- ch 3 Operator GUI: **1920x1080@50**, screen consumer `device 1`, `vsync true`, windowed,
  at 1728,0 1920×1080.
- → **Two vsync'd GL windows on the same X screen.** If the two attached displays refresh
  at different rates (or one blocks), the two swap chains can beat against each other —
  classic source of periodic dropped/duplicated frames on one output.

### Display suspects (xrandr, 10:10 UTC)

- DP-0 connected, preferred mode **2560x896@50** (LED-wall-shaped); DP-4 connected primary,
  preferred **1920x1080@50**, but 60 Hz modes listed first among alternates.
- If the PGM display actually runs 60 Hz while the channel produces 50 fps with vsync on,
  you get a 3-2-style cadence = exactly "micro stutter" — while Firefox on the operator
  monitor (compositing at its own rate) looks smooth.
- **Anomaly recorded**: at probe time (16 min after casparcg start) `xrandr` reported
  `Screen 0 … current 8 x 8` and **no active mode (`*`) on either connected output**, while
  kiosk + both screen consumers were running on `:0`. Either RandR reporting is broken under
  this driver setup, or display bring-up at boot is racing the consumers (WO-80/WO-314
  territory). Must re-probe while the owner confirms pictures are on the glass.

### Hypotheses, ranked

1. **Refresh mismatch** — PGM display at 60 Hz vs 50 fps channel with vsync (needs live
   xrandr showing the `*` mode; if 60: force 50 Hz via WO-80 mechanism, or vsync off on that
   consumer and let the 50 fps pace itself).
2. **Dual-vsync contention** — two blocking swap chains on one X screen; test by setting
   `vsync false` on the ch 3 (operator GUI) consumer only, since Firefox composites above it
   anyway, and see if PGM smooths out.
3. **Load-induced** — caspar at 431 % CPU (WO-401 baseline) missing frame deadlines;
   would show as irregular (not cadenced) drops; `DIAG` / graph overlay or frame-time OSC
   would distinguish. Ties into WO-405 round-2 measurements.

## 2. Diagnosis plan (needs the box in its normal on-glass state)

1. Owner confirms which output shows the stutter (LED wall on DP-0? projector?).
2. `xrandr` with displays live → actual refresh of the PGM display (and re-check the 8×8
   anomaly).
3. Watch cadence: is the stutter periodic (≈10 Hz hiccup ⇒ 50-on-60 duplication) or
   irregular (⇒ load)?
4. Single-variable tests, one restart each, in order: force PGM display to 50 Hz →
   ch 3 vsync off → PGM vsync off.

## 3. What was done / verified

Nothing changed yet — investigation only. No config edits, no restarts (live box).
