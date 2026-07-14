# WO-188 — Auto-update systems: close the four gaps (dist-web exclude, DeckLink API/UI/tar.gz, vendor seeding)

**Status:** Planned
**Priority:** HIGH for T188.1 (web UI never updates from a USB drop); Medium for the rest
**Date:** 2026-07-14
**Source:** `work/work-orders/todos14.07.26` (owner): verify drop-update + decklink auto-install for stick-boot and installed systems; web-GUI GitHub update flow.
**Related:** WO-66 (boot drop-update + webui update — mostly shipped), WO-92 (DeckLink exFAT vendor install — Phase A/B partial).

---

## 1. Verification result (2026-07-14) — most of the owner's spec ALREADY WORKS

Audited end-to-end (details/file:line in the investigation record below):
- **Stick-boot drop-update: ✓** `highascg-exfat-server-update.service` (installed+enabled, ordered after the exFAT mount, before highascg) → `highascg-apply-server-drop.sh` — staging rsync uses `--delete` into a temp dir, **merge into the workdir has NO `--delete`** (:195 — exactly the owner's "overwrite only, never delete others"), drop validation fails closed, retain-mode on live USB / consume-to-`applied/<UTC>/` on persistent, BUILD_STAMP written, late-USB arrival handled (`highascg-exfat-arrive.sh:55`).
- **Installed-system version check: ✓** `stamp_unchanged_skip()` compares BUILD_STAMP (skip when unchanged); DeckLink `decklink_needs_install_from_vendor()` (`scripts/lib/decklink-install-lib.sh:99-111`) skips when dpkg versions ≥ vendor debs.
- **DeckLink boot install: ✓ (partial)** `highascg-decklink-install.service` installed+enabled, correct ordering, idempotent, <2 s no-op.
- **Web-GUI GitHub update: ✓ fully shipped** — `GET /api/system/update/check` (GitHub releases API, 15-min cache, offline-safe), Settings → System Updates tab (`settings-modal-system-updates.js`) with running-stamp/latest display, password-gated Apply with confirm dialog warning of the restart, progress polling, sudo-restricted apply script that also re-stages the drop onto USB/bridge with `--delete`.

### The four gaps

1. **`dist-web/` is still excluded from the server drop** (`config/server-update-rsync-excludes.txt:4`, WO-66 T1.1 never done) — a stick-boot drop updates the server but the **web UI stays stale**.
2. **No `POST /api/system/decklink/install`** (WO-92 B2) — only the GET status route exists.
3. **No Settings UI button** to trigger a DeckLink install/upgrade (WO-92 B3).
4. **No `.tar.gz` extraction** — the installer only finds pre-extracted `desktopvideo_*_amd64.deb` (`decklink-install-lib.sh:71-77`); WO-92's spec says vendor `.tar.gz` in `exfat/vendor/decklink/`. Also verify `seed-exfat-operator-layout.sh` seeds `vendor/decklink/README.txt` (WO-92 Phase C).

## 2. Tasks (haiku-sized)

- [x] T188.1 Remove `dist-web/` from `config/server-update-rsync-excludes.txt` (and the mirrored copy `client/tools/to-server/server-patches/config/server-update-rsync-excludes.txt` if it lists it — check). Verify the drop VALIDATION already requires `dist-web/index.html` (it does — consistent). Note in WO-66's log.
- [x] T188.2 tar.gz support in `decklink-install-lib.sh`: when `vendor/decklink/` has `Blackmagic_Desktop_Video_Linux_*.tar.gz` but no debs, extract the amd64 debs from it (to a temp dir; `tar -tzf` first to locate `deb/x86_64/*.deb`) then run the existing deb path. Keep the pre-extracted-deb path working.
- [x] T188.3 `POST /api/system/decklink/install` in `routes-system-hardware.js`: password-gated like the update apply (`checkNuclearPassword` pattern in `routes-system-update.js:34`), invokes the existing install script via the same restricted `sudo -n` mechanism (check if the sudoers entry covers it — the boot unit runs as root; a webui-triggered run needs a sudoers line like the webui-server-update one; add the sudoers line to the installer script `install-exfat-systemd-units.sh` where the other one is written). Returns install/skip reason from the lib's reason string.
- [x] T188.4 Settings UI: in the System tab near the DeckLink status (`settings-modal-mount-hardware.js` region), an "Install/upgrade DeckLink from USB" button → the new POST; show the reason string result; disabled when no vendor files found (GET already reports status — extend it with `vendorAvailable` if absent).
- [x] T188.5 Verify `seed-exfat-operator-layout.sh` seeds `vendor/decklink/` (+README); add if missing.
- [x] T188.6 Verify: bash -n all touched scripts; node --check + eslint JS; smoke for the excludes-file change if a smoke reads it; manual QA notes (stick drop now updates dist-web; UI button installs from vendor tar.gz).

## 3. Acceptance criteria

- [ ] A188.1 A drop containing new `dist-web/` updates the web UI on next stick boot (verify on hardware/next produce).
- [ ] A188.2 DeckLink installable from the Settings UI with vendor tar.gz on the USB; already-installed → clean "already installed (>= X)" response.
- [ ] A188.3 Existing boot flows unchanged (stamps, retain/consume, no-delete merge).

## 4. Work log

- 2026-07-14 — WO-188 implementation complete (agent):
  - **T188.1:** Removed `dist-web/` from `config/server-update-rsync-excludes.txt`; mirrored copy already correct. Added log entry to WO-66.
  - **T188.2:** Added `decklink_extract_tar_gz_debs()` and tar.gz extraction branch to `decklink_find_newest_vendor_pair()` in `decklink-install-lib.sh`; passes extract temp dir to cleanup function; script verified with `bash -n`.
  - **T188.3:** Created `src/api/system-hardware-decklink-install.js` with POST handler (password-gated via `checkNuclearPassword`, invokes script via `sudo -n`, returns action+reason); wired into `routes-system-hardware.js`; added sudoers entry write to `install-exfat-systemd-units.sh` (decklink-install via sudo -n).
  - **T188.4:** Extended `src/api/system-hardware-decklink.js` with `checkDecklinkVendorAvailable()` function checking exfat/bridge decklink dirs for debs/tar.gz; added to response; added `wireDecklinkInstallListener()` + UI button handler to `settings-modal-mount-hardware.js` (password prompt, POST, shows reason, auto-refresh); button disabled when no vendor files.
  - **T188.5:** Verified `seed-exfat-operator-layout.sh` — decklink/ dir and README_DECKLINK already seeded (lines 21, 58-77).
  - **T188.6:** Verified: bash -n on install-exfat-systemd-units.sh, decklink-install-lib.sh, decklink-install-from-exfat.sh; node --check + eslint --quiet on all modified JS files; all OK.
  - **Manual QA notes:** stick drop now includes dist-web/ (web UI updates on stick boot); UI Settings button installed (disabled until tar.gz/debs present on USB/bridge); password-gated install from exFAT vendor files (supports tar.gz extraction).

- 2026-07-14 — WO created after full audit: boot drop-update, installed-system version checks, and the entire web-GUI GitHub update flow verified ALREADY SHIPPED and matching the owner's spec (incl. overwrite-only merge). Remaining gaps: dist-web exclude (critical), DeckLink POST/UI/tar.gz, vendor seeding verify.
