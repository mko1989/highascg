# WO-416 — `build-produce-flash-stick.sh` fails at exFAT partitioning: WO-413 USB auto-mount re-mounts the stick mid-flash

**Status: OPEN (2026-08-03 — root-caused from owner's pasted run log + journal; no fix applied)**

## Symptom (owner run log, pasted into `work/work-orders/todos03.08.26`)

Build phase (`eggs produce`) completed fine — ISO
`/home/eggs/mnt/highascg-nvidia-595_amd64_2026-08-03_1259.iso` produced, all Calamares/GRUB
branding and verify steps `OK`. The run dies in **phase 2/5, `finish-operator-stick`**, while
recreating the operator exFAT slice:

```
==> Remove stale operator slices (persistence + exFAT) before recreating HIGHASCGEXF
OK: no mounts on partitions under /dev/sda
Note: exFAT units masked for this session; finish-operator-stick.sh unmasks when done.
==> Partition table before prune:
Number  Start    End      Size     Type     File system  Flags
 2      0.18MiB  16.2MiB  16.0MiB  primary  fat16        esp

Prune candidate: /dev/sda3 → parted rm 3 (LABEL=HIGHASCGEXF TYPE=exfat)
parted rm 3
Error: Partition doesn't exist.
Error: Partition(s) 3 on /dev/sda have been written, but we have been unable to inform the
kernel of the change, probably because it/they are in use.  As a result, the old partition(s)
will remain in use.  You should reboot now before making further changes.
```

Owner's `lsblk` immediately after shows the contradiction:

```
sda           29.3G disk
├─sda2          16M part
└─sda3        24.6G part /media/casparcg/HIGHASCGEXF     ← mounted
```

The **on-disk table has only partition 2**; the **kernel still has an `sda3` node and it is
mounted**. `parted rm 3` therefore fails twice over: no #3 in the table to remove, and the
kernel refuses to re-read the table because a partition on the disk is in use.

## Investigation

`usb_quiesce_stick_for_partitioning()` (`tools/eggs/live-usb/flash-stick-common.sh:272`) is the
script's defence, and it only knows about **WO-47 systemd units**
(`flash-stick-common.sh:243-250`):

```sh
usb_mask_exfat_automount() {
	systemctl mask --runtime highascg-exfat-arrive.service
	systemctl mask --runtime home-casparcg-exfat.mount
	systemctl mask --runtime home-casparcg-highascg-media-exfat.mount
	systemctl stop highascg-exfat-sync.service ... home-casparcg-exfat.mount
}
```

Every mount that actually bit is on the **udisks path `/media/casparcg/*`**, not the WO-47 path
`/home/casparcg/exfat` — nothing in the quiesce touches it. The re-mounter is
**WO-413's `src/media/usb-automount.js`** (landed today), which runs inside `highascg.service`:

- `POLL_MS = 3000` (`usb-automount.js:27`) — polls every 3 s
- gated on `usbIngest.enabled` / `usbIngest.autoMount`, both `true` in `config/usb_ingest.json`
- `udisksctl mount`s every unmounted removable partition it finds → mountpoint
  `/media/casparcg/<LABEL>`
- it is a **node timer, not a systemd unit**, so `systemctl mask` cannot stop it

`journalctl -u udisks2` shows the fight verbatim (unmount by the script, re-mount 1–3 s later
"on behalf of uid 1000" = `casparcg`, the user `highascg.service` runs as):

```
13:09:06 Cleaning up mount point /media/casparcg/HIGHASCGEXF (device 8:3 is not mounted)
13:09:07 Mounted /dev/sda3 at /media/casparcg/HIGHASCGEXF on behalf of uid 1000
13:09:10 Cleaning up mount point /media/casparcg/0B31-AE32 (device 8:2 is not mounted)
13:09:12 Cleaning up mount point /media/casparcg/HIGHASCGEXF (device 8:3 is not mounted)
13:09:15 Mounted /dev/sda2 at /media/casparcg/0B31-AE32 on behalf of uid 1000
13:09:17 Mounted /dev/sda3 at /media/casparcg/HIGHASCGEXF on behalf of uid 1000
```

Corroboration that the poller (not a desktop automounter) is the caller:

- `pgrep -a "gvfs-udisks|nautilus|thunar|pcmanfm"` → **nothing running** (kiosk is nodm/Openbox);
  there is no desktop automounter on this box.
- The highascg log emits its own line at the same second as the udisks line, e.g.
  `14:53:53 (HACG) [info] USB auto-mount: /dev/sda1 (highascg-nvidia-595) → /media/casparcg/highascg-nvidia-595`
  paired with `14:53:53 udisksd: Mounted /dev/sda1 ... on behalf of uid 1000`.
- The 3 s gap between unmount and re-mount matches `POLL_MS` exactly.

`OK: no mounts on partitions under /dev/sda` is printed truthfully — the check
(`unmount-usb-for-partitioning.sh:24`) passes at that instant, and the poller re-mounts during
the window before `parted` runs. The check has no hold/inhibit, so it is a TOCTOU against a
3-second timer.

**Regression window:** this pipeline worked before WO-413 (auto-mount) landed today. It also
explains the *earlier* half-flashed stick found in WO-415's correction — a raw hybrid-ISO dd
(`sda1` 3.5 G iso9660 + `sda2` 16 M ESP) with ~25.8 GB unallocated and **no `HIGHASCGEXF`
partition**: the same phase failed, leaving the exFAT slice uncreated.

Not a bug, per owner (03.08): `eggs produce` bakes a default config into the ISO, so a
stick-booted system starting on default config is expected and out of scope here.

## Fix options (owner to pick — none applied)

1. **Teach the quiesce about the poller** (preferred): have
   `usb_mask_exfat_automount` also stop the node watcher for the duration — either
   `systemctl stop highascg.service` (heavy, kills playout) or a runtime gate the script can
   set, e.g. write `usbIngest.autoMount=false` / touch an inhibit file
   (`/run/highascg/usb-automount-inhibit`) that `usb-automount.js:58 enabled()` also checks,
   then restore in `unmask-exfat-systemd.sh`.
2. **Inhibit udisks directly** for the target disk during partitioning (`udisksctl` has no
   inhibit for this; a `udev` rule with `UDISKS_IGNORE=1` on the device, applied and reverted
   around the flash, is the usual approach).
3. **Re-check + retry**: make `unmount-usb-for-partitioning.sh` loop (unmount → verify → sleep →
   verify again) so a single re-mount inside the window is caught rather than silently passing.

Option 1 + 3 together is the smallest change that makes the pipeline reliable; option 3 alone
still races.

## Immediate workaround (documented for the owner, not executed)

Before flashing, disable the poller for the session, then flash normally:

```bash
# stop the auto-mount poller (it lives inside highascg.service)
sudo systemctl stop highascg
# make sure nothing is left mounted from the stick
sudo bash tools/eggs/live-usb/unmount-usb-for-partitioning.sh /dev/sdX
sudo bash tools/eggs/live-usb/build-produce-flash-stick.sh --flash-only --usb /dev/sdX -y
sudo systemctl start highascg
```

Alternative without stopping playout: set `"autoMount": false` in `config/usb_ingest.json`
(live-read per WO-413), flash, set it back.

Because the kernel was left with a stale in-use `sda3` after the failed run, a **reboot** (or a
physical unplug/replug of the stick) is needed before re-running, exactly as `parted` advised —
otherwise the table/kernel mismatch persists.

## What was VERIFIED

Diagnosis only — read-only. Verified: the quoted run-log failure; `flash-stick-common.sh:243-250`
masks systemd units only; `usb-automount.js:27,58` poll interval and config gate;
`config/usb_ingest.json` has `enabled/autoMount: true`; the udisks unmount→remount pairs above;
no desktop automounter process on the box; current `sda` state (`sda1`+`sda2` mounted under
`/media/casparcg/`, no exFAT slice). **No fix applied, no flash re-run, no service restarted.**
