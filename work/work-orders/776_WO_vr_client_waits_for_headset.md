# WO-776 — VR: "OpenXR was requested but failed to start" — the XR client launched before the headset connected

**Status: IN PROGRESS (26.10) — run-xr.sh fix dry-run verified (3 paths) + live relaunch got a running XR session;
owner QA = the next Start VR from the GUI with the headset off / connecting late.**

Owner, 26.10: "tried running vr session and got an alert, openxr was requested but failed to start".

Parents: [WO-741](./741_WO_vr_walk_mvr_scene_program_lights.md) (run-xr.sh), [WO-770](./770_WO_vr_session_gui_pin_modal_mirror.md)
(GUI Start VR → `src/vr/vr-session.js` launches run-xr.sh with `XR_WAIT_S=600`).

## Investigation

- The alert is Godot's own (`modules/openxr/register_types.cpp:262`), after `Failed to create XR instance [Error code
  -51]` (XR_ERROR_RUNTIME_UNAVAILABLE) in the XR client's `godot.log`.
- Timeline (journal + `ps lstart`): wivrn-server start 12:39:46 → XR Godot (pid 62787, `--xr-mode on`) 12:39:47 →
  `Client connected` (Quest) 12:40:15. The client started 28 s before the headset.
- `run-xr.sh` waited for `~/.config/openxr/1/active_runtime.json`, its comment saying WiVRn registers it "when the
  headset connects". The runtime file exists as soon as the WiVRn server runs, so the wait passed in 1 s. Godot only
  initialises OpenXR at launch → desktop mode for the whole session. Earlier sessions worked because the headset was
  already connecting.
- WiVRn's D-Bus `io.github.wivrn.Server.HeadsetConnected` (already read by vr-session.js) is the real signal;
  `busctl --user get-property …` → `b true` once connected.

## What was done

- `godot/client/run-xr.sh`: when the runtime JSON is WiVRn's and `busctl` exists, wait (same `XR_WAIT_S` budget) for
  `HeadsetConnected`, then 2 s for WiVRn's per-headset server; if it never connects, fall back to the desktop walk
  (`--xr-mode off`) instead of the modal. `XDG_RUNTIME_DIR` defaults to `/run/user/<uid>` (the node launcher has no
  session env). Header comment corrected.
- Done in the script, not vr-session.js, so a hand-run `run-xr.sh` gets it too.

## Verified

- Dry runs with `GODOT=/bin/echo`: headset connected (real D-Bus) → `--xr-mode on` at once; shim busctl turning true
  on the 3rd poll → waits ~2 s + settle, then `on`; shim always false, `XR_WAIT_S=3` → "the headset did not connect" →
  `--xr-mode off`.
- Live: with the headset connected, a fresh run-xr.sh client → `Running on OpenXR runtime: WiVRn 'v26.9'`, D-Bus
  `SessionRunning true`; the failed instance was stopped after (the WO-770 watcher kept WiVRn up).
- Owner QA: Start VR from the GUI, then connect the headset.
