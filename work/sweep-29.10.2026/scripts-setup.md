# scripts/setup — sweep 29.10.2026 (batch 060)

Files: 29 · lines: 1914 · findings: 1 BUG-HIGH, 10 BUG, 1 DEAD, 8 RISK, 18 QUALITY

Context for the stale-stack findings: the box now runs Ubuntu 26.04.1 on kernel 7.0.0-38 with NVIDIA 615 (WO-753); `/etc/highascg/pinned-kernel` still says `6.8.0-117-generic`. Package claims below were checked with `apt-cache policy` on this box.

## scripts/setup/01-kernel-117.sh
- `RISK` scripts/setup/01-kernel-117.sh:35-40,45-51,60-66 — re-running on the current box would undo the kernel-7 stack. Installed here: `linux-generic`, `linux-image-generic`, `linux-headers-generic`, `linux-image-7.0.0-38-generic` (dpkg-query). The script writes a `-1` pin on those metas, purges them (L60-64) and runs `apt-get autoremove -y` (L66), which then drops the orphaned kernel-7 packages except the running one, and holds only 6.8.0-117. On a fresh 26.04 host the pin file (L35) is written BEFORE `apt-get install linux-image-6.8.0-117-generic` (L45), which has no repo candidate there (box: candidate only from `/var/lib/dpkg/status`), so the script exits at L45 leaving the `-1` pin blocking the generic kernel metas.
- `RISK` scripts/setup/01-kernel-117.sh:94-96 — stamps `/etc/highascg/pinned-kernel`, which `tools/eggs/live-usb/build-highascg-egg.sh:59-61` treats as "purge non-pinned images". The stamp on the box is already stale (6.8.0-117 vs running 7.0.0-38), so an eggs build would try to purge the kernel the box actually runs.

## scripts/setup/02-verify-kernel-117.sh
- `QUALITY` scripts/setup/02-verify-kernel-117.sh:24,62-66 — hard-wired to `TARGET_KREL=6.8.0-117-generic` (`lib/common.sh:18`); on the current kernel-7 box it always reports FAIL (running_krel, no_124_boot is the only pass). Either retire steps 01-03 (README rule "Kernel: stay on 6.8.0-117") or make the target configurable. Logic itself is sound.

## scripts/setup/03-nvidia-open-595.sh
- `RISK` scripts/setup/03-nvidia-open-595.sh:66-67 — `apt-get download nvidia-firmware` runs in the current directory, and `ls -t nvidia-firmware_*_amd64.deb` reads it back. The docs say to run from the repo root (`cd ~/highascg`), so a ~MB `.deb` lands in the Syncthing-shared repo root (not in `.stignore`). Use `cd "$WORKDIR"` first.
- `RISK` scripts/setup/03-nvidia-open-595.sh:34,90-100 — `WORKDIR=/tmp/highascg-nvidia-cuda-repo` is predictable and reused if the keyring `.deb` already exists; any local user can plant `cuda-keyring_1.1-1_all.deb` there and root `dpkg -i`s it. Use `mktemp -d` and verify a sha256.
- `QUALITY` scripts/setup/03-nvidia-open-595.sh:22,29,31-33,106 — stale stack: requires kernel 6.8.0-117, `DISTRO=ubuntu2404`, driver branch 595; the box is 26.04 with NVIDIA 615 and `cuda-ubuntu2404-x86_64.list.disabled`.

