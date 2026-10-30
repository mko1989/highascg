# tools/eggs (part 1) — sweep 29.10.2026 (batch 114)

Files: 65 · lines: 6953 · findings: 2 BUG-HIGH, 11 BUG, 3 DEAD, 36 RISK, 37 QUALITY

Context notes. `shellcheck` is not installed on the box; `bash -n` / `sh -n` pass on all 65 files. Two claims below were reproduced with throw-away scripts (scratchpad `j53-sigpipe.sh`, `j53-rc.sh`; nothing in the repo was run). Environment facts used: eggs on this box is `26.10.25-1` (dpkg.log 2026-10-25 15:03), `/usr/lib/penguins-eggs` does not exist, last ISOs were built 22/23.10 (before the eggs upgrade).

## tools/eggs/companion/dev-mode.sh
- `BUG` tools/eggs/companion/dev-mode.sh:93 — `[[ ! -e "${DEV_MODULE_LINK}" ]]` is true for a DANGLING symlink (`-e` follows links), so the script goes to `ln -s` (line 95), which fails with "File exists" and `set -e` aborts; the `elif [[ -L ]]` repair branch at 97-106 is never reached for exactly the case it exists for. Failing case: `<dev dir>/highpass-highascg` is a symlink to an old/deleted `pkg/` path → script dies on `ln -s` instead of updating the link. Fix: test `-L` first (`if [[ -L … ]]; then … elif [[ -e … ]]; then error; else create`).

## tools/eggs/companion/install-companion-module.sh
- `QUALITY` tools/eggs/companion/install-companion-module.sh:21-25 — the "No packaged … tgz found" message is unreachable: with no `*.tgz`, `ls -1t … | head -1` exits non-zero (ls status 2 under `pipefail`), so `TGZ="$(…)"` aborts the script under `set -e` at line 21 with only ls's own error. Fix: `TGZ="$(ls … 2>/dev/null | head -1 || true)"` then the `-z` test.
- `RISK` tools/eggs/companion/install-companion-module.sh:27-29 — the installed module dir is `rm -rf`'d BEFORE the tarball is extracted; if `tar` fails (truncated tgz, disk full) the box is left with no `highpass-highascg` module at all (dead Companion desk). Extract to a temp dir and swap.

## tools/eggs/companion/install-companion-service.sh
- `QUALITY` tools/eggs/companion/install-companion-service.sh:41-42 — bare `udevadm trigger` re-fires events for EVERY device on a production playout box (can re-bind USB/GPU/audio devices). Scope it: `udevadm trigger --subsystem-match=usb --action=add`. Also no header comment and mixed space/tab indentation (rest of tree uses tabs).

## tools/eggs/companion/prepare-companion-for-eggs-clone.sh
- `BUG` tools/eggs/companion/prepare-companion-for-eggs-clone.sh:47-52 — the script validates and `export`s `COMPANION_MODULE_SRC`, `MODULES_DIR`, `COMPANION_DB`, then runs `sudo -u casparcg -H bash "${MODULE_INSTALL}"`. sudo's default `env_reset` drops those exports, so install-companion-module.sh falls back to ITS defaults. Failing case: `COMPANION_MODULE_SRC=/srv/mod sudo bash prepare-companion-for-eggs-clone.sh` passes the `package.json` check (line 38) on /srv/mod but packages and installs from `/home/casparcg/companion-module-dev/…`, then reports OK. Fix: `sudo -u casparcg -H env COMPANION_MODULE_SRC=… MODULES_DIR=… COMPANION_DB=… bash …` (as reset-iso-operator-config.sh already does for HIGHASCG_ROOT).
- `RISK` tools/eggs/companion/prepare-companion-for-eggs-clone.sh:52 — Companion is never stopped first; install-companion-module.sh:36 skips the instance version-pin fix when `companion` is active (and install-iso-defaults.sh restarts it just before), so on a normal build box the pin repair is always skipped while line 66 prints "ready". Low impact only because the Companion DB is excluded from the ISO (WO-669).

## tools/eggs/live-usb/add-exfat-data-partition.sh
- `QUALITY` tools/eggs/live-usb/add-exfat-data-partition.sh:6-8,30 — usage text and comments still say `tools/live-usb/…` (the tree moved to `tools/eggs/live-usb/`, and the conf to `legacy-persistence/`).
- `QUALITY` tools/eggs/live-usb/add-exfat-data-partition.sh:86-332 — ~230 lines of embedded Python (`to_mib`, `split_fields`, `disk_mib_from_print`, `max_partition_end_mib`, sysfs scan, flag snapshot) are copy-pasted into legacy-persistence/add-union-persistence-partition.sh:85-313. One bug fix must be made twice; extract to `usb-partition-calc.py`.
- `RISK` tools/eggs/live-usb/add-exfat-data-partition.sh:377 — relies on `usb_mkfs_exfat_labeled` returning non-zero on failure; it does not (see flash-stick-common.sh:333), so a failed `mkfs.exfat` is followed by `blkid … || true` and "Done." at 381.

## tools/eggs/live-usb/apt-with-stale-eggs-repo-fallback.sh
- `RISK` tools/eggs/live-usb/apt-with-stale-eggs-repo-fallback.sh:9 — a SOURCED library sets `set -euo pipefail` in the caller's shell (every current caller already has it, but a new caller without `-e` silently gains it).
- `RISK` tools/eggs/live-usb/apt-with-stale-eggs-repo-fallback.sh:25-30 — ANY `apt-get update` failure (box simply offline, transient mirror error) renames every `/etc/apt/sources.list.d/*eggs*|*penguins*` to `.disabled-by-highascg-apt` (line 16) and nothing ever re-enables them, so later `apt upgrade penguins-eggs` silently stops working. Failing case: unplug network, run prepare → eggs repo permanently disabled. Only disable after confirming the failure names the eggs host.

