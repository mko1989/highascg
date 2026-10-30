# scripts/exfat — sweep 29.10.2026 (batch 054)

Files: 19 · lines: 2774 · findings: 0 BUG-HIGH, 3 BUG, 4 DEAD, 4 RISK, 13 QUALITY

Reference check: every file was grepped by basename across the repo (outside `work/`, `node_modules`, this sweep dir). All are installed by `install-exfat-systemd-units.sh` (into `/usr/local/lib/highascg/`), called from `tools/eggs`, pinned by `tools/smoke/*`, or reached through the `scripts/` root forwarders, except where marked DEAD below. Syntax and logic were read in full; none was run.

## scripts/exfat/apply-bridge-label-highascgdat.sh
- `QUALITY` scripts/exfat/apply-bridge-label-highascgdat.sh:3,13 — usage text names `scripts/apply-bridge-label-highascgdat.sh` (works through the root forwarder, but the canonical path is `scripts/exfat/…`). Calls `scripts/install-exfat-systemd-units.sh` and `scripts/write-highascg-systemd-unit.sh` through forwarders too (lines 29, 31), so deleting the forwarders breaks it. Otherwise `OK`: `blkid -L` guard before any change; every called path exists.

## scripts/exfat/highascg-apply-server-drop.sh
- `RISK` scripts/exfat/highascg-apply-server-drop.sh:173,192-193 — `staging="${staging_parent}/${src_stamp}"` then `rm -rf "$staging"`, where `src_stamp` is the content of the drop's `BUILD_STAMP` (`tr -d '[:space:]'`, line 73), unvalidated. Failing input: a drop whose `BUILD_STAMP` is `../../..` → `rm -rf /var/cache/highascg/update-staging/../../..` = `rm -rf /var` as root. An empty `BUILD_STAMP` makes `staging` the staging parent itself. The drop comes from a release tarball or the Web-UI cache dir (owned by the service user), so this is a robustness hole rather than an attack on a trusted release. Fix: accept `[A-Za-z0-9._-]+` only, else fall back to the date stamp.
- `RISK` scripts/exfat/highascg-apply-server-drop.sh:229-239 — `npm ci --omit=dev` runs on every apply that has a `${dest}/package-lock.json` (the destination's, which always exists — the header and README say "when package-lock.json was in the drop"), not only when the lock changed. `npm ci` deletes `node_modules` first; with the service already stopped and no network (typical venue box) a cold npm cache means `node_modules` is gone and the log says "npm ci failed (continuing)" before the service is started. Fix: compare the new lock with the installed one (`cmp`) and skip when identical; `npm ci --offline` first when no network.
- `QUALITY` scripts/exfat/highascg-apply-server-drop.sh:292-299 — `--print-retain-mode` is handled only as the first argument and calls `should_retain_drop` without a drop root, so the stick check (`drop_on_operator_stick_exfat`) is always skipped. Used by tests/diagnostics only.

## scripts/exfat/highascg-boot-stick.sh
- `OK` — sourced library (mode 0644 by design, installed by `install-exfat-systemd-units.sh:103`). Shell twin of `src/system/boot-stick.js`. Callers: `highascg-exfat-network-apply.sh:74`, `highascg-exfat-server-update.sh:88`.

## scripts/exfat/highascg-bridge-arrive.sh
- `OK` — handles the same `--no-block` race that `highascg-exfat-arrive.sh` misses: after `start_unit home-casparcg-bridge.mount` it re-checks `mountpoint` and falls back to `highascg-bridge-boot.service` (lines 18-24). Installed to `/usr/local/lib/highascg/` and triggered by `config/udev/99-highascg-bridge-arrive.rules`.

## scripts/exfat/highascg-bridge-boot.sh
- `OK` — bounded waits, every failure path `exit 0` (bridge is optional). Installed by the unit installer; referenced by `highascg-bridge-boot.service`.

## scripts/exfat/highascg-exfat-arrive.sh
- `BUG` scripts/exfat/highascg-exfat-arrive.sh:37-43 — `start_unit home-casparcg-exfat.mount` runs `systemctl start --no-block`, then line 40 immediately tests `mountpoint -q`. The job has only been queued, so the check is almost always false and the script logs "exFAT not mounted" and exits 0 — the server-update / network-apply / decklink / sync pipeline for a stick plugged in after boot never starts. `highascg-exfat-boot.sh:101-116` documents exactly this race and polls `mountpoint` for up to 10 s; `highascg-bridge-arrive.sh` has a fallback; this file has neither. Evidence on this box: `journalctl -u highascg-exfat-arrive.service` holds 68 "exFAT not mounted at /home/casparcg/exfat" lines against 46 "pipeline finished" lines (some of the 68 may be genuine mount failures). Fix: poll `mountpoint -q` for a few seconds after the start, as `highascg-exfat-boot.sh` does.
- `BUG` scripts/exfat/highascg-exfat-arrive.sh:45-50 — `rm -rf "${EXFAT_MP}/sim"` runs for any volume labelled `HIGHASCGEXF` that mounts, before any boot-stick check. WO-697 says only the stick the box booted from is touched automatically; any other HighAsCG stick "is a drive the operator saves to by hand". Failing case: an operator's second `HIGHASCGEXF` data stick with a `sim/` folder of their own → deleted on plug-in. Fix: gate the cleanup on `highascg_exfat_is_boot_stick` (sourcing `highascg-boot-stick.sh`).

## scripts/exfat/highascg-exfat-boot.sh
- `QUALITY` scripts/exfat/highascg-exfat-boot.sh:118-133 — when the direct `mount` fails (line 123 only logs a WARN), the script still waits the full 45 s loop for a mount that cannot appear, then exits 1. The unit is ordered before `highascg.service`/`casparcg-server.service`, so a present-but-unmountable stick delays playout by about 45 s plus the earlier 10 s poll. Fix: skip the wait when the direct mount returned non-zero.
- `QUALITY` scripts/exfat/highascg-exfat-boot.sh:8-12 — the 30 s / 12 s default is dead on installed boxes: the generated unit sets `Environment=HIGHASCG_EXFAT_BOOT_WAIT_SEC=30` (`install-exfat-systemd-units-units.sh:216`), so the `/run/live` test never changes anything. Only the WO-471 sticks-less grace shortens it.

## scripts/exfat/highascg-exfat-bootstrap.sh
- `DEAD` scripts/exfat/highascg-exfat-bootstrap.sh — header says DEPRECATED and the installer writes `/etc/highascg/disable-exfat-bootstrap` (`install-exfat-systemd-units.sh:144`) and disables the unit (line 165); no unit or script installs or runs it any more (grep `highascg-exfat-bootstrap`: the installer, `write-highascg-systemd-unit.sh:48` which tests for a unit file nothing creates, docs, `config/bootstrap-rsync-excludes.txt`). The only code that touches it is `tools/smoke/smoke-wo47-manifest.mjs:59`, which asserts the file exists (listed in `package.json:71`, collected by `tools/ci/collect-offline-tests.js`). Deleting it needs that assert and `config/bootstrap-rsync-excludes.txt` dropped together.

## scripts/exfat/highascg-exfat-network-apply.sh
- `QUALITY` scripts/exfat/highascg-exfat-network-apply.sh:120,136-138 — `hostname` and `tailscale` are accepted keys (no "unknown key" note) but nothing reads `CFG[hostname]` or `CFG[tailscale]` afterwards (grep in the file: only the case label). A `hostname=` line in `network.conf` is silently ignored.
- `QUALITY` scripts/exfat/highascg-exfat-network-apply.sh:110-111 — comments are stripped at the first `#` or `;` anywhere in the line, so a `dns=1.1.1.1;8.8.8.8` (semicolon-separated) is cut to the first server without a message; only commas are documented.
- Otherwise `OK`: hash-gated idempotence, validation before apply, WO-702 `vlog` fix present.

## scripts/exfat/highascg-exfat-remount-sync.sh
- `QUALITY` scripts/exfat/highascg-exfat-remount-sync.sh:14-15 — `REPO_ROOT` and `USER_CASPAR` are assigned and never used (the positional user is ignored). Called from `tools/eggs/live-usb/build-highascg-egg.sh:192` and `work/run-eggs-produce-clone-only.sh:81` as `… casparcg`, so the argument is a no-op.

## scripts/exfat/highascg-exfat-server-update.sh
- `OK` — apply failure intentionally exits 0 so the stick boot does not mark the unit failed; boot-stick gate (WO-697) and lock present. (`"${legacy_flag[@]}"` inside the array literal at line 138 needs bash >= 4.4 under `set -u`; Ubuntu 24.04 ships 5.2.)

## scripts/exfat/highascg-fix-config-permissions.sh
- `QUALITY` scripts/exfat/highascg-fix-config-permissions.sh — near-identical duplicate of `tools/runtime/wo47-highascg-fix-config-permissions.sh` (diff: three header comment lines). Only the `scripts/exfat/` copy is installed (`install-exfat-systemd-units.sh:92`); the `tools/runtime/` one is referenced by `tools/eggs/live-usb/stop-and-unmount-wo47-for-eggs-produce.sh`. Two copies to keep in sync.

## scripts/exfat/highascg-webui-server-update.sh
- `BUG` scripts/exfat/highascg-webui-server-update.sh:138-140 — `stage_drop_to_volume` does `mkdir -p "$drop" "${drop}/applied"` and then `rsync … --delete "${src}/" "${drop}/"`. The source has no `applied/`, and `config/server-update-rsync-excludes.txt` does not list it (nor `.applied-stamp`, `.applied-at`, `README.txt`), so `--delete` removes them. Failing case: a stick with `drop-update/applied/<UTC>/` (consume-mode history, `highascg-apply-server-drop.sh:263-266`) → every Web-UI update wipes it. Add `--exclude=/applied/ --exclude=/.applied-*` before `--delete`.
- `RISK` scripts/exfat/highascg-webui-server-update.sh:116-123,230-240 — the source check accepts `/tmp/highascg-updates/*` (world-writable parent) and validates `readlink -f "$src"` but the apply then uses the unresolved `$src` (check-then-use). `refresh_installed_helpers` then copies `scripts/exfat/highascg-webui-server-update.sh`, `…apply-server-drop.sh`, `…exfat-server-update.sh` from the freshly applied tree (service-user-owned) into root-owned `/usr/local/lib/highascg/` — and the first of those is the file the service user may run through sudo. If `casparcg`'s sudo is limited to this helper, a compromised Node process can plant its own helper in the cache dir and get root on the next update. Not exploitable if casparcg already has unrestricted sudo (check `setup/12-passwordless-sudo.sh`).
- `QUALITY` scripts/exfat/highascg-webui-server-update.sh:203 — `[[ $detach -eq 1 ]] && detach_and_exit` is a non-final `&&` list, safe under `set -e`; noted only because the same idiom bit `network-apply` (WO-702).

## scripts/exfat/install-exfat-systemd-units-units.sh
- `RISK` scripts/exfat/install-exfat-systemd-units-units.sh:16,96 — `Options=…,nofail,x-systemd.device-timeout=5,x-systemd.mount-timeout=5` inside a native `.mount` unit. `x-systemd.*` and `nofail` are `/etc/fstab` conventions read by systemd-fstab-generator; in a hand-written unit they are passed through to `mount(8)` and do nothing, so the 5 s timeouts that `highascg-exfat-boot.sh:107` ("the unit carries device-timeout=5 / mount-timeout=5") relies on do not apply (the `[Mount]` key is `TimeoutSec=`). I could not run systemd here to confirm, so this stays a risk: the effect would be a failed mount waiting the default 90 s instead of 5 s.
- `OK` otherwise — sourced fragment (no shebang; mode 0644 by design) of `install-exfat-systemd-units.sh:151`; unit contents match the WO-704 notes.

## scripts/exfat/install-exfat-systemd-units.sh
- `QUALITY` scripts/exfat/install-exfat-systemd-units.sh:238,249 — the second `trap '…' EXIT` replaces the first, so `$TMP_SUDOERS` (the DeckLink sudoers temp file) is never removed. Lines 243 and 254 end `visudo -cf … && install …`; if `visudo` rejects the file nothing is installed but the next line still prints `installed /etc/sudoers.d/…`.
- `QUALITY` scripts/exfat/install-exfat-systemd-units.sh:132 — `chown "$USER_CASPAR:$USER_CASPAR"` (group = user name) while lines 129-131 use `$GNAME`. On a host where the service user's primary group has another name the `chown` fails and `set -e` aborts the installer midway (before the units are written).

## scripts/exfat/install-exfat-units-bridge.sh
- `DEAD` scripts/exfat/install-exfat-units-bridge.sh — never sourced or executed. The installer sources only `install-exfat-systemd-units-units.sh` (line 151). grep `install-exfat-units-bridge`: `scripts/README.md:68` and WO-475 text only. This is a stale copy of part of the live fragment (it lacks the WO-704 additions) and WO-475 even points at it as "what makes the restore a single systemctl start", so an edit here changes nothing. Safe to delete; fix the README and WO-475 pointer.

## scripts/exfat/install-exfat-units-enable.sh
- `DEAD` scripts/exfat/install-exfat-units-enable.sh — never sourced; the same tail (enable/disable lists, echo summary) lives in `install-exfat-systemd-units.sh:164-257`, which additionally has the sudoers sections and the DeckLink cache lib that this copy lacks. grep → `scripts/README.md:69` only. Safe to delete.

## scripts/exfat/install-exfat-units-exfat.sh
- `DEAD` scripts/exfat/install-exfat-units-exfat.sh — never sourced; superseded by `install-exfat-systemd-units-units.sh`. grep → `scripts/README.md:67,187` only (README line 187 claims it installs `highascg-network-apply.sh`; it does not). Safe to delete.

## scripts/exfat/write-highascg-systemd-unit.sh
- `QUALITY` scripts/exfat/write-highascg-systemd-unit.sh:48-50 — adds `highascg-exfat-bootstrap.service` to `After=` when that unit file exists; nothing creates it any more (see the bootstrap script). Harmless.
- `QUALITY` scripts/exfat/write-highascg-systemd-unit.sh:109 — without `HIGHASCG_INSTALL_HEADLESS=1` the script deletes `highascg.service.d/10-headless.conf` on every run, so re-running the installer on a headless box removes its drop-in (WO-52 intent, but it surprises `tools/eggs/live-usb/systemd/highascg.service.d-10-headless.conf.example` users).
