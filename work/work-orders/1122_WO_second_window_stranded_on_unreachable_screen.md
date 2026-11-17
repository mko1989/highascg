# WO-1122 — Second operator window stranded on a screen the pointer cannot reach after a project switch

**Area:** godot-client, devices-config
**Status: IN PROGRESS (17.11.26 — built, smoke + unit tested; the project-switch case not yet replayed on the box)**

Owner 17.11: "i loaded the previous project to get back to work on that one. this one did not have 2 op monitors.
but now i had previs on second monitor to which i couldnt get to because it was blocked."

## Investigation

- gutmanny 26 cables the Operator GUI to two outputs (DP-3 + DP-5, `gui: 2`); the Previs tab was sent to the second
  window (`app/second_window.gd`, "HighAsCG — 2") on DP-5.
- The other project has one operator monitor. `GET /api/system/operator-screen` then lists DP-5 with
  `caspar: false`, no `gui` — a free screen. `app/tab_undock_model.gd` `pick_screen()` keeps the operator's saved pick
  while it "shows no Caspar output", so `recheck()` (run on a project switch) left the window on DP-5.
- The pointer barriers (`src/system/pointer-confine.js`, `pointerConfine: auto` with an operator monitor set) span
  only the operator monitors: DP-5 was out of reach, and so was the tab on it.

## What was done

- `src/api/routes-operator-screen.js`: while the pointer is confined, an output that is neither the operator monitor
  nor cabled as a GUI monitor carries `reach: false`.
- `tab_undock_model.gd` `busy()` counts such a screen as unusable: the saved pick is ignored and the free-screen scan
  skips it → the second window becomes a plain window on the main monitor (its tabs stay in it, reachable); when a
  project cables operator monitor 2 again the window goes back there (the saved pick is kept).

## What was verified

- `tools/smoke/smoke-wo1122-operator-screen-reach.test.js` + wo599: 8 pass. Client unit suite 30110 passed, 0 failed
  (new pick_screen case in test_tab_undock.gd).

## Not verified

- On the box: load the one-monitor project with a tab on the second window and see the window come to the main
  monitor; load gutmanny 26 again and see it return to DP-5.