## tools/eggs/live-usb/audit-eggs-clone-host.sh
- `BUG` tools/eggs/live-usb/audit-eggs-clone-host.sh:102 — `journalctl -k -b --no-pager | grep -q 'requires use of the NVIDIA open kernel modules'` under `pipefail`: `grep -q` exits at the first match while journalctl is still writing the (>64 KiB) kernel log, journalctl dies of SIGPIPE (141), the pipeline status is 141 and the `if … &&` condition is FALSE exactly when the message is present, so the "closed cuda-drivers cannot init Blackwell" failure never fires (same mechanism reproduced in scratchpad j53-sigpipe.sh). Fix: capture first (`log="$(journalctl -k -b --no-pager 2>/dev/null || true)"; grep -q … <<<"$log"`), or read the whole stream with plain `grep … >/dev/null` (no early exit).
- `RISK` tools/eggs/live-usb/audit-eggs-clone-host.sh:253-258 — the DeckLink exclude check uses `grep -qF 'lib/udev/rules.d/55-blackmagic.rules'`, a substring that also matches the working `usr/lib/udev/…` twin and the non-working bare `lib/udev/…` line alike. Under merged-usr only the `usr/` form excludes anything (WO-430), so the audit cannot tell a broken list (lib/ only) from a good one. Require `usr/lib/udev/rules.d/55-blackmagic.rules` (and `usr/lib/modules/*/updates/dkms/blackmagic*`). Related: template `exclude.list:35` `lib/live/*` has no `usr/lib/live/*` twin (not in this batch; the audit does not look for lib/-prefixed lines without a twin at all).
- `RISK` tools/eggs/live-usb/audit-eggs-clone-host.sh:102-114,268,275 — `dpkg-query -W <pkg>` exits 0 for packages in `config-files` (rc) state, so a purged-but-not-`--purge`d `cuda-drivers`/`desktopvideo` still counts as installed. Use `-f '${Status}'` + `grep -qE '(install|hold) ok installed'` as install-eggs-calamares.sh:78 does.
- `QUALITY` tools/eggs/live-usb/audit-eggs-clone-host.sh:27 — `[[ "$STRICT" == "1" ]] || true` is a no-op statement (STRICT is honoured at 288). Line 204 `… | head -1 || echo installed`: the `||` binds to `head`, never fires.

## tools/eggs/live-usb/build-highascg-egg.sh
- `BUG` tools/eggs/live-usb/build-highascg-egg.sh:138-216 — no `trap`/cleanup. After `systemctl stop highascg.service companion.service` (138) and the preflight's swap strip + WO-47 unmount, any later failure (`eggs produce` at 156, `patch-iso-squashfs-calamares.sh` 161, `verify-iso-squashfs-excludes.sh` 171, branding verify `exit 1` at 181) aborts under `set -e` before the restore block (185-216). Failing case: eggs produce exits non-zero (disk full) → HighAsCG and Companion stay stopped, host swap stays stripped, exFAT stays unmounted, `node_modules` stays pruned to prod-only (the 208-216 comment itself documents the MODULE_NOT_FOUND fallout), Caspar stays on the factory config. Fix: `trap restore_host EXIT` wrapping lines 185-216.
- `RISK` tools/eggs/live-usb/build-highascg-egg.sh:98-102 — mutates the BUILD HOST's identity/network, not just the clone: enables systemd-networkd/resolved, repoints `/etc/resolv.conf` to the resolved stub (99), writes `/etc/netplan/01-live-networkd.yaml`, and `hostnamectl set-hostname highascg-nvidia-<drv>` (102). Nothing restores the hostname after the build.
- `QUALITY` tools/eggs/live-usb/build-highascg-egg.sh:69 — bare `apt-get update` (set -e) aborts the whole build on a dead eggs repo although apt-with-stale-eggs-repo-fallback.sh exists for exactly this.
- `QUALITY` tools/eggs/live-usb/build-highascg-egg.sh:254 — points to `tools/eggs/live-usb/FLASH_AND_PERSIST.md`, which moved to `legacy-persistence/` (rg/ls: no file at the cited path).
- `QUALITY` tools/eggs/live-usb/build-highascg-egg.sh:219 — `source flash-stick-common.sh 2>/dev/null || true` hides a broken helper; the ISO sidecar/"Done. ISO:" line then silently degrade.
- `QUALITY` tools/eggs/live-usb/build-highascg-egg.sh:215 — `npm install --include=optional` here and again in build-produce-flash-stick.sh:90 (two full installs back to back when run through the wrapper).

## tools/eggs/live-usb/build-produce-flash-stick.sh
- `RISK` tools/eggs/live-usb/build-produce-flash-stick.sh:32,125-126 — default target `/dev/sda` with `-y`: the only guard downstream is `TYPE=disk`. On a box whose system/bridge disk is `sda` (SATA), `build-produce-flash-stick.sh -y` dd's the internal disk with no prompt. Add a refusal for the disk holding `/` or any mounted fs, and require `RM=1`/`TRAN=usb` unless `--force`.
- `QUALITY` tools/eggs/live-usb/build-produce-flash-stick.sh:20 — documents `NVIDIA_BRANCHES` (read nowhere; rg shows only comments/docs) while the REQUIRED `HIGHASCG_NVIDIA_DRIVER` (build-highascg-egg.sh:14) is not mentioned; `BUILD_AND_FLASH.md:73` repeats the stale `NVIDIA_BRANCHES="535 580 595"` invocation, which exits 1.

## tools/eggs/live-usb/calamares-l10n-helper.sh
- `OK`

## tools/eggs/live-usb/calamares-logs-helper.sh
- `OK`

