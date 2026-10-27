# WO-792 — Program lights in VR: the MagicQ UI as a panel in the headset (MagicQ PC + WayVR)

**Status: IN PROGRESS (27.10, Fix 3: summons only once the head moves) — MagicQ runs as its own WayVR window panel in the headset (owner: "good"); next: VR Start / End
wires it in**

Owner, 27.10:
> I need a way to be able to program lights in the VR. Is it possible to display chamsys magicq ui inside the VR?

and, after the proposal (MagicQ PC + WayVR, no new code first):
> Yes, start

Parents:
- [WO-741](./741_WO_vr_walk_mvr_scene_program_lights.md) / [WO-757](./757_WO_vr_programmer_panel.md) (HighAsCG's own
  VR programmer: it drives HighAsCG's programmer, not the desk);
- [WO-770](./770_WO_vr_session_gui_pin_modal_mirror.md) (VR session Start / End, WiVRn only while needed);
- [WO-632](./632_WO_artnet_read_through.md) (the Art-Net tap: one :6454 socket);
- [WO-630](./630_WO_godot_owner_notes_next_md_4.md) Q1 (the desk is a ChamSys MQ500).

## Investigation

- **The desk's own screens can't go into the headset.** The MQ500 runs MagicQ on its own hardware. What can go into
  VR is **MagicQ PC running on this box**, as a window.
- **WayVR** ([github.com/wayvr-org/wayvr](https://github.com/wayvr-org/wayvr), the January 2026 merge of WlxOverlay-S,
  WayVR and WayVR Dashboard):
  - It is an OpenXR overlay: desktop screens or single windows become panels in the headset, and the controller ray
    works as the mouse.
  - It runs natively on WiVRn and Monado, and composites over whatever XR app is running. So MagicQ would float over
    the HighAsCG VR scene (WO-741).
  - Latest release `v26.8.0` (2026-08-09) ships an AppImage.
- **The box:**
  - Display: Xorg `:0` (`/usr/lib/xorg/Xorg :0 … vt8`), which WayVR captures.
  - VR runtime: WiVRn 26.9 (`wivrn-server`, `wivrn-dashboard` 26.9-0ubuntu2).
  - GPU: RTX PRO 4000 Blackwell, 5.8 / 24 GB used.
  - FUSE: **no `libfuse.so.2`**, only libfuse3, so the AppImage can't mount itself. Either install `libfuse2t64` or
    run it extracted (`--appimage-extract`).
- **The VR session** (`src/vr/vr-session.js`, WO-770):
  - Start runs `systemctl --user start wivrn`, waits for D-Bus, then launches `godot/client/run-xr.sh`.
  - A watcher stops WiVRn once the XR client has gone.
  - WayVR would be launched and stopped alongside the XR client, with the same user-session env (WO-780: XDG_RUNTIME_DIR,
    DBUS, DISPLAY, XAUTHORITY).
- **MagicQ PC for Linux** ([downloads.chamsys.co.uk/magicq](https://downloads.chamsys.co.uk/magicq)):
  - Stable 1.9.8.3 (2026-05-27), beta 1.9.9.0 (2026-09-22), "Linux 64-bit".
  - **The downloads need a ChamSys sign-in**, so the owner has to fetch the file.
  - The ChamSys Linux notes still name Ubuntu 14.04, so 26.04 is untested.
- **Licensing** ([MagicQ PC manual](https://secure.chamsys.co.uk/docs/magicq/manual/magicq_pc.html)):
  - MagicQ PC outputs 64 universes of Art-Net / sACN for free.
  - "Multi Programming including Net Sessions" is listed under **Unlocked** mode, which needs ChamSys hardware.
  - **Open question:** whether joining the MQ500's network session counts as that unlock. This decides whether
    programming in VR edits the desk's show, or a show run from the box.
- **The Art-Net port is contended on the box:**
  - HighAsCG's lighting input owns UDP :6454, and the follow read-through and the DMX monitor share that one socket
    (`src/artnet/artnet-tap.js:3-7`).
  - On Linux, a second SO_REUSEADDR socket takes unicast datagrams away from the first. So a MagicQ on the same box
    that binds :6454 could starve HighAsCG's input.
  - It can also loop its own output back in (memory: Art-Net out loops into own input).
  - Options: MagicQ outputs sACN, or Art-Net on another interface. To check once MagicQ runs: which sockets it binds
    (`ss -ulpn`).

## Plan

1. **The owner downloads MagicQ for Linux** with the version the MQ500 runs (a net session needs matching versions).
   The owner installs it: `sudo apt install ./<file>.deb`, or unpacks it if ChamSys ships a tarball.
2. **WayVR:** run the extracted AppImage (`~/.local/opt/wayvr/`) during a VR session. First test: MagicQ on `:0` as a
   panel, readable and clickable with the ray.
3. **Network:** check which ports MagicQ binds (`ss -ulpn`). Pick sACN, or an interface, so HighAsCG's :6454 input
   keeps its traffic. Test a MQ500 net session (the unlock question).
4. **If it works, wire it in:** VR Start launches WayVR next to the XR client and the watcher stops it.
   `vr-session.js` with injectable spawn, plus a smoke test.

## What was done

- `~/.local/opt/wayvr/WayVR-v26.8.0-x86_64.AppImage`, 25 156 088 bytes. Its sha256
  `4b40719a860138cde4b97a5acbe5d5c300e9c7a186ab6bed423be8768e0c0794` matches the GitHub release asset digest.
  The first `chmod +x` was part of a command that auto mode blocked, so it never ran. The file stayed non-executable
  until the second pass.
- **Owner, 27.10: "ive installed everything"**:
  - `magicq 1.9.8.3` (`~/Downloads/magicq_ubuntu_v1_9_8_3.deb`, installs to `/opt/magicq`, launcher `runmagicq.sh`);
  - `libfuse2t64 2.9.9-9build1`.
- **MagicQ launched** on `:0` (`DISPLAY=:0 XAUTHORITY=~/.Xauthority setsid -f ./runmagicq.sh`, log in the scratchpad):
  - `mqqt` runs as "MagicQ PC (Demo Mode)", window 1800×920 at 10,35, plus a "SELECT" start-up dialog.
  - Every library resolves (`ldd`, none missing). The log is only PortAudio ALSA channel-count complaints, harmless.
- **Ports:**
  - MagicQ bound UDP **0.0.0.0:6454** (Art-Net) and **6553** (MagicQ network).
  - :6454 was free before it started: nothing listened (`ss -uln`), so HighAsCG's lighting input is off right now and
    nothing was starved.
  - This becomes a conflict as soon as the lighting input or read-through is switched on (see Investigation).
  - MagicQ ships `run_in_namespace.sh`, which runs an instance in its own network namespace (veth on a `mq-br` bridge,
    2.0.0.1x0). That is a possible way to give it its own :6454; it needs sudo. To evaluate.
- **Where the window can live:**
  - It opened on **DP-4** (3840×1792 at 0,0). DP-4 is covered by Caspar's `Screen consumer [1|3840x1792]` window, so
    MagicQ sits behind it: not on the program output, but not visible either. Desktop screenshot in the scratchpad.
  - The operator monitor is **DP-0** (1920×1080 at +3840+0), with the Godot GUI on it.
- **WayVR limits for this box** (README):
  - **X11 captures whole screens only, not windows**, and "zero-copy GPU capture is not supported on the general X11
    desktop" (slower).
  - DPI scaling and rotated screens break the mouse.
  - MagicQ's bundled Qt 5 has **only the xcb platform plugin** (`/opt/magicq/plugins/platforms/libqxcb.so`), so it
    can't run as a Wayland app inside WayVR's own compositor.
  - So MagicQ must sit on a visible screen, i.e. **DP-0 during a VR session**, and WayVR shows that screen as the
    panel.
- **WayVR runs:** `./WayVR-v26.8.0-x86_64.AppImage --help` prints its options (`--openxr`, `--wait`, `--show`, `--replace`,
  `-l`). With libfuse2 installed the AppImage mounts.

## Verified

- MagicQ PC runs on the box and binds Art-Net. WayVR starts.
- **Not yet tested:** WayVR in the headset (needs a VR session), the MagicQ panel's readability and ray input, and the
  MQ500 net session.

## Headset test, 27.10 (owner in the headset)

- **Whole-screen panel first:** WayVR (`--openxr --show`) captured DP-0 and DP-4. The owner first saw the HighAsCG GUI:
  MagicQ's main window is unmapped until its SELECT dialog is answered. After a MagicQ layout change, MagicQ moved its
  window back to DP-4, behind Caspar's screen consumer, and it disappeared from the panel. The owner asked for a
  single window.
- **Ray as mouse:** WayVR logged "Could not create uinput provider". `/dev/uinput` was `root:root 0600`; the user is
  already in `input`. Owner ran: a udev rule `/etc/udev/rules.d/60-uinput-input.rules`
  (`KERNEL=="uinput", SUBSYSTEM=="misc", MODE="0660", GROUP="input", OPTIONS+="static_node=uinput"`), then
  `udevadm control --reload && udevadm trigger --name-match=uinput`. Result: `crw-rw---- root input`, and WayVR logs
  "Initialized uinput."
- **Correction to the investigation:** "MagicQ can't be a WayVR app panel (xcb only)" was wrong. WayVR's compositor
  starts its bundled `xwayland-satellite` (source v26.8.0 `wayvr/src/backend/wayvr/client.rs:101`), so X11 apps get
  their own panels. It only needs Xwayland: `xwayland-satellite` was `<defunct>` until the owner installed
  `xwayland` (2:24.1.10-1).
- **Window panel:**
  - WayVR restarted: `xwayland-satellite :20` and `Xwayland :20` stay up, with `wayland-20` in `/run/user/1000`.
  - The desktop MagicQ was closed (TERM; :6454 / :6553 freed).
  - MagicQ was launched with `DISPLAY=:20 QT_QPA_PLATFORM=xcb runmagicq.sh`, with WAYLAND_DISPLAY and XAUTHORITY
    unset.
  - WayVR registered it as an external process ("Toplevel surface count changed: 1").
  - **Owner: "the standalone magicq window is good. but i dont need the main window and keyboard."** Those were hidden
    with the watch's overlay toggles; WayVR saves that in `~/.config/wayvr/conf.d/zz-saved-state.json5`. A restart of
    WayVR kills `:20`, and MagicQ with it.
- **For VR Start:** launch WayVR with `--headless` (no desktop capture, so no DP-0 / DP-4 panels), then MagicQ on
  WayVR's X display. VR End stops both.

## Built in: "MagicQ in VR" in the VR session dialog (27.10, owner: "run magicq window in vr")

- **`src/vr/vr-desk-panel.js`** (new):
  - Start spawns `WayVR-v*.AppImage --openxr --headless --wait`, with the session env + DISPLAY :0. Headless means no
    DP-0 / DP-4 panels.
  - Once `xwayland-satellite :N` exists it starts `runmagicq.sh` on `DISPLAY=:N QT_QPA_PLATFORM=xcb`, with
    WAYLAND_DISPLAY and XAUTHORITY unset.
  - MagicQ is a detached process group, and its pgid is kept in `~/.highascg/run/vr-desk.json`. Stop sends our group's
    `mqqt` SIGTERM (SIGKILL after 5 s), then SIGTERM to WayVR.
  - A MagicQ the operator runs on the desktop (another group) is never stopped, and Start refuses a second one.
  - **Found on the box:** with the headset off, WiVRn removes `~/.config/openxr/1/active_runtime.json`. WayVR then
    waits and there is no X display yet, so the first version failed after 15 s.
  - Now Start returns `pending` and a background wait (1 s polls, up to 10 min) launches MagicQ when the display
    appears. End / Close cancels it.
- **`src/vr/vr-session.js`:** `deps.desk` (only the box instance has it, so tests never touch real processes).
  `status.desk`; `deskStart` / `deskStop`; End and the exit watcher stop the desk before WiVRn.
- **`src/api/routes-vr.js`:** `POST /api/vr/desk/start`, `POST /api/vr/desk/stop`. The API contract was regenerated
  (511 routes).
- **Godot** (`vr_session_model.gd`, `vr_session_dialog.gd`):
  - a "MagicQ in VR" / "Close MagicQ in VR" button while WiVRn runs and both programs are installed;
  - while pending: "MagicQ opens in the headset once it is connected."
  - Desk errors show in the detail line.

### Verified

- `tools/smoke/smoke-wo792-vr-desk-panel.test.js`: 6 tests, in the curated list, including the late display, the
  10-minute timeout, a cancel, and a desktop MagicQ left alone. With WO-770's: 16/16.
- Offline suite: 3400 pass, 0 fail (before the pending change; the two changed files were re-run after it). Godot suite:
  21901 passed, 0 failed.
- **Box:**
  - The node restarted with the new code. The programmer was snapshotted and restored, 38 fixtures identical.
  - `GET /api/vr/status` shows `desk` (available, WayVR v26.8.0).
  - `POST /api/vr/desk/start` with the headset off: `ok, pending: true`, and WayVR waits.
  - The operator GUI was relaunched with no script errors.
- **Not yet seen with this code:** MagicQ opening in the headset through the dialog. That's the owner's QA: connect the
  headset; MagicQ should appear by itself while the wait is pending, or VR… → "MagicQ in VR".
- Earlier by hand (same launch line): the owner confirmed the standalone MagicQ window panel is good.

## Fix, 27.10: the panel spawned under the operator's feet (owner: "the magicq in the vr does not show up")

**Investigation**
- Box state was all good:
  - `GET /api/vr/status` desk: `wayvrRunning`, `display ":20"`, `magicqRunning`.
  - On :20 MagicQ's `SELECT` dialog (794×190) was `IsViewable`, and WayVR logged "Toplevel surface count changed: 1".
- WayVR IPC confirmed it:
  - Abstract socket `@/tmp/wayvr_ipc.sock`; u32 BE length + JSON, protocol 4. WayVR only serves it while rendering,
    i.e. with the headset on.
  - `WvrWindowList` → `{size_x: 794, size_y: 190, visible: true}`.
  - `WlxInputState` → `hmd_pos [0.14, 1.50, -0.25]`.
- **Cause: the anchor.** WayVR's `app.anchor` starts as IDENTITY (source v26.8.0 `wayvr/src/state.rs:206`), and
  only `show_hide` moves it to `hmd * (0,0,-1)` (`windowing/manager.rs:1102-1105`).
  - Anchored panels sit at `anchor * (0, 0, z)` (`overlays/wayvr.rs:116`, `windowing/window.rs:164`). Until the first
    show / hide, that is the play-space origin at floor height: under the operator's feet.
  - The headset test that worked ran WayVR with `--show`, which queues a ShowHide 1 s after start
    (`backend/openxr/mod.rs:86-92`). The built-in launch had dropped it.
- **Second fault: WayVR's own autostart.** In the headset the owner added MagicQ to WayVR's Apps autostart
  (`~/.config/wayvr/conf.d/zz-saved-config.json5`, `autostart_apps`, env `QT_QPA_PLATFORM=wayland`). MagicQ's Qt is
  xcb only, so every such launch died: "Sending SIGTERM (graceful exit) to process … runmagicq.sh" at 13:46:09,
  13:46:27, 13:46:57 and 13:48:25. Had it worked, it would have been a second MagicQ.

**What was done**
- `src/vr/vr-desk-panel.js`: WayVR now starts with `WAYVR_ARGS = --openxr --headless --show --no-autostart --wait`.
  - `--show` puts the anchor (and the MagicQ panel) 1 m in front of the headset once the runtime is up.
  - `--no-autostart` skips WayVR's own app autostart.
- `tools/smoke/smoke-wo792-vr-desk-panel.test.js`: the args assertion follows.

**Verified**
- Smoke test 6/6, ESLint and Prettier clean.
- Server restarted (programmer snapshot of 38 fixtures restored identical); desk stop → start.
  - The WayVR argv carries `--show --no-autostart`.
  - MagicQ is on :20 and its toplevel was created.
  - No autostart SIGTERM in the log.
- Owner QA in the headset.
- If the headset was lying elsewhere when WayVR started, the panel sits 1 m in front of that spot. Show / hide twice
  (the menu button) brings it back in front.

## Fix 2, 27.10: `--show` was not enough, and WayVR froze (owner: "magicq fails to show up … the wristwatch … just says the application started")

**Investigation**
- **13:56 run (`--show`).** The owner wore the headset 13:58:45–14:00:10 (WiVRn "user presence") and WayVR was
  rendering, but the panel was not in view. `--show` fires 1 s after start, while the headset sits idle, so the
  anchor came from that stale head pose.
- **Watch launches.** The owner launched MagicQ from the watch's Apps. WayVR started it in Wayland mode, which died
  ("Sending SIGTERM … runmagicq.sh", 13:59:48). That is the "application started" toast with nothing after it.
- **14:00:24 run: WayVR froze.**
  - The owner restarted. MagicQ's window arrived at 14:00:30.88, during a presence flap (false 14:00:29 → true
    14:00:31). WayVR then logged nothing, not even its "IPD changed" stream, while WiVRn showed the owner in the
    headset until 14:02:17.
  - Its main thread sat in `unix_stream_data_wait`, with unread data queued from xwayland-satellite (916 B) and
    D-Bus (348 B). No stack: `ptrace_scope` = 1.
  - "Close MagicQ in VR" TERMed MagicQ, but the frozen WayVR ignored its TERM. "MagicQ in VR" at 14:02:10 then
    launched MagicQ into the dead display.
  - I killed the group by hand (`kill -KILL -- -1638247`).

**What was done**
- `src/vr/wayvr-ipc.js` (new): a WayVR IPC client with `inputState`, `windowList` and `showHide`. WayVR serves IPC
  only from its render loop, so an answer means the operator is in the headset and WayVR is alive.
- `src/vr/vr-desk-panel.js`:
  - WayVR args are now `--openxr --headless --no-autostart --wait` (no `--show`).
  - Start always waits in the background until the X display exists and WayVR answers `inputState`.
  - On a fresh WayVR it then sends `WlxShowHide`, which anchors the panel 1 m in front of the head, waits 1 s, and
    opens MagicQ. A WayVR that is already up gets no show / hide, because it is a toggle.
  - For 15 s it then checks `windowList`. If there is no window, or no answer, the error says so and tells the
    operator to close and reopen.
  - Stop: when WayVR ignores TERM for 5 s, SIGKILL goes to its process group (satellite, Xwayland).
- `vr_session_model.gd`: the pending text is now "MagicQ opens in front of you once you have the headset on."

**Verified**
- Smoke tests 9/9:
  - rig: launch order inputState → showHide → MagicQ → windowList;
  - headset off: no MagicQ;
  - a WayVR already up gets no toggle;
  - no-panel error;
  - a frozen WayVR is group-KILLed;
  - real `wayvr-ipc` framing against a fake server, plus timeout on silence.
- Godot suite 21901 / 0.
- Server restarted (programmer: 38 fixtures restored identical); desk started → `pending: true` (headset off).
- Owner QA in the headset. Whether WayVR freezes again when MagicQ's window arrives while it is rendering is still
  open: the panel check reports it, and Close now recovers.

## Fix 3, 27.10: an IPC answer does not mean the headset is worn

**Investigation**
- Fix 2 was deployed at 14:12:19. WayVR answered `inputState` at 14:12:20, but WiVRn had logged "user presence
  changed to false" at 14:06:38 and never back to true. So right after start, WayVR renders and answers with the
  headset lying on the desk.
- Fix 2 therefore summoned the panel (`WlxShowHide`) at once: 1 m in front of the idle headset, not the operator.
  Fix 2's claim that "an answer means the operator is in the headset" is wrong.
- WiVRn's presence shows only in its journal. Its D-Bus properties (HeadsetConnected, SessionRunning) have no
  presence flag, so the server cannot ask WiVRn.

**What was done**
- `src/vr/vr-desk-panel.js` `worn()`: samples `hmd_pos` over IPC 4 × 400 ms. The headset counts as worn once the
  pose moves more than 4 mm from the first sample. A worn head always sways by more than that; a tracked headset
  lying still stays under 1 mm. The wait loop summons and opens MagicQ only after `worn()`.
- Header comments in `vr-desk-panel.js` and `wayvr-ipc.js` corrected.
- `src/vr/vr-session.js`: prettier formatting only.

**Verified**
- Smoke tests 9/9; the VR smokes together 19/19.
  - The rig sways the head 5 mm per sample when worn.
  - A new case: the headset lies on the desk (static pose) → stays pending with no MagicQ; it opens once the head
    moves.
- Server restarted (programmer: 38 fixtures restored identical) and the VR client restarted.
- Desk start with the headset disconnected: `pending: true`, no MagicQ. I stopped the desk afterwards.
- Owner QA in the headset.
