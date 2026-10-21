**Status: IN PROGRESS (2026-10-21)**

# WO-646 — Delete the Firefox kiosk operator GUI; two clients remain (web UI, Godot GUI)

Owner, 21.10: *"after that we are doing a clean up. the kiosk deleted and marked as such. there are two clients. one
for headless and or just remote webui with the compose preview with only the hq thumbnails. second the godot gui."*

This is [WO-609](./609_WO_godot_cutover_packaging_kiosk_decommission.md) T5 (the deletion commit). The start-up side
is already [WO-645](./645_WO_startup_launcher_autostart_opt_in.md): the Godot GUI or headless, never the kiosk.

## Investigation

What the kiosk is: a full-screen Firefox on the web UI (`?operatorGui=1`) with holes punched where Caspar's
`operator_gui` channel shows live video through. It works through an X SHAPE overlay
(`operator-shape-overlay.py`), window-layer helpers, and a watchdog that keeps foreign helper windows above the kiosk.
The Godot GUI draws the same channel itself (shm surface `opgui`), so none of the X machinery is needed.

Importer map (rg `require(...)`, 21.10):

| Module | Kiosk-only? | Kept users |
|---|---|---|
| `src/system/operator-gui-launcher.js` (+ `-placement`, `operator-gui-scale`) | yes | `routing-setup.js:189` auto-launch, `routes-operator-gui.js` launch / raise, `operator-helper-window.js`; **Godot** `destinations_panel.gd:194` "Launch" (POST `/api/operator-gui/launch`, opens the kiosk) |
| `operator-shape-overlay.js` + `tools/runtime/operator-shape-overlay.py` (+ `_lib`), `highascg-window-below.py` | yes | `operator-gui-channel.js:171,387` feeds rects, `bootstrap/shutdown.js:85` |
| `operator-snap-home.js` + `tools/runtime/highascg-operator-snap-home.sh`, `highascg-window-above.py` | **no** | the Godot dock's snap Firefox (`system-hardware-gui.js:62`) and `install-operator-firefox.sh`; kept |
| `operator-helper-window.js`, `-plan`, `-state`, `-applier`, `-coordinator`, `-live`, `-registry` (WO-283 / 317 helper windows over the kiosk) | runtime yes | **`operator-dock.js` (Godot dock)** uses `HELPER_ACTIONS`, `isHelperAction`, `classifyHelperWindows`, so those move into the dock |
| `src/api/operator-helper-icon.js` | **no** | the Godot dock's icons (`operator_dock_model.gd:47`, GET `/api/system/operator-helper-icon`) |
| `operator-monitor-picker.js` (WO-290 fresh-boot picker) | its boot call is in the launcher (`maybeRunBootMonitorPicker`) | WO-638's `boot-screen-assignment.js` replaced the boot prompt; the module stays for `system-hardware-operator-display.js` / `index.js` |

- Routes that only serve the kiosk: `POST /api/operator-gui/launch|raise`, `DELETE /api/operator-gui/layout`,
  `/api/system/operator-helper-window` (GET / POST), `/api/system/operator-helper-taskbar` (GET / POST).
- Kept routes: `/api/operator-gui/layout` GET / POST and `/cell`, `/cell/remove` (Godot compose tiles,
  `media_preview.gd`), `/api/system/dock*`, `/api/system/operator-helper-icon`, `/api/system/operator-display|screen`.
- Web client, kiosk-only: `client/lib/operator-gui-mode*.js`, `operator-gui-launch.js`,
  `operator-gui-interaction-suppress.js`, `element-position-watch.js`, `components/header-bar-operator-helper.js`,
  `styles/10-operator-gui-mode.css`. Call sites: `app.js`, `app-ws-handlers.js`, `scenes-editor*.js`,
  `timeline-editor.js`, `preview-canvas-panel.js`, the compose tiles. `compose-preview-url.js` has a `'native'`
  (holes) mode. Without the kiosk, the web compose preview is HQ thumbnails only (`thumbnail-url.js ?hq=1`).
