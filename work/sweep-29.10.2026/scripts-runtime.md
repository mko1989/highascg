# scripts/runtime — sweep 29.10.2026 (batch 059)

Files: 6 · lines: 452 · findings: 0 BUG-HIGH, 1 BUG, 1 DEAD, 2 RISK, 4 QUALITY

Note: despite its name this directory holds installers/helpers that `scripts/exfat/install-exfat-systemd-units.sh` copies to `/usr/local/lib/highascg/` (see scripts/README.md:165).

## scripts/runtime/decklink-install-from-exfat.sh
- `BUG` scripts/runtime/decklink-install-from-exfat.sh:60,65,84 — see `scripts/lib/decklink-install-lib.sh` findings: `decklink_needs_install_from_vendor` and `decklink_find_newest_vendor_pair` each extract a vendor `.tar.gz` into a new temp dir (first one lost), the `skip:`/`dry-run` exits (L62, L67, L81) leave the dir behind, and `decklink_install_vendor_pair` runs under `if` so a failed `dpkg -i` is still logged as `ok: installed` (L85) and the `ERROR` branch (L90) is unreachable for dpkg failures. Runs on every boot (`highascg-decklink-install.service`, `Before=casparcg-server`).
- `QUALITY` scripts/runtime/decklink-install-from-exfat.sh:25-27,42,44 — `BOOT` and `VERBOSE` are parsed but never read (`--boot`, `--verbose` are no-ops).

## scripts/runtime/highascg-clean-slate-reset.sh
- `RISK` scripts/runtime/highascg-clean-slate-reset.sh:105-109,114-117 — protection is per entry, but deletion of a directory is `rm -rf` (no `--one-file-system`). `find -depth` visits children first and skips a protected child (mount point or foreign device, L75-89), then reaches its unprotected parent and `rm -rf` descends into the mount. Failing case: any mount below `media/` that is not under `media/{bridge,exfat,drive}` (e.g. a USB mounted at `media/projects/usb`) → `rm -rf media/projects` wipes the USB's contents although `usb` was counted as skipped. Fix: `rm -rf --one-file-system`, or skip any directory that contains a skipped path.
- `QUALITY` scripts/runtime/highascg-clean-slate-reset.sh:106-107 — `set -e` + a failing `rm` aborts without the final JSON line that the caller (`tools/runtime/clean-slate-reset.js:186-195`, `JSON.parse(last line)`) expects, so a partial wipe is reported as a thrown parse error rather than counts.

## scripts/runtime/highascg-set-system-time.sh
- `QUALITY` scripts/runtime/highascg-set-system-time.sh:34 — the usage/validation claims strict arguments, but the `set` guard is `$# -lt 3 || $# -gt 4`, so a 4th argument is accepted: `set 2026-01-01 10:00 anything` passes validation and the 4th arg is ignored; `status foo bar` is accepted too (L20-22). Tighten to exactly `$# -eq 3` / `$# -eq 1`.
- `QUALITY` scripts/runtime/highascg-set-system-time.sh:84-86 — dead branch: the time regex at L47 already requires a `:`, so `! [[ "$time_arg" =~ : ]]` can never be true. (HH:MM is not padded with seconds here; `timedatectl` accepts it.)
- Live: copied by `scripts/exfat/install-exfat-systemd-units.sh:55,71`, called from `src/api/system-time.js:12`; sudoers entry present on the box.

## scripts/runtime/install-network-apply.sh
- `DEAD` scripts/runtime/install-network-apply.sh:1-30 — no live caller. grep: `grep -rn "install-network-apply" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=work .` → only `scripts/deprecated/legacy/install-phase4.sh:268` and scripts/README.md:227. The live paths install the helpers themselves (`setup/14-power-button-network-reset.sh`, `scripts/exfat/install-exfat-systemd-units.sh`).
- `RISK` scripts/runtime/install-network-apply.sh:22-29 — the sudoers file is written straight into `/etc/sudoers.d/` and only validated afterwards (`visudo -cf` L28, after `chmod`). `USER_CASPAR="${1:-casparcg}"` is interpolated unchecked (no `getent`). Failing case: a bad `$1` → `visudo -cf` fails, `set -e` exits, and the broken `/etc/sudoers.d/highascg-network` stays in place; sudo then rejects the whole config ("parse error … no valid sudoers sources found") and locks out every NOPASSWD helper. `setup/12-passwordless-sudo.sh:30-69` shows the right pattern (temp file → `visudo -cf` → `install`).

## scripts/runtime/remove-highascg-https-proxy.sh
- `OK` — idempotent, `DRY_RUN` wrapper `run()` covers every mutation, `|| true` only on "already gone" steps; caller `tools/eggs/live-usb/prepare-eggs-clone-with-exfat.sh:135`; unit is already masked on the box.

## scripts/runtime/remove-highascg-web-proxy.sh
- `OK` — guarded root check, `rm -f`, logs truncated not deleted; caller `prepare-eggs-clone-with-exfat.sh:128`. (`PURGE=1` hides apt errors with `>/dev/null 2>&1 || true`, acceptable for a removal helper.)
