# WO-882 — A pre-eggs project loaded its looks but not its devices: an autosave had stamped the factory rig over it

**Area:** engine, godot-client
**Status: DONE (31.10: smoke 5/5 fails on the old guard; mhp_harder repaired and applied; a live autosave during a
rig swap kept the cables; the open Devices tab refreshes on apply — Xvfb screenshots)**

Owner 31.10: "Tried to load the project from before eggs and it loaded looks but didn't load the devices tab, screen
destinations, connections etc." Follows the guard written for the same symptom (`smoke-autosave-preserves-hardware`).

## 1. Investigation

- The load itself worked: journal 08:13:35 `[project] Loaded hardware configuration (v2)` then `activated mhp_harder:
  23 look(s)`. The FILE had no rig: `projects/mhp_harder.json` rev 382, saved 30.10 20:32:50 UTC, hardwareConfig =
  4 connectors / 0 cables / 1 destination (Operator GUI).
- The rig existed: the WO-868 switch backup (`~/.highascg/backup/wo868-2026-10-30T17-12-06-237Z/projects/
  mhp_harder.json`, rev 375) holds 13 connectors / 4 cables / 3 destinations (Operator GUI, Dioda, Proj). Every other
  project in `projects/` matches its backup — only mhp_harder, the active one, was hit.
- When: the node's startup config dumps (journal) — 21:15:10 local `conn 13 edges 4 dests 3`, 21:32:42 `conn 0 edges
  0 dests 1` (the pre-eggs factory reset — intended), and the project file was written 8 s later (21:32:50 local), no
  journal line: a background autosave from a connected client.
- Why the guard let it through: `injectHardwareConfigToProject(…, {preserveWhenEmpty})` keeps the stored rig only when
  `hardwareConfigHasOperatorIntent(live)` is false, and that counted ANY destination or cable. The factory config
  (`src/config/factory-starter.js`, WO-264) seeds the `dst_operator_gui` destination, and WO-718 may cable its monitor
  — so a factory box always looked rigged. The smoke's "empty" fixture had `destinations: []`, a shape the factory
  never produces, so it stayed green.
- Second gap: the Godot Devices tab refreshes only when it becomes visible, on DRM hotplug or prefs
  (`devices_tab.gd:211-213`); the server's `change {path: hardwareConfig | project.activated}` broadcasts after a load
  / apply-hardware were ignored, so a load while sitting on Devices showed the old rig.

## 2. What was done

- `src/engine/project-hardware-config.js` `hardwareConfigHasOperatorIntent`: operator-GUI destinations and cables to or
  from their `dst_in_<id>` connector don't count. Any other destination or cable still does.
- `tools/smoke/smoke-autosave-preserves-hardware.test.js`: a test on the REAL factory config
  (`buildFactoryModularConfig`), with and without the operator-GUI cable — counts as empty and the autosave keeps the
  project's rig; a PGM destination or any other cable still counts as a rig.
- `godot/client/features/devices/devices_tab.gd`: refresh on `change` with path `hardwareConfig` or
  `project.activated` while visible (one line — the file is at 500).
- Data repair (box): `projects/mhp_harder.json` copied to the scratchpad (rev 382), then `POST /api/project/autosave`
  with the stored doc and the backup's hardwareConfig (→ rev 383), then `POST /api/project/apply-hardware` with it.
  The backup slice is the 21:15 live rig exactly (deviceGraph same up to edge order, destinations identical,
  casparServer differs only by `operator_gui_first`, which is machine-local and stripped on apply — live stays true).

## 3. What was verified

- The new smoke test fails on the old predicate (4 / 5) and passes on the fix (5 / 5).
- Box: after the repair, live `config/device_graph.json` 13 connectors / 4 cables, destinations Operator GUI, Dioda,
  Proj; `operator_gui_first` still true.
- Box, the fix live: a second client on Xvfb on the Devices tab; apply-hardware with the thin rig, then the full one —
  the open tab showed full → thin → full without a tab switch (screenshots). A client autosave landed during the
  swap (rev 384) and the file kept its 4 cables.
- `run-client.sh --check` boot OK; Godot suite 24073 / 0.
- Caspar itself was not re-applied: the Devices view holds the rig; Apply (Caspar config + restart) is the owner's.
