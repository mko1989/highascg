# tools/eggs (part 2) — sweep 29.10.2026 (batch 115)

Files: 31 · lines: 3097 · findings: 0 BUG-HIGH, 9 BUG, 1 DEAD, 13 RISK, 26 QUALITY

Scope notes: all files read in full; `bash -n` / `node --check` / `ast.parse` clean (shellcheck is not installed on the box). Nothing was executed except small pure repros in the scratchpad (trap/local scoping, `pgrep -c || echo 0`). Verified facts about this box are marked "(box)".

## tools/eggs/live-usb/seed-exfat-operator-layout.sh
- `QUALITY` tools/eggs/live-usb/seed-exfat-operator-layout.sh:18-19 — `${ROOT}/projects/_autosave` is listed twice in the `mkdir -p`. Fix: drop one.
- `QUALITY` tools/eggs/live-usb/seed-exfat-operator-layout.sh:113 — `chown -R` walks the whole stick root (media/ can be TBs) and every error is swallowed; on exFAT mounted with `uid=` it is a no-op. Fix: chown only the folders created here (or skip when the fs is exfat).
- `QUALITY` tools/eggs/live-usb/seed-exfat-operator-layout.sh:40 — `drop-update/README.txt` is overwritten on every run while the other READMEs are guarded with `[[ ! -f ]]` (an operator-edited README is lost). Fix: guard it the same way.

## tools/eggs/live-usb/seed-stick-config-from-host.sh
- `QUALITY` tools/eggs/live-usb/seed-stick-config-from-host.sh:21 — default `${HIGHASCG_SEED_STICK_CONFIG:-0}` makes the script a no-op unless `=1`, while the header says "Skipped when =0" (reads as default-on) and work/wiki/WO_02_Installation_And_Deployment_Guide.md:35 tells the operator to run it directly as "optional: push configs/". Failing case: `sudo bash seed-stick-config-from-host.sh /dev/sda` prints "Skip stick config seed" and exits 0. Only create-operator-stick-from-dd.sh:144 gates on `=1` correctly. Fix: make the header/usage say "opt-in, set =1".
- `RISK` tools/eggs/live-usb/seed-stick-config-from-host.sh:30,39 — `$DEV` is only used to unmount; the volume that gets mounted and written is whatever `blkid -L HIGHASCGEXF` / `mount -L HIGHASCGEXF` finds first. With two sticks carrying that label (old operator stick + new one) the wrong stick is seeded. Fix: mount the partition of `$DEV` explicitly. Same pattern in seed-stick-drop-update-from-host.sh and seed-stick-factory-config.sh.

## tools/eggs/live-usb/seed-stick-drop-update-from-host.sh
- `BUG` tools/eggs/live-usb/seed-stick-drop-update-from-host.sh:124-129 — `trap cleanup_remote EXIT` is installed inside `apply_remote()` but the handler reads the function's `local tmp_dir socket`; when the script ends normally those locals are out of scope. Repro (scratchpad j54-trap.sh, same shape): handler prints `socket: unbound variable`, script exits 1 although the push+apply succeeded, `tmp_dir` is NOT removed (a full copy of server + dist-web leaks under /tmp on every `--remote` run) and `ssh -O exit` is skipped. Fix: make `tmp_dir`/`socket` globals (or trap inside a subshell).
- `RISK` tools/eggs/live-usb/seed-stick-drop-update-from-host.sh:138 — `rsync -az --delete` (implies `-a`) pushes to `${REMOTE}:/home/casparcg/exfat/drop-update/`, which is an exFAT volume. Project rule: exFAT targets use `-rLt --modify-window=2` (chown/symlinks abort with code 23, WO-434). It only works today because the remote user is non-root and the tree has no symlinks (box: `find src config template scripts tools/runtime dist-web -type l` is empty). `user@host` = root, or a symlink in the tree, aborts the push. Fix: use the same `rs` array as `rsync_drop_members`.
- `BUG` tools/eggs/live-usb/seed-stick-drop-update-from-host.sh:79 — member list has drifted from `archive_common_server_tar_members` (scripts/lib/archive-common.sh:22-46): it lacks `client/lib`, `client/package.json` (WO-737), `tools/sweep`, `tools/startup`, `godot/client`, the e2e/require-check helpers. src/api/routes-scene-take-look.js:64 does `import('../../client/lib/transition-presets.js')` at runtime, so a stick/drop seeded only by this script (exFAT-only builds, `HIGHASCG_SEED_DROP_UPDATE=1`, WO-434) has no client/lib; scene take of a look with transitions fails on the box. Fix: source the member list from archive-common.sh instead of a second copy.
- `RISK` tools/eggs/live-usb/seed-stick-drop-update-from-host.sh:71-78,88 — the `config/` filter mirrors only `MACHINE_LOCAL_JSON` (tools/ci/write-repo-default-config.js:20); everything else in the build host's live `config/` rides the stick: `certs/highascg-key.pem` (TLS private key), `device-identity.json` (Ed25519 private key), `casparcg.config.bak.*`, `*.corrupt-*`, `security.json`/`replication.json`/`ui.json` (token/password fields, empty on this box today), `nginx/`. scripts/exfat/highascg-apply-server-drop.sh:203-207 copies non-`*.json` always and `*.json` with `--ignore-existing`, so a fresh box that lacks `device-identity.json` adopts the build host's identity and key. The three lists disagree: exfat-sync.json excludes device-identity.json/replication.json/audio_*; archive-common.sh:118-129 excludes certs/nginx/identity (WO-687). Fix: one shared exclude list (add `device-identity.json`, `certs`, `nginx`, `*.bak.*`, `*.corrupt-*`, `casparcg.config*`).
- `RISK` tools/eggs/live-usb/seed-stick-drop-update-from-host.sh:176-185 — same `-L HIGHASCGEXF` / `$DEV`-ignored mount as the other seed scripts.
- `QUALITY` tools/eggs/live-usb/seed-stick-drop-update-from-host.sh:104 — `chown -R "${USER_CASPAR}:${USER_CASPAR}"` assumes the primary group has the user's name (seed-exfat-operator-layout.sh:112 uses `id -gn`).

