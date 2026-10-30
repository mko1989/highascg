# scripts/deprecated — sweep 29.10.2026 (batch 052)

Files: 30 · lines: 2682 · findings: 0 BUG-HIGH, 17 BUG, 20 DEAD, 6 RISK, 6 QUALITY

How references were checked: `grep -rIn <basename>` over the whole repo (excluding `node_modules`, `.git`, `dist-web`, this sweep dir) for every file, plus the `scripts/setup`, `scripts/fix`, `tools/eggs`, `package.json`, `.github` trees. Only `work/` WOs/docs and `scripts/README.md` / `scripts/deprecated/README.md` text mention most of these. `tools/eggs/live-usb/penguins-eggs-exclude-highascg-embed-server.list:30-31` excludes `scripts/deprecated` from the ISO, so none of it exists on a clone; anything outside the tree that calls into it breaks there (see `scripts/install.sh`, `scripts/fix/fix-host-boot-display-hang.sh:112`).

Cross-cutting finding: the WO-273 move into `deprecated/` never fixed the path arithmetic. Scripts in `deprecated/nvidia/` and `deprecated/unused/` compute the repo root with the depth they had before the move, so they resolve to `scripts/` (or `scripts/deprecated/`) and fail at their first `source`/`exec`. Each is listed below; `pin-kernel-6.8.0-117.sh` (one level shallower) is correct. The README's "kept for one-off recovery" is not true of these files today.

## scripts/deprecated/fix-boot-emergency-recovery.sh
- `BUG` scripts/deprecated/fix-boot-emergency-recovery.sh:3 — forwarder resolves `$(dirname)/fix/…` = `scripts/deprecated/fix/fix-boot-emergency-recovery.sh`, which does not exist (the real file is `scripts/fix/…`). `exec bash <missing>` → "No such file". Same in the next three files.
- `DEAD` scripts/deprecated/fix-boot-emergency-recovery.sh — grep `deprecated/fix-boot-emergency-recovery` → nothing; the name appears only in `scripts/README.md:97` and `docs/BOOT_EMERGENCY_RECOVERY.md:23`, both meaning `scripts/fix-boot-emergency-recovery.sh` (itself no longer present; see batch 055). Safe to delete.

## scripts/deprecated/fix-highascg-no-exfat-startup-block.sh
- `BUG` scripts/deprecated/fix-highascg-no-exfat-startup-block.sh:3 — same broken forwarder path as above.
- `DEAD` — no references (WO-143 list only). Safe to delete.

## scripts/deprecated/fix-host-boot-console-and-hang.sh
- `BUG` scripts/deprecated/fix-host-boot-console-and-hang.sh:3 — same broken forwarder path.
- `DEAD` — no references (WO-143 list only). Safe to delete.

## scripts/deprecated/fix-host-boot-display-hang.sh
- `BUG` scripts/deprecated/fix-host-boot-display-hang.sh:3 — same broken forwarder path.
- `DEAD` — no references (WO-143 list only). Safe to delete.

## scripts/deprecated/highascg-exfat-server-update.sh
- `DEAD` scripts/deprecated/highascg-exfat-server-update.sh — header (lines 2-11) already says "DEAD FORK, DO NOT RESURRECT": a regression of `scripts/exfat/highascg-exfat-server-update.sh`. grep: `tools/smoke/smoke-wo697-boot-stick.test.js:91`, `scripts/exfat/highascg-webui-server-update.sh:233` and `scripts/exfat/highascg-exfat-bootstrap.sh:3` all name the `scripts/exfat/` copy; the deprecated one has no caller. Its `SCRIPT_DIR/exfat/highascg-apply-server-drop.sh` (line 31) also points at a path that does not exist from here. Safe to delete.

## scripts/deprecated/legacy/install-phase1.sh
- `QUALITY` scripts/deprecated/legacy/install-phase1.sh:87 — `curl … | grep … | head | sed … || echo "22.0.0"`: the pipeline's status is `sed`'s, so the fallback never runs; offline, `NODE_RECOMMENDED` is empty. Moot (check_internet_connectivity ran first).
- Not safe to delete on its own: sourced by `legacy/install.sh:48`, which `scripts/install.sh` still forwards to (`tools/eggs/live-usb/EXFAT_DATA_ZERO_TOUCH.md:34` and `scripts/setup/README.md:82` still tell the operator to run it). See `scripts/install.sh` in batch 048.

