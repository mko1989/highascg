# WO-832 — Post-update remnants: ISO build, kernel pin, NVIDIA, 26.04 package names

**Status: IN PROGRESS (30.10) — repo fixes done + verified offline; owner sudo commands below pending**
**Source:** REPORT §4a–4d and §7e. Owner 30.10: *"the kernel pin and the eggs theme path before the next ISO build. that
and other remnants of pre update should be fixed (nvidia etc)"*.
**Related:** WO-430, WO-431, WO-779, memory: eggs excludes vs merged-usr.

Scope:

- 4a `install-eggs-live-grub-theme.sh` points at `/usr/lib/penguins-eggs/…`; eggs 26.10.25 keeps the theme in
  `/etc/penguins-eggs.d/branding.default`, so the next produce exits 1.
- 4b the liveroot bind-mount guard fails open under pipefail.
- 4c `/etc/highascg/pinned-kernel` says 6.8.0-117, the box runs 7.0.0-38 → the owner runs the sudo command; the scripts
  must also refuse to purge the running kernel.
- 4d `08-caspar-cef-scanner.sh` stops and disables casparcg-server.
- NVIDIA remnants: the stale `/usr/local/bin/highascg-nvidia-x-apply.sh`, the third-party licence list for driver 615.
- 26.04 package names in `install.sh` (`libsfml-*2.6`, `policykit-1`).
- `findmnt -L` (not an option) in the stick test lib, test-03 and `flash-stick-common.sh:300`, plus the stick-test
  counting bugs in §7e.

Never run `eggs produce`, the sync/purge script, or any stick script while fixing these.

## 1. Investigation

All findings re-read against the code and the live box before fixing (read-only: `ls`, `dpkg`, `apt-cache policy`, `uname`).
Box: Ubuntu 26.04.1 (resolute), kernel 7.0.0-38-generic, NVIDIA 615.71.09 open (`nvidia-driver-615-open`), eggs 26.10.25.

