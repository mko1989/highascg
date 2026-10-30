# WO-780 — VR still "OpenXR was requested but failed to start": the XR client had no XDG_RUNTIME_DIR

**Area:** tracking-vr
**Status: DONE (26.10). Verified live: Start VR through `/api/vr/start` with the Quest connected → OpenXR instance on
WiVRn, `Started native session`. Owner QA: the GUI's Start VR with the headset on.**

Owner, 26.10 (after WO-776): "tryied vr again and it failed. whats going on with this?"

Parents: [WO-770](./770_WO_vr_session_gui_pin_modal_mirror.md) (GUI Start VR → `src/vr/vr-session.js`),
[WO-776](./776_WO_vr_client_waits_for_headset.md) (headset wait — necessary, but not the whole cause).

## Investigation

- `~/.highascg/log/godot-xr.log`, run of 15:52: `[xr] WiVRn is up — waiting for the headset to connect` → runtime
  found (the WO-776 wait worked: Quest `Client connected` 15:52:43, per-headset server started), then
  `ERROR [ipc_client_socket_connect] Failed to connect to socket ~/.cache/wivrn/comp_ipc: No such file or directory!`
  → `XR_ERROR_RUNTIME_UNAVAILABLE in xrCreateInstance` → `Failed to create XR instance [Error code -51]` → the alert.
- WiVRn's socket is `/run/user/1000/wivrn/comp_ipc`. The OpenXR client side resolves it as `$XDG_RUNTIME_DIR/wivrn/`,
  falling back to `~/.cache/wivrn/` when the variable is unset.
- The node server is a system service (`highascg.service`, User=casparcg) with no user-session env:
  `/proc/<node>/environ` has no `XDG_RUNTIME_DIR` / `DBUS_SESSION_BUS_ADDRESS`. `vr-session.js` already adds both
  for its own `systemctl --user` / `busctl --user` calls (`busEnv()`), but `launchClient()` built the client env from
  plain `process.env` (+ DISPLAY/XAUTHORITY) — the XR Godot (`/proc/192088/environ`) had neither.
- The 12:40 failure that WO-776 attributed to the early launch has the same `comp_ipc` line (log line 2678): the
  early launch was real, but the missing runtime dir would have failed it anyway. WO-776's live check passed because
  it ran `run-xr.sh` from an interactive shell, which has the session env — not through the node launcher.
- Side effect of the same gap: zenity (the client's dialogs) warned `Unable to acquire session bus`.

## What was done

- `src/vr/vr-session.js` `launchClient()`: the client env starts from `busEnv()` (XDG_RUNTIME_DIR =
  `/run/user/<uid>`, DBUS_SESSION_BUS_ADDRESS = its `bus`) instead of `process.env`.
- `godot/client/run-xr.sh`: exports both when unset and `/run/user/<uid>` (resp. its `bus` socket) exists — covers
  any other launcher without a session (ssh, a unit); `headset()` drops its now-redundant inline default.
- `tools/smoke/smoke-wo770-vr-session.test.js`: the spawn test asserts both variables in the client env.

## Verified

- Smoke WO-770 10/10; Godot `run_tests.gd` 21865/0 (`test_xr_walk.gd` pins run-xr.sh); lint clean; line limit ok.
- Live (node restarted on the fix; Quest connected, WiVRn up): `POST /api/vr/start` → client pid 198690 env has
  `XDG_RUNTIME_DIR=/run/user/1000`; log `xrCreateInstance: Instance created`, `Running on OpenXR runtime: WiVRn
  'v26.9'`, HMD + both controllers selected; WiVRn: `Client 1 connected … application_name: 'HighAsCG Operator'`,
  `Started native session, 1 active app session(s)`. No `No viewport was marked with use_xr` warnings in this run.
- Not seen by me: the picture in the headset — owner QA.