## scripts/deprecated/legacy/install-phase2.sh
- `QUALITY` scripts/deprecated/legacy/install-phase2.sh:12-18 — both branches of the FFmpeg `if` run the identical `apt install -y ffmpeg libdrm2`. Line 95 (heredoc comment) names `scripts/install-phase2.sh`, a path that no longer exists.
- Sourced by `legacy/install.sh:50`; same keep/delete verdict as phase1.

## scripts/deprecated/legacy/install-phase3.sh
- `QUALITY` scripts/deprecated/legacy/install-phase3.sh:148-150 — `chmod -R 775 /home/casparcg/highascg` makes every file in the tree (data, configs, scripts) group-writable and executable; repeated at install-phase4.sh:220 and install-phase5.sh:9.
- Sourced by `legacy/install.sh:52`; same verdict as phase1.

## scripts/deprecated/legacy/install-phase4.sh
- `RISK` scripts/deprecated/legacy/install-phase4.sh:204-208 — `rsync -a` from the checkout over `/home/casparcg/highascg/` has no `config/`, `highascg.config.json` or `projects/` exclude. Failing case: running the legacy installer from a second checkout on a live box overwrites `config/*.json`, `highascg.config.json` and `projects/` with the checkout's copies.
- `RISK` scripts/deprecated/legacy/install-phase4.sh:211-215 — the clone branch runs `find /home/casparcg/highascg -mindepth 1 -maxdepth 1 -exec rm -rf {} +` (config, media, bin, lib too). It is reached only when `$SCRIPT_DIR/package.json` is missing, which `legacy/install.sh:10` makes impossible in a normal checkout, so latent.
- Sourced by `legacy/install.sh:54`; same verdict as phase1. Every path it calls exists (`scripts/polkit/*.rules`, `tools/eggs/live-usb/install-exfat-sync-map.sh`, `tools/runtime/highascg-network-apply.sh`, `scripts/runtime/install-network-apply.sh`, `scripts/exfat/*`, `scripts/nvidia/disable-nvidia-multi-driver-boot.sh`).

## scripts/deprecated/legacy/install-phase5.sh
- `BUG` scripts/deprecated/legacy/install-phase5.sh:36 — `sed -i 's/GRUB_CMDLINE_LINUX_DEFAULT=.*/GRUB_CMDLINE_LINUX_DEFAULT="consoleblank=0"/'` replaces the whole kernel command line. Failing case: a host that already has `nvidia-drm.modeset=1 nvidia-drm.fbdev=1 loglevel=7 nosplash noresume` from `scripts/boot/install-host-boot-branding.sh:90` → after the installer's last phase the line is just `consoleblank=0`; DRM modeset is gone and the GPU/Wayland-less X path changes at next boot. Phase 5 runs after phase 4 in every full install.
- `RISK` scripts/deprecated/legacy/install-phase5.sh:17-31 — `ufw --force reset` then allows only RFC1918 ranges and `tailscale0`, with no SSH rule for other sources: a box reached over a public or non-RFC1918 address is locked out by the last step.
- `QUALITY` scripts/deprecated/legacy/install-phase5.sh — the file has no shebang and no `set -e` of its own (sourced fragment); `scripts/setup/07-node-highascg.sh:86` still points at `scripts/install-phase4.sh + install-phase5.sh`, paths that do not exist.
- Sourced by `legacy/install.sh:56`; same verdict as phase1.

## scripts/deprecated/legacy/install.sh
- `OK` — paths verified (`SCRIPT_DIR` is the repo root three levels up, `scripts/lib/install-config.sh` / `install-helpers.sh` exist, phases 1-5 exist). Live entry: `scripts/install.sh:4` forwards here; `scripts/deprecated/restore-production-host.sh` also execs `scripts/install.sh`. Not safe to delete while `scripts/install.sh` and the two docs above exist; on a clone ISO the whole tree is excluded (embed-server exclude list), so `scripts/install.sh` already fails there.

## scripts/deprecated/lib/install-helpers-github.sh
- `DEAD` scripts/deprecated/lib/install-helpers-github.sh — byte-identical to `scripts/lib/install-helpers-versions.sh` except the 7-line DEPRECATED header (`diff` shows only the header and one trailing blank line). Nothing sources it (grep `install-helpers-github` → `scripts/README.md:42` and WO-120 text only; `scripts/lib/install-helpers.sh` sources the `-versions`, `-runtime`, `-binaries` files). Its header says it duplicates a "518-line monolith"; `scripts/lib/install-helpers.sh` is now a 14-line wrapper, so the comment is stale. Safe to delete.