## tools/eggs/live-usb/calamares-nomodeset-helper.sh
- `OK`

## tools/eggs/live-usb/calamares-session-log-rescue.sh
- `OK`

## tools/eggs/live-usb/create-operator-stick-from-dd.sh
- `RISK` tools/eggs/live-usb/create-operator-stick-from-dd.sh:47-55,90-98 — the only target validation is "is a block device" + `TYPE=disk`. Nothing refuses the disk that holds `/` (e.g. `/dev/nvme0n1`) or a non-removable disk, and `-y` skips the prompt entirely (build-produce-flash-stick passes it). A wrong `/dev/…` argument is an unrecoverable overwrite of the playout box.
- `RISK` tools/eggs/live-usb/create-operator-stick-from-dd.sh:57-62 — `find_latest_iso` picks the newest `*.iso` by mtime and never checks for the `.sha256` sidecar that build-highascg-egg.sh:225-235 (WO-462) declares to be the only "safe to copy" signal; run standalone during the tail of a build (inject/patch still repacking) it dd's a torn image.
- `QUALITY` tools/eggs/live-usb/create-operator-stick-from-dd.sh:167 — `timeout 15 "$PARTED" … | grep -qi esp` under `pipefail` can report a false "no ESP flag" when grep exits before parted finishes writing (SIGPIPE → 141 → `!` true).

## tools/eggs/live-usb/diagnose-exfat-volumes.sh
- `OK`

## tools/eggs/live-usb/diagnose-highascg-startup.sh
- `OK`

## tools/eggs/live-usb/discover-recovery-sources.sh
- `DEAD` tools/eggs/live-usb/discover-recovery-sources.sh:1 — whole file unreferenced. grep: `rg -l "discover-recovery-sources" . --glob '!node_modules'` → only the sweep batch list; not in package.json, tools/, scripts/, docs/, .github/, work-orders or RECOVER_DESTROYED_USR.md (which inlines the same `echo /home/eggs/…` probes). Either wire it into the recovery doc or delete.

## tools/eggs/live-usb/eggs-kernel-lib.sh
- `RISK` tools/eggs/live-usb/eggs-kernel-lib.sh:5-9,29 — `dpkg -l 'linux-image-[0-9]*-generic'` exits 1 when nothing matches (e.g. a host running only `-lowlatency`/`-nvidia` flavours); with the caller's `pipefail`+`set -e`, `KVER="$(highascg_latest_installed_kernel)"` aborts there, so the intended fallback `[[ -n "$KVER" ]] || KVER="$running"` (line 32) is dead for exactly that case. Append `|| true` inside the function.
- `QUALITY` tools/eggs/live-usb/eggs-kernel-lib.sh:13 — comment "playout host must stay on 6.8.0-117" is stale (box runs 26.04 / kernel 7.0.x).

## tools/eggs/live-usb/eggs-liveroot-safety.sh
- `BUG-HIGH` tools/eggs/live-usb/eggs-liveroot-safety.sh:55-58 — the guard meant to stop anyone from `rm`/`umount`-ing a liveroot that bind-mounts the LIVE /usr fails open. `eggs_liveroot_list_host_bind_mounts … | "$GREP" -q .` runs under `set -o pipefail` (line 9): `grep -q` exits at the first line, the lister is still printing, gets SIGPIPE (141), the pipeline's status is 141, and `if eggs_liveroot_has_host_bind_mounts` is FALSE although mounts exist. Reproduced with a stand-in lister (scratchpad j53-sigpipe.sh, 200 runs each): 3 mounts → detected 199/200, 20 mounts → 4/200, 200 mounts → 0/200. A real clone liveroot has dozens of bind mounts, so the check reports "safe" almost every time. Callers: build-highascg-egg.sh:36, pre-produce-preflight.sh:29, audit-eggs-clone-host.sh:40 and `eggs_liveroot_assert_safe_for_mutation` (87) used by work/run-eggs-*.sh. The reboot-per-produce habit (WO-464) is the only remaining protection. Fix: `out="$(eggs_liveroot_list_host_bind_mounts "$root" 2>/dev/null || true)"; [[ -n "$out" ]]` (no pipe, no `-q`). Same failure if `prereq_check` returns 1 (the `2>/dev/null` swallows it and the function reports "no mounts").
- `RISK` tools/eggs/live-usb/eggs-liveroot-safety.sh:9,12 — sourcing this file replaces the CALLER's `PATH` with a fixed list (drops `/snap/bin`, nvm/`~/.local/bin`, any custom node location) and turns on `set -euo pipefail` in the caller. build-highascg-egg.sh and pre-produce-preflight.sh run all later steps (npm, node, eggs) with that PATH. Scope the PATH override to the functions (`local PATH=…`) or use the absolute-path vars already defined.

## tools/eggs/live-usb/ensure-dist-web-for-stick-seed.sh
- `OK`

## tools/eggs/live-usb/ensure-empty-live-usb-dirs.sh
- `QUALITY` tools/eggs/live-usb/ensure-empty-live-usb-dirs.sh:16 — `chown -R` over the whole `…/highascg/media` tree (the show media library, possibly multi-TB, plus any mounted bridge/exFAT) on every prepare; only the directory skeleton needs ownership (`chown` the 3 stub dirs). Indented with 2 spaces unlike the rest of the tree.

## tools/eggs/live-usb/ensure-iso-grub-gfx-theme.sh
- `OK`

