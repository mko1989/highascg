# WO-457 — Windows diskpart "cannot find the file specified" on stick exFAT format; quick-start guide hardened

**Status: IN PROGRESS (doc fix pushed 2026-08-07; awaiting owner retry on the Windows machine)**

Owner report (2026-08-07): after Etcher-flashing the ISO on Windows, creating/formatting the
trailing exFAT partition fails with **"DiskPart has encountered an error: The system cannot find
the file specified"** — both in `diskpart` and in Disk Management. Owner had already removed the
Disk Management path from `docs/STICK_QUICK_START.md` on GitHub (5b7ec510) because it has no
offset option. Decisions for this WO: **no .ps1 script** (guide only), **persistence is
deprecated** (long-standing — scripts live under `tools/eggs/live-usb/legacy-persistence/`),
**fixed 6 GiB offset always** (`offset=6291456` KB / start sector 12582912).

## 1. Investigation

- The error is Windows error 0x80070002 surfacing from the Virtual Disk Service, which both
  diskpart and Disk Management sit on — hence identical failures in both tools.
- Sequence on a fresh Etcher stick: `create partition primary offset=6291456` writes the MBR
  entry and normally succeeds, but the volume manager has not attached a volume object to the
  new partition yet (freshly flashed removable media, isohybrid table Windows half-understands).
  Diskpart's internal `FORMAT` then cannot resolve the volume → "system cannot find the file
  specified". Plain `format.exe` after `assign letter` takes a different path and works; so does
  a replug + reopen of diskpart (volume attaches on re-enumeration).
- Why the offset is load-bearing (not just tidy): Windows does not see the hybrid ISO extent —
  only the small ESP near the 16 MiB mark — so Disk Management / offset-less
  `create partition primary` place the new partition in what Windows thinks is free space,
  i.e. **inside the live image**. A successful format there destroys boot. Same trap is
  documented on the Linux side in
  `tools/eggs/live-usb/legacy-persistence/add-union-persistence-partition.sh` ("parted print
  free shows a huge Free Space band after the ESP even though MBR partition 1 still covers the
  whole ISO").
- 6 GiB fixed offset is safe for current ~5 GiB builds (`release.json` sizes); needs revisiting
  only if a build exceeds ~5.5 GiB. Owner chose a fixed value over per-ISO math for guide
  simplicity.
- Related stale material: `client/tools/live-usb/windows/make-highascg-stick.ps1` runs an
  offset-less diskpart `CREATE PARTITION PRIMARY` + diskpart `FORMAT` — the exact dangerous +
  flaky path above. Owner explicitly does **not** want the .ps1 route; left untouched this WO
  (candidate for deletion/deprecation banner in a follow-up). `USB_STICK_AFTER_FLASH.md` (also
  touched by WO-453) still describes the deprecated persistence layer.

## 2. What was done

`docs/STICK_QUICK_START.md` only (the guide the owner points Windows users at):

- §3 Windows rewritten as two explicit steps: (1) diskpart `create partition primary
  offset=6291456` + `assign letter=E`, (2) **format OUTSIDE diskpart** with
  `format E: /FS:exFAT /V:HIGHASCGEXF /Q` — with the "cannot find the file specified" failure
  named inline plus a recovery path (cancel format popups, replug, `list partition`, assign,
  format) since the partition usually exists after the error.
- Added the rationale line: partition must start at the 6 GiB mark because the boot image is
  invisible to Windows; this is why Disk Management is unusable (no offset option).
- macOS §3 step 5: variable "ISO size + 1.5 GiB" rule replaced with the same fixed 6 GiB
  (sector 12582912) rule.
- Header: USB minimum restated as 16 GiB practical (fixed 6 GiB offset), 32 GiB recommended.
- Troubleshooting table: new row for the diskpart error.

## 3. What was VERIFIED

- No CI smoke greps `STICK_QUICK_START.md` (`rg` over test/tools + curated FILES list) — doc
  edit cannot trip the source-text smokes.
- `offset=6291456` KB = 6 GiB and sector 12582912 × 512 B = 6 GiB cross-checked.
- **NOT verified: the format-outside-diskpart remedy on the owner's actual Windows machine** —
  that retry is the owner QA for this WO. On success, flip status to DONE; if `format.exe` also
  fails there, next steps are in this WO's investigation notes (replug + reassign first, then
  suspect the specific isohybrid table).