## tools/eggs/live-usb/seed-stick-factory-config.sh
- `RISK` tools/eggs/live-usb/seed-stick-factory-config.sh:23,37 — mounts `-L HIGHASCGEXF` instead of the partition of `$DEV` (see seed-stick-config-from-host.sh); with two labelled sticks the factory config can land on the wrong one.

## tools/eggs/live-usb/starter-project.js
- `OK`

## tools/eggs/live-usb/stop-and-unmount-wo47-for-eggs-produce.sh
- `OK`

## tools/eggs/live-usb/strip-host-swap-for-live-iso.sh
- `QUALITY` tools/eggs/live-usb/strip-host-swap-for-live-iso.sh:9-10 — usage lines name `tools/live-usb/...` (path is `tools/eggs/live-usb/`); line 29 `cmd_prepare` has a stray tab indent.
- `RISK` tools/eggs/live-usb/strip-host-swap-for-live-iso.sh:46-48 — `restore` overwrites /etc/fstab with the pre-`prepare` backup, discarding any fstab edit made in between (e.g. a mount added during a long produce). Fix: only remove/re-add the swap lines instead of copying the whole file.

## tools/eggs/live-usb/strip-legacy-exfat-sim.sh
- `OK`

## tools/eggs/live-usb/sync-eggs-kernel-and-purge-stale.sh
- `BUG` tools/eggs/live-usb/sync-eggs-kernel-and-purge-stale.sh:25,53-61 — the kernel to keep comes from /etc/highascg/pinned-kernel (eggs-kernel-lib.sh:19-20) and every other `linux-image-*-generic` is purged, with no guard against purging the RUNNING kernel. (box) pinned-kernel = `6.8.0-117-generic`, running kernel = `7.0.0-38-generic` (Ubuntu 26.04), both installed (`dpkg -l 'linux-image-[0-9]*'`). Running the script today sets eggs.yaml to the 6.8 kernel and `apt-get purge linux-image-7.0.0-38-generic` on the live box, with the 615 NVIDIA DKMS built for 7.0. Fix: refuse when `uname -r` != KVER (or refresh the pin first); never purge `$(uname -r)`.
- `RISK` tools/eggs/live-usb/sync-eggs-kernel-and-purge-stale.sh:46-50 — one `apt-get purge` lists `linux-headers/modules/modules-extra/tools-${ver}`; apt aborts the whole transaction with "Unable to locate package" if any name is unknown to the cache (e.g. `linux-tools-X` never installed and dropped from the archive), and `2>/dev/null || true` hides it, so none of the four is purged. `autoremove --purge` (line 64) masks most of the effect. Fix: filter names with `dpkg-query` first, or purge them one by one.
- `RISK` tools/eggs/live-usb/sync-eggs-kernel-and-purge-stale.sh:58-63 — `export DEBIAN_FRONTEND=noninteractive` comes after the purge loop, so the kernel-removal debconf prompts of those `apt-get -y purge` calls can block on a terminal. Fix: export before line 40.
- `QUALITY` tools/eggs/live-usb/sync-eggs-kernel-and-purge-stale.sh:55-57 — the "Pinned kernel" branch only echoes; it changes nothing.

