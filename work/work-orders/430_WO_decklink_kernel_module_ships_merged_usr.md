# WO-430 — "Driver-free" ISOs ship the DeckLink kernel module (merged-usr exclude miss)

**Status: DONE (2026-08-05 — fragment + verifier + smoke green; squashfs-PROVEN same day: the 10:32 produce (`highascg-nvidia-595_amd64_2026-08-05_1032.iso`) passed the full verifier incl. `absent (DeckLink): usr/lib/modules/*/updates/dkms/blackmagic*`)**

Owner 05.08: "on the second machine that i installed the iso just now, again the decklink
card displays in the devices tab even though the drivers are not installed" (box 192.168.0.34).

## Investigation

**The card showing is NOT a bug.** The second box physically contains a DeckLink 8K Pro
(`lspci` sees it with zero drivers), and WO-428 (closed 04.08, owner-QA'd) deliberately
shows a physically present PCI card even driverless so the WO-427 GUI upload→Install flow
has something to attach to. `probeDecklinkFromOs()` in
`src/utils/decklink-enum.js:154` is the path: lspci model name + `/dev/blackmagic` io
nodes, explicitly "still report card so UI is not blank" (line 205).

**The real finding: the box is NOT driver-free — the ISO shipped the kernel module.**
Probed live via `GET http://192.168.0.34:4200/api/system/decklink`:

- `driverHealth.driverVersion: "16.2a1 loading"` — kernel ring buffer of the CURRENT boot
  (`journalctl -k`, read by `probeDecklinkDriverHealth`) says the BlackmagicIO driver loaded.
- `ioNodes: ["io0".."io3"]` — `/dev/blackmagic/io0-3` exist; only the kernel module creates those.
- Meanwhile userspace IS masked as intended: `updaterPath: null` (`dpkg -L desktopvideo`
  fails — `var/lib/dpkg/info/desktopvideo.*` excluded), ffmpeg has no decklink format,
  Caspar log `caspar_2026-08-05.log` shows no DeckLink enumeration.

Root cause — **merged-usr**: on this Ubuntu, `/lib -> usr/lib` (symlink, verified on the
build host). mksquashfs stores the real files only under `usr/lib/...`; eggs excludes are
anchored, so the WO-92 fragment lines

```
lib/modules/*/updates/dkms/blackmagic.ko*        # matches nothing — lib/ is a symlink entry
lib/udev/rules.d/55-blackmagic.rules             # same
```

never matched the real paths (build host ground truth:
`/usr/lib/modules/6.8.0-117-generic/updates/dkms/blackmagic{,-io,…snd}.ko.zst`,
`/usr/lib/udev/rules.d/55-blackmagic.rules`). So every ISO produced from this box ships
the DKMS modules; on a machine with a DeckLink present, PCI modalias autoloads them at
boot — hence "16.2a1 loading" and `/dev/blackmagic` on a fresh, "driverless" install.
`verify-iso-squashfs-excludes.sh` passed because its DeckLink needles
(`usr/lib/blackmagic`, `var/lib/dkms/blackmagic`, `lib/udev/...`) are exactly the paths
that WERE masked or equally symlink-blind — it never looked under `usr/lib/modules/`.

This dents WO-429's "ISOs ship driver-free = EULA-clean" claim: userspace (the Desktop
Video tools/libs, the part with install-time EULA acceptance) never shipped, but the
proprietary kernel module did.

## What was done

- `tools/eggs/live-usb/penguins-eggs-exclude-decklink.list` — added the merged-usr real
  paths: `usr/lib/modules/*/updates/dkms/{blackmagic,blackmagic-io,snd_blackmagic-io}.ko*`
  and `usr/lib/udev/rules.d/55-blackmagic.rules` (kept the old `lib/...` lines; harmless
  and correct on a non-merged layout).
- `tools/eggs/live-usb/verify-iso-squashfs-excludes.sh` — DeckLink block now also fails on
  `usr/lib/udev/rules.d/55-blackmagic.rules` and greps
  `usr/lib/modules/*/updates/dkms/(snd_)?blackmagic*` (kernel-version wildcard, so a
  needle-path check can't cover it).
- `tools/smoke/smoke-wo430-decklink-kernel-module-excluded.test.js` — pins both fragment
  lines and both verifier checks; registered in `tools/ci/run-offline-tests.js`.

Not changed: the devices-tab display (intended per WO-428) and the already-loaded module
on 192.168.0.34 (owner's call, see QA).

## What was VERIFIED to work

- Live probe of 192.168.0.34 (API :4200): evidence above captured 05.08.
- Build host: `/lib` symlink + real module paths confirmed by `ls`/`find` (module 16.2a1
  loaded here too, as expected — build host legitimately has the driver).
- `node --test` on the new smoke + WO-429 smoke: 4/4 pass; `bash -n` on the verifier clean.
- NOT yet proven: a produced squashfs without the module — needs the next
  `eggs produce` + verifier run (the verifier will now catch a regression itself).

## Owner QA / actions

- [x] Next produce: verified 05.08 — the owner's 10:32 produce passed the full verifier
      (`absent (DeckLink): usr/lib/modules/*/updates/dkms/blackmagic*`, gh token / history /
      vendor also clean). NOTE: that ISO predates the WO-431 lib fix, so fresh installs
      from it still need the WO-431 one-liner before GUI driver install.
- [ ] Every ISO produced to date ships the kernel module (16.2a1 on the latest). If
      EULA-cleanliness of already-burned sticks matters, re-produce after this fix.
- [ ] The second box (192.168.0.34) currently runs the leaked module. Options: leave it
      (you'll likely install the full driver via the WO-427 GUI anyway) or remove
      `/usr/lib/modules/*/updates/dkms/*blackmagic*` + `depmod -a` + reboot for a truly
      clean baseline. SSH publickey to that box was refused from this machine — done by
      hand or fix key seeding first.
