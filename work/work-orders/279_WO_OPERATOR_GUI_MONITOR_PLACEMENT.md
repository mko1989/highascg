# WO-279 — Operator-GUI Firefox opens on the wrong monitor

**Source:** todos19.07.26 — "the operator gui firefox fails to open on the selected monitor. but the
mouse is locked to the correct monitor. the xrandr workflow needs a review. after manualy running
`DISPLAY=:0 xdotool search --onlyvisible --name "Mozilla Firefox" windowmove 3072 0` it showed
correct and restarts correct."

## Problem
The kiosk Firefox lands on the wrong X screen/position at launch, even though pointer confinement
already targets the right monitor — so the *intended* monitor is known, it just isn't applied to
the window. The owner's manual `xdotool windowmove 3072 0` fixes it and survives restarts, which
says the geometry is right and the placement step is either missing, racing, or applied before the
window exists.

## Investigate first
1. Read the launcher end to end: `src/system/operator-gui-launcher.js` (it now carries WO-273-era
   timing probes — use them), the shape overlay helper `tools/runtime/operator-shape-overlay.py`,
   and any xrandr/xdotool/wmctrl invocations under `src/system/` and `tools/`.
2. Establish the intended-monitor source of truth (the same value the pointer lock uses) and follow
   it to the window-placement call. Confirm whether placement is attempted at all, and when.
3. Race check: Firefox creates its window asynchronously and may re-create/resize it during
   startup (profile restore, kiosk transition). A single early `windowmove` can be silently undone.
   The probes should show whether placement fires before the window is mapped.

## Requirements
1. Place the kiosk window on the monitor the operator selected, using the same source of truth as
   the pointer confinement — never a second, independently-derived guess.
2. Make placement robust to Firefox's asynchronous window creation: wait for the window to exist
   and be mapped, then place; verify the resulting geometry and retry a bounded number of times
   with backoff if it does not match. Log each attempt (one line per state change, not per poll).
3. Log the intended monitor, the resolved geometry, and the final verified geometry, so a wrong
   monitor is diagnosable from the journal without the operator reproducing it.
4. Prefer the mechanism that already works on this box (`xdotool windowmove`, per the owner's own
   test) over introducing a new dependency.

## Acceptance
- Written root cause with file:line evidence: missing placement, wrong geometry, or a race.
- Kiosk window verified on the selected monitor after launch; failure to place is logged loudly.
- Offline smoke test for the pure parts (monitor → geometry resolution, retry/backoff schedule,
  probe log shape). Do not require a live X server in the gate.
- `npm run test:ci` → 0 fail; no new eslint warnings vs HEAD.

## Constraints
- Do NOT restart the highascg service or relaunch the operator GUI on this live box — the operator
  display is in use. Exercise logic offline; the owner will validate the real launch.
- Do NOT run `npm run build:client`.
