# WO-351 — Boot monitor picker: calm colors + pick lands as a devices-tab cable

**Status: DONE (2026-07-27)** · Source: todos27.07.26 (owner):
"the screen that displays after reboot to choose operator monitor is too bright and colorfull.
black bg and white text in the middle. also when the monitor is chosen this way it needs to be
cabled correctly in the devices tab already."

## 1. Colors (tools/runtime/operator-monitor-picker.py)

Deep-blue panel + orange accent (`#10284b` / `#ff9d2e`) → **black bg `#000000`, white text
`#ffffff`, muted gray frame `#4a4a4a`**. Text was already centered around mid-screen
(`draw_prompt` rows around h/2); only the palette changed.

## 2. Devices-tab cable (src/system/operator-monitor-picker.js)

`applyOperatorMonitorChoice` (the pure persistence step, WO-290) now also calls
`wireOperatorGuiGraphEdge`: finds the `operator_gui` destination in
`config.screenDestinations.destinations`, and wires `dst_in_<destId>` → `gpu_p<port-1>` in
`config.deviceGraph.edges` (flag port is 1-based; jack ids are slotOrder — the same
slot+1 relation `listPickerOutputs` uses). Any prior cable on either endpoint is replaced —
one monitor, one jack, mirroring the physical click. Safety: never invents connectors — if the
graph doesn't yet have both endpoints (fresh box before the boot hardware sync), the
`screen_N_operator_monitor` flag alone still drives the launcher and the graph is untouched.

The devices tab reads its cables from `deviceGraph.edges`, and the OS layout resolver
(src/utils/os-layout-calculator-assign.js) already treats an operator_gui-bound jack as the
operator-area head — so the pick now shows up cabled and drives layout the same way a manual
devices-tab cable would.

## Verification

smoke-wo290 extended with two subtests (wire + replace prior cables; missing-connector /
no-destination no-ops): 33/33. Full test:ci 1532/0, lint 0 errors, py_compile clean.
Visual sign-off pending: next fresh-boot pick (colors + cable appearing in devices tab).
