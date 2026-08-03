# WO-407 — Screen-consumer micro-stutter while the same channel is smooth in the operator GUI (todos03.08.26 item 3)

**Status: DONE (2026-08-03 — T2 confirmed by owner on the glass: "seems to be smooth now". Root cause: GL swaps synced to the PRIMARY head (DP-4 operator monitor) while PGM lives on DP-0 — cross-panel vblank beat. Fix: `__GL_SYNC_DISPLAY_DEVICE=DP-0` via run.sh's box-local caspar-env hook)**
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

### Update 03.08 later (box back in show state, displays driven)

`xrandr` with real modes: **DP-0 = 1728x960@50.00\* and DP-4 = 1920x1080@50.00\*** — both
displays run exactly 50 Hz, matching the 50 fps channels. **Hypothesis 1 (refresh mismatch)
is RULED OUT.** The earlier 8×8/no-mode report resolved itself after the owner's restart —
likely a boot-order window, worth remembering but not the stutter. Show-day caspar logs
(01–02.08) contain zero late/dropped lines (the binary doesn't log frame pacing at info
level), so diagnosis is by eye + single-variable tests below.

### Hypotheses, ranked (updated)

1. ~~Refresh mismatch~~ — RULED OUT 03.08 (both displays measured 50.00 Hz, see update).
2. **Dual-vsync contention** — two blocking swap chains on one X screen; test by setting
   `vsync false` on the ch 3 (operator GUI) consumer only, since Firefox composites above it
   anyway, and see if PGM smooths out. NOTE: ch 3's vsync is HARD-CODED true in
   `config-generator-operator-gui.js:88` — the test is a hand-edit of the generated
   `config/casparcg.config` + caspar restart (next Apply regenerates it back).
3. **Load-induced** — caspar at 431 % CPU (WO-401 baseline) missing frame deadlines;
   would show as irregular (not cadenced) drops. Ties into WO-405 round-2 measurements.
4. **Windowed swap path** — both consumers are `windowed` borderless; without a compositor
   X blits instead of page-flipping. If 2. fails, try fullscreen/windowed toggle on ch 1.

### Test log (03.08, owner watching)

- **T1 — ch 3 vsync off** (hand-edit of generated config + caspar restart 11:17): owner
  verdict **"its the same"** — dual-vsync contention alone is not it (or not all of it).
  Left off for now; next Apply regenerates it back to true.
- Owner hunch: "may be something with composition pipeline in nvidia settings" — live
  driver state read: **ForceCompositionPipeline=On on both displays** (this box's own
  documented normative policy, `docs/reference/screen-consumer-vsync-nvidia.md` +
  `/etc/X11/xorg.conf.d/99-highascg-force-composition.conf`), SyncToVBlank=0,
  `__GL_SYNC_TO_VBLANK=0`. So the doc'd recipe is in force and still stutters.
- **T2 — pin GL swap vblank to the PGM display** (running): the doc never covers WHICH
  head GL syncs to; on a multi-head X screen the driver defaults to one (primary DP-4 =
  operator monitor = the smooth one) and DP-0 beats against it — matches "irregular" +
  the channel pipeline measuring a perfect 50.00 fps. `run.sh` now sources an optional
  box-local `~/.config/highascg/caspar-env` (NOT in the repo — Syncthing peers
  unaffected); this box sets `CASPAR_GL_SYNC_DISPLAY=DP-0` →
  `__GL_SYNC_DISPLAY_DEVICE=DP-0`, verified in the running caspar's environment
  (service cycled via exit-137 → systemd on-failure restart). **Owner verdict: SMOOTH — this was the fix.** Note: the owner asked if a stray caspar instance was the cause — no; that was a pgrep-self-match false alarm in the session (only one caspar ever ran). CAVEAT: T1's ch3 vsync=false hand-edit was still in place during the verdict; the next Apply regenerates vsync=true on ch3 — re-check PGM smoothness once after that Apply (if stutter returns, the combination matters and ch3 vsync needs a real setting).
- If T2 fails: **T3** — ForceCompositionPipeline OFF on DP-0 only (live
  `nvidia-settings --assign`, no restart — but contradicts the normative doc; test-only,
  re-asserted by `highascg-nvidia-x-apply.sh` on next layout apply). Then T4: PGM vsync
  off / fullscreen.

## 2. Diagnosis plan (box IS in show state as of 03.08 midday — ready when the owner is)

1. Owner looks at the PGM output now: is the micro-stutter visible at the shop, and is it
   periodic (metronome-like hiccup) or irregular? Which output is it (DP-0 1728×960?).
2. Single-variable tests, one caspar restart each, in order: ch 3 vsync off (hand-edit) →
   ch 1 PGM vsync off → windowed/fullscreen. Judge each by eye on moving content.

## 3. What was done / verified

Nothing changed yet — investigation only. No config edits, no restarts (live box).
