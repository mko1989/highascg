# WO-920 — Operator GUI destination: a second output dot for the second operator monitor (dots "1" and "2")

**Area:** godot-client, devices-config, mapping
**Status: OPEN**

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

Nothing yet.

## What was verified

Nothing yet.
