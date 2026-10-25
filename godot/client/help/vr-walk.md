# Walk the stage in VR (Meta Quest)

Put on a Meta Quest and stand in the Previs stage at real size: the MVR scene, the heads and their beams, the LED
screens. Point at a head to select it, point at the floor to aim the selection there, and work the full Programmer on
your left wrist: intensity, colour, wheels, pan / tilt, zoom, gobos, groups, Release, and Store into a look. It is the
Programmer doing the work, so **DMX leaves the box only while Fixtures DMX output is on**: keep it off to preprogram blind.

The headset talks to the computer through **WiVRn**: a server on Ubuntu and an app on the Quest. WiVRn becomes the
OpenXR runtime that HighAsCG renders into, and streams the picture to the Quest over Wi-Fi or USB.

## 1. Install the WiVRn server (once per computer)

The server and the headset app must be the **same WiVRn version**.

- **Ubuntu 26.04** (the PPA):

  - `sudo add-apt-repository ppa:lvra/wivrn`
  - `sudo apt update && sudo apt install wivrn-server wivrn-dashboard`
  - Do **not** enable it at login on a playout box: the HighAsCG GUI starts it for a session (Previs → **VR…**, below)
    and stops it again when the VR window closes. By hand: `systemctl --user start wivrn` / `stop wivrn`.
  - The PPA package enables it for every user at login — undo that once: `sudo systemctl --global disable wivrn`.
  - Without a PipeWire daemon (a Caspar box that owns ALSA) WiVRn crashes at connect unless PipeWire's client parts are
    there: `sudo apt install --no-install-recommends pipewire-bin libpipewire-0.3-modules` (never the daemon /
    wireplumber). It then streams video without sound.
  - If it fails with "Failed to drop capabilities", the packaged service is too strict for systemd 259: put a file
    `~/.config/systemd/user/wivrn.service.d/override.conf` with `[Service]`, `ProtectClock=false`,
    `ProtectKernelLogs=false` and `ProtectKernelModules=false` on separate lines, then
    `systemctl --user daemon-reload && systemctl --user restart wivrn`.

- **Ubuntu 24.04** (Flathub, the PPA has no 24.04 build):

  - `sudo apt install flatpak`
  - `flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo`
  - `flatpak install --user flathub io.github.wivrn.wivrn`

- For Wi-Fi, the computer must be findable and reachable:

  - `sudo systemctl enable --now avahi-daemon`
  - `sudo ufw allow 5353/udp && sudo ufw allow 9757`

  (skip the `ufw` line when the firewall is off).

## 2. Install the WiVRn app on the Quest (once)

- From the Meta store: search **WiVRn**. Its version must match the server's.
- Or let the WiVRn dashboard on the computer install the matching app over USB (the Quest in developer mode).

## 3. Connect

1. In the operator client: **Previs → VR… → Start VR session**. That starts WiVRn and the VR client (its window shows
   what the headset sees once it connects). The first time, the dialog shows a **PIN** to type in the Quest (or
   **Pair a new headset** for another one). **End VR session** closes the VR window and stops WiVRn.
   Without the GUI: `systemctl --user start wivrn`, `wivrnctl pair`, then `godot/client/run-xr.sh`.
2. **Wi-Fi:** a fast 5 GHz / 6 GHz network, the computer on a cable to the same router. On the Quest open WiVRn
   and press **Connect** next to the computer.
3. **USB** (steadier, no Wi-Fi needed): switch the Quest's Wi-Fi off, plug the cable in, then on the computer:

   - `adb reverse tcp:9757 tcp:9757`
   - `adb shell am start -a android.intent.action.VIEW -d "wivrn+tcp://localhost" org.meumeu.wivrn`

When the headset connects, WiVRn registers itself as the OpenXR runtime. It undoes that after you disconnect and
close the VR apps.

## 4. Start HighAsCG in the headset

On the same computer, after the Quest is connected:

- `godot/client/run-xr.sh`
- `godot/client/run-xr.sh --server=http://192.168.0.4:4200` (program another server's show)

It waits up to 2 minutes for the headset, then opens a second operator window on the **Previs** tab. The picture is
in the Quest. That window has its own settings, so the kiosk is not touched. Close it to leave VR.

## 5. In the headset

| Control | What it does |
|---|---|
| Right trigger on a head | Select it (grip held: add to the selection) |
| Right trigger on the floor | Aim the selected heads at that spot |
| Left stick | Walk (push fully to go 3x faster) |
| Right stick left / right | Turn 30° |
| Left wrist | The Programmer: point at it with the right controller |
| Right trigger on the Programmer | Click (hold it to drag a slider; grip held adds in the fixture list) |
| Right stick up / down on the Programmer | Scroll it |
| Y (left controller) | Hide / show the Programmer |

The Programmer in the headset is the same one as in the Previs tab: selecting a head in the stage selects it on your
wrist, and the other way round. Under it, pick a look and press **Store** to keep the programmer in that look (a PGM
TAKE of the look fades the rig to it) or **Recall** to bring the look's fixtures back. Naming a new group needs a
keyboard: save groups at the desktop.

Walking around in your room moves you on the stage too: 1 m in the room is 1 m on the stage.

## Without a headset

`XR_WAIT_S=0 godot/client/run-xr.sh` (or no WiVRn running) opens the same walk on the desktop. **W A S D** walk
(shift: faster), drag with the left button to look, the wheel steps. Click a head, right-drag to aim, as in the
normal Previs.

## When it does not work

- **The headset shows WiVRn's lobby, no stage:** HighAsCG was started before the Quest connected. Close it and
  start `run-xr.sh` again.
- **The Quest lists no computer:** avahi is not running, the firewall blocks 5353 / 9757, or they are on different
  networks. Use USB.
- **"version mismatch":** update the server or the app so both are the same WiVRn version.
- **Stutter:** use USB or a less busy Wi-Fi channel. NVIDIA cards: WiVRn's own notes say lowering its resolution or
  switching to software encoding can help.
- **On a playout box during a show:** the headset render and its video encoding use the same GPU as Caspar. Walk
  in VR while preprogramming, not while on air.
