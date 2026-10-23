# WO-692 — Network: every NIC (also down ones) from Devices, a Settings → Network tab, Wi-Fi

**Status: DONE pending owner step (23.10) — server, helper and Godot UI box-verified (Settings → Network, Devices server
page, a live re-apply on eno2). Wi-Fi scan / join and the networkd hand-over need the owner's one-time `sudo install` of
the helper (below), then owner QA of a join.**

Owner, 23.10: *"I should be able to set/change IP of all nic on the machine, also currently down ones from the devices
tab. And also add a network tab in settings. Also wifi is not enabled/installed at all."*

## Investigation (23.10)

- **Down NICs were invisible.** `GET /api/system/network` built `interfaces` from `os.networkInterfaces()`
  (`src/system/network-inventory.js` `listEthernetInterfaces`), which only reports interfaces that hold an address.
  An unplugged port never reached the GUI.
- **Only the primary could be set up.**
  - The Devices → Server page (`godot/client/features/devices/server_page_model.gd` `apply_network`) shows one
    interface select. Its mode and static fields always come from `config.network`, i.e. the primary.
  - `handleNetworkApplyPost` wrote whatever interface was applied into `config.network.primaryInterface`, mixing in
    the primary's static values.
  - The primary drives hardware identity (`src/system/hardware-identity.js:65`), the exFAT `network.conf` and the
    splash IP. Setting up a second port would have moved all of that.
- **The helper rejected PCI / MAC names.** `tools/runtime/highascg-network-apply.sh` still had
  `^(eth|enp|eno)[0-9]+$`, the regex the JS side dropped (`network-settings.js` comment: `enp3s0` on highascg7579).
  The installed copy `/usr/local/lib/highascg/highascg-network-apply.sh` is identical to the repo one.
- **A port without a cable failed.** `nmcli con up` errors with no carrier. Also, an inactive profile shows no
  DEVICE in `nmcli -t -f NAME,DEVICE con show`, so the helper added a *duplicate* `highascg-<iface>` each time.
- **Two network managers on the wired ports.**
  - The live image runs systemd-networkd DHCP on every `en*`/`eth*` (`/etc/systemd/network/10-live-wired.network`,
    from `tools/eggs/live-usb/build-highascg-egg.sh:78`, WO-94).
  - NetworkManager manages the same ports (`networkctl`: eno1 / eno2 "configured", `nmcli dev`: connected).
  - Result on this box: eno2 holds the NM static 2.0.0.13/8 *and* a DHCP 192.168.0.59/24 from networkd. A static IP
    set from the GUI would always carry a second address.
- **Wi-Fi is installed but unreachable from HighAsCG.**
  - Hardware: Intel Raptor Lake CNVi (`lspci 00:14.3`), driver loaded (`wlp0s20f3`), rfkill unblocked.
  - Software: `nmcli radio` WIFI enabled; `wpasupplicant`, `linux-firmware-intel-wireless` and `wireless-regdb` are
    installed; `nmcli dev wifi list` sees 7 networks.
  - Missing:
    - HighAsCG filters `wl*` out (`IFACE_RE`), and no GUI exists. The Openbox desktop has no applet (`nm-applet`
      not installed, only `nmtui`).
    - The server runs as a system service without a login session. NetworkManager's polkit allows `wifi.scan` and
      `settings.modify.system` only to an active local session or `auth_admin`
      (`/usr/share/polkit-1/actions/org.freedesktop.NetworkManager.policy`,
      `/usr/share/polkit-1/rules.d/org.freedesktop.NetworkManager.rules`). Scanning and joining must go through the
      sudo helper. Reading the cached scan does not need it.

## What was done (server + helper)

- `src/system/network-interfaces.js` (new), read-only:
  - `listNetworkInterfaces()`: `/sys/class/net` (en*/eth* + wl*, down ones included), `ip -j -4 addr`, and per
    device its NM profile (also inactive ones, matched by our `highascg-<iface>` name) with mode and static values to
    pre-fill.
  - `buildWifiStatus()`: radio, adapters, and NM's cached scan, one row per SSID (strongest, joined one first;
    nmcli `\:` escapes handled).
- `GET /api/system/network` adds `nics` (the old `interfaces` stays for the web client).
- `POST /api/system/network/apply`:
  - any NIC can be set up;
  - only the primary's settings go to `config.network`;
  - another port neither moves the primary nor inherits its static values;
  - the reply carries `primary` and `nics`.
- `src/api/system-network-wifi.js` (new):
  - `GET /api/system/network/wifi`;
  - `POST …/wifi/scan | connect | disconnect | radio`;
  - SSID and WPA passphrase validation;
  - the passphrase goes to the helper on **stdin**, so it never appears in argv or in sudo's journal line.
