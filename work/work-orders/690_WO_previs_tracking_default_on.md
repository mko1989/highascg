# WO-690 — Previs + Tracking server modules on by default ("the programmer is gone")

**Area:** tracking-vr, godot-client
**Status: DONE (23.10; smoke 3/3, box: both modules load after a restart, Programmer back in the Godot client)**

Owner, 23.10: *"The programer is gone now."*

## Investigation (23.10)

- The Programmer *section* was still in Previs → Fixtures. Screenshot of a second client instance (`--tab=1`):
  it lists the 3 fixtures but has no attribute controls, and shows *"Fixture engine not reporting — the Tracking
  module is off on the server"* (`programmer_section.gd:137`). The model library line says *"server previs module
  off"* (`previs_tab.gd:406`).
- The journal shows when it changed:
  - `[modules] loaded "tracking"` at 22.10 17:41;
  - `[plugins] "previs" disabled` / `"tracking" disabled` from 22.10 18:22 on, the eggs produce for the 22.10 ISO.
  The produce resets `config/` to the factory state, which is intended (owner rule; WO-415).
- In the factory state both modules are off: `src/plugins/plugin-manager.js` `legacyEnabled` needed
  `features.previs3d === true` / `features.tracking === true` or the env flag. The factory config has neither, and the
  plugin store (`config/plugins.json`) is `{"entries": {}}`. So every reset, and every box installed from the ISO,
  loses the fixture engine (Programmer, DMX out, Art-Net / sACN input) and the GLB model library. This is although
  the Godot client always shows the Previs tab.
- Tracking at load opens no sockets and spawns nothing. Detection stays opt-in per project
  (`project.previs.tracking.detection.enabled`, `detect-service.js`). Default-on costs only the in-process module.

## What was done

- `src/plugins/plugin-manager.js`: previs and tracking now follow the CG Studio pattern (WO-265):
  - an env flag, when set, decides;
  - otherwise they are on unless `features.previs3d` / `features.tracking` is `false`;
  - a plugin-store entry still wins over both.
  - Auto Follow stays opt-in.
- `tools/smoke/smoke-wo690-previs-tracking-default-on.test.js` (in the curated CI list) covers:
  - factory config → both on, autofollow off;
  - flags false → off;
  - env 0 → off;
  - store entry wins.

## What was VERIFIED

- Smoke 3/3.
- Box: server restarted (`kill -TERM` of the MainPID). `GET /api/plugins` → previs enabled, tracking enabled,
  autofollow disabled, cg-studio enabled. `/api/fixtures/dmx` 200, `/api/previs/models` 200.
- Box, second Godot instance on Previs: the DMX output / Send / Art-Net-sACN input row and the Programmer are back. The
  project (`new_project_1.json`: 3 fixtures, 1 stage object, MVR) is untouched (checked after the restart).
