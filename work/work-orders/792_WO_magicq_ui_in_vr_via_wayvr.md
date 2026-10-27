# WO-792 — Program lights in VR: the MagicQ UI as a panel in the headset (MagicQ PC + WayVR)

**Status: IN PROGRESS (27.10) — MagicQ 1.9.8.3 installed by the owner and running on :0 (Demo Mode); WayVR v26.8.0
runs (`--help`); headset test pending: needs a VR session + the owner in the headset**

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