- `tools/runtime/highascg-network-apply.sh`:
  - wired names follow the JS rule (`eth[0-9]+ | en[a-z0-9]+`);
  - an unmanaged port is set to managed;
  - a port without a cable keeps its saved profile (autoconnect) and reports "saved; applies when a cable is
    connected";
  - an inactive `highascg-<iface>` profile is reused;
  - a port set here is taken from networkd: `05-highascg-nm-<iface>.network` sets `Unmanaged=yes`, sorts before
    `10-live-wired`, and old addresses are flushed before NM brings it up;
  - Wi-Fi: `wifi-scan`, `wifi-connect` (one `highascg-wifi-<ssid>` profile per network, removed again on a failed
    join), `wifi-disconnect`, `wifi-radio on|off`;
  - test hooks: `HIGHASCG_NETWORKD_DIR` / `HIGHASCG_SYS_NET` (sudo resets the environment, so the real paths
    always apply there).
- `src/api/router.js`: the five Wi-Fi routes.

**Owner, one time** (the sudoers rule allows the installed path, which only root can replace; the next eggs ISO
carries it from then on):

```
sudo install -m 755 ~/highascg/tools/runtime/highascg-network-apply.sh /usr/local/lib/highascg/highascg-network-apply.sh
```

## What was VERIFIED

- `smoke-wo692-network-apply-helper.test.js`: 6/6. The real script with fake nmcli / ip / networkctl:
  - a down `enp3s0` is saved, not activated, and gets the networkd override;
  - an inactive profile is reused;
  - an unmanaged port is handed over;
  - names are rejected where they should be;
  - Wi-Fi join with the passphrase from stdin; a failed join removes its profile;
  - an open network; radio; disconnect.
- `smoke-wo692-network-interfaces.test.js`: 4/4 (it caught the inactive-profile lookup, fixed). Covers parsers, the
  down port, Wi-Fi rows and validation.
- Box (server restarted):
  - `GET /api/system/network` `nics` = eno1 (dhcp, 192.168.0.23), eno2 (static, 2.0.0.13), wlp0s20f3 (wifi, down);
    primary eno1;
  - `GET /api/system/network/wifi` = available, radio on, 5+ networks;
  - `POST …/wifi/scan` → 503 "The network helper on this box is older than Wi-Fi support", which is expected until
    the install above.
- Not run on the box: a real apply / join. It needs the new helper installed, and applying on eno1 would cut this
  session.

## Godot UI (23.10)

### What was done

- `godot/client/features/settings/network_model.gd` (pure):
  - a NIC card: title with `(primary)`; status "link up / no cable · addresses · DHCP / static / not set up yet";
  - static fields from the saved profile, else from the address the port has now;
  - the apply body with IPv4 / prefix / gateway / DNS validation;
  - "the GUI reaches the server through this port";
  - Wi-Fi rows and the status line.
- `godot/client/features/settings/network_pane.gd`:
  - one card per Ethernet port (down ones included) with DHCP / static and "Apply to <port>"; it asks first when the
    GUI talks to the server through that port;
  - Wi-Fi: on / off, Scan, Disconnect, a network list (✓ joined, signal, security), password and Join (Enter or a
    double-click joins too);
  - refreshes when shown and after each action;
  - the label | field grid keeps it narrow enough for the Inspector column.
- Settings → **Network** tab (`settings_tab.gd`).
- Devices → server page (click the rear-panel background):
  - `server_page_model.gd` `items(…, network_panel := true)` replaces the web's one-interface block with a `network`
    item;
  - `server_controls.gd` renders the same pane and keeps that one node across the 3 s re-renders, so a field being
    typed survives;
  - the golden replay of the web page (`test_devices_server_page.gd`) still calls the default and is unchanged.

### What was VERIFIED

- Godot suite: 21126 passed, 0 failed (`test_network_model.gd`: ipv4, up / DHCP / primary card, down never-set-up card,
  down saved-static card, apply bodies, origin port, Wi-Fi rows / lines).
- Box, second client instance (screenshots in the session scratchpad: `net2.png`, `dev4.png`):
  - Settings → Network shows eno1 (primary, DHCP, 192.168.0.23/24) and eno2 (static 2.0.0.13/8 + the networkd DHCP
    192.168.0.59/24, the double-manager issue above), and the Wi-Fi list (7 networks).
  - The Devices server page shows the same in the Inspector. Its first version overflowed the column (a 4-column field
    row); now it fits, as label | field rows.
- Live apply through the API (the button's request): `eno2` static 2.0.0.13/8 with the *old* installed helper:
  - `ok`, `primary: false`;
  - `config.network` before = after (primaryInterface eno1, dhcp);
  - eno2 re-activated with 2.0.0.13/8 (NM's re-activation also dropped the stray networkd address for now; networkd
    can add it back at its next lease until the new helper's hand-over is installed).
- Owner QA after the `sudo install`:
  - Scan / Join a network;
  - set up a port without a cable, then plug it in.
