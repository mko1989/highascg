# WO-889 — Device View GPU-port inspector: drop the "Confine" select

**Area:** godot-client
**Status: DONE (31.10.26 — Godot --check OK; test_devices_gpu_output golden replay green without the confine step; smoke pin in WO-888's smoke)**

## Owner request (31.10.26)
"we dont need the confine monitor choice in the ports inspector, its already programmed very well no need for the setting."

## 1. Investigation
- `godot/client/features/devices/gpu_output_controls.gd:170-174` put a `Confine: auto / on / off` OptionButton right
  after the "Operator monitor" toggle (web-parity port of the old device-view inspector, WO-605 slice 4); it posted
  `{"operatorTools": {"pointerConfine": …}}` (`gpu_output_model.gd confine_patch`).
- The box value is `"auto"` (`config/general.json` operatorTools.pointerConfine) — confine follows the operator
  monitor (WO-568 / WO-805), which the owner says works as intended.
- The golden replay `tests/golden/devices_gpu_output.json` recorded one confine step (case "live p3 pgm", act 8) and a
  `confine` select in every `init.selects`.

## 2. What was done
- Removed the select and its save kind from `gpu_output_controls.gd`, the `confine` field/effect from
  `gpu_output_ui.gd`, and `CONFINE_OPTIONS` / `CONFINE_TIP` / `confine_patch` / `st.confine` from
  `gpu_output_model.gd` (the `settings` parameter of `consumer_state` is now unused → `_settings`).
- Golden fixture: the confine act and the `confine` select entries dropped; `test_devices_gpu_output.gd` no longer
  maps `operatorTools` posts to a confine kind.
- The server setting stays (`auto` default) — only the control is gone; Settings ▸ System still reports the confine
  state read-only.

## 3. What was VERIFIED
- `./run-client.sh --check` boot OK; `./run-client.sh --test` (count in the commit run).
- `tools/smoke/smoke-wo888-caspar-sync-follows-pgm.test.js` asserts the controls carry no `CONFINE_OPTIONS` / `"confine"`.