- Smokes that test kiosk code: wo255, shape-overlay-input-dead (+ the xvfb harness), wo269, launch-timing, wo279,
  wo264, 4k-scale, wo283 ×2, wo317 ×6, wo243, and parts of boot-monitor-picker, wo597, wo325, wo387, wo382.

## Plan (one commit per stage, each gated)

- A. Server kiosk launch + shape overlay; the Godot Launch button.
- B. Helper-window runtime. The dock keeps its app list / window check (moved into `operator-dock.js`) and the icon.
- C. Web client: kiosk mode out; the compose preview to HQ thumbnails.
- D. Mark the kiosk WOs DEPRECATED → this WO; WO-609 T5 done.

## What was done

### Stages A + B (server + Godot)

- Deleted (`git rm`):
  - `src/system/`: `operator-gui-launcher.js`, `-launcher-placement.js`, `operator-gui-scale.js`,
    `operator-shape-overlay.js`, and the seven `operator-helper-window*` / `-applier` / `-coordinator` / `-live` /
    `-registry` modules;
  - `tools/runtime/operator-shape-overlay.py`, `operator_shape_overlay_lib.py`, `highascg-window-below.py`,
    `tools/smoke/xvfb-shape-overlay-harness.py`;
  - 14 kiosk-only smokes (dropped from the curated list too).
- `operator-dock.js` now owns `HELPER_ACTIONS`, `isHelperAction`, `PROFILE_LOCK_TITLE_RE` and `classifyHelperWindows`,
  the only parts of the helper runtime the Godot dock used.
- Routes gone: `POST /api/operator-gui/launch|raise`, `DELETE /api/operator-gui/layout`,
  `/api/system/operator-helper-window` and `/operator-helper-taskbar` (GET + POST). Their handlers left
  `system-hardware-gui.js`, `routes-system-hardware.js`, `routes-operator-gui.js` and `router.js`. The API contract was
  regenerated.
- `operator-gui-channel.js` no longer feeds the shape overlay; `bootstrap/shutdown.js` no longer stops it;
  `routing-setup.js` no longer auto-launches the kiosk.
- Smokes that tested both kiosk and kept code lost only the kiosk cases: boot-monitor-picker,
  operator-gui-reconnect-reassert, wo243 (now asserts there is NO `DELETE` route), wo325, wo369, wo382, wo387, wo597.
- Godot Devices → destination Inspector: the Web-UI URL field, "Auto-start at boot", "Launch / Bring to front" and
  the `launch_operator_gui` signal are gone (`destination_inspector.gd`, `destinations_panel.gd`). The video-output
  labels and the notes no longer mention the Firefox kiosk / X SHAPE (`destinations_model.gd`). The web-form golden
  (`tests/golden/devices_destination_form.json`) lost the same two fields and two actions.
- `operatorTools.multiHelperTaskbar` has no reader any more. It stays in `defaults-core.js` and `settings-post.js`, so
  saved settings still round-trip. Its comment says so.
- Unwired-exports gate: three helpers exported only for the deleted smokes were unexported; the baseline shrank 667 →
  654.

### Stage D (docs)

- WO-243, 255, 264, 269, 279, 283, 290, 317 and 325 carry `DEPRECATED (… successor WO-646)` status lines (one line
  each; 243 keeps its older "partially deprecated" banner). The OPERATOR-GUI-CEF and OPERATOR-GUI-V2 queue rows are
  marked deprecated.

## What was VERIFIED

- Stages A + B, 21.10:
  - `npm run -s test:ci`: 2880 tests, 2878 pass, 0 fail, 2 skipped.
  - Lint 0 errors; `format:check`, `check-max-file-lines` and `check-unwired-exports` all clean.
  - Godot `--test` 20694 passed, 0 failed; `--check` boot OK.
  - Box: node restarted (up after 8 s, no errors). `GET /api/operator-gui/layout`, `/api/system/dock` and
    `/api/system/apps` → 200. `/api/operator-gui/launch` and `/api/system/operator-helper-window` → 404. The Godot GUI
    relaunched without script errors.
