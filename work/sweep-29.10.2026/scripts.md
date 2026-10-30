# scripts — sweep 29.10.2026 (batch 048)

Files: 11 · lines: 109 · findings: 0 BUG-HIGH, 1 BUG, 0 DEAD, 0 RISK, 3 QUALITY

Nine of the eleven files are 1-3 line forwarders (WO-273 "compat forwarders at scripts/ root"). Each target exists (`scripts/exfat/`, `scripts/eggs/`, `scripts/deploy/`, `scripts/boot/`, `scripts/nvidia/disable-nvidia-multi-driver-boot.sh`, `scripts/deprecated/legacy/install.sh`). None is dead: grep for each name outside `scripts/deprecated` and `work/sweep` shows live callers, listed per file.

## scripts/apply-bridge-label-highascgdat.sh
- `OK` — forwarder; target `scripts/exfat/apply-bridge-label-highascgdat.sh` exists. Callers by old path: `docs/BRIDGE_DISK_AND_USB_EXFAT.md:24`, `work/from_laptop/HOST_MACHINE_BRIDGE_MEDIA.md`, `scripts/README.md:85` (docs only, no code).

## scripts/backup-caspar-config.sh
- `BUG` scripts/backup-caspar-config.sh:25-29 — the backup lands in `config/backups/`, a path nothing excludes. Failing case: operator follows `scripts/setup/MANUAL_INSTALL.md:391` (run this script, then `run-eggs-produce-from-host.sh`) → `config/backups/casparcg.config.bak.<epoch>` is inside the squashfs: the exclude lists only carry `home/casparcg/highascg/config/*.bak*` (`tools/eggs/live-usb/penguins-eggs-exclude-highascg-fragment.list:86`, `…-embed-server.list:99`), which does not match a file one directory down; `src/config/factory-defaults-manifest.js:61 isConfigBackupEntry` tests the basename of a `config/` entry, and `backups` has no `.bak`; and `tools/eggs/live-usb/verify-iso-squashfs-excludes.sh:149` only checks `config/[^/]*` so the verifier passes. Same gap for git and Syncthing: `.gitignore:123` ignores `config/casparcg.config.bak.*` only at top level and `.stignore` has no `config/backups` line, so backups show as untracked in git and sync to peers. That is the WO-161 / WO-168 leak this script was written to prevent, moved one level down. Fix: add `config/backups/` to `.gitignore`, `.stignore`, both eggs exclude lists, and extend `isConfigBackupEntry` and the verifier regex.
- `QUALITY` scripts/backup-caspar-config.sh:35 — `HIGHASCG_CASPAR_BACKUP_KEEP` is not validated; a non-numeric value dies in the `$((KEEP + 1))` arithmetic with an unhelpful bash message. Also two runs in the same second overwrite the same `bak.<epoch>`. Harmless for a manual tool.

## scripts/cg-studio-run.js
- `QUALITY` scripts/cg-studio-run.js:26-40 — the promise from `startStudioServer` has no `.catch`. Failing case: port 4300 already in use (`npm run cg-studio` twice, or beside the launcher) → `server.on('error', reject)` → unhandled rejection with a raw stack trace instead of a one-line message. Live: `package.json:35` (`npm run cg-studio`) and `docs/MODULES.md:172`. Imports verified: `configure`, `startStudioServer`, `resolveStudioPort` all exist in `src/cg-studio/`; `template/` exists.

## scripts/clean-eggs-dev-host.sh
- `OK` — forwarder to `scripts/eggs/clean-eggs-dev-host.sh`; live: `package.json:18` (`clean:eggs-host`).

## scripts/dev-push.sh
- `OK` — forwarder to `scripts/deploy/dev-push.sh`; live: `package.json:17` (`deploy:dev`).

## scripts/disable-nvidia-multi-driver-boot.sh
- `OK` — forwarder to `scripts/nvidia/disable-nvidia-multi-driver-boot.sh` (exists). Live callers by the root path: `tools/eggs/live-usb/build-highascg-egg.sh:51`, `tools/eggs/live-usb/audit-eggs-clone-host.sh:94`. Do not delete the forwarder without repointing these.

## scripts/highascg-exfat-remount-sync.sh
- `OK` — forwarder to `scripts/exfat/highascg-exfat-remount-sync.sh`. Live callers by the root path: `tools/eggs/live-usb/build-highascg-egg.sh:192`, `work/run-eggs-produce-clone-only.sh:81`, `tools/smoke/smoke-wo724-build-restarts-caspar.test.js:29` (pins the text `highascg-exfat-remount-sync.sh" casparcg`).

## scripts/install-exfat-systemd-units.sh
- `OK` — forwarder to `scripts/exfat/install-exfat-systemd-units.sh`. Callers by the root path: `tools/eggs/live-usb/diagnose-highascg-startup.sh:70,78` and the printed hints in `scripts/exfat/*`.

## scripts/install-host-boot-branding.sh
- `OK` — forwarder to `scripts/boot/install-host-boot-branding.sh`. Callers by the root path: `scripts/setup/MANUAL_INSTALL.md:344`, the usage text inside the target (lines 8,11). `scripts/setup/11-boot-branding.sh:19` calls the `boot/` path directly.

## scripts/install.sh
- `QUALITY` scripts/install.sh:4 — forwards to `scripts/deprecated/legacy/install.sh`, so a "live" entry point depends on the deprecated tree. `tools/eggs/live-usb/EXFAT_DATA_ZERO_TOUCH.md:34` still recommends `sudo bash scripts/install.sh`. Deleting `scripts/deprecated/legacy/` (batch 052) breaks this path; repoint or retire the doc first.

## scripts/write-highascg-systemd-unit.sh
- `OK` — forwarder to `scripts/exfat/write-highascg-systemd-unit.sh`. Callers by the root path: `tools/eggs/live-usb/systemd/highascg.service.d-10-headless.conf.example:10`, the re-run hints in `scripts/exfat/install-exfat-systemd-units.sh:257` and `install-exfat-units-enable.sh:124`.
