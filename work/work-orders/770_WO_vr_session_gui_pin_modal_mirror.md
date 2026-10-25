# WO-770 — VR session from the GUI: Start / PIN modal / End, WiVRn only while needed, a desktop mirror of the headset

**Status: IN PROGRESS (25.10) — offline-verified (smoke 10/0, test:ci 3357/0, Godot 21801/0, boot check OK); node restart + client relaunch + owner headset QA pending**

Owner 25.10 (after the first headset session on this box worked):
> there should be an explicit start vr sesion in the gui, with the pin in the modal, when connected there should be a
> window that shows whats displayed in vr.

Standing owner rule (25.10): "dont start the vr service at login. only when needed."

## Investigation

1. **Start / PIN were terminal-only.** The session ran from `systemctl --user start wivrn` + `wivrnctl pair` +
   `godot/client/run-xr.sh` by hand. WiVRn 26.9 (ppa:lvra/wivrn) exposes everything on the user bus:
   `io.github.wivrn.Server` `/io/github/wivrn/Server`, props `HeadsetConnected b`, `SessionRunning b`,
   `PairingEnabled b`, `Pin s`, `SystemName s`, `KnownKeys a(ssx)`; method `EnablePairing(i minutes) → s` (the PIN).
   A single `busctl --user --json=short get-property … P1 P2 …` prints one JSON object per line, in order (probed live).
2. **The node server has no user session.** `highascg.service` (User=casparcg) has no `XDG_RUNTIME_DIR` /
   `DBUS_SESSION_BUS_ADDRESS`, so `systemctl --user` / `busctl --user` fail from it unless both are set to
   `/run/user/<uid>`.
3. **The VR client's window was black.** `xr_walk.gd` `_start_xr()` sets `get_viewport().use_xr = true` on the Previs
   SubViewport: it then renders to the headset only and its desktop SubViewportContainer shows black (screenshot
   25.10, "HighAsCG Operator (DEBUG)" with an empty 3D area).
4. `previs_tab.gd` and `router.js` were at the 500-line limit.

## What was done

- **Server** — `src/vr/vr-session.js` (new, injectable deps) + `src/api/routes-vr.js` (new), registered on an existing
  `register(routes)` line of `router.js` (still 500):
  - `GET /api/vr/status` → `{installed, serverRunning, headsetConnected, sessionRunning, pairingEnabled, pin, paired
    (names only, never the keys), systemName, clientRunning, clientPid?, starting, error}`.
  - `POST /api/vr/start`: `systemctl --user start wivrn` (never enable), waits ≤10 s for the D-Bus props,
    `EnablePairing(5)` when no headset is paired, spawns `run-xr.sh` on :0 (`XR_WAIT_S=600`, log
    `~/.highascg/log/godot-xr.log`) unless a client is already there, then a 5 s watcher stops WiVRn once the client
    has come and gone (or 15 min with no client) — WiVRn runs only for a session.
  - `POST /api/vr/pair {minutes 1–30}` → a fresh PIN (409 when WiVRn is down). `POST /api/vr/stop`: SIGTERM the client,
    stop WiVRn.
  - Client match: the godot binary with `--xr-mode`, or `run-xr.sh` still waiting for the headset (bash, before its
    exec) — else Start during the wait would launch a second client.
- **GUI** — Previs toolbar **VR…** (`features/previs/xr/vr_session_dialog.gd`, one line in `previs_tab.gd`): state line,
  the PIN big (spaced digits) while pairing is on, the detail line, Start VR session / Pair a new headset / End VR
  session; polls status once a second while open. Texts and buttons come from the pure `vr_session_model.gd`.
- **Mirror** — `xr_walk.gd` `_make_mirror()`: a second SubViewport on the stage's World3D, a Camera3D copying the XR
  camera's transform every frame (fov 90), rendered at most 1280×720 (`xr_walk_model.gd mirror_px`), shown in a
  TextureRect over the previs container (mouse ignored). A mirror rather than the OpenXR desktop blit: that blit is
  the whole window, would hide the client's tabs, and is one eye of a distorted stereo pair.
- `help/vr-walk.md`: on-demand (no `enable --now`), the GUI flow, the `--global disable` and PipeWire client-libs notes.

## What was VERIFIED

- `tools/smoke/smoke-wo770-vr-session.test.js` 10/10 (curated list): status parsing / names only / user-bus env, start
  never enables, pairing only when none paired, spawn only without a client with `XR_WAIT_S=600`, pair clamps, stop kills
  only the matched pid, the watcher stops WiVRn after the client exits, argv matching incl. a waiting run-xr.sh.
- Live read-only `status()` on the box during the owner's session: `{"installed":true,"serverRunning":true,
  "headsetConnected":false,"sessionRunning":true,"pairingEnabled":false,"pin":"","systemName":"Meta Quest 3",
  "paired":["Oculus Quest 3"],"clientRunning":true,"starting":false,"error":"","clientPid":414991}`.
- `tests/test_vr_session_wo770.gd` (dialog states, PIN only while pairing, mirror sizes, hooks). Godot 21801/0,
  `run-client.sh --check` boot OK. test:ci 3357/0, eslint clean, 500-line check 0 over, API contract regenerated.
- **Pending:** node restart + client relaunch, then the owner: Previs → VR… → Start, PIN, connect, the VR window shows
  the headset view, End closes it and WiVRn stops (`systemctl --user is-active wivrn` → inactive).
