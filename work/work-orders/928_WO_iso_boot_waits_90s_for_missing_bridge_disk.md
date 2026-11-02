# WO-928 — Clone boots held node ~75 s waiting for a bridge disk (HIGHASCGDAT) the machine does not have

**Area:** os-iso
**Status: DONE (02.11.26 — root cause from .31's boot journal; device-timeout mechanism proven under a user systemd manager; smoke; ships with the next eggs build)**

Owner, 02.11.26, second machine 192.168.0.31 booted from the 02.11 ISO (BUILD_STAMP `2026-11-02_074103`, with WO-926
and WO-927): "new iso, new run still the node doesnt start up."

## Investigation

- At uptime 2 min, `highascg.service` had no journal lines at all; `systemctl list-jobs` showed it `start waiting`
  behind a running `highascg-exfat-sync`. It started at **2 min 54 s** (userspace), API answered (`/api/settings` 200,
  `/api/previs/health` 200, WO-927), Caspar active. So node does start on this ISO (WO-926's jszip fix works).
  The owner looked before it came up.
- `systemd-analyze critical-chain highascg.service`:
  - `highascg-exfat-server-update` finished @18.8 s;
  - `highascg-decklink-install` started only @1 min 32 s (+63 s);
  - then exfat-sync (+18 s), then node.
- Boot journal at monotonic 98.93 s:
  `Timed out waiting for device dev-disk-by\x2dlabel-HIGHASCGDAT.device` → `Dependency failed for home-casparcg-bridge.mount`
  → the next line is `Starting highascg-decklink-install.service`. Nothing else ran between 25.6 s and 98.9 s.
- Cause, in `scripts/exfat/install-exfat-systemd-units-units.sh`:
  - `home-casparcg-bridge.mount` is `WantedBy=multi-user.target`, so every boot queues it.
  - Its `Options=` carry `x-systemd.device-timeout=5,x-systemd.mount-timeout=5`. systemd honours `x-systemd.*` only in
    `/etc/fstab` (fstab-generator); in a unit file's `Options=` it ignores them. So the device job used the default
    90 s timeout. `ConditionPathExists=` does not help: it is checked when the mount job runs, after the device wait.
  - `highascg-decklink-install` and highascg's other boot units are `After=home-casparcg-bridge.mount`.
- This box has a `HIGHASCGDAT` disk, so it never waits. Only clones without the bridge NVMe (.31) do. The earlier
  ISOs had the same 75 s wait. On WO-926's first .31 boot it helped push node past run.sh's 240 s gate.
- `highascg-bridge-boot.sh` already waits 12 s for the label itself, starts the mount when it appears and falls back to
  a direct `mount`, and `highascg-bridge-arrive` handles hotplug. So a short device timeout cannot lose a late disk.
- Same latent pattern on `home-casparcg-exfat.mount` (HIGHASCGEXF). Not changed: on stick boots the device appears
  at ~10 s and that path works (exfat-boot.sh's direct-mount fallback). It only matters on a disk install booted
  without the stick.
- Not changed, recorded: DeckLink install is still 63 s per live boot (dpkg unpack, WO-926 notes).

## What was done

- `install-exfat-systemd-units-units.sh` writes
  `/etc/systemd/system/dev-disk-by\x2dlabel-HIGHASCGDAT.device.d/highascg-timeout.conf` with
  `JobRunningTimeoutSec=5`. fstab-generator writes exactly this for `x-systemd.device-timeout=5`.
- Rejected alternative: dropping `WantedBy=` from the bridge mounts. That changes which component mounts the disk on
  boxes that have one. The drop-in only restores the 5 s that was always intended.
- The eggs build runs `prepare-eggs-clone-with-exfat.sh` → `install-exfat-systemd-units.sh` on the build host
  before the clone, so the next ISO carries the drop-in. The build host itself gets it then too (harmless: it has the
  disk).
- Smoke `tools/smoke/smoke-wo928-bridge-device-timeout.test.js` (curated, `offline-test-files-3.js`).

## What was verified

- Mechanism, under this box's user systemd manager (no root): a oneshot service `Requires=`/`After=` a nonexistent
  `dev-disk-by\x2dlabel-WO928NOPE.device`:
  - without the drop-in, `systemctl --user start` was still blocked when the 25 s test cap ended (default 90 s);
  - with the drop-in (`JobRunningTimeoutUSec=5s`), it failed with "A dependency job … failed" after **5.08 s**.
- The drop-in could not be installed on .31 for a live check: root writes over ssh were refused by the session's
  permission classifier. Expected on the next ISO: on .31, `highascg-decklink-install` starts at ~25 s instead of
  ~99 s, and node about 74 s earlier (~1 min 40 s of userspace, most of it DeckLink).
  Check with `systemd-analyze critical-chain highascg.service`.
- Smoke 2/2; it fails 1/1 with the timeout set back to 90. `bash -n` on the units script.