## tools/eggs/live-usb/etc-initramfs-tools-hooks-highascg-nvidia.sh
- `BUG` tools/eggs/live-usb/etc-initramfs-tools-hooks-highascg-nvidia.sh:21-26 — `modinfo -n "$mod"` has no `-k "$version"`, so it resolves against the RUNNING kernel; the guard `case "$kmod" in /lib/modules/${version}/*)` then returns early whenever `KERNELVERSION` (the kernel the initrd is being built for) differs from `uname -r`. build-highascg-egg.sh/eggs-kernel-lib.sh explicitly support that case (pinned kernel, or newest installed ≠ running). Failing case: running 7.0.0-38, ISO kernel 7.0.0-40 → `copy_kmod_file` is a silent no-op, so the `.ko.zst` copy this hook exists for (header comment) never happens, only `manual_add_modules` remains. Fix: `modinfo -k "$version" -n "$mod"`. Also accept a `/usr/lib/modules/${version}/*` path in the `case` (merged-usr), or it rejects such output too.

## tools/eggs/live-usb/etc-initramfs-tools-hooks-highascg-storage.sh
- `BUG` tools/eggs/live-usb/etc-initramfs-tools-hooks-highascg-storage.sh:20-25 — same defect as the nvidia hook (`modinfo -n` without `-k "$version"` + `/lib/modules/${version}/*` guard): nvme/vmd/ahci `.ko.zst` are not copied when the ISO kernel differs from the running one, and Calamares then sees no internal disk. Fix as above.

## tools/eggs/live-usb/etc-initramfs-tools-hooks-highascg.sh
- `OK`

## tools/eggs/live-usb/finalize-boot-branding-for-eggs-produce.sh
- `RISK` tools/eggs/live-usb/finalize-boot-branding-for-eggs-produce.sh:25 — (consequence of the BUG-HIGH in install-eggs-live-grub-theme.sh) runs that script, which hard-exits when `/usr/lib/penguins-eggs/addons/eggs/theme/livecd` is missing (install-eggs-live-grub-theme.sh:21,28-31). With the eggs now installed on this box (26.10.25-1, upgraded 2026-10-25; theme moved to `/etc/penguins-eggs.d/branding.default/`) that dir does not exist, so build-highascg-egg.sh dies at line 122, i.e. after the ~5 min prepare has already mutated the host. See the install-eggs-live-grub-theme.sh entry.
- `RISK` tools/eggs/live-usb/finalize-boot-branding-for-eggs-produce.sh:32,51 — the "splash is still the stock eggs penguins" guard compares against `/usr/lib/penguins-eggs/addons/eggs/theme/livecd/splash.png`; with the file gone (eggs 26.10.25) the `[[ -f "$EGGS_PENGUINS" ]] &&` short-circuits and the guard is a silent no-op. Same stale path in verify-iso-boot-branding.sh:51 (other batch).

## tools/eggs/live-usb/finish-operator-stick.sh
- `RISK` tools/eggs/live-usb/finish-operator-stick.sh:63-67,119 — destructive (parted `rm` of partitions, mkpart, mkfs) with NO confirmation and weaker validation than create-operator-stick-from-dd.sh: only `-b`, no `TYPE=disk`, no removable/system-disk refusal. prune-operator-data-partitions.sh:97 removes any partition that is `LABEL=HIGHASCGEXF|persistence` OR `TYPE=exfat` (slot 1 and ESP excepted), so `finish-operator-stick.sh /dev/nvme1n1` against the bridge disk (exFAT `HIGHASCGDAT`, slot ≥2) deletes the media library partition. (`/dev/nvme*` partitions are not matched by the `[0-9]*` glob, so NVMe is spared by accident, but SATA bridge disks are not.)
- `RISK` tools/eggs/live-usb/finish-operator-stick.sh:128-135 — the seed mount at `/tmp/highascg-exfat-seed.XXXXXX` is only unmounted on the success path (no trap); a failure in strip-legacy/seed leaves the stick mounted there and the `rmdir` never runs.

## tools/eggs/live-usb/fix-calamares-branding.sh
- `OK`