## scripts/setup/04-ndi.sh
- `BUG` scripts/setup/04-ndi.sh:44-45 — fresh-host failure: `LIC_REPO="${REPO_ROOT}/licenses/third-party"` and `mkdir -p` it, but `licenses` is a tracked symlink to `/usr/share/doc/highascg/licenses`, which does not exist until step 15 runs (after 04). `mkdir -p` through a dangling symlink fails (reproduced: `mkdir: Already exists`, rc 1), `set -e` aborts after the NDI installer ran but BEFORE `install … libndi.so.6.*` (L66), so the library is never installed. Fix: `mkdir -p` tolerant (`|| true`) or write the licence to a real path.
- `BUG` scripts/setup/04-ndi.sh:28 — `NDI_VER=$(ls /usr/lib/x86_64-linux-gnu/libndi.so.6.* 2>/dev/null | head -1 | sed …)` has no `|| true`; with `pipefail` a non-matching glob makes the assignment fail and `set -e` kills the script silently (reproduced: rc 2 and `reached` never printed). Failing case: `ndi_installed` true because `libndi.so.6` is a plain file / registered elsewhere, but no versioned `libndi.so.6.x.y` next to it.
- `BUG` scripts/setup/04-ndi.sh:24 — `ldconfig -p | grep -q libndi` under `pipefail`: `grep -q` exits on the first hit, `ldconfig` gets SIGPIPE, the function returns 141, so a libndi that is only in the ldconfig cache (e.g. `/usr/local/lib`) is reported as "not installed". Reproduced on this box with `libm.so`, `libz.so`, `libssl`, `libcrypto` (`ldconfig -p` is 99 KB): all rc=141. Use `grep … >/dev/null`.
- `QUALITY` scripts/setup/04-ndi.sh:20,34-41 — `MIN_NDI` assigned and never read; the SDK is extracted into shared `/tmp` and `./Install_NDI_SDK_v6_Linux.sh` run with `|| true`, so a stale `NDI SDK for Linux/` dir in `/tmp` from an earlier run is silently reused (L62).

## scripts/setup/05-caspar-deps.sh
- `BUG` scripts/setup/05-caspar-deps.sh:26 — `apt-get install … libsfml-graphics2.6 libsfml-window2.6 libsfml-system2.6` cannot resolve on Ubuntu 26.04 (`apt-cache policy libsfml-graphics2.6` prints nothing on this box; only `libcsfml-*3.0` exist), so the single `apt-get install` aborts as a whole and nothing after it (user, dirs, nodm config) runs; `fix-caspar-and-grub.sh` and the documented step order break the same way. Memory/WO-753: the box keeps the noble SFML libs in `~/highascg/lib` instead.
- `QUALITY` scripts/setup/05-caspar-deps.sh:65-66 (same at `07-node-highascg.sh:49-50`) — `chmod -R 775 "$PLAYOUT"` makes every tracked file executable and group-writable, including `node_modules`, `media`, `config`; git sees the whole tree as mode-changed unless `core.fileMode=false`. Use `chmod -R u+rwX,g+rwX`/`X` or only the directories that need it.
- `QUALITY` scripts/setup/05-caspar-deps.sh:48-49 — `ok "ffmpeg: x11grab"` is the last `&&` of a pipeline; fine under `-e`, but the `|| echo note` on L48 prints "kmsgrab not listed" for the `x11grab`-absent case too. Cosmetic.

## scripts/setup/07-node-highascg.sh
- `BUG` scripts/setup/07-node-highascg.sh:43-47 — the rsync excludes are unanchored, so they match at any depth: `media`, `lib`, `data`, `bin`, `core`, `log`, `dist`, `work`. Reproduced with a copy of the layout: `rsync -an … --exclude='media' --exclude='lib' --exclude='core' …` skips `src/media/`, `client/lib/` (imported by `src/` at runtime, WO-737), `scripts/lib/`, `godot/client/core/`. Failing case: repo cloned somewhere other than `/home/casparcg/highascg` → the synced server lacks `src/media/*` and `client/lib/*` → `MODULE_NOT_FOUND` at start. (When `REPO_ROOT == PLAYOUT`, as on the box, it is a no-op.) Fix: anchor with a leading `/` (`--exclude='/media'` …), as `archive-common.sh` does with `./`.
- `BUG` scripts/setup/07-node-highascg.sh:74-77 — runs `bash 13-usb-ingest.sh` unguarded under `set -e`; that script fails on 26.04 (`policykit-1`, see below), so step 07 aborts after the systemd unit and sudoers were installed and never prints the "Next:" lines. Add `|| echo "note: …"` like step 08 does for 13-caspar-systemd-units.
- `RISK` scripts/setup/07-node-highascg.sh:30 — `curl … setup_lts.x | bash -` as root: floating LTS, no pin (box holds `nodejs` via apt-mark and has `nodesource.sources`).
- `QUALITY` scripts/setup/07-node-highascg.sh:86 — points to `scripts/install-phase4.sh`/`install-phase5.sh`, which live in `scripts/deprecated/legacy/`.