## tools/eggs/live-usb/unmask-exfat-systemd.sh
- `OK`

## tools/eggs/live-usb/unmount-usb-for-partitioning.sh
- `OK`

## tools/eggs/live-usb/usb-env.sh
- `OK`

## tools/eggs/live-usb/usb-mkpart-numbered.sh
- `QUALITY` tools/eggs/live-usb/usb-mkpart-numbered.sh:65-68 — GPT branch ignores `TYP_ID`: the first `sgdisk -n ... -t N:8300` succeeds for exfat too, so an exFAT partition gets the Linux-filesystem type (0700 is only the fallback after a failed first call). stderr is hidden. Only reachable on a GPT stick (isohybrid sticks are msdos). Fix: pick 0700 for exfat up front.
- `QUALITY` tools/eggs/live-usb/usb-mkpart-numbered.sh:20-21,36 — non-numeric START/END MiB abort with a bash arithmetic error instead of a usage message.

## tools/eggs/live-usb/usb-partition-slots.py
- `QUALITY` tools/eggs/live-usb/usb-partition-slots.py:8,51 — docstring names `HIGHASCG_LEGACY_UNION_PERSIST=1` as the switch, the code reads `HIGHASCG_EXFAT_ONLY` (set by finish-operator-stick.sh:23,107,114). Anyone calling it with only the documented variable gets exFAT-only.
- `QUALITY` tools/eggs/live-usb/usb-partition-slots.py:28 — `check_output(parted ...)` raises an uncaught `CalledProcessError` traceback on an unlabeled disk; callers read stdout via `read -r` and would see an empty line.

## tools/eggs/live-usb/usb-restore-esp-flags.sh
- `QUALITY` tools/eggs/live-usb/usb-restore-esp-flags.sh:12 — non-root exits 1 silently (other scripts print "Run as root").

## tools/eggs/live-usb/verify-calamares-installed.sh
- `QUALITY` tools/eggs/live-usb/verify-calamares-installed.sh:38 — "dpkg calamares" gate uses `dpkg-query -W -f='${Status}'`; clones ship a phantom `/var/lib/dpkg/status` (WO-431). It is harmless here only because the payload (`/usr/bin/calamares`, branding, launcher) is checked right above and below; the dpkg line adds no information.
- `RISK` tools/eggs/live-usb/verify-calamares-installed.sh:106 — `sudo -u ... sudo -n -l | grep -q` under `set -o pipefail`: `grep -q` can close the pipe early and the pipeline then reads as failure (the same file family documents this, verify-iso-boot-branding.sh:20 and verify-iso-squashfs-excludes.sh:46-48). Output is small so it rarely triggers. Fix: capture to a variable, then grep.

## tools/eggs/live-usb/verify-config-persistence.sh
- `BUG` tools/eggs/live-usb/verify-config-persistence.sh:19-23 — requires the literal `persistence` in /proc/cmdline and sets `FAIL=1` otherwise. Production sticks are exFAT-only with no union persistence (BUILD_AND_FLASH.md:180, usb-partition-slots.py:7, verify-iso-boot-branding.sh:97-98 even WARNs when the default line HAS persistence). Failing case: boot a correct production stick, run the script as documented in build-produce-flash-stick.sh:137 → "FAIL: cmdline missing persistence" and exit 1. Fix: drop the cmdline/overlay/LABEL=persistence checks or make them legacy-only (`HIGHASCG_LEGACY_UNION_PERSIST=1`).
- `QUALITY` tools/eggs/live-usb/verify-config-persistence.sh:49 — second `grep` has no `2>/dev/null`, so a missing repo map prints a raw grep error in the middle of the report.

