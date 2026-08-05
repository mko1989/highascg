# WO-433 — DeckLink install fails on clones (usr/src stripped, phantom headers); scan ~/Downloads

**Status: DONE (2026-08-05 — smoke 4/4, suite green; fragment fix proves out on the next produce; .34 unblock is a one-liner, see QA)**

Owner 05.08: "i dont get why on the installed machine i need to click upload driver package
before i can install it. the driver package was downloaded on that machine and is in the
downloads. the install also errored with a really long error." (192.168.0.34)

## Investigation

**The long error — reproduced live** via `POST /api/system/decklink/install` on .34:

```
linux-headers-6.8.0-117-generic is already the newest version (6.8.0-117.117).
…
[…] vendor: /tmp/…/Blackmagic_Desktop_Video_Linux_16.2/deb/x86_64 version=16.2a1
[…] action: install or upgrade to 16.2a1
ERROR: linux-headers-6.8.0-117-generic installed but /lib/modules/6.8.0-117-generic/build still missing
ERROR: dpkg install failed for 16.2a1
```

(The "install or upgrade" line also shows the owner's WO-431 `dpkg --remove` one-liner was
applied — the phantom desktopvideo gate is past; extraction and vendor detection work.)

Root cause — **two features fight, and the referee is blind**:

- `install-kernel-headers-for-dkms-iso.sh` deliberately bakes `linux-headers-<pinned>` +
  build tools into the clone host **so the DeckLink DKMS build works on installs**.
- BOTH exclude fragments then stripped **all of `usr/src`** ("Kernel/NVIDIA headers —
  build host only", embed-server list) — deleting exactly the tree that script installed.
  `/lib/modules/<kver>/build` is a symlink into `/usr/src/linux-headers-<kver>` (ships,
  dangles).
- The verifier "proved" headers present by grepping `var/lib/dpkg/status` — which ships
  wholesale and CLAIMS the packages (the same phantom-record mechanism as WO-431), so the
  contradiction never failed a produce.
- On the fresh box `decklink_ensure_dkms_prereqs` ran `apt-get install linux-headers-…` →
  apt: "already the newest version" (status says so) → no files restored → hard error.
  The trailing "dpkg install failed" is misleading; dpkg never ran.

**The upload-first UX** — `decklink_vendor_search_dirs` (script) and
`checkDecklinkVendorAvailable` (API, drives the Install button) scanned only
`~/highascg/vendor/decklink` (GUI upload), `~/exfat/decklink`, `~/bridge/decklink` —
never `~/Downloads`, where the package naturally lands when downloaded on the box.
`~/Downloads` is already excluded from ISOs (WO-429), so scanning it is EULA-clean.

## What was done

- **Fragments (both)**: `usr/src` blanket exclude replaced with targeted
  `usr/src/nvidia-*` + `usr/src/blackmagic-*` — the linux-headers trees now ship
  (128M + 29M on disk ≈ tens of MB squashfs; NVIDIA stays prebuilt-only, kernel is
  apt-mark-held so the masked nvidia source tree stays irrelevant). Stale comment fixed.
- **`decklink_ensure_dkms_prereqs`**: when the ready-check still fails after plain
  install, `apt-get install --reinstall` BOTH header packages (`linux-headers-<kver>`
  AND the base `<kver%-generic>` that holds most of the tree) — self-heals phantom
  records on already-burned ISOs (needs apt network); clearer final error message.
- **Verifier**: new check `usr/src/linux-headers-${kver}/Makefile` present as REAL files
  in the squashfs (the dpkg-status grep stays but is phantom-blind, WO-433 comment).
- **Vendor scan**: `~/Downloads` added to `decklink_vendor_search_dirs` (after the GUI
  upload dir, before exfat/bridge) and to `checkDecklinkVendorAvailable` — Install
  arms without any upload when the tar.gz sits in Downloads. Install-button tooltip
  updated to say so.
- Smoke `smoke-wo433-headers-ship-downloads-scan.test.js` pins all four; registered.

## What was VERIFIED to work

- Error reproduced + root-caused live on .34 (see above); vendor pair detection,
  extraction, and the WO-431 gate all confirmed working there.
- Smoke 4/4; decklink exfat-install smoke 6/6 still green; `bash -n` both scripts;
  client rebuilt. Suite/lint/prettier at commit time (see commit).
- NOT yet proven: a produce with usr/src shipping (next produce; the new verifier
  check now guards it), and the --reinstall self-heal end-to-end on .34 (owner QA).

## Owner QA / actions

- [ ] **.34 unblock now** (its scripts predate this fix, no repo sync there):
      `sudo apt-get install --reinstall -y linux-headers-6.8.0-117 linux-headers-6.8.0-117-generic`
      then press Install in the GUI again (upload already staged). The DKMS build takes
      a minute or two; expect action:installed.
- [ ] Next produce: verifier must show `present: usr/src/linux-headers-… FILES in squashfs`.
      Machines installed from it: drop the tar.gz in ~/Downloads → Install button arms,
      no upload step, works offline (headers on board).
- [ ] This box: re-run `sudo bash scripts/exfat/install-exfat-systemd-units.sh` once more
      to install the --reinstall + Downloads-scan lib to /usr/local/lib/highascg/.
