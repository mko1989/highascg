# WO-996 — Retire the dd-flash / scripted-partition stick tools (sticks are Ventoy-only)
**Area:** os-iso, process
**Status: DONE (07.11.26, removals checked by whole-repo reference search; 41 affected smokes 330 / 330 pass; ISO finder checked against the real eggs nest; the next `eggs:build` is the live proof)**

Owner, 01.11: flashing the ISO is deprecated and Ventoy is the only stick workflow (`docs/STICK_QUICK_START.md`).
Owner, 07.11, about the WO-995 owner-call list: *"The rest seems obsolete but make sure first."*

## Investigation

Every script in `tools/eggs/live-usb/` was mapped to the tracked files that name it (`scratchpad/sweep/usbgraph.py`;
`work/` history, generated wiki and work orders excluded).

- **Flash-only cluster.** These files are reachable only from the dd entry points (`npm run eggs:build-flash` /
  `eggs:clone-flash` / `eggs:clone-flash-tmux`, `create-operator-stick-from-dd.sh`) or from each other:
  - **dd and finishing:** `build-produce-flash-stick.sh`, `create-operator-stick-from-dd.sh`,
    `finish-operator-stick.sh`;
  - **partitioning:** `add-exfat-data-partition.sh`, `repair-stick-exfat-only.sh`, `prune-exfat-partition-only.sh`,
    `prune-operator-data-partitions.sh`, `usb-mkpart-numbered.sh`, `usb-partition-slots.py`,
    `usb-restore-esp-flags.sh`, `usb-env.sh`, `unmount-usb-for-partitioning.sh`;
  - **seeding a stick from the host:** `seed-stick-config-from-host.sh`, `seed-stick-drop-update-from-host.sh`,
    `seed-stick-factory-config.sh`;
  - **flash-time checks:** `verify-operator-stick-branding.sh`, `verify-config-persistence.sh`;
  - **union persistence:** all of `legacy-persistence/`;
  - **runners:** `work/run-eggs-clone-flash{,-tmux,-inner}.sh` and `work/run-parallel-eggs-and-sync.sh`
    (npm `deploy:parallel-eggs-sync`).
- **`flash-stick-common.sh` was not flash-only.** The live build uses two of its functions:
  - `build-highascg-egg.sh:276-279` sources it for `find_latest_iso`, which names the ISO that the `.sha256`
    "safe to copy" sidecar (WO-462) is written for. A plain delete would have degraded quietly: the
    `source … || true` line hides the error, and no sidecar would be written.
  - `verify-iso-boot-branding.sh`, `verify-iso-squashfs-excludes.sh` and `preview-live-iso-qemu.sh` use the same
    finder.
  - Everything else in the file (`usb_*`, `run_dd_flash`, `pick_usb_interactive`) only served the flash scripts.
- **USB auto-mount inhibit (WO-416).** `usb_mask_exfat_automount` was the only thing that set
  `/run/highascg/usb-automount-inhibit`. The poller gate (`src/media/usb-automount.js`) and the cleanup in
  `unmask-exfat-systemd.sh` still have a use: setting the inhibit by hand before repartitioning a stick on the box
  (Ventoy2Disk.sh). They stay.
- **Six smokes pinned the cluster:**
  - eggs-produce-build-stamp: the wrapper as the second stamp writer;
  - wo413: the inhibit handshake on the shell side;
  - wo434: the drop-update seed of the dd stick, which is the whole file;
  - wo842: `usb_mkfs_exfat_labeled`;
  - wo832: `findmnt` in `flash-stick-common`;
  - wo870: the finder's source path, the flash ISO lookup sites, and `stat -L` in `dd_iso_with_progress`.
- **Kept after checking:**
  - `tools/startup/verify-live-stick.sh` still checks the old union-persistence layout. It already accepts the
    exFAT-only (Ventoy) layout and runs in health checks, so only its flash hints changed.
  - `HIGHASCG_FOLDER_USB_PARTITION.md` (ext4 how-to, linked from `systemd/README.md`) and
    `MANUAL_STICK_WINDOWS_MACOS.md` (contents reference) still hold.

## What was done

- **New `tools/eggs/live-usb/iso-find-lib.sh`.** It holds `find_latest_iso` and `find_newest_iso_since`, moved
  verbatim. The four survivors source it. `flash-stick-common.sh` is deleted.
- **Deleted:** the cluster listed above (32 files) and the npm scripts `eggs:build-flash`, `eggs:clone-flash`,
  `eggs:clone-flash-tmux` and `deploy:parallel-eggs-sync`. The `.gitignore` lines for `flash-iso.conf` are gone;
  no local copy existed.
- **`build-highascg-egg.sh`.** The "Full build + flash /dev/sda" and "Flash only" hints are gone. The `Done.`
  lines (copy to Ventoy, `verify-stick-iso.sh`) stay.
- **Smokes:**
  - build-stamp now asserts that the produce script is the **only** `BUILD_STAMP` writer among every
    `live-usb/*.sh`. Before, it checked one wrapper.
  - wo413 keeps the poller gate and the unmask pin.
  - wo870 sources `iso-find-lib.sh`. It checks that the four survivors source it and that `flash-stick-common.sh`
    stays gone.
  - wo842 and wo832 drop the dead functions and file; wo434 is deleted, along with its curated-list entry.
- **Comments and hints** naming the deleted scripts were fixed in: `usb-automount.js`, `unmask-exfat-systemd.sh`,
  `diagnose-exfat-volumes.sh`, `verify-live-stick.sh`, `work/bring-up-eggs-produce-host.sh` and the wo926 smoke.
- **Docs** were rewritten to the Ventoy workflow; no doc was deleted:
  - live-usb `BUILD_AND_FLASH`, `EXFAT_DATA_ZERO_TOUCH`, `HIGHASCG_FOLDER_USB_PARTITION`,
    `HOW_TO_BUILD_AND_FLASH_EGGS`, `MANUAL_STICK_WINDOWS_MACOS` and the README;
  - `scripts/README`;
  - three files in `docs/` and three in `work/`.

  The wiki was rebuilt. History in `work/work-orders`, `work/archive` and `work/deprecated` was left alone.

## What was VERIFIED

- **References.** `git grep` for every deleted basename and npm script, excluding WO, archive, deprecated, notes,
  sweep, reviews and checklist history plus the generated wiki, finds no hits.
- **Smokes.** All 41 smokes that read `tools/eggs/live-usb`, `package.json`, the stick docs or `usb-automount`:
  **330 / 330 pass**. Wiki smokes: 5 / 5.
- **Shell.** `bash -n` is clean on every remaining `live-usb/*.sh` and the touched scripts.
- **Live finder.** On the box, `source iso-find-lib.sh; find_latest_iso` returns
  `/home/eggs/highascg-nvidia-615-2026-11-03_1038.iso` (rc 0). That is the call `build-highascg-egg.sh` makes
  before it writes the sidecar.
- **Gates:** max-file-lines, prettier and unwired-exports are clean.
- **Not run:** an `eggs produce`. It stops highascg, needs sudo, and is limited to one per boot. The next owner build
  is the live check: the end of the build log must still print `Done. ISO: …` and write `<iso>.sha256`.

Rollback: revert the commit. Sticks that were already flashed are unaffected.
