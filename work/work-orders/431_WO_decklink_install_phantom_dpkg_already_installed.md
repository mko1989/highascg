# WO-431 — GUI DeckLink Install says "already installed" on fresh clones (phantom dpkg entry)

**Status: DONE (2026-08-05 — payload-presence gate in the install lib; smoke 6/6; owner one-liner clears the second box, see QA)**

Owner 05.08: "tried installing the decklink drivers but got already installed. on the
second machine" (192.168.0.34, fresh ISO install, package uploaded via WO-427 GUI flow).

## Investigation

The Install path is `decklink_needs_install_from_vendor` →
`decklink_both_packages_installed_at_least` → `decklink_pkg_installed_version`
(`scripts/lib/decklink-install-lib.sh`), which trusts **`dpkg-query -W` alone**.

On an eggs clone that check lies: the WO-92/430 exclude fragment masks every Desktop
Video payload file AND `var/lib/dpkg/info/desktopvideo.*`, but a single package record
**cannot be excluded from `/var/lib/dpkg/status`** — the whole file ships. So a fresh
install has dpkg claiming `desktopvideo 16.2…` installed with nothing on disk (a
phantom install). The version compare passes → `reason="already installed (>= …)"` →
skip. Live evidence on .34 (API :4200, 05.08): `vendorAvailable: true` (upload arrived),
`updaterPath: null` (`dpkg -L desktopvideo` fails — info/ masked), no Caspar DeckLink
enumeration, yet Install answered "already installed".

Same-machine ground truth for the sentinel: `dpkg -L desktopvideo` on the build host
shows `/usr/lib/blackmagic/DesktopVideo/DesktopVideoHelper` — a payload binary the
fragment always masks (`usr/lib/blackmagic/*`).

## What was done

- `scripts/lib/decklink-install-lib.sh` — new `decklink_payload_present()`
  (checks `/usr/lib/blackmagic/DesktopVideo/DesktopVideoHelper`);
  `decklink_both_packages_installed_at_least` now requires it besides the dpkg version,
  so a phantom entry falls through to "install or upgrade" and `dpkg -i` runs (dpkg
  handles the same-version reinstall; missing maintainer scripts of the phantom old
  version are treated as success by dpkg).
- `tools/smoke/smoke-decklink-exfat-install.test.js` — the existing skip test now stubs
  `decklink_payload_present` true (keeps CI deterministic on driverless runners); new
  phantom test: dpkg says 16.0.1a2 + payload absent → `NEEDS_INSTALL:install or upgrade`.

## What was VERIFIED to work

- `node --test tools/smoke/smoke-decklink-exfat-install.test.js`: 6/6 pass (was 4);
  `bash -n` clean. Full offline suite green (see commit).
- Live evidence on .34 captured via API as above; the fix itself is NOT yet on .34
  (see QA — the ISO's repo predates it and the box is not a Syncthing peer).

## Owner QA / actions

- [ ] **Second box, immediate unblock** (no repo update needed): in a terminal on .34
      `sudo dpkg --remove desktopvideo-gui desktopvideo`
      (dpkg warns "files list file … missing; assuming package has no files" — that IS
      the phantom; the warning is expected and harmless), then press Install in the GUI
      again. It should now run the real dpkg install from the uploaded package.
- [ ] This box: the fixed lib reaches `/usr/local/lib/highascg/` only via the still-owed
      `sudo bash scripts/exfat/install-exfat-systemd-units.sh` (same debt as WO-427).
- [ ] ISOs produced after WO-430's fragment fix still ship the phantom status entry
      (unavoidable); with this lib fix on board, the GUI Install just works on future
      fresh installs — that is the accepted end state, no status-db surgery at first boot.