## tools/eggs/live-usb/verify-eggs-prepare-host.sh
- `BUG` tools/eggs/live-usb/verify-eggs-prepare-host.sh:159-165 — `n_run` counts every process whose argv contains `run.sh` and whose cwd is the repo. run.sh forks a subshell with an identical argv. (box) `ps -eo pid,ppid,args`: 1190203 `/bin/sh .../run.sh` (ppid 1) and 1326612 `/bin/sh .../run.sh` (ppid 1190203), one healthy supervisor. Result: `n_run=2` → "duplicate Caspar supervisors" ERROR on a healthy box whenever :5250 is up (the gate runs before produce stops Caspar). Fix: count only processes whose parent is not itself a run.sh.
- `BUG` tools/eggs/live-usb/verify-eggs-prepare-host.sh:66-76 — requires /etc/highascg/pinned-kernel and `uname -r` == pin. (box) pin = 6.8.0-117-generic, running = 7.0.0-38-generic → "running ... != pin ... reboot after kernel setup" every time; the gate cannot pass on this host until the pin file (scripts/setup/01-kernel-117.sh:95) is updated. Fix: refresh the pin, or treat the pin as advisory on 26.04.
- `BUG` tools/eggs/live-usb/verify-eggs-prepare-host.sh:33-40,78-81 — install gate for exfatprogs/parted/python3/rsync is `dpkg-query -W -f='${Status}'` only. Clone hosts ship the whole dpkg status with files stripped (WO-431), so a phantom entry passes while `mkfs.exfat`/`parted` are missing and stick prep dies later. Fix: gate on the payload (`command -v mkfs.exfat parted rsync python3`), keep dpkg only as a hint.
- `QUALITY` tools/eggs/live-usb/verify-eggs-prepare-host.sh:84-88 — the three sub-verifiers run bare under `set -e`; the first failing one ends the script, so the remaining ~15 gates and the FAIL summary never print (gates mask each other: fix one, rerun, meet the next). Fix: `bash x || fail "..."`.
- `QUALITY` tools/eggs/live-usb/verify-eggs-prepare-host.sh:139-143 — second dpkg-only calamares gate (payload is checked at 134); redundant, see verify-calamares-installed.sh:38.
- `QUALITY` tools/eggs/live-usb/verify-eggs-prepare-host.sh:20 — user comes from `USER_CASPAR`, every sibling script uses `HIGHASCG_SERVICE_USER`.

## tools/eggs/live-usb/verify-eggs-safety.sh
- `OK`

## tools/eggs/live-usb/verify-highascg-stick-boot.sh
- `BUG` tools/eggs/live-usb/verify-highascg-stick-boot.sh:97-102 — `_run_ct="$(pgrep -cf 'run\.sh' 2>/dev/null || echo 0)"`: with no match `pgrep -c` prints `0` AND exits 1, so `|| echo 0` makes the value `"0\n0"`; `[[ "0\n0" -le 1 ]]` is an arithmetic syntax error → the else branch → `fail "multiple run.sh supervisors (0\n0)"` (repro in scratchpad j54-pg.sh, bash prints `[[: 0 0: arithmetic syntax error`). With one healthy supervisor the count is 2 (run.sh + its subshell, see verify-eggs-prepare-host.sh:159) → also fail. So the check fails with 0 supervisors AND with 1. Also `pgrep -f` matches any process whose argv merely contains "run.sh". Fix: `pgrep -c ... || true` and count supervisors by parent/cwd like the prepare script.

## tools/eggs/live-usb/verify-iso-boot-branding.sh
- `QUALITY` tools/eggs/live-usb/verify-iso-boot-branding.sh:133-134 — `GRUB_MAIN` is hard-wired to `$MNT/boot/grub/grub.cfg` although `GRUB_CFG` may have fallen back to `EFI/ubuntu/grub.cfg` (line 89); the gfxterm/gfxmode/font/timeout checks then run against a different file and report "missing" through `2>/dev/null`.
- `QUALITY` tools/eggs/live-usb/verify-iso-boot-branding.sh:226-229 — "newest initrd" is the lexicographically last glob match (`initrd.img-6.8.0-9` sorts after `-10`); fine with one kernel, wrong with two.

## tools/eggs/live-usb/verify-iso-squashfs-excludes.sh
- `RISK` tools/eggs/live-usb/verify-iso-squashfs-excludes.sh:290-291,305-306,315-316,325-326,357-358 — five `unsquashfs -cat ... | grep -q` pipelines run under `set -o pipefail`, although the file defines `squash_cat_grep` (lines 70-83) precisely because the early-closing `grep -q` turns into SIGPIPE/141 and a false negative. The files are small, so it is a latent flake. Fix: route them through `squash_cat_grep`.
- `RISK` tools/eggs/live-usb/verify-iso-squashfs-excludes.sh:342-343 — `kver` falls back to the literal `6.8.0-117-generic` (stale; box runs 7.0.0-38). And if `unsquashfs -cat` returns empty with status 0, `kver=""` and the fixed-string grep `Package: linux-headers-` matches ANY headers package, so the check passes vacuously (the real-file check at 352 then fails with a confusing path). Fix: fail when `kver` is empty.
- `QUALITY` tools/eggs/live-usb/verify-iso-squashfs-excludes.sh:399 — needle `lib/udev/rules.d/55-blackmagic.rules` can never match on a merged-usr squashfs (`lib` is a symlink); coverage is real only through the `usr/lib/...` twin on line 400. Harmless dead needle, but it is exactly the lib/-without-usr/ pattern.
- `QUALITY` tools/eggs/live-usb/verify-iso-squashfs-excludes.sh:438-441 — squashfs size window 2000/4300 MiB is hard-coded.

