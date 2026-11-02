# WO-935 — The ISO shipped the build host's network profiles and its shows instead of a clean starter project

**Area:** os-iso
**Status: DONE (02.11.26 — verifier catches both leaks in the 02.11 11:31 ISO and passes a clean fixture squashfs; exclude smoke 47/0, offline 5270/0; proof on a produced ISO waits for the next build)**

Owner, 02.11.26 (latest ISO on the second machine, .10): "i also noticed a manual setting of one of the ethernets that
carried over from the host machine as well as the project. the project should be totaly clear with only the operator
gui connection made from the start operator here."

## Investigation

ISO `/home/eggs/highascg-nvidia-615-2026-11-02_1131.iso`, squashfs listing (`unsquashfs -o <offset> -l`):

- **Network.** The build host's NetworkManager profiles shipped. They are netplan files here
  (`/etc/netplan/90-NM-<uuid>.yaml`, written by NM, and so by the HighAsCG network UI too):
  - a static `eno2` 2.0.0.13/8 and a DHCP `eno1`;
  - two Wi-Fi profiles with their PSKs in clear.
  - The files are dated 23–26.10. No exclude list named `etc/netplan` or `etc/NetworkManager/system-connections`, so
    every ISO since 23.10 carried them. A clone needs only `01-live-networkd.yaml`, which `build-highascg-egg.sh`
    writes itself (DHCP on every wired port).
- **Projects.** The squashfs held 67 entries under `projects/`: the starter `new_project_1` (11:31:08) plus every
  build-host show and its autosave, with their October mtimes.
  - `build-highascg-egg.sh` ran `reset-iso-operator-config.sh` (→ `write-iso-default-config.js`, which wipes
    `projects/` and writes the starter) at 11:31:08–10.
  - That was before `pre-produce-preflight.sh`, which only then stops highascg and the bridge/USB sync services and
    unmounts the volumes. In between, the bridge pairs (`config/exfat-sync.json`) copied the shows back from
    `~/bridge` within seconds, keeping their old mtimes.
  - On this host the restored projects carry ctime 11:34:56: the post-produce `highascg-exfat-remount-sync.sh`, as
    designed.
- **Screen layout.** `~/.config/highascg/apply-layout.sh` (this host's `DP-0 1920x1080@50` and the NVIDIA sync output)
  and `caspar-env` (`CASPAR_GL_SYNC_DISPLAY=DP-0`) shipped too. The openbox autostart runs the layout script at every
  session start on the clone. Both files are optional at start-up (`-x`/`-r` checks in the autostart and `run.sh:35`),
  and the node rewrites them on the clone's own Apply (`os-config-persist.js`, `caspar-gl-sync-env.js`).
- **Not leaks:**
  - `~/.highascg/gdtf-share.json` ships on purpose (owner 22.10, WO-669).
  - `audio-desk.json` and `lighting-consoles.json` are empty defaults.
- **.10's stick** still holds that morning's test state (active slug `mhp_harder`, `new_project_1`). Stick-wins at
  boot is by design (`stick-insert-clobbers-live-config`). That state is a test leftover, not an ISO leak.

## What was done

- **`reset-iso-operator-config.sh`** is split by `HIGHASCG_RESET_PART=stick|tree|all` (default `all`, the old
  behaviour for a hand run):
  - `stick` clears `~/exfat/configs` and `drop-config/highascg.config.json`;
  - `tree` resets `config/`, `projects/`, `casparcg.config` and `.env`.
- **`build-highascg-egg.sh`:**
  - **Before the preflight:** only the stick part runs, early, while the stick is still mounted.
  - **After the preflight:** with highascg and the volume sync stopped, the tree part runs. Nothing can write the shows
    back any more.
  - **Syncthing** (`syncthing@casparcg.service`) is stopped across the produce. It syncs the repo with its peers and
    would send them the factory-reset `config/` and `projects/`.
    - It starts again only after the post-produce remount-sync has brought this host's own data back
      (`REMOUNT_SYNCED=1`).
    - If the build dies earlier, an EXIT trap prints the restore commands and leaves Syncthing stopped. Starting it on
      a reset tree is what must not happen.
- **Both exclude lists** gain:
  - `etc/netplan/90-NM-*` and `etc/NetworkManager/system-connections/*`;
  - `home/casparcg/.config/highascg/apply-layout.sh` and `caspar-env`.
  - `01-live-networkd.yaml`, `NetworkManager.conf` and the `.config/highascg` directory still ship.
- **`verify-iso-squashfs-excludes.sh`** gains two assertions:
  - `projects/` holds only the starter (`STARTER_PROJECT_SLUG` from the manifest, plus `_autosave/` and `.gitkeep`);
    anything else fails and names the first three leaked paths;
  - no `etc/netplan/90-NM-*` or `NetworkManager/system-connections/*` entries.
- **`smoke-eggs-exclude-lists.test.js`:** per list, the NM profiles and the two layout files are excluded, and the
  live netplan, `NetworkManager.conf` and `.config/highascg` are not.

The ISO's operator connection still comes only from the start-up question ("Start operator here", WO-638). The
starter project carries no network or output settings of the build host.

## What was VERIFIED

- **Verifier on the 02.11 11:31 ISO:** both new checks FAIL with the leaked paths:
  - `projects/_autosave/airport.json` …;
  - the network-profile line.
- **Verifier on a fixture squashfs** (`mksquashfs`; scratchpad `wo935/`):
  - starter only + `01-live-networkd.yaml`: both OK;
  - with `projects/kongres.json` + `system-connections/eno2.nmconnection` added: both FAIL.
- `smoke-eggs-exclude-lists.test.js`: **47 passed, 0 failed**. Offline suite: **5270 passed, 0 failed**. Line limit,
  format:check and eslint are clean. `bash -n` passes on both scripts.
  - `smoke-wo47-manifest.mjs` fails on `dist-web`, but it already did at HEAD, and CI excludes it
    (`collect-offline-tests.js`).
- **Not yet proven:** a produced ISO. The new eggs reads `custom.exclude.list`; the build regenerates it from the
  fragments before the produce (`eggs-run-lib.sh` → `install-eggs-config.sh --apply`), so no manual step is needed.
  The next build's verifier run is the proof.
- **Regression, fixed in WO-937:** the build host's NM profiles had also let NetworkManager manage every wired port. Without them
  the network helper stranded the port: no IP on .10's enp5s0, and setting a manual IP from the client failed.