## scripts/deprecated/lib/install-helpers-packages.sh
- `DEAD` scripts/deprecated/lib/install-helpers-packages.sh — identical to `scripts/lib/install-helpers-binaries.sh` apart from the header. No caller (grep `install-helpers-packages` → `scripts/README.md:43`, `work/godot-port/inventory/runtime-kiosk-tests.md:199`). Safe to delete.

## scripts/deprecated/lib/install-helpers-runtime.sh
- `DEAD` scripts/deprecated/lib/install-helpers-runtime.sh — identical to `scripts/lib/install-helpers-runtime.sh` apart from the header. The live file of the same name is sourced by `scripts/lib/install-helpers.sh:9`; nothing sources this copy. Safe to delete.

## scripts/deprecated/nvidia/fix-nvidia-dkms-prebuilt-conflict.sh
- `BUG` scripts/deprecated/nvidia/fix-nvidia-dkms-prebuilt-conflict.sh:16-18 — `REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." …)"` from `scripts/deprecated/nvidia/` is `scripts/`, so `source "${REPO_ROOT}/scripts/lib/apt-block-service-starts.sh"` looks for `scripts/scripts/lib/…` and `set -e` aborts. Needs `../../..`.
- References: called by `pin-kernel-6.8.0-117.sh:65` (with `|| true`) and `install-nvidia-driver-595-blackwell.sh:63`, `restore-…` chain. Deletion safe only together with those.

## scripts/deprecated/nvidia/fix-nvidia-firmware-dpkg-conflict.sh
- `BUG` scripts/deprecated/nvidia/fix-nvidia-firmware-dpkg-conflict.sh:21-23 — same `../..` repo-root error → aborts at the `source` of `apt-block-service-starts.sh`.
- `DEAD` — no caller (README list only). Safe to delete.

## scripts/deprecated/nvidia/install-nvidia-595.sh
- `BUG` scripts/deprecated/nvidia/install-nvidia-595.sh:8-13 — `REPO_ROOT` is `scripts/`; both `exec bash "${REPO_ROOT}/scripts/deprecated/nvidia/…"` targets resolve to `scripts/scripts/deprecated/…`. Always fails.
- `DEAD` — no caller (README only). Safe to delete.

## scripts/deprecated/nvidia/install-nvidia-cuda-repo-595.sh
- `BUG` scripts/deprecated/nvidia/install-nvidia-cuda-repo-595.sh:29-32 — same `../..` error; the `source` of `apt-block-service-starts.sh` fails first.
- `QUALITY` scripts/deprecated/nvidia/install-nvidia-cuda-repo-595.sh:31 — the shellcheck directive says `source=apt-block-service-starts.sh` (relative to the old location).
- References: called from `install-nvidia-595.sh`, `install-nvidia-proprietary-595.sh`, `install-nvidia-cuda-repo-open-595.sh:46`; only deprecated files. Safe to delete with the group.

## scripts/deprecated/nvidia/install-nvidia-cuda-repo-open-595.sh
- `BUG` scripts/deprecated/nvidia/install-nvidia-cuda-repo-open-595.sh:27-30 — same `../..` error.
- `DEAD` — no caller outside README. Safe to delete.

## scripts/deprecated/nvidia/install-nvidia-driver-595-blackwell.sh
- `BUG` scripts/deprecated/nvidia/install-nvidia-driver-595-blackwell.sh:17-20 — same `../..` error; also the target of `restore-gpu-working.sh:16`, `install-nvidia-595.sh:11` and `unused/fix-nodm-no-screens.sh:24`.
- `RISK` scripts/deprecated/nvidia/install-nvidia-driver-595-blackwell.sh:40-50 — purges `nvidia-persistenced`, `nvidia-modprobe`, `nvidia-settings`, `libnvidia-*`, `cuda-drivers` in one `apt-get remove --purge`; it is the closed-driver path that the README says is wrong for the Blackwell box (needs the open 595 modules), so running it on the playout host is the failure it describes.
- Safe to delete with the NVIDIA group (callers are all deprecated).

## scripts/deprecated/nvidia/install-nvidia-gsp-rpc-workaround.sh
- `OK` — works (no repo-root use). NOT safe to delete: `scripts/fix/fix-host-boot-display-hang.sh:112` calls it by this path, and three deprecated installers call it. Because `scripts/deprecated` is excluded from clone ISOs, the `fix/` caller silently loses it there (check the `-f` guard in batch 055).