## scripts/setup/08-caspar-cef-scanner.sh
- `BUG-HIGH` scripts/setup/08-caspar-cef-scanner.sh:14,62-69 — `export SCRIPT_DIR="${REPO_ROOT}"` (needed by `ensure_highascg_caspar_launcher`) clobbers the script dir, so `${SCRIPT_DIR}/13-caspar-systemd-units.sh` is `<repo>/13-caspar-systemd-units.sh` (does not exist) and the `else` branch runs instead: `systemctl stop casparcg-server; systemctl disable casparcg-server`. Failing case: the documented CEF repair `sudo bash scripts/setup/reinstall-cef.sh` (a thin `exec` of this script) on the live box — it pkills Caspar (L38-39), then STOPS and DISABLES `casparcg-server.service` (verified present and enabled on the box), so playout is down and does not return at the next boot; the docs only say to restart `nodm`. On a fresh host the units are never installed here either (09 then falls into the legacy Openbox-launches-run.sh path, 09:83). Fix: save the setup dir in a different variable (`SETUP_DIR` already exists from common.sh) and use it for lines 62-63 and 95.
- `BUG` scripts/setup/08-caspar-cef-scanner.sh:54 — `HIGHASCG_FORCE_SCANNER=1` can never force a reinstall: the first branch (`command -v casparcg-scanner`, L52) already catches every installed case, so the `elif` only runs when the scanner is missing (its second operand). Only defined here: `grep -rn HIGHASCG_FORCE_SCANNER` → this line. Fix: check the flag first.
- `RISK` scripts/setup/08-caspar-cef-scanner.sh:36-43 — whenever `lib/libcef.so` exists (i.e. every configured box) the script kills the running Caspar and `run.sh`, empties `cef-cache` and deletes `/tmp/.org.chromium.Chromium.*` with no confirmation or `--yes`; combined with the previous finding, a re-run is an on-air interruption. Guard with an explicit flag.
- `QUALITY` scripts/setup/08-caspar-cef-scanner.sh:93,95 — final lines `[[ -f libcef.so ]] && ok …` make the script exit 1 when libcef is absent (e.g. `HIGHASCG_SKIP_CEF=1`), and the "Next:" line prints `${SCRIPT_DIR}` = repo root, i.e. a wrong path (`<repo>/09-openbox-autostart.sh`).

## scripts/setup/09-openbox-autostart.sh
- `QUALITY` scripts/setup/09-openbox-autostart.sh:181 — prints `Logs: /tmp/caspar.log`, but Caspar is owned by systemd since WO-73 (journal); the file only exists in the legacy branch.
- `QUALITY` scripts/setup/09-openbox-autostart.sh:86-95 — in the legacy fallback block, `flock -n 9 || exit 0` runs at top level of the generated autostart, so a held lock ends the whole autostart script and skips the Godot client launch (L146-150). Use a subshell or `||:`-style guard.
- Checked: all four `tools/runtime/*` files it installs exist; heredoc escaping (`\$HOME`, `'^x11-only\$'`) produces correct output.

## scripts/setup/10-playout-performance.sh
- `OK` — idempotent; the unit is installed and ran cleanly on the box (governor `performance`, no ordering-cycle in the journal).

## scripts/setup/11-boot-branding.sh
- `OK` — forwards to `scripts/boot/install-host-boot-branding.sh` (exists).

