# WO-702 — ISO live-boot defects seen on .64 (22.10 build)

**Area:** os-iso
**Status: DONE in repo (2026-10-23; smoke-wo702 13/13 + test:ci, see Verified) — proven on the next ISO boot only:
`systemctl --failed` empty, network.conf applied to the cabled NIC, one hostname line, no sda1 mount retries**

Follow-up of [WO-696](./696_WO_iso_test_boot_192_168_0_64.md) (same boot: 22.10 19:20 ISO, BUILD_STAMP
`2026-10-22_192013`, booted on .64 / highascg5867 at 10:59:24). The read-only probe of 23.10 13:12–13:16 (raw output in
the session scratchpad `probe64/`) found failures beyond WO-696's three. WO-696's (SSH host keys, the start-up gate
the client never re-asked, the stick adoption → WO-697) are fixed in the repo already and not repeated here.

## Investigation

### 1. `highascg-exfat-network-apply.service` failed: the script died after its "apply:" line; it never picked enp5s0

- .64 journal: `10:59:41 apply: mode=dhcp iface=eno2 from /home/casparcg/exfat/network/network.conf`, then
  `status=1/FAILURE` with no further line; the unit is in `systemctl --failed`.
- `scripts/exfat/highascg-exfat-network-apply.sh:30-32` (before the fix): `vlog() { [[ "$VERBOSE" -eq 1 ]] && log "$@"; }`.
  As a function's last statement the `[[ ]]` failure is its return value (1) and, under `set -euo pipefail`, the call
  `vlog "  args: …"` (line 226) ended the script. Line 89 (`vlog "skip: … unchanged"`) had the same problem: an
  unchanged conf exited 1 instead of 0.
- `iface=eno2`: .64's cabled NIC is `enp5s0` (192.168.0.64), eno2 is NO-CARRIER. The probe suspected a carrier race.
  The real cause is `iface_allowed` (line 140): `^(eth|enp|eno)[0-9]+$` rejects every predictable PCI name
  (`enp5s0`, `enp0s31f6`), so the carrier loop never even looked at enp5s0 and the fallback took the first allowed
  name. `tools/runtime/highascg-network-reset.sh:13` had the same regex. The repo's
  `tools/runtime/highascg-network-apply.sh:79` and `src/config/network-settings.js:11` (`IFACE_RE`) already allow
  `^(eth[0-9]+|en[a-z0-9]+)$`.
- Effect: dhcp mode was harmless (DHCP comes up anyway), but a static `network.conf` was never applied, and would have
  gone to the wrong NIC.

### 2. `highascg-hardware-hostname.service` looped through sudo for 20 s at boot

- .64: 179 `sudo … highascg-apply-hardware-hostname.sh` runs between 10:59:34 and 10:59:53, each preceded by
  `Failed to connect to bus: No such file or directory`, ending with `spawnSync sudo ETIMEDOUT` and
  `warn: hostname not applied`. The name became highascg5867 at 10:59:50, once dbus / hostnamed came up.
- `scripts/systemd/highascg-hardware-hostname.service`: `DefaultDependencies=no`,
  `After=systemd-udev-settle.service network-pre.target` and no D-Bus ordering, so hostnamectl ran before the bus.
- `src/system/hardware-identity.js:207-245` `applySystemHostname`: the attempts are hostnamectl → `sudo -n hostnamectl`
  → `sudo -n …/highascg-apply-hardware-hostname.sh`. The comment promised that the helper "re-enters this function AS
  ROOT, where the first attempt succeeds — no recursion". With no bus, the first attempt fails as root too, so root
  fell through to the helper again, which recursed until the timeouts.
- Not traced: the early derived name `highascg7580` differs from the final `highascg5867`
  (`getPrimaryEthernetMac` picking another NIC before enp5s0 is up). Left open below.

### 3. `nxserver.service` failed on every live boot

- .64: `nxserver.service: Failed with result 'start-limit-hit'` at 10:59:58. `/usr/lib/systemd/system/nxserver.service`
  is present, `/usr/NX` is not, and `dpkg -l` shows `nomachine 9.10.3-3`.
- `tools/eggs/live-usb/penguins-eggs-exclude-highascg-fragment.list:215-218` and the embed-server list (228-231)
  exclude `usr/NX` and `etc/NX` ("NoMachine excluded FULLY", WO-142) but not the unit file or its enable link. On the
  build host they are `/usr/lib/systemd/system/nxserver.service` (`/lib` is a merged-usr symlink) and
  `/etc/systemd/system/multi-user.target.wants/nxserver.service`; there is no init.d or autostart entry.
- The dpkg status record still ships. That is the WO-431 class: a single record cannot be excluded. It is harmless
  once nothing starts.

### 4. USB auto-mount retried the Ventoy boot partition all day