## scripts/deprecated/nvidia/install-nvidia-proprietary-595.sh
- `BUG` scripts/deprecated/nvidia/install-nvidia-proprietary-595.sh:14-15 — `REPO_ROOT` wrong (`../..`), `exec` target missing.
- `DEAD` — referenced only by `restore-nvidia-595-closed-userspace.sh:39` (an error message). Safe to delete.

## scripts/deprecated/nvidia/restore-gpu-working.sh
- `QUALITY` scripts/deprecated/nvidia/restore-gpu-working.sh:16 — path is right (`$(dirname)/install-nvidia-driver-595-blackwell.sh`) but the target is broken (above), so this wrapper fails one hop later. The header (lines 2-13) promises a GSP workaround and firmware-conflict fix that the target does not run.
- `DEAD` — no caller (README only). Safe to delete.

## scripts/deprecated/nvidia/restore-nvidia-595-closed-userspace.sh
- `DEAD` scripts/deprecated/nvidia/restore-nvidia-595-closed-userspace.sh — self-contained and path-correct, but no caller (README only), and it restores the closed stack the README says breaks Blackwell. Safe to delete.

## scripts/deprecated/pin-kernel-6.8.0-117.sh
- `BUG` scripts/deprecated/pin-kernel-6.8.0-117.sh:65 — calls `fix-nvidia-dkms-prebuilt-conflict.sh … || true`; that script dies at its own `source` (path bug above), so the "Block DKMS NVIDIA" step silently does nothing and the pin continues without the DKMS block. `REPO_ROOT` here (line 18) is correct.
- `RISK` scripts/deprecated/pin-kernel-6.8.0-117.sh:88-96,128-131 — purges kernel and `linux-*-generic` meta packages and `rm -f /boot/*6.8.0-124*`. Guarded by the earlier `apt-get install` under `set -e`, but if the box is currently running a 6.8.0-124 kernel and the 117 install fails after the first purge loop there is no fallback entry.
- `DEAD` — references: `scripts/setup/README.md:66` (text), README map. Replaced by `setup/01-kernel-117.sh`. Safe to delete (with the fix-dkms script).

## scripts/deprecated/restore-production-host.sh
- `BUG` scripts/deprecated/restore-production-host.sh:19,35 — `REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"` is `scripts/`, not the repo. Failing case: `sudo HIGHASCG_NVIDIA_DRIVER=595 bash scripts/deprecated/restore-production-host.sh` → after the useradd and `chown -R "$USER_CASPAR" /home/$USER_CASPAR` have already run, `cd scripts; exec bash ./scripts/install.sh` fails with "No such file" — a partly-executed restore with an ownership rewrite and no install. Needs `../..`.
- `DEAD` — no caller (README only). Safe to delete.

## scripts/deprecated/unused/check-decklink.sh
- `BUG` scripts/deprecated/unused/check-decklink.sh:8,10 — sources `${HERE}/install-config.sh` and `install-helpers.sh`, which live in `scripts/lib/`, not `unused/` → fails immediately.
- `DEAD` — the README calls it a duplicate of `scripts/setup/check-decklink.sh` (the live one sources `../install-config.sh`, also stale, outside this batch). Safe to delete.

## scripts/deprecated/unused/fix-highascg-config-perms.sh
- `RISK` scripts/deprecated/unused/fix-highascg-config-perms.sh:9,21 — `DIR` comes from `$1` with no guard beyond "is a directory", then `chown -R`; `… fix-highascg-config-perms.sh /` re-owns the filesystem. Superseded by `scripts/exfat/highascg-fix-config-permissions.sh`.
- `DEAD` — no caller. Safe to delete.

## scripts/deprecated/unused/fix-nodm-no-screens.sh
- `BUG` scripts/deprecated/unused/fix-nodm-no-screens.sh:13,24 — `bash "${HERE}/install-nvidia-driver-595-blackwell.sh"`: that file is in `../nvidia/`, not beside this script → fails after the state printout.
- `DEAD` — no caller (README: "one-off nodm debug"). Safe to delete.

## scripts/deprecated/unused/install-passwordless-sudo.sh
- `BUG` scripts/deprecated/unused/install-passwordless-sudo.sh:4-5 — `exec bash "${SCRIPT_DIR}/../setup/12-passwordless-sudo.sh"` resolves to `scripts/deprecated/setup/…` (missing); needs `../../setup/`.
- `DEAD` — no caller (README: ad-hoc). Safe to delete.