## scripts/setup/12-passwordless-sudo.sh
- `OK` — sudoers is built in a temp file, `visudo -cf` validated, then `install -m 0440`; pinned by `tools/smoke/smoke-hostname-sudoers.test.js` and `smoke-wo460-*`.

## scripts/setup/12b-syncthing-highascg.sh
- `RISK` scripts/setup/12b-syncthing-highascg.sh:26-29 — drop-in sets `STGUIADDRESS=0.0.0.0:8384` and the script sets no GUI user/password anywhere. The box's GUI is listening on `*:8384` (`ss -ltn`). Whether it is protected depends on manual setup; the script should at least run `syncthing generate --gui-user/--gui-password` or bind to the LAN/tailnet address only (its header promises "LAN/Tailnet").

## scripts/setup/13-caspar-systemd-units.sh
- `OK` — checks unit sources, rewrites the `After=` line (the regex at L55 matches the repo unit's `After=network.target nodm.service casparcg-scanner.service` exactly), enables conditionally. Note that it is unreachable from step 08 (see 08).

## scripts/setup/13-usb-ingest.sh
- `BUG` scripts/setup/13-usb-ingest.sh:25 — `apt-get install -y udisks2 policykit-1`: `policykit-1` has `Candidate: (none)` on this Ubuntu 26.04.1 box (the packages are `polkitd` / `pkexec`, both with candidates). The install fails, `set -e` aborts before the polkit rules are copied (L30-40), and — because 07 calls it unguarded — takes step 07 down with it. Fix: install `polkitd pkexec` (fall back to `policykit-1` on noble).
- `QUALITY` scripts/setup/13-usb-ingest.sh:36 — `sed -i "s/casparcg/${USER_CASPAR}/g"` rewrites every `casparcg` occurrence in the rules file, not only the user name; harmless for the default user.

## scripts/setup/13b-syncthing-media-pair.sh
- `OK` — print-only helper; `chown -R` over exFAT bind mounts is accepted by exFAT when the owner equals the mount uid (uid=1000 on this box). No script calls it (manual, documented in scripts/README.md:33).

## scripts/setup/14-power-button-network-reset.sh
- `OK` — sources exist (`tools/runtime/highascg-power-button-listen.sh`, `highascg-network-reset.sh`); caller/verifier `tools/runtime/verify-power-button-setup.sh`.

## scripts/setup/14b-private-volume-bootstrap.sh
- `OK` — `.private/` is in `.gitignore:16`; on exFAT the `-m 0700` is silently ignored by the driver (documented in the README text it writes). No caller (manual).

## scripts/setup/15-licenses-install.sh
- `BUG` scripts/setup/15-licenses-install.sh:14-21 — on a fresh clone `${REPO_ROOT}/licenses` is a dangling symlink to the very destination this script is meant to create, so `manifest.json` is missing, the collector runs (`tools/release/collect-third-party-licenses.sh:12-19`) and its `mkdir -p "${LIC}/third-party"` fails through the dangling link (reproduced, rc 1) → step 15 (called by `build-highascg-egg.sh:113`) cannot bootstrap. Fix: `mkdir -p "$DEST"` and point the collector at it first, or have 15 create the target dir before the check.
- `QUALITY` scripts/setup/15-licenses-install.sh:25 — on the box `SRC` (symlink) and `DEST` are the same directory, so `rsync -a --delete "$SRC/" "$DEST/"` copies a tree onto itself; harmless today, but `--delete` makes a future change of either side dangerous. Skip when `readlink -f` of both match.

## scripts/setup/16-hardware-hostname-boot.sh
- `OK`

## scripts/setup/17-operator-tools.sh
- `QUALITY` scripts/setup/17-operator-tools.sh:22-23 — sources `lib/install-helpers.sh` and uses nothing from it (no function or variable referenced afterwards); drop the line. Everything else is fine (package names resolve on 26.04: `gh`, `magic-wormhole`, `v4l2loopback-utils` have candidates).

## scripts/setup/check-decklink.sh
- `BUG` scripts/setup/check-decklink.sh:7,9 — sources `${HERE}/../install-config.sh` and `${HERE}/../install-helpers.sh`, i.e. `scripts/install-config.sh` / `scripts/install-helpers.sh`, which do not exist (they live in `scripts/lib/`). Every run dies at L7 with "No such file or directory". The command is documented in `06-decklink-manual.md:82` and `MANUAL_INSTALL.md:215`. Fix: `../lib/…` (and `SCRIPT_DIR` is not needed by `decklink_report_status`).

## scripts/setup/fix-caspar-and-grub.sh
- `QUALITY` scripts/setup/fix-caspar-and-grub.sh:17-28 — step 1 is the whole `05-caspar-deps.sh`, which fails on 26.04 (see 05), so under `set -e` the GRUB half never runs there; the GRUB block (L19-28) duplicates `01-kernel-117.sh:76-90` and `grub-set-default 0` assumes entry 0 is the wanted kernel.
- `RISK` scripts/setup/fix-caspar-and-grub.sh:31-32 — unconditionally restarts `highascg.service` and `nodm` (kills the X session, Godot client and Caspar screen consumers) with no flag; fine on a fresh host, an on-air interruption anywhere else.

## scripts/setup/install-exfat-sync-map.sh
- `DEAD` scripts/setup/install-exfat-sync-map.sh:1-11 — duplicate of `tools/eggs/live-usb/install-exfat-sync-map.sh`, which is what every caller uses (`create-operator-stick-from-dd.sh:138`, `finish-operator-stick.sh:72`, `verify-config-persistence.sh:47,85`, legacy install-phase4). grep: `grep -rn "install-exfat-sync-map" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=work .` → the only reference to this copy is scripts/README.md:51. It also lacks the `[[ -f $SRC ]]` guard the tools version has.

## scripts/setup/install-tailscale-deb-for-iso.sh
- `OK` — caller `prepare-eggs-clone-with-exfat.sh:201`. (Box's `tailscale.list` says noble; the script derives the codename from os-release, which is the better behaviour.)

## scripts/setup/lib/common.sh
- `QUALITY` scripts/setup/lib/common.sh:18-19 — `TARGET_KVER="6.8.0-117"` hard-coded for the retired 24.04 pin; drives 01/02/03 (see those).
- `QUALITY` scripts/setup/lib/common.sh:33-36 — `setup_trap_apt_cleanup` defines a global function named `cleanup` and installs `trap … EXIT`, replacing any EXIT trap the caller set earlier; `export PATH=…` at L5 also drops `/snap/bin`.

## scripts/setup/lib/install-operator-firefox.sh
- `QUALITY` scripts/setup/lib/install-operator-firefox.sh:6,22,39,43 — header says it is also sourced by `work/bootstrap-remote-after-sync.sh` (that file defines its own `log`/`ok`, so fine) but the lib calls `log`/`ok` without defining them, so any other consumer gets "command not found" under `set -e`. Also `set -euo pipefail` in a sourced lib (see apt-block note).

## scripts/setup/reinstall-cef.sh
- `QUALITY` scripts/setup/reinstall-cef.sh:11 — `exec bash 08-caspar-cef-scanner.sh` re-runs the entire step 08 (scanner install, systemd unit step, config seeding), not just "re-overlay CEF" as the header says, and so inherits the BUG-HIGH in 08 (stops and disables `casparcg-server.service`). Use `HIGHASCG_SKIP_*` switches or a CEF-only entry point.

## scripts/setup/sync-caspar-supervisor-wiring.sh
- `QUALITY` scripts/setup/sync-caspar-supervisor-wiring.sh:18-19 — runs `09-openbox-autostart.sh` twice (13-caspar-systemd-units.sh already runs it at 13:92, then L19 again); idempotent but duplicates the autostart/menu rewrite. Live caller `prepare-eggs-clone-with-exfat.sh:195`; verifier `tools/startup/verify-caspar-autostart.sh:31`.

## scripts/setup/verify-boot-branding.sh
- `OK`
