# WO-920 — Operator GUI destination: a second output dot for the second operator monitor (dots "1" and "2")

**Area:** godot-client, devices-config, mapping
**Status: DONE (01.11.26 — suites green; live: dot 2 drag-cabled to DP-6, Apply placed operator_gui_2 at +1920, window 2 lands on the dot-2 output)**

Owner, 01.11.26:
> For the operator gui destination add a second output dot for the second screen, label them 1 and 2.

Related: [WO-891](./891_WO_second_operator_monitor_window.md) (the second operator window), WO-573 (operator_gui has
its own layout bucket), WO-868 (operator GUI first), [WO-919](./919_WO_gui_sweep_followups.md) F20.

## Investigation

- **Godot card.** `godot/client/features/devices/destinations_panel.gd` `_card()` draws one output dot on the title row,
  except for a PGM/PRV destination, which gets one row and one dot per half (`id#pgm`, `id#prv`). The Operator GUI
  destination therefore has one unlabelled dot.
- **Cables.** A destination edge from the PRV half is stored with the note `outputLayer 2`
  (`devices_model.gd output_layer` / `source_anchor`, WO-364). The server reads it with
  `device-graph-output-mapping.readEdgeOutputLayer`.
- **Server layout.** `src/utils/os-layout-calculator-assign.js` maps an operator_gui-bound GPU jack to
  `binding = { type: 'operator_gui', index: 1 }`, whatever the edge's output layer is (:145). Everything downstream
  already keys the operator heads by `n`:
  - `results.operatorGui[n]` (os-layout-calculator-place.js:240), with per-n `operator_gui_<n>_os_*` keys;
  - xrandr apply (`os-config-xrandr-apply.js:261`) and verify (`xrandr-layout-verify.js:21`);
  - pointer confine span, offset, operator-first plan.

  `x-display-session-layout-resolve.js:186` takes `operatorGui[1]` as the main GUI head. So a second head needs only
  index 2 from outputLayer 2, plus a check that nothing treats every `operatorGui` entry as "the" GUI monitor.
- **Second window.** `godot/client/app/tab_undock.gd` `place()` and `tab_undock_model.gd` `pick_screen` choose window
  2's screen. They use the saved pick if it is not a Caspar output, else the first screen that is neither the main
  window's nor busy. Busy comes from GET `/api/system/operator-screen` `caspar:true`, built by
  `routes-operator-screen.js casparOutputNames`. Nothing there knows which output is cabled as operator monitor 2.
- **On this box** DP-6 (1920x1080 at +1920) is the physical second operator monitor. It is connected but uncabled,
  which is the WO-918 F20 overlap case.

## What was done

Commit eafdd6f7.

- **Server.**
  - `os-layout-calculator-assign.js`: a cable from dot 2 (edge note `outputLayer 2`) binds
    `{ type: 'operator_gui', index: 2 }`, and dot 1 binds index 1. Unnumbered `operator_gui_os_*` keys apply to n=1
    only.
  - `os-layout-calculator-place.js operatorGuiPlacementOrder` and `os-layout-calculator-offset.js` place heads 1 and
    2 in order. The main GUI stays `operatorGui[1]` (`x-display-session-layout-resolve.js`,
    `screen-consumer-port-resolve.js OPERATOR_MONITOR_1`).
  - `operator-monitor-picker.js` and `boot-screen-assignment.js monitor2Jacks` know the second monitor.
  - GET `/api/system/operator-screen` (`routes-operator-screen.js planRoles`) reports `gui: 1|2` per output.
- **Godot card.**
  - `devices_model.gd half_rows` / `link_prefix` and `destinations_panel.gd` give the Operator GUI destination two
    rows, "1" and "2", each with its own dot, the way PGM/PRV halves work. The cabled outputs are listed as
    "• 1: …" and "• 2: …".
  - `destination_inspector.gd` follows.
- **Second window.**
  - `tab_undock_model.gd pick_screen` prefers the screen whose output is cabled to dot 2 (`cabled_screen`).
  - `tab_undock.gd recheck()` re-places window 2 when `shell.gd` hears `caspar.applied`, `hardwareConfig` or
    `project.activated`.
- **Tests:** `test_devices_model.gd` and `test_tab_undock.gd` additions, and
  `smoke-wo920-operator-gui-monitor-2.test.js` (14). `smoke-wo243` was repointed.

## What was verified

- **Suites:** offline 5206/0 and Godot 25747/0.
- **Live on the box**, 01.11, show mhp_harder, in the Godot GUI test client on Xvfb :120:
  1. The Devices Operator GUI card shows the dots "1" and "2".
  2. I removed the old dot-1 fan-out cable "Operator GUI 1 → DP 6/7 · DP-6" from its cable row, then drag-cabled dot
     2 to the DP-6 port.
     - The edge is `dst_in_dst_operator_gui -> gpu_p3 {"outputLayer":2}`.
     - The card lists "• 2: DP 6/7 · DP-6" and the cable row reads "Operator GUI 2 → DP 6/7 · DP-6".
  3. GET operator-screen reports DP-4 `gui:1` current, DP-6 `gui:2`, and DP-0 `caspar:true`.
  4. Apply ("Config written; layout applied; Caspar restarted.") logged `operator_gui_1 DP-4 pos=0,0`,
     `operator_gui_2 DP-6 pos=1920,0` and `screen_1 DP-0 pos=3840,0`, with no nodm restart.
     - `xrandr --listmonitors` shows DP-4 +0+0, DP-6 +1920+0 and DP-0 +3840+0.
     - The same layout held after the final restore Apply at 13:04.
  5. Window 2 placement, on a private Xvfb :95 with three monitors named like the box's:
     - A client with `[second_window] tabs=["Audio"]` put "HighAsCG Operator" at 0,0 and "HighAsCG — 2" at
       1920,0, 1920x1080. That is the output cabled to dot 2.
- **Box state change (intended):** mhp_harder's hardware now cables DP-6 to dot 2 instead of the old dot-1 fan-out.
  The DP-6 overlap from WO-918 F20 is gone on this box.
