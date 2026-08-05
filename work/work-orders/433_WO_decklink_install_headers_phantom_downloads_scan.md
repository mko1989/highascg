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

## Addendum 05.08 late — the 13:46 produce: verifier false-FAIL + drop-apply poisoning

Owner's 13:46 produce FAILED verification on `unexpected path in squashfs:
usr/src/linux-headers-6.8.0-117` — a **stale absence entry** in the verifier's generic
unexpected-paths list (line 146, from the usr/src-excluded era) that this WO's morning
sweep missed. Removed; replaced with a targeted `usr/src/{nvidia,blackmagic}-*` absence
check. Verifier now PASSES against the real 13:46 squashfs (headers ship correctly).

**But the 13:46 ISO is poisoned and must not be flashed.** Journal-proven chain: at
13:40:41 the owner ran `install-exfat-systemd-units.sh` (WO-433 QA item) with the
to-be-reflashed stick inserted; the exfat arrive pipeline fired and at 13:41:29
`highascg-exfat-server-update.service` applied the stick's `drop-update/` — a server
drop seeded **04.08 15:35** (stamp `2026.05.20`) — over the LIVE repo, 12 s into the
produce (`stamp_unchanged_skip` only skips EQUAL stamps; an older drop applies fine).
Effects, all captured by mksquashfs minutes later:
- `src/api/system-hardware-decklink.js` reverted (Downloads scan gone — the drop only
  carries `src/` + `dist-web/` + package files, which is why only ONE tracked file lost
  content while `scripts/lib/` survived);
- `dist-web/` reverted to 04.08 (the ISO's UI still has the USB video tab, WO-432 undone);
- `BUILD_STAMP` overwritten with the drop's `2026.05.20` — reproducing the exact stale
  stamp the owner reported in WO-432;
- ~544 tracked files got exec bits flipped (exFAT rsync has no permissions);
- node_modules pruned to prod again (`npm ci --omit=dev --prefix` at 13:41:33).

Recovery on the build host (done): Downloads lines re-applied, 544 modes stripped per
`git diff --summary`, README drop-lines reverted, drop-written BUILD_STAMP removed,
`npm install --include=optional` (93 pkgs), client rebuilt. Tree == HEAD again.
`highascg.service` was left stopped (owner's flash-procedure stop; sudo needed to start).

**Open owner decision (NOT implemented — WO-415 ruled stick-insert config clobber
intended, this is the server-drop cousin):** any stick carrying an old `drop-update/`
re-applies that old server tree to the build box on insert, and a produce started near
that window bakes the revert into the ISO. Options if unwanted on THIS box only:
machine-local opt-out flag for `highascg-exfat-server-update.service`, or an
older-than-installed stamp direction guard in `stamp_unchanged_skip`. Field boxes keep
current behavior either way.

## Owner QA / actions

- [ ] **.34 unblock now** (its scripts predate this fix, no repo sync there):
      `sudo apt-get install --reinstall -y linux-headers-6.8.0-117 linux-headers-6.8.0-117-generic`
      then press Install in the GUI again (upload already staged). The DKMS build takes
      a minute or two; expect action:installed.
- [ ] **Do NOT flash the 13:46 ISO** (see addendum) — re-run the produce with no old
      drop-carrying stick inserted (or insert it only when the flash phase asks for it).
- [ ] Decide on the drop-apply-on-build-box question (addendum) — say the word and it
      gets a WO.
- [ ] Next produce: verifier must show `present: usr/src/linux-headers-… FILES in squashfs`.
      Machines installed from it: drop the tar.gz in ~/Downloads → Install button arms,
      no upload step, works offline (headers on board).
- [ ] This box: re-run `sudo bash scripts/exfat/install-exfat-systemd-units.sh` once more
      to install the --reinstall + Downloads-scan lib to /usr/local/lib/highascg/.
