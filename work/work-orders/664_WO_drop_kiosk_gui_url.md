# WO-664 — drop the kiosk's `guiUrl` from operator_gui destinations (keep `autoLaunch`)

**Area:** godot-client, devices-config
**Status: DONE (22.10.2026: offline 2736/0; node restarted on the box, operator-GUI layout 200, no errors in the journal).**

Owner, 22.10, on the dead-field question left open by [WO-660](./660_WO_remove_gui_stream_encoder.md) ("delete `guiUrl` / `autoLaunch`?"): *"What you recommend"*. The recommendation: delete `guiUrl`, keep `autoLaunch`.

## Investigation

**`guiUrl`** was the Firefox kiosk's page URL (WO-243 / WO-255, `?operatorGui=1`). The kiosk is gone (WO-646 / WO-660). What remained:
- written: `screen-destinations.js` `normalizeDestination` default, plus the `device-view-crud.js` add and patch merge;
- passed along: `operator-gui-channel-geometry.js` `resolveOperatorGuiChannel` returned it, with a `DEFAULT_GUI_URL` fallback that was exported and re-exported by `operator-gui-channel.js`, and `ensureOperatorGuiChannel` returned it;
- never read: no caller used `resolved.guiUrl` or `DEFAULT_GUI_URL` (`rg` over `src/`, `client/` and the Godot `.gd` files).

The web UI has no `guiUrl` field. The one in `client/setup.html` and `routes-system-setup.js` is Syncthing's GUI URL, which is unrelated and stays.

**`autoLaunch`** also has no reader today. It is the destination's "start the operator GUI at boot" switch, though, and [WO-609](./609_WO_godot_cutover_packaging_kiosk_decommission.md) T2 says the Godot user unit should honour it (start policy in [WO-645](./645_WO_startup_launcher_autostart_opt_in.md)). Deleting it would mean re-adding the same field later, so it stays.

## What was done

- `screen-destinations.js`: no `guiUrl` default. `normalizeDestination` builds `base` from listed keys, so a saved `guiUrl` is dropped on the next normalize or save. The `autoLaunch` comment now names its future reader.
- `operator-gui-channel-geometry.js`: removed `DEFAULT_GUI_URL`; `resolveOperatorGuiChannel` returns `{ ch, dest }`.
- `operator-gui-channel.js`: dropped the re-export; `ensureOperatorGuiChannel` returns `{ ch }`.
- `device-view-crud.js`: add and patch no longer carry `guiUrl`. The `autoLaunch` / `physicalPort` / `headless` merge is unchanged.
- `factory-starter.js`: comment updated.
- Tests now pin the removal rather than the old URL:
  - `smoke-wo243-operator-gui.test.js`: no `guiUrl`; `autoLaunch` defaults true; a saved `guiUrl` is dropped; `resolveOperatorGuiChannel` returns `dest`.
  - `smoke-wo243-operator-gui-crud-ui.test.js`: the patch-merge test now patches `physicalPort` and checks that `autoLaunch: false` survives and the saved `guiUrl` is dropped.
- Not touched:
  - Godot `tests/golden/devices_*.json`: captured server data that the page only reads, so an extra key is harmless;
  - `tools/smoke/fixtures/screen_destinations.sample.json`: input;
  - the live `config/screen_destinations.json`: runtime state, which loses the key on its next save.

## What was VERIFIED

- `npm run test:ci`: 2736 pass, 0 fail. The three WO-243 / new-project smokes: 36 pass.
- Lint: 214 warnings. `format:check` passes. Unwired exports: no new ones.
- `normalizeDestination({ mode: 'operator_gui', guiUrl: 'x', autoLaunch: false })` returns no `guiUrl` and `autoLaunch: false`.
- Box: node restarted. `GET /api/operator-gui/layout` returns 200 with cells. The journal has no TypeError or ReferenceError since the restart.