| Item | Real? | Evidence |
|---|---|---|
| 4a eggs theme path | yes | `/usr/lib/penguins-eggs` does not exist. The stock theme is `/etc/penguins-eggs.d/branding.default/{applications,artwork,calamares,livecd}` (livecd has only `splash.png` + `isolinux.theme.cfg`; `calamares/` has `branding/` but no `modules/`). `install-eggs-live-grub-theme.sh:21-31` required the old dir and exited 1. The same literal sat in `verify-eggs-prepare-host.sh:22` (fails the host check), and — silently — in `finalize-boot-branding-for-eggs-produce.sh:32` / `verify-iso-boot-branding.sh:51` (the "ISO still shows the eggs penguin splash" guard was disabled because `[[ -f $EGGS_PENGUINS ]]` is simply false). `fix-calamares-shellprocess.sh:215` read the cleanup module from `/usr/lib/penguins-eggs/conf/distros/...`, now `/etc/penguins-eggs.d/distros/noble/...` (exists). `tools/eggs/live-usb/highascg-eggs-theme/theme/{artwork,applications}` are untracked-by-build symlinks to the removed path (dangling now; `ln -sfn` in the installer rewrites them). |
| 4b liveroot guard | yes | `eggs_liveroot_has_host_bind_mounts` was `list | grep -q .`. `grep -q` exits on the first match, the list loop then gets SIGPIPE, and under `set -o pipefail` the pipeline status is 141 = "false" = "no bind mounts" — exactly when MANY host mounts are bound. Reproduced with a stub `findmnt` printing 6000 mounts: old idiom `CLEAR`, new `DETECTED`. Second fail-open found: a failing `findmnt` inside `< <(…)` (or a missing prereq tool) produced an empty list = "safe". |
| 4c kernel pin | yes | `/etc/highascg/pinned-kernel` = `6.8.0-117-generic`, `uname -r` = `7.0.0-38-generic`; both kernels are installed. Reproduced with mocked `uname/dpkg/apt-get` against the OLD script (git HEAD copy, real pin file): it logged `apt-get -y purge linux-image-7.0.0-38-generic` + headers/modules/tools = the running kernel. `verify-eggs-prepare-host.sh` can never pass until the pin is fixed. Also: `verify-iso-squashfs-excludes.sh:342` fell back to a `6.8.0-117-generic` literal that never fires (`a | tr || echo` takes tr's status) — a pin-less squashfs checked for `linux-headers-` with an empty version. |
| 4d CEF scanner script | yes | `08-caspar-cef-scanner.sh:14` does `export SCRIPT_DIR="${REPO_ROOT}"` (install-config/-helpers need it), so `[[ -f ${SCRIPT_DIR}/13-caspar-systemd-units.sh ]]` at :62 tests the repo root, is always false, and the `else` ran `systemctl stop` + `disable casparcg-server`. `reinstall-cef.sh` (the documented CEF repair) execs it. `casparcg-server.service` is enabled on the box right now. |
| NVIDIA stale apply script | yes | `/usr/local/bin/highascg-nvidia-x-apply.sh` (Oct 23) differs from `tools/runtime/highascg-nvidia-x-apply.sh` (Oct 29): it lacks the WO-805 fix (heredoc swallowed python's stdin so `XVideoSyncToDisplayID` was never set; wrong `[dpy:N]` regex). It is installed only by `scripts/setup/09-openbox-autostart.sh:46` and called from `~/.config/openbox/autostart` and `~/.config/highascg/apply-layout.sh` — no systemd unit/udev/Xsession hook. Other drifted installed copies: `/usr/local/lib/highascg/{decklink-dkms-cache-lib.sh,highascg-apply-server-drop.sh}` (stale vs WO-721/737; refreshed by `install-exfat-systemd-units.sh`, which `prepare-eggs-clone-with-exfat.sh` runs during the build). |
| NVIDIA branch hard-coded | yes | `build-highascg-egg.sh` accepted only `535|580|595` and exited 1 for 615 (the installed driver) — a second ISO-build blocker next to 4a. `collect-third-party-licenses.sh:nvidia_pkg` only tried 595/580/535 names, so the manifest still says `nvidia-driver-595-open 595.71.05-0ubuntu0.24.04.1` (`licenses/manifest.json`, `isoDriverStamp 595`; `/etc/highascg/nvidia-iso-driver` = 595). `install-helpers-runtime.sh` persistenced whitelist the same. `audit-eggs-clone-host.sh` NVIDIA block only knew CUDA-repo `nvidia-open` / `nvidia-driver-595`, so on this box it fell to "nvidia-smi present but cuda-drivers not installed" and told the owner to run `03-nvidia-open-595.sh`. |
| Legacy 24.04 setup flow | yes | `scripts/setup/01-kernel-117.sh` installs 6.8.0-117 and purges every other kernel (= the running 7.0.0-38), `03-nvidia-open-595.sh` drops Ubuntu firmware/modules and adds the `ubuntu2404` CUDA repo. Running either on 26.04 is destructive. `/etc/apt/sources.list.d/cuda-ubuntu2404-x86_64.list.disabled` and `cuda-keyring` are leftovers of that flow (disabled, harmless; `cuda-repository-pin-600` pin file inert while the repo is off). |
| 26.04 package names | yes | `apt-cache policy`: `policykit-1` no candidate (polkitd/pkexec have 127-2ubuntu1.1); `libsfml-{graphics,window,system}2.6` and `2.6t64` no candidate (only `3.0`: 3.0.2+dfsg-2); `libboost-*1.83.0` still exist but the deployed `bin/casparcg` links `libboost_*.so.1.90.0` + `libsfml-*.so.3.0` + ffmpeg 8 (`ldd`). All other names in the `05-caspar-deps`/`17-operator-tools`/plymouth/build lists have candidates. `python3.12` literals, `ffmpeg6`: none in scripts/tools. `install.sh` is `scripts/install.sh` and has no apt lists of its own (helpers only). `lib/*.so` noble compat libs left alone on purpose (24.04 rollback binaries). |
| §7e `findmnt -L` | yes | `findmnt -L x` → "invalid option -- 'L'" (rc 2). Three call sites; test-03 additionally printed "mounted at " (empty) whenever the mount was found via the `${EXFAT}` fallback. `-S LABEL=…` is the valid form (verified against a UUID source on this box; no match = rc 1). |
| §7e stick tests | yes | test-05: `grep -cvE … || echo 0` → "0\n0" → `[[ "0\n0" -eq 0 ]]` arithmetic error → false FAIL on a clean box (same idiom in test-09, `diagnose-caspar-supervisors.sh:76` (outside my scope), `verify-highascg-stick-boot.sh:97`). test-12: `exit 0` in a file the runner SOURCES ends the runner before `st_summary`/exit code. test-06 and `verify-highascg-stick-boot.sh`: `pgrep -f 'run\.sh'` counts run.sh's forked sub-shell (live: pids 1190203 supervisor + 1326612 child with identical cmdline and the supervisor as parent) as a second supervisor. |
| `diagnose-screen-consumers.sh:82` | yes | reads `~/highascg/webui-port.json` = 4350 — that is the Vite DEV-server port (client/lib/webui-port.js); the server listens on 4200 (`defaults-core.js` httpPort, `ss -ltn`). The curl always hit a closed port. |

Unverifiable here (never run eggs): whether eggs 26.10.25 — now a Go binary (`/usr/bin/eggs -> coa`) — still accepts the flags
`build-highascg-egg.sh` passes to `eggs produce` (`--theme`, `--basename`, `--nointeractive`, `--clone`, `--max`). `strings` on the binary
gave no usable answer. The owner should run `eggs produce --help` once (harmless) before the build; see Owner commands.

## 2. What was done

4a — new `tools/eggs/live-usb/eggs-theme-lib.sh` (`highascg_eggs_theme_dir`: explicit `EGGS_THEME` if it has `livecd/`, else
`/etc/penguins-eggs.d/branding.default`, else the old `/usr/lib/penguins-eggs/addons/eggs/theme`). Used by `install-eggs-live-grub-theme.sh`
(+ clearer error), `verify-eggs-prepare-host.sh`, `finalize-boot-branding-for-eggs-produce.sh`, `verify-iso-boot-branding.sh`;
`fix-calamares-shellprocess.sh` looks for the cleanup module in `/etc/penguins-eggs.d/distros` first.

4b — `eggs-liveroot-safety.sh`: `eggs_liveroot_list_host_bind_mounts` captures `findmnt` first and returns 1 if it fails;
`eggs_liveroot_has_host_bind_mounts` captures the list and tests `[[ -n $out ]]` (no pipe) and answers "mounts present" when the list cannot be
produced (fail closed, WARN line). All three callers (`build-highascg-egg.sh`, `audit-eggs-clone-host.sh`, `pre-produce-preflight.sh`) inherit it.

4c — `eggs-kernel-lib.sh`: `highascg_assert_pin_valid` (well-formed release, `linux-image-<pin>` installed, `/boot` vmlinuz+initrd present; prints
the owner fix) and `highascg_refuse_purge_running`; `highascg_resolve_eggs_kernel` validates the pin. `sync-eggs-kernel-and-purge-stale.sh` now
computes the purge set BEFORE editing `eggs.yaml` and aborts ("Nothing was changed") if it contains the running kernel; `purge_kernel_pkg` re-checks.
`verify-eggs-prepare-host.sh` validates the pin + running match with the fix command in the message (hint to the 24.04 `01-kernel-117.sh` removed).
`install-kernel-headers-for-dkms-iso.sh` validates the pin. `verify-iso-squashfs-excludes.sh` falls back to `uname -r` (with WARN). Test seams:
`HIGHASCG_PIN_FILE`, `HIGHASCG_BOOT_DIR`.

4d — `08-caspar-cef-scanner.sh`: sibling scripts via `${SETUP_DIR}` (from `lib/common.sh`); the missing-helper branch now only warns — it never
stops/disables casparcg-server. SCRIPT_DIR stays the repo root for install-config/-helpers.

NVIDIA — new `scripts/lib/nvidia-branch.sh` (`highascg_installed_nvidia_version/branch`: `/sys/module/nvidia/version` → `/proc` → nvidia-smi → dpkg).
`build-highascg-egg.sh`: branch defaults to the installed one, any 3-digit branch accepted, refuses a `HIGHASCG_NVIDIA_DRIVER` that contradicts the
host (the ISO is a clone, the stamp would lie). `collect-third-party-licenses.sh`: `nvidia_pkg` uses the detected branch (`nvidia-driver-615-open`),
warns when the `nvidia-iso-driver` stamp disagrees. `install-helpers-runtime.sh`: persistenced package for any branch / installed branch.
`audit-eggs-clone-host.sh`: recognises `nvidia-driver-<N>-open` + loaded open module as OK; hints now say `apt install nvidia-driver-<N>-open`.
`scripts/setup/lib/common.sh` gains `require_legacy_2404`, called by 01/02/03: they refuse on non-24.04 (override `HIGHASCG_ALLOW_LEGACY_2404=1`),
so nobody can purge the running kernel or add the ubuntu2404 CUDA repo by following the old README. README/MANUAL_INSTALL got a banner;
BUILD_AND_FLASH docs / hint messages no longer say `HIGHASCG_NVIDIA_DRIVER=595`.

Packages — `05-caspar-deps.sh`: `first_candidate` picks the first alternative with an apt candidate (SFML 3.0 → 2.6 → 2.6t64; Boost 1.90 → 1.88 →
1.83), warns and skips instead of aborting the whole install. `13-usb-ingest.sh`: `udisks2 polkitd pkexec` (valid on 24.04 and 26.04).

§7e — `findmnt -S LABEL=…` in `stick-test-lib.sh`, `test-03` (also falls back to `${EXFAT}` for the printed path), `flash-stick-common.sh`.
`grep -c … || echo 0` → `|| true` in test-05, test-09. test-12 body wrapped in a function with `return` (sourced file). New
`tools/startup/run-sh-supervisors-lib.sh` (`st_count_run_sh_supervisors`: counts run.sh shells whose parent is not an identical run.sh; `ST_PS_CMD` test
seam) used by `stick-test-lib.sh` (test-06) and `verify-highascg-stick-boot.sh` (which also had the `pgrep -cf … || echo 0` bug).
`diagnose-screen-consumers.sh`: `PORT=${HIGHASCG_HTTP_PORT:-4200}`.

Not changed (by design): `/usr/local/bin/highascg-nvidia-x-apply.sh` (root-owned; owner command), `lib/*.so` noble compat libs, the
`mozillateam-ubuntu-ppa-noble.sources` (disabled; `firefox-esr` still comes from the noble PPA build), `tailscale` repo codename logic
(`VERSION_CODENAME` used as-is — not verified that pkgs.tailscale.com serves `resolute`; the box already has `tailscale.list`).
Outside my scope, to hand over: `tools/runtime/diagnose-caspar-supervisors.sh:76` has the same `grep -c … || echo 0` bug (use `|| true`).

## 3. Verified

- `bash -n` on every changed script: clean. `shellcheck` is not installed on the box (ask owner: `sudo apt install shellcheck`), so no shellcheck run.
- New `tools/smoke/smoke-wo832-iso-remnants.test.js`: 35 tests, all pass (`node --test`). Behavioural, no live state: stub `findmnt` with 6000 mounts
  (old idiom fails open — asserted — new detects), failing `findmnt` → unsafe; the real `sync-eggs-kernel-and-purge-stale.sh` run against mocked
  `uname/dpkg/dpkg-query/apt-get/id` with a stale pin (refuses, apt log empty, `eggs.yaml` untouched), uninstalled pin (fails with the owner fix), correct
  pin (purges only the old image); `run.sh` supervisor counting on ps fixtures (supervisor + fork = 1, two real = 2); test-12 sourced no longer ends the
  shell; `grep -c || true` vs `|| echo 0` shown to differ; `findmnt -S LABEL=` is a valid call (rc 1 on no match); `require_legacy_2404` exits 1 here.
- Old-code repro of 4c: HEAD copy of the sync script + mocks + the real stale pin file purged `linux-image-7.0.0-38-generic`; the fixed script on the
  same inputs exits 1 with "refusing to purge linux-image-7.0.0-38-generic — it is the RUNNING kernel … Nothing was changed."
- Real-box read-only checks: `highascg_eggs_theme_dir` → `/etc/penguins-eggs.d/branding.default` (livecd/applications/artwork found, `calamares/modules` absent → guarded);
  `highascg_installed_nvidia_version` → 615.71.09; `nvidia_pkg` → `nvidia-driver-615-open`; `st_count_run_sh_supervisors` → 1 on the live box (old
  `pgrep` gave 2); `05-caspar-deps` candidate picker → `libsfml-*3.0`, `libboost-*1.90.0`.
- Existing smokes pinning the touched scripts re-run: wo464, eggs-produce-build-stamp, wo724, wo465, wo462, wo498, licenses-manifest, eggs-exclude-lists + the new one: 107 pass / 0 fail.
- NOT run (by instruction): eggs, `eggs produce`, the sync/purge script for real, any flash/stick/install script, apt, sudo. The install-eggs-live-grub-theme and
  08-caspar scripts need root; verified by reading + `bash -n` + the library/function tests above, not executed end-to-end.
- Remaining owner QA: the sudo commands below, then one `build-highascg-egg.sh` run (first real exercise of 4a/4c/driver-615 path).

## Owner commands

Run in this order before the next ISO build (none of them touch the running kernel or Caspar):

```bash
# 1. Fix the kernel pin (4c). The box runs 7.0.0-38-generic; headers + initrd for it are installed.
echo "$(uname -r)" | sudo tee /etc/highascg/pinned-kernel
cat /etc/highascg/pinned-kernel          # expect 7.0.0-38-generic

# 2. Stamp the ISO driver the host really has (the build re-stamps it too; this makes licenses/ and test-01 right today).
echo 615 | sudo tee /etc/highascg/nvidia-iso-driver

# 3. Replace the stale installed X apply script (WO-805 fix: XVideoSyncToDisplayID never got set by the old copy).
sudo install -m 0755 -o root -g root /home/casparcg/highascg/tools/runtime/highascg-nvidia-x-apply.sh /usr/local/bin/highascg-nvidia-x-apply.sh

# 4. Optional but recommended: tools for the next verification round.
sudo apt install shellcheck

# 5. Check the host is ready (check-only, installs nothing). Expect no "ERROR:" lines about the pin/theme.
sudo bash /home/casparcg/highascg/tools/eggs/live-usb/verify-eggs-prepare-host.sh

# 6. Check that eggs 26.10.25 still takes the flags build-highascg-egg.sh passes (harmless, prints help only).
eggs produce --help | grep -E -- '--(theme|basename|nointeractive|clone|max)'
```

Then (no sudo needed, writes the generated `licenses/` tree owned by casparcg) refresh the NVIDIA licence manifest so it names driver 615:

```bash
bash /home/casparcg/highascg/tools/release/collect-third-party-licenses.sh
```

The stale `/usr/local/lib/highascg/{decklink-dkms-cache-lib.sh,highascg-apply-server-drop.sh}` are refreshed by the build's own
`prepare-eggs-clone-with-exfat.sh` → `install-exfat-systemd-units.sh`; to refresh them now: `sudo bash /home/casparcg/highascg/scripts/install-exfat-systemd-units.sh casparcg`.
The old 6.8.0-117 kernel packages stay until the build's sync step purges them (it now will, and will refuse to touch 7.0.0-38).
