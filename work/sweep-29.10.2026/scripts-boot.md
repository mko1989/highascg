# scripts/boot — sweep 29.10.2026 (batch 049)

Files: 3 · lines: 214 · findings: 0 BUG-HIGH, 0 BUG, 0 DEAD, 3 RISK, 3 QUALITY

## scripts/boot/install-fast-boot-network.sh
- `RISK` scripts/boot/install-fast-boot-network.sh:22-26 — writes `[connection] wait-online-timeout=15` into an NM `conf.d` file and logs "Cap NetworkManager wait-online at 15s". I could not verify that `wait-online-timeout` is a key NetworkManager.conf reads (the man page is not installed on this box, and the `[connection]` section holds default connection properties, not wait-online settings; `NetworkManager-wait-online.service` takes its timeout from `nm-online -t`). If it is not a real key, the file is a no-op and the only effective change is the networkd-wait-online mask (line 18). Worth checking on a box with NM before relying on the log message.
- `QUALITY` scripts/boot/install-fast-boot-network.sh:12-45 — unreferenced. grep `install-fast-boot-network` across the repo → only `scripts/README.md:63` and its own header. Not called by any `scripts/setup/*`, systemd unit, package.json, WO tooling or CI. Manual-only; keep or drop is an owner call.

## scripts/boot/install-host-boot-branding.sh
- `RISK` scripts/boot/install-host-boot-branding.sh:93-117 — edits `/etc/default/grub` with `sed -i` in five places and runs `update-grub` with no backup copy. Failing case: a failure in the middle (`update-grub` failing at line 120 after the edits at 93-117 leaves a modified `/etc/default/grub`) → no pristine file to restore. Idempotent on re-run, so this is a risk, not a bug.
- `QUALITY` scripts/boot/install-host-boot-branding.sh:26 — `KVER="$(uname -r)"` is never used. grep `KVER` in the file → one assignment, no reads.
Inputs checked: all exist: `tools/eggs/live-usb/{prepare-branding-assets.sh,install-fb-corner-throbber.sh,install-highascg-plymouth-theme.sh,grub-gfx-preamble.cfg,branding/splash.png,branding/splash.boot.png,highascg-eggs-theme/theme/livecd/grub.theme.cfg}` and `template/fonts/Rewir-Light.ttf`. Live caller: `scripts/setup/11-boot-branding.sh:19`.

## scripts/boot/install-nvidia-persistenced-boot-order.sh
- `RISK` scripts/boot/install-nvidia-persistenced-boot-order.sh:19-20 — the drop-in adds `After=`/`Wants=dev-nvidia0.device`. A `.device` unit exists only if udev tags the node `systemd`; nothing on this box lists a `dev-nvidia0.device`, and `/etc/systemd/system/nvidia-persistenced.service.d` is absent here, so the effect cannot be confirmed on this machine. If the device is never tagged, `Wants=` pulls in a device job that waits for its timeout, delaying `nvidia-persistenced` instead of fixing the race (the `ExecStartPre` loop at line 24 already covers the race by itself). Not proven; keep the `ExecStartPre` loop and drop the `After/Wants` pair if boots get slower.
- `QUALITY` scripts/boot/install-nvidia-persistenced-boot-order.sh:5 — usage text names the old path `scripts/install-nvidia-persistenced-boot-order.sh` (no such forwarder exists; the real path is `scripts/boot/`). Callers use the right path: `scripts/setup/03-nvidia-open-595.sh:130`, `scripts/fix/fix-host-boot-console-and-hang.sh:79`.
