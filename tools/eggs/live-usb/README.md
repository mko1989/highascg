# Live USB / eggs tooling

## Production paths

| Goal | Script |
|------|--------|
| Eggs produce | `build-highascg-egg.sh` (via `work/run-eggs-produce-from-host.sh`) |
| Clone host prep | `prepare-eggs-clone-with-exfat.sh`, `pre-produce-preflight.sh`, `verify-eggs-safety.sh` |
| Flash stick (`dd`) | `create-operator-stick-from-dd.sh` |
| Finish stick (exFAT) | `finish-operator-stick.sh` |
| WO-47 unmount before produce | `stop-and-unmount-wo47-for-eggs-produce.sh` |
| Bridge / exFAT seed layout | `seed-bridge-operator-layout.sh`, `seed-exfat-operator-layout.sh` |
| ISO boot branding | `branding/`, `inject-iso-boot-branding.sh`, `patch-iso-grub-kernel-cmdline.sh` |

Host systemd units (WO-47/52): **`scripts/exfat/install-exfat-systemd-units.sh`** (installed into `/etc` before produce).

## Folders

| Folder | Contents |
|--------|----------|
| [`branding/`](branding/) | GRUB/Plymouth/fb throbber assets |
| [`systemd/`](systemd/) | Example unit fragments for docs |
| [`legacy-persistence/`](legacy-persistence/) | Old union `/` persistence — **not** production sticks |
| [`highascg-eggs-theme/`](highascg-eggs-theme/) | Eggs GRUB/isolinux theme |

## Verify / diagnose

`audit-eggs-clone-host.sh`, `verify-eggs-prepare-host.sh`, `verify-iso-squashfs-excludes.sh`, `verify-iso-boot-branding.sh`, `verify-live-stick.sh`, `diagnose-exfat-volumes.sh`, `diagnose-highascg-startup.sh`

## Docs

- [BUILD_AND_FLASH.md](BUILD_AND_FLASH.md) — operator stick workflow
- [EXFAT_DATA_ZERO_TOUCH.md](EXFAT_DATA_ZERO_TOUCH.md) — exFAT-only layout
- [MANUAL_STICK_WINDOWS_MACOS.md](MANUAL_STICK_WINDOWS_MACOS.md)