## tools/eggs/live-usb/verify-live-stick.sh
- `OK`

## tools/eggs/live-usb/verify-operator-stick-branding.sh
- `RISK` tools/eggs/live-usb/verify-operator-stick-branding.sh:83-84 — compares `<(strings stick | grep | sort -u)` with the ISO's; `strings` (binutils) is never checked. If it is missing both sides are empty, `cmp -s` succeeds and the script prints "stick branding strings match ISO file". Fix: `command -v strings` guard.
- `QUALITY` tools/eggs/live-usb/verify-operator-stick-branding.sh:41-42,82 — reads up to 4 GiB twice from the stick and ISO; slow but deliberate.

## tools/eggs/live-usb/verify-plymouth-animation-frames.sh
- `OK`

## tools/eggs/live-usb/verify-startup-on-host.sh
- `QUALITY` tools/eggs/live-usb/verify-startup-on-host.sh:18-22 — required list lacks `verify-decklink.sh`, which verify-iso-squashfs-excludes.sh:383 requires in the squashfs. The host gate passes, the post-produce gate then fails. `REPO_ROOT` (line 8) is unused. Fix: add the file to the list.

## tools/eggs/live-usb/verify-stick-iso.sh
- `OK`

## tools/eggs/live-usb/write-exfat-starter-bundle.js
- `QUALITY` tools/eggs/live-usb/write-exfat-starter-bundle.js:52-58 — `copyCasparTemplate` silently does nothing when config/casparcg.config.iso is missing; the script still prints "OK: starter configs + show" with no casparcg.config on the stick. Fix: warn or fail.

## tools/eggs/live-usb/write-iso-default-config.js
- `RISK` tools/eggs/live-usb/write-iso-default-config.js:112-115 — `_autosave` is assumed to be a directory; if it is a file `fs.readdirSync(full)` throws ENOTDIR outside the `unlinkIfExists` error handler (uncaught stack trace, config already half-reset). Fix: `statSync().isDirectory()` first.
- `QUALITY` tools/eggs/live-usb/write-iso-default-config.js:130-135 — starter project serialized twice; trivial.

## tools/eggs/unused/prepare-eggs-minimal.sh
- `DEAD` tools/eggs/unused/prepare-eggs-minimal.sh:1 — not called anywhere. grep: `rg -n "prepare-eggs-minimal" . --glob '!work/sweep*'` → only tools/eggs/README.md:9 ("not in default pipeline"), work/EGGS_PRODUCE_SAFETY.md:18 ("Not called"), a comment in strip-host-swap-for-live-iso.sh:6, scripts/README.md:276 (`tools/eggs/unused/` = audit trail). Kept on purpose as audit trail; delete or leave per owner.
- `BUG` tools/eggs/unused/prepare-eggs-minimal.sh:239 — if anyone does run it: `${HERE}/live-usb/strip-host-swap-for-live-iso.sh` resolves to tools/eggs/unused/live-usb/ (does not exist), so under `set -e` it dies at line 239 after `rm -rf /opt/old` (235) and the other deletions already ran. Also hard-codes `nvidia-driver-535` (265) and purges `linux-headers-6.8.0-*` (289), which contradicts WO-433 (headers must ship for DeckLink DKMS) and the 7.0/615 box. Usage line 216 names a stale path.

## tools/eggs/verify-w02-structure.js
- `QUALITY` tools/eggs/verify-w02-structure.js:377-392 — never sets a non-zero exit code, so `npm run verify:structure` (package.json:19) cannot fail; it also warns about a long-gone `backend/` directory. grep: `rg -n "verify-w02|verify:structure" .github tools/ci package.json` → only package.json:19; not in CI. All 28 EXPECTED paths exist today (checked). Fix: `process.exitCode = missing.length ? 1 : 0` or retire the script (WO-02-era layout check).
