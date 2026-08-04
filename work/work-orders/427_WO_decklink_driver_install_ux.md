# WO-427 — DeckLink driver install a normal user can actually do (GUI upload + the dead WO-188 button resurrected)

**Status: DONE in repo, LIVE-verified on the JS side (2026-08-04 — upload endpoint probed: bad name → 400, valid name → staged + `vendorAvailable:true`, cleaned up after; suite 1826/0/2; client rebuilt). Bash-lib half needs the owner's installer re-run below before the boot/stick paths see the local dir.**

Owner: "i need an easy way for users to install the decklink drivers because as far as i know
i cant really ship it with the driver already installed (unless i can). there was something
already done in that direction but we need to make it more robust and easy for the end user."

## Can the driver ship pre-installed? No.

Blackmagic's Desktop Video is distributed under a EULA click-through with no redistribution
right — baking the debs (or an installed driver) into the public ISO/repo is not allowed.
The legal shape is exactly the vendor-dir design WO-92 chose: the USER downloads the free
package from blackmagicdesign.com/support once and supplies it; the box installs it. This WO
makes that supply step a browser action.

## Investigation — "something already done": shipped in WO-92/WO-188, and HALF OF IT WAS DEAD

Working: boot-time auto-install from a stick's `decklink/` dir (`highascg-decklink-install.
service`), tar.gz extraction, `POST /api/system/decklink/install` (password-gated, sudo
helper + sudoers present on this box — verified).

Dead: the Settings "Install" button from WO-188 T188.3 — `wireDecklinkInstallListener()` was
exported but NEVER CALLED, and `#decklink-install-btn` NEVER EXISTED in the settings template
(same shipped-but-unwired class as WO-424's update flow; it sat in the unwired-exports
baseline the whole time). And even when working, the flow assumed the user knows to put the
tar.gz in a stick's `decklink/` folder — nothing in the GUI said so.

## What was done

1. **Browser upload** — `POST /api/system/decklink/upload` (multipart, raw-stream path;
   registered in router.js): filename whitelisted to
   `Blackmagic_Desktop_Video_Linux_*.tar.gz` / `desktopvideo_*.deb`, streamed to the new
   local vendor dir `~/highascg/vendor/decklink/` with WO-418-style error discipline
   (write/stream errors answered, partials unlinked, 2 GB bound). Upload only STAGES —
   installing stays behind the password-gated Install button.
2. **Local vendor dir scanned first** in both halves: `scripts/lib/decklink-install-lib.sh`
   `decklink_vendor_search_dirs()` and the JS `checkDecklinkVendorAvailable()` (kept-in-sync
   comment on both). USB-stick and bridge paths unchanged.
3. **Settings → decklink tab rebuilt for humans**: a "Driver install / update" section
   explaining exactly what to download and why we can't ship it, a file picker + Upload
   button, the Install button (now actually in the DOM), and result/status lines.
   `wireDecklinkInstallListener` + new `wireDecklinkUploadListener` are now CALLED from
   settings-modal init.
4. `/vendor/` added to `.gitignore` and `.stignore` (250 MB user-supplied packages must never
   hit git or Syncthing peers). **Mirror the `.stignore` line on the Mac** (stignore doesn't
   sync — house rule).

## What was VERIFIED

- LIVE probes after restart: bad filename → 400 with a human message; a correctly-named
  dummy → `{ok, savedAs, dir}` and `vendorAvailable` flipped true (Install button enables),
  false again after cleanup. Suite 1826/0/2, all gates green.
- NOT verified: a real driver install through the new path (needs the real ~250 MB Blackmagic
  package + hardware reboot policy — owner QA when convenient).

## Owner action (this box + before next produce)

The INSTALLED bash lib copy is root-owned; refresh it so boot/stick installs also scan the
upload dir:

```
sudo bash scripts/exfat/install-exfat-systemd-units.sh
```

End-user flow after this ships: Settings → decklink → download Desktop Video for Linux from
blackmagicdesign.com/support on any computer → Upload driver package → Install driver
(nuclear password) → done. No stick, no terminal.