- .64 HighAsCG log: 31× `USB auto-mount failed for /dev/sda1: … /media/casparcg/Ventoy: /dev/sda1 already mounted or
  mount point busy`, from 11:02:02 at the 5-min backoff cap. The kernel logged `/dev/sda1: Can't open blockdev` at
  each one, through 13:10.
- WO-463 (`src/media/usb-drives-discovery.js:61-70`) skips partitions whose lsblk node has children (the dm holder).
  That code is in the 22.10 ISO, yet sda1 still reached the poller. lsblk on .64 evidently did not list the Ventoy map
  under sda1: after switch_root the map has no `/dev/mapper` node (the WO-697 boot-stick note). The probe did not
  capture lsblk, so this is inferred.
- `src/media/usb-automount.js` had no check of its own.

## What was done

1. `highascg-exfat-network-apply.sh`:
   - `vlog` is an `if` (no `[[ ]] && x` as a last statement remains; the three in loop bodies are not last).
   - `iface_allowed` uses the Node rule `^(eth[0-9]+|en[a-z0-9]+)$`, and so does `highascg-network-reset.sh`.
   - `pick_iface` polls for a carrier up to `CARRIER_WAIT_S` (default 10 s, `HIGHASCG_CARRIER_WAIT_S`) before
     falling back to the first allowed name. An explicit `interface=` never waits. The sysfs root is overridable
     (`HIGHASCG_SYS_CLASS_NET`) for tests.
   - The unit is started `--no-block` (`highascg-exfat-boot.sh:146`) with the default timeout, so the wait delays
     nothing else.
2. Hostname:
   - The unit gets `Wants=dbus.socket` and `After=… dbus.socket dbus.service`. `systemd-analyze verify` finds no
     cycle.
   - `applySystemHostname` never runs sudo as root. Root tries hostnamectl, then `hostname <name>` plus `/etc/hostname`
     (neither needs a bus). Unprivileged keeps the three attempts.
   - Test seams `deps {exec, isRoot, current, writeEtcHostname}`.
   - Why not an env marker on the re-entry: sudo's `env_reset` drops it; uid 0 is the reliable signal.
   - `prepare-eggs-clone-with-exfat.sh:95` reinstalls the unit (`16-hardware-hostname-boot.sh`), so the next produce
     carries it.
3. Both exclude lists add `usr/lib/systemd/system/nxserver.service` and
   `etc/systemd/system/multi-user.target.wants/nxserver.service` (the usr/ path, no bare `lib/` line). The squashfs
   verifier (`verify-iso-squashfs-excludes.sh`) asserts `usr/NX` and both are absent.
4. `usb-automount.js` reads `/sys/class/block/<dev>/holders` itself (`sysfsHolders`, injectable `holdersOf`). A held
   device is skipped and logged once per plug ("skip /dev/sda1 — held by dm-0 …"). This is independent of what lsblk
   shows.

## Verified

- `tools/smoke/smoke-wo702-iso-live-boot-defects.test.js` 13/13 (in the curated CI list):
  - **network apply:**
    - the real `vlog` / `pick_iface` / `iface_allowed` functions are extracted from the script and run under
      `set -euo pipefail`;
    - vlog not verbose → the script goes on;
    - fake sysfs eno2 + enp5s0 both carrier 0, with enp5s0 getting its carrier 1 s later → `enp5s0`; no carrier and
      no wait → `eno2`; explicit interface → as given;
    - `iface_allowed` agrees with `isAllowedEthernetIface` on 9 names (enp5s0, enp0s31f6, wlp2s0, docker0,
      `enp5s0;x` …);
    - `bash -n`.
  - **hostname:**
    - root with no bus → `hostnamectl`, then `hostname`, then /etc/hostname, and no sudo;
    - root all-fail → no sudo;
    - unprivileged keeps the sudo path;
    - unit pins.
  - **NoMachine:** both lists carry the two lines and no bare `lib/` line; the verifier names them.
  - **auto-mount:** a held sda1 is never mounted and logged once over ~12 ticks, while sdb1 mounts.
- wo413 / wo463 auto-mount and hostname-sudoers smokes unchanged; full `test:ci`, lint, format and file-size gates in
  the session report.
- NOT verified: the live boot itself (needs the next ISO). Whether lsblk on a Ventoy live boot really omits the map
  under sda1 is inferred, not captured.

## Open

- The derived-name mismatch (`highascg7580` early vs `highascg5867`): which MAC `getPrimaryEthernetMac` takes before
  the cabled NIC is up.
- Out of scope here, from the same probe:
  - DeckLink DKMS rebuild on every live boot (~1m53s before node starts; `highascg.service` is ordered behind
    `highascg-exfat-sync` ← `highascg-decklink-install`). This is what let the Godot client beat node in WO-696.
    Owner decision: pre-build the module into the ISO, or stop ordering node behind it.
  - The `startup.mode ask` hold has no timeout (`timeoutS 0`).
  - The stick's `configs/` carries `.bak*` junk that the ISO excludes.