## tools/eggs/live-usb/fix-calamares-shellprocess.sh
- `RISK` tools/eggs/live-usb/fix-calamares-shellprocess.sh:112-120 — the `release_bridge` instance is inserted with a hard-coded 2-space indent (`  - id:`). eggs' own template `/etc/penguins-eggs.d/distros/noble/calamares/settings.yaml` uses column-0 items (`- id:       mkinitramfs`). If eggs generates `/etc/calamares/settings.conf` from that file, the result is an indent-2 item followed by indent-0 items = YAML parse error and Calamares will not start (the krill/settings.conf template uses indent 2, which is what WO-721 was verified against). Detect the indent of the existing first item (or of the first line after `instances:`) and reuse it; the settings check in patch-iso-squashfs-calamares.sh:83 only greps, it never parses.
- `QUALITY` tools/eggs/live-usb/fix-calamares-shellprocess.sh:215 — `cleanup.sh` source path `/usr/lib/penguins-eggs/conf/distros/noble/…` no longer exists with eggs 26.10.25 (moved to `/etc/penguins-eggs.d/distros/noble/calamares/calamares-modules/cleanup/cleanup.sh`); the `[[ -f ]]` guard turns this into a silent skip (harmless today only because `/usr/sbin/cleanup.sh` is already installed).
- `QUALITY` tools/eggs/live-usb/fix-calamares-shellprocess.sh:194-195 — installs `calamares-nomodeset-helper.sh` as `calamares-nomodeset.sh` into `/usr/libexec/calamares` (this matches eggs' `shellprocess@nomodeset`), but scripts/README.md:213 says `/usr/sbin/calamares-nomodeset.sh`.

## tools/eggs/live-usb/flash-stick-common.sh
- `BUG` tools/eggs/live-usb/flash-stick-common.sh:322-333 — `rc=$?` is read AFTER the `fi` of `if mkfs.exfat …; then return 0; fi`; an `if` whose condition failed and which had no else branch exits 0, so `rc` is always 0 and `return "$rc"` at 333 reports SUCCESS after the "exFAT format fail" message. Reproduced (scratchpad j53-rc.sh: `rc=0 ret=0`). Failing case: mkfs.exfat fails twice (device busy) and the label check at 327 is false → the function returns 0 → add-exfat-data-partition.sh:377 continues to "Done." with an unformatted partition. Fix: `if mkfs.exfat …; then return 0; else rc=$?; fi`.
- `BUG` tools/eggs/live-usb/flash-stick-common.sh:43-50 — `lsblk -dnrpo PATH,TRAN,RM` prints an empty TRAN as a doubled space and `read -r path tran rm` (default IFS) collapses it, so `/dev/sdb␣␣1` parses as tran=`1`, rm=empty. A removable disk without a transport string (card reader, some bridges) is never offered as a candidate (47-48); only the all-disks fallback (51-59) lists it, and only if NO other usb/removable disk exists. Parse with `IFS=$'\x20'`-aware tools (`lsblk -P` or `--json`).
- `QUALITY` tools/eggs/live-usb/flash-stick-common.sh:158-159 — the "written:" progress reads cumulative sectors-written from `/sys/block/<dev>/stat` (counted since boot), not a delta; a second flash in the same boot (or the exFAT mkfs after dd) shows more than the ISO size.
- `QUALITY` tools/eggs/live-usb/flash-stick-common.sh:190-195 — waits for `${dev}2|3|4`; for `mmcblk`/`nvme` style names the node is `${dev}p2`, so a card-reader stick always burns the full 25 s and warns. Line 22: the second test `"${prefix}_"*` is subsumed by the first.
- `RISK` tools/eggs/live-usb/flash-stick-common.sh:170-173 — `set +e … set -e` unconditionally turns errexit ON in the caller even if the caller had it off (e.g. preview-live-iso-qemu.sh sources this file); use `local`-style save/restore (`[[ $- == *e* ]]`).

## tools/eggs/live-usb/inject-iso-boot-branding.sh
- `DEAD` tools/eggs/live-usb/inject-iso-boot-branding.sh:106-109 — the `elif [[ -f "$SPLASH" ]]` branch references an undefined `$SPLASH` (would die on `set -u`) and is unreachable: line 41 already exits when `$SPLASH_PNG` is not a file, so the `if [[ -f "$SPLASH_PNG" ]]` at 103 is always true. grep: `rg -n "SPLASH\b" tools/eggs/live-usb/inject-iso-boot-branding.sh` → only these uses (SPLASH_JPG/SPLASH_PNG are the defined ones).
- `RISK` tools/eggs/live-usb/inject-iso-boot-branding.sh:140 — `modinfo nvidia_drm` is evaluated for the running kernel, while the initrd is built for the eggs.yaml `$KVER` (line 59); a mismatched running kernel can wrongly skip (or include) install-plymouth-nvidia-initramfs.sh.
- `QUALITY` tools/eggs/live-usb/inject-iso-boot-branding.sh:154-157 — if the `-V highascg ` rewrite misses (eggs changes its mkisofs line) the script goes on and prints "OK" with the lowercase volume id; no check of the resulting ISO label.

## tools/eggs/live-usb/install-eggs-calamares.sh
- `QUALITY` tools/eggs/live-usb/install-eggs-calamares.sh:80,166 — `$(calamares --version | head -1 || echo calamares)`: the `||` binds to `head`, never to calamares, so a failing `--version` prints an empty string. Otherwise OK.

## tools/eggs/live-usb/install-eggs-live-grub-theme.sh
- `BUG-HIGH` tools/eggs/live-usb/install-eggs-live-grub-theme.sh:21-31 — hard requirement `[[ -d /usr/lib/penguins-eggs/addons/eggs/theme/livecd ]]` or `exit 1`. penguins-eggs 26.10.25-1 (installed here 2026-10-25, `dpkg -L penguins-eggs`) ships no `/usr/lib/penguins-eggs` at all; the stock theme now lives in `/etc/penguins-eggs.d/branding.default/{livecd,applications,artwork,calamares}` and Calamares templates in `/etc/penguins-eggs.d/distros/noble/calamares/`. Failing case: `sudo HIGHASCG_NVIDIA_DRIVER=595 bash build-highascg-egg.sh` → prepare (skips branding via HIGHASCG_SKIP_BOOT_BRANDING_IN_PREPARE) → finalize-boot-branding-for-eggs-produce.sh:25 → this script prints "penguins-eggs livecd theme not found … install eggs first." and exits 1; every produce on this host is blocked until fixed (workaround today: `EGGS_LIVECD=/etc/penguins-eggs.d/branding.default/livecd EGGS_THEME=/etc/penguins-eggs.d/branding.default`). The last ISOs on disk are 22/23.10, i.e. built before the upgrade, so nothing has exercised this yet. Fix: probe both locations. Same stale prefix at verify-eggs-prepare-host.sh:22 and verify-iso-boot-branding.sh:51 (other batches).
- `QUALITY` tools/eggs/live-usb/install-eggs-live-grub-theme.sh:2 — header says "(persistence default)" and line 106 mentions "no union persistence"; persistence is retired.

## tools/eggs/live-usb/install-exfat-sync-map.sh
- `OK`

## tools/eggs/live-usb/install-fb-corner-throbber.sh
- `QUALITY` tools/eggs/live-usb/install-fb-corner-throbber.sh:27-35 — `apt-get install gcc/ffmpeg` without `apt-get update` and without the stale-eggs-repo helper. Line 71: `frame_w/frame_h` keep only the LAST frame's size, the unit passes one `-w -h` for all frames (assumes uniform PNG sizes; not verified).

## tools/eggs/live-usb/install-grub-for-calamares-iso.sh
- `OK`

## tools/eggs/live-usb/install-highascg-plymouth-theme.sh
- `QUALITY` tools/eggs/live-usb/install-highascg-plymouth-theme.sh:30 — bare `apt-get install` (no `update`, no stale-repo fallback) although the helper exists. prepare-branding-assets.sh is invoked here AND from install-eggs-live-grub-theme, finalize, inject, and install-fb-corner-throbber (5x per build), each re-running ffmpeg/ImageMagick over all 30 frames.

## tools/eggs/live-usb/install-initramfs-eggs-build-conf.sh
- `RISK` tools/eggs/live-usb/install-initramfs-eggs-build-conf.sh:17-21 — `export FSTYPE=ext4` in `/etc/initramfs-tools/conf.d` is global: it applies to every `update-initramfs` on the build host and, because `/etc` is cloned, to the ISO and every Calamares-installed system. An installed system whose root is btrfs/xfs builds its initrd with the ext4 fsck assumption. Scope it to the ISO build only (env var on the mkinitramfs call) instead of a persistent conf.

## tools/eggs/live-usb/install-iso-defaults.sh
- `RISK` tools/eggs/live-usb/install-iso-defaults.sh:68-75 — `restore_after_build` (restarts highascg/companion/casparcg) runs BEFORE `npm prune --omit=dev --omit=optional`, so the prune deletes `exceljs`, `naudiodon`, `three` (package.json optionalDependencies) and devDeps from the tree a live, just-restarted highascg is serving; a lazy `require` of one of them fails until the post-produce `npm install`. Move the restore after the prune.
- `QUALITY` tools/eggs/live-usb/install-iso-defaults.sh:13 — `HERE` from `$0` (other scripts use `BASH_SOURCE[0]`); `source`-ing breaks it.

## tools/eggs/live-usb/install-kernel-headers-for-dkms-iso.sh
- `BUG` tools/eggs/live-usb/install-kernel-headers-for-dkms-iso.sh:24-27 — picks headers for `uname -r` (or the pin), but the ISO kernel is chosen by `highascg_resolve_eggs_kernel` (newest installed `linux-image-*-generic` unless pinned). Line 18 sources eggs-kernel-lib.sh and never calls it. Failing case: no `/etc/highascg/pinned-kernel` (build-highascg-egg.sh:63-65 treats that as a WARN path), running 7.0.0-38, 7.0.0-40 installed → eggs ISO boots 7.0.0-40, headers for -38 are baked, DeckLink/NVIDIA DKMS on the installed system finds no headers for the running kernel. Fix: `highascg_resolve_eggs_kernel; KVER=$KVER`. Line 18 sources eggs-kernel-lib.sh but this file never calls anything from it (no `highascg_resolve_eggs_kernel`/`highascg_latest_installed_kernel`; it re-implements the pin logic at 25-27).
- `RISK` tools/eggs/live-usb/install-kernel-headers-for-dkms-iso.sh:39 — `apt-mark hold` on the headers is persisted on the production box and cloned into the ISO with no counterpart release.

## tools/eggs/live-usb/install-plymouth-nvidia-initramfs.sh
- `QUALITY` tools/eggs/live-usb/install-plymouth-nvidia-initramfs.sh:33-45 — `modinfo` checks the running kernel (not eggs KVER) and the module names are appended permanently to the host's `/etc/initramfs-tools/modules` (also cloned into installed systems, including ones with an AMD/Intel GPU); never removed.

## tools/eggs/live-usb/install-storage-drivers-for-iso.sh
- `RISK` tools/eggs/live-usb/install-storage-drivers-for-iso.sh:18-26 — `linux-modules-extra-$(uname -r)` is installed for the RUNNING kernel, not the eggs/pinned KVER; if they differ, the ISO kernel lacks `vmd`/extra storage modules (the Calamares "no partition available" symptom this script exists to prevent).
- `QUALITY` tools/eggs/live-usb/install-storage-drivers-for-iso.sh:22,79-87 — bare `apt-get update` (no stale-repo fallback); `found` is incremented but never read; `scsi_transport_sas` is in STORAGE_MODS (→ `/etc/initramfs-tools/modules`) but not in the `modules.d` conf at 44-50.

## tools/eggs/live-usb/legacy-persistence/add-union-persistence-partition.sh
- `QUALITY` tools/eggs/live-usb/legacy-persistence/add-union-persistence-partition.sh:10-12,37,242 — stale `tools/live-usb/…` paths; 230 lines of Python duplicated with add-exfat-data-partition.sh (see that entry). Correctly gated by `HIGHASCG_LEGACY_UNION_PERSIST=1` (44-49).

## tools/eggs/live-usb/legacy-persistence/build-flash-and-persist.sh
- `DEAD` tools/eggs/live-usb/legacy-persistence/build-flash-and-persist.sh:37,149-156 — `DO_PERSIST` is initialised `false` and no option ever sets it `true` (`--no-persist` only sets false). grep: `rg -n "DO_PERSIST" tools` → only this file (the `work/deprecated/tools/build-operator-stick.sh` hit is a different script). So `--dry-run-persist`, `PERSIST_SCRIPT`, lines 149-156, and the "persistence" wording at 133/170 (printed "Boot GRUB → Live with persistence" after an exFAT-only flash) are dead/misleading.
- `QUALITY` tools/eggs/live-usb/legacy-persistence/build-flash-and-persist.sh:5,20,171 — stale `tools/live-usb/` path, `NVIDIA_BRANCHES` (unread), and `tools/eggs/live-usb/FLASH_AND_PERSIST.md` (file lives in legacy-persistence/).

## tools/eggs/live-usb/legacy-persistence/flash-iso-conf-lib.sh
- `QUALITY` tools/eggs/live-usb/legacy-persistence/flash-iso-conf-lib.sh:2 — stale `tools/live-usb/flash-iso.conf` path in the header. Parser itself is fine.

## tools/eggs/live-usb/legacy-persistence/flash-iso-from-config.sh
- `QUALITY` tools/eggs/live-usb/legacy-persistence/flash-iso-from-config.sh:116 — `status=progress oflag=sync conv=fsync`, which flash-stick-common.sh:127 documents as hanging on USB; stale `tools/live-usb/` paths at 5-8, doc path at 20.
- `RISK` tools/eggs/live-usb/legacy-persistence/flash-iso-from-config.sh:92-102 — only `TYPE=disk` + size check; no refusal of the disk holding `/` (confirm prompt is the only guard).

## tools/eggs/live-usb/legacy-persistence/prune-hybrid-data-partitions.sh
- `RISK` tools/eggs/live-usb/legacy-persistence/prune-hybrid-data-partitions.sh:23-26,95-102 — removes EVERY non-ESP partition whose start is ≥ the data band (512 MiB when no ISO path is given) on whatever device is passed; no TYPE=disk/removable/`-b` check at all (`DEV="${1:?}"` is used directly). Called from finish-operator-stick.sh:85 with the same minimal validation.

## tools/eggs/live-usb/merge-penguins-eggs-exclude-highascg.sh
- `OK`

## tools/eggs/live-usb/pack-bridge-starter-zip.sh
- `QUALITY` tools/eggs/live-usb/pack-bridge-starter-zip.sh:27-42 — the `zip`/python-zipfile fallback block is byte-identical to pack-exfat-starter-zip.sh:49-64. Otherwise OK (all `.gitkeep` target dirs are created by seed-bridge-operator-layout.sh:10-19).

## tools/eggs/live-usb/pack-exfat-starter-zip.sh
- `QUALITY` tools/eggs/live-usb/pack-exfat-starter-zip.sh:49-64 — duplicate of pack-bridge-starter-zip.sh:27-42 (see there). `.gitkeep` dirs all created by seed-exfat-operator-layout.sh (which lists `projects/_autosave` twice at lines 17-18, other batch).

## tools/eggs/live-usb/patch-iso-grub-kernel-cmdline.sh
- `RISK` tools/eggs/live-usb/patch-iso-grub-kernel-cmdline.sh:25-38,50 — every rewrite is an exact-string `sed` match of one historical eggs cmdline variant; if eggs (now 26.10.25) emits a different default line, no rule matches, nothing is patched and line 50 still prints "OK: ISO kernel cmdline (default Live = full dmesg nosplash…)". Add a post-patch `grep -q 'nosplash'`/`nvidia-drm.fbdev=1` assertion per file.
- `QUALITY` tools/eggs/live-usb/patch-iso-grub-kernel-cmdline.sh:24 — `cp -a f f.bak.highascg` writes the backups INTO the ISO staging tree (`boot/grub/`, `isolinux/`, `EFI/ubuntu/`), so they are repacked into the ISO; a second run overwrites the backup with the already-patched file.

## tools/eggs/live-usb/patch-iso-squashfs-calamares.sh
- `RISK` tools/eggs/live-usb/patch-iso-squashfs-calamares.sh:48-55 — reuse decision is only "`${WORK}/etc/os-release` exists"; the unpacked tree is not tied to the squashfs being patched. If a previous build's `/home/eggs/mnt/squashfs-calamares-patch-root` survives (it exists now, left from the last produce), `mksquashfs "$WORK"` (61) overwrites the FRESH squashfs with the OLD OS tree (old server, old BUILD_STAMP, old config). Only eggs' own mnt cleanup at produce time prevents it today. Compare mtimes/stamp or always re-unpack (or `rm -rf` after use).
- `QUALITY` tools/eggs/live-usb/patch-iso-squashfs-calamares.sh:44 — the double-quoted message `($HIGHASCG_FORCE_SQUASHFS_UNPACK=1)` expands the variable (prints `(1=1)`); escape the `$`.
- `RISK` tools/eggs/live-usb/patch-iso-squashfs-calamares.sh:59-66 — `SQ_NEW` (several GiB) lives next to the live squashfs in the ISO staging dir; a failed `mksquashfs` leaves it there (no trap), and a later `inject-iso-boot-branding.sh` repack would carry it into the ISO.

## tools/eggs/live-usb/pause-heavy-services-for-iso-build.sh
- `RISK` tools/eggs/live-usb/pause-heavy-services-for-iso-build.sh:30-31 — `systemctl start "$unit" 2>/dev/null || true` followed by `rm -f "$f"`: if the start fails the marker is deleted anyway, so the unit stays down with no record and no message. Only delete the marker on success and report failure.

## tools/eggs/live-usb/pre-produce-preflight.sh
- `RISK` tools/eggs/live-usb/pre-produce-preflight.sh:29 — the whole liveroot safety gate rests on `eggs_liveroot_has_host_bind_mounts`, which fails open (eggs-liveroot-safety.sh:57, BUG-HIGH above). The `eggs_liveroot_produce_in_progress` check at 23 uses `pgrep -f 'eggs produce|…'`, which also matches any shell whose command line merely contains "eggs produce" (e.g. `bash -c '… eggs produce …'` wrapper) and refuses a legitimate run.

## tools/eggs/live-usb/prepare-branding-assets.sh
- `OK`

## tools/eggs/live-usb/prepare-eggs-clone-with-exfat.sh
- `QUALITY` tools/eggs/live-usb/prepare-eggs-clone-with-exfat.sh:110 — `chown -R` over the full media library on every prepare (see ensure-empty-live-usb-dirs.sh); `SKIP_STRIP_HOST_SWAP` (line 52) is assigned and never used; line 73 still says "persistence on default boot entry".
- `RISK` tools/eggs/live-usb/prepare-eggs-clone-with-exfat.sh:105 — seeds the operator layout into `/home/casparcg/exfat` without checking whether a real HIGHASCGEXF stick is mounted there (it then writes starter files onto the operator's stick).

## tools/eggs/live-usb/preview-live-iso-qemu.sh
- `OK`

## tools/eggs/live-usb/preview-plymouth-boot-branding.sh
- `OK`

## tools/eggs/live-usb/prune-exfat-partition-only.sh
- `RISK` tools/eggs/live-usb/prune-exfat-partition-only.sh:106 — `parted_num_for_start(sysfs_start(part) or 0)`: an unreadable sysfs start (None) is coerced to 0, and `parted_num_for_start` matches any parted row whose start is within 64 sectors of 0 (line 91), i.e. the hybrid-ISO boot partition 1; the exFAT slice is then "identified" as partition 1 and `parted rm 1` (114) removes the ISO. Unlike prune-operator-data-partitions.sh:119 there is no "skip slot 1" guard. Skip the partition when `sysfs_start` is None, and refuse num==1. Also no `-b "$DEV"` check (unlike its sibling).

## tools/eggs/live-usb/prune-operator-data-partitions.sh
- `RISK` tools/eggs/live-usb/prune-operator-data-partitions.sh:97 — selection is `LABEL in (HIGHASCGEXF, persistence) or TYPE == exfat`; on a disk that is not the stick (the internal bridge disk is exFAT `HIGHASCGDAT`) its partitions are `parted rm`'d (skips only slot 1/ESP). No TYPE=disk/removable check; see finish-operator-stick.sh entry. Glob `{dev}[0-9]*` (93) never matches `nvme0n1p1`/`mmcblk0p1`, so non-sd devices are silently a no-op.

## tools/eggs/live-usb/recover-display-after-plymouth.sh
- `OK`

## tools/eggs/live-usb/recover-host-usr-from-eggs-artifact.sh
- `BUG` tools/eggs/live-usb/recover-host-usr-from-eggs-artifact.sh:66-73 — `[[ -n "$f" && -f "$f" ]] || continue` runs BEFORE the glob loop (`for g in $f`), and a quoted glob inside `[[ -f ]]` is never expanded, so every wildcard candidate (`/home/eggs/mnt/highascg-nvidia-595_amd64_*.iso`, `/home/eggs/*.iso`, `/home/eggs/mnt/*.iso`) is skipped; lines 68-73 are dead for them (the comment at 67 even states the glob does not expand). Failing case: only `/home/eggs/highascg-nvidia-595_amd64_2026-10-23_1555.iso` survives (no `mnt/iso/live/filesystem.squashfs`) → "ERROR: no squashfs, ISO, or liveroot/usr" in the very emergency this tool is for. Fix: drop the `-f` from the line-66 test and test `-f "$g"` in the inner loop (with `shopt -s nullglob`).
- `BUG` tools/eggs/live-usb/recover-host-usr-from-eggs-artifact.sh:32-36,160 — in busybox mode `MKDIR()` is `"$BB" mkdir "$@"` (no `-p`, unlike the non-busybox variant at 41). `restore_tree` calls `MKDIR /usr` (160); the wiped system still HAS an empty `/usr` (and `/bin`/`/lib` symlinks), so busybox `mkdir` fails "File exists" and `set -e` aborts before copying anything — the exact scenario in the file header (no `/bin/mount`). Fix: `MKDIR() { "$BB" mkdir -p "$@"; }`.
- `RISK` tools/eggs/live-usb/recover-host-usr-from-eggs-artifact.sh:112-114,176 — in liveroot-staging mode `SQ_MNT=/home/eggs/liveroot` and line 176 runs `UMOUNT "$SQ_MNT"` on it, contradicting the file's own "NEVER umount/rm liveroot" rule (RECOVER_DESTROYED_USR.md); skip the unmount when `SQ_MNT` is the liveroot.
- `QUALITY` tools/eggs/live-usb/recover-host-usr-from-eggs-artifact.sh:83,184 — completeness threshold 2500 MiB differs from inject (2000) / create-operator-stick (1500); post-recovery hint names `scripts/setup/02-verify-kernel-117.sh` and hard-codes `…-595_…` globs.

## tools/eggs/live-usb/repair-stick-exfat-only.sh
- `QUALITY` tools/eggs/live-usb/repair-stick-exfat-only.sh:29-41 — no `-b`/whole-disk validation and no confirmation; it forwards straight to finish-operator-stick.sh (whose own validation is minimal, see that entry). Thin wrapper; only referenced from EXFAT_DATA_ZERO_TOUCH.md.

## tools/eggs/live-usb/reset-iso-operator-config.sh
- `RISK` tools/eggs/live-usb/reset-iso-operator-config.sh:56-60 — `find "${EXFAT_ROOT}/configs" … -exec rm -rf {} +` and the `drop-config` rm run with no mount-point check. build-highascg-egg.sh:105 (and install-iso-defaults.sh:24 via prepare) run this BEFORE pre-produce-preflight unmounts WO-47 volumes (118); if a real HIGHASCGEXF stick is mounted at `~/exfat`, the operator's `configs/` on the stick is deleted. (A reset of the build host's own config is the documented intent; wiping a mounted external volume is not.) Guard with `findmnt -n "$EXFAT_ROOT"` → skip/refuse.
- `QUALITY` tools/eggs/live-usb/reset-iso-operator-config.sh:46 — the host's `.env` is overwritten from `.env.example` with no backup (bootstrapped by design, but build-highascg-egg.sh restores only Caspar config via exfat sync).

## tools/eggs/live-usb/seed-bridge-operator-layout.sh
- `OK`
