# WO-937 — Live ISO: the boot network apply left the wired port with no manager (no IP, manual IP failed); the start-up launcher still showed a small window

**Area:** os-iso, network, godot-client
**Status: DONE (02.11.26 — on .4 (.10's second NIC): API DHCP→static→DHCP on enp5s0 through systemd-networkd; simulated boot: the launcher window never mapped, only the prompt; smokes 26/0, Godot 25760/0, offline 5273/0)**

Owner, 02.11.26, second machine on the 19:40 ISO: "i still saw a very small godot window before the start operator pop
up on the second machine. also its ethernet didnt get an ip address now, which is weird..." Then: "trying to set
manual ip from the client results in network apply failed..." and "ive changed to a second network card on the
second machine and it connected, its on .4 now".

## Investigation

### No address on enp5s0 (a regression of WO-935)

`.4`, `journalctl -b`:

- `systemd-networkd`: `enp5s0: Configuring with /etc/systemd/network/10-live-wired.network`, `Gained carrier`, then
  4 s later `enp5s0: Unmanaging interface.`
- `highascg-exfat-network-apply.service` ran in between, from the stick's default `network/network.conf`
  (`mode=dhcp`, interface auto → enp5s0). It logged `apply: mode=dhcp iface=enp5s0`, then
  `apply failed: … Connection 'highascg-enp5s0' is not available on device enp5s0 because device is strictly unmanaged`.
- NetworkManager audit: `connection-add highascg-enp5s0`, then `connection-activate … result="fail"` the same way. Each
  manual-IP attempt from the client failed identically.

Why `tools/runtime/highascg-network-apply.sh` broke the port:

1. **`iface_nm_state` never returned a state.** It ran `nmcli -t -f DEVICE,STATE device show <iface>`, which nmcli
   rejects (`invalid field 'DEVICE'`, exit 2; checked on this box and on .4). So `should_use_networkd` never chose
   networkd, and every wired port went down the NetworkManager path.
2. **NetworkManager may not manage wired ports on the live image.**
   - `/usr/lib/NetworkManager/conf.d/10-globally-managed-devices.conf` says
     `unmanaged-devices=*,except:type:wifi,…`. netplan lifts that only while some netplan file uses the
     NetworkManager renderer (an empty `/run/NetworkManager/conf.d/10-globally-managed-devices.conf`).
   - Until WO-935, the ISO shipped the build host's `90-NM-*.yaml` profiles, and they did exactly that. Without them a
     wired port is *strictly* unmanaged: `nmcli dev set enp5s0 managed yes` exits 0 and changes nothing (verified on
     .4), and `con up` fails.
3. **The NetworkManager path still handed the port away.** Before `con up`, it wrote
   `/etc/systemd/network/05-highascg-nm-enp5s0.network` (`Unmanaged=yes`, WO-692) and flushed the address. After that
   neither manager configured the port.
4. **The networkd static path was dead code anyway.** It wrote `80-highascg-operator.network`, but networkd uses the
   first matching file in name order, and `10-live-wired.network` matches every `en*`.

### The small window

- `boot_launcher.gd` minimizes the main window in `_ready`, but the window is mapped at engine start (64×64,
  `--resolution`) and stays visible until then.
- Off-screen placement does not help: on Xvfb + the box's openbox `rc.xml`, `--position -10000,-10000` was moved back
  to `1,20` and shown.
- An openbox per-window rule cannot single out the launcher: it has the GUI's `WM_CLASS` (`Godot_Engine`,
  `HighAsCG Operator`) and title.
- A scratch project with `display/window/size/mode=1` (minimized) goes from unmapped straight to `WM_STATE Iconic`, and
  is never viewable.

## What was done

- **`highascg-network-apply.sh`:**
  - It reads the state with `nmcli -g GENERAL.STATE device show` ("10 (unmanaged)").
  - An unmanaged port is offered to NetworkManager first (`managed yes`, as before). If it is still unmanaged and
    systemd-networkd answers (`networkctl list`), the port goes to networkd.
  - **networkd static** writes `05-highascg-operator-<iface>.network`, which sorts before `10-live-wired.network`.
  - **networkd DHCP** removes that file, so `10-live-wired.network` (DHCP) applies again.
  - Both remove a stale `05-highascg-nm-<iface>.network`, the old `80-…` file and our `highascg-<iface>`
    NetworkManager profile (which the Settings pane would otherwise read), then `networkctl reload` + `reconfigure`.
  - The NetworkManager path drops a networkd operator file when it takes a port.
- **`highascg-network-reset.sh`:** the networkd branch removes the hand-off file before renewing.
- **`src/system/network-interfaces.js`:** a wired port with no NetworkManager profile, which NetworkManager reports as
  unmanaged, shows networkd's mode. The operator file gives static and its values; without it the port is on DHCP.
  Before this it showed `unknown`.
- **The launcher starts iconic:**
  - `project.godot` gains `application/config/project_settings_override="user://launcher-override.cfg"`.
  - `run-client.sh` runs the launcher with a temporary `XDG_DATA_HOME` holding that file
    (`display/window/size/mode=1`), and with `HIGHASCG_SERVER` set to the node it asked. It removes the directory
    afterwards.
  - The GUI's real `user://` never has the file, so the GUI, `--test` and `--check` are unchanged.
  - `boot_launcher.gd` still minimizes as a backstop.
- I chose not to make NetworkManager manage wired ports again (shipping a conf.d override). Both managers would then
  run DHCP on every port, as on the build host (`eno1`: networkd "configured" and NM `highascg-eno1` at once). The
  live image's design is networkd for wired (WO-94); the helper now follows it.

## What was VERIFIED

- **Helper smoke** (`smoke-wo692-network-apply-helper.test.js`): the fake nmcli now answers the real
  `-g GENERAL.STATE` query, and a "strict" mode keeps `managed yes` from taking. New cases:
  - strictly unmanaged + networkd: static → `05-highascg-operator-enp3s0.network` with Address/Gateway/DNS, the
    hand-off file and our profile removed, `networkctl reconfigure`, no `con add`/`con up`; DHCP → the file is gone;
  - strictly unmanaged without networkd still fails.
- **Interfaces smoke:** networkd mode and values.
- Network smokes 26/0. Offline suite **5273/0**. Godot `--check` OK, `--test` **25760/0**. Line limit and format clean.
- **On .4** (new helpers, reset and listing hand-copied into the live session; node restarted). Through
  `POST /api/system/network/apply`, as the client sends it:
  1. `enp5s0` DHCP: `Applied DHCP … (systemd-networkd)`, the NM profile and hand-off file gone, networkd managing
     (`no-carrier configuring`), listing `dhcp`;
  2. static 10.99.0.5/24: `networkctl status` shows `Network File: …/05-highascg-operator-enp5s0.network`, listing
     `static` with those values;
  3. DHCP again: the file is removed.
  - Then `eno2` was set primary again with DHCP: still 192.168.0.4. The stick's `network.conf` is untouched.
- **Launcher:**
  - Xvfb + openbox, `run-client.sh --autostart` against a fake pending node: the main window went unmapped → Iconic,
    and the only viewable window was the 560×220 prompt (screenshot). The click posted prepare/prompt/resolve, the
    temporary user dir was removed, and the GUI's user dir has no override file.
  - **On .4, a simulated boot** (sim-boot from WO-934): `20:16:22 64x64 IsUnMapped` → `20:16:23 Iconic` →
    `20:16:26 560x220 IsViewable` (the prompt, screenshot). Answered HDMI-0 → `start-up answered: gui`, GUI running.
- The hand-copied files on .4 are lost at its next boot. **Not yet proven:** a fresh ISO boot with a cable on
  `enp5s0` getting DHCP.
