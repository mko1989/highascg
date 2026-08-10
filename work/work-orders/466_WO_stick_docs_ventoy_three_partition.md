# WO-466 — Stick documentation moved to Ventoy + a reserved exFAT partition at the end

**Status: DONE in repo (2026-08-10; owner QA: follow the guide once end-to-end on a fresh stick)**

Owner (todos10.08): *"change quickstart guide and any place that references the iso flash to the
new way using ventoy and additional exf partition at the end of the stick."*

## 1. Investigation

This **reverses** the layout decision recorded in WO-458 earlier the same day (*"i dont see a
point in creating an additional partition"*). The sticks the owner actually built afterwards use
the three-partition layout, confirmed on the 57.3 GB stick attached to the build host:

```
sdb1  37.3G  exfat  Ventoy        ← ISO files
sdb2    32M  vfat   VTOYEFI       ← Ventoy boot partition
sdb3    20G  exfat  HIGHASCGEXF   ← operator data
```

WO-458's decision paragraph has been rewritten to point here rather than left contradicting the
guide — a settled-then-reversed ruling is exactly the kind of corpse the CLAUDE.md rule about
DEPRECATED work orders exists to prevent.

**Why the third partition is right, beyond preference:** while a machine is booted from a Ventoy
stick, Ventoy holds partition 1 open through the dm map it builds for the ISO, and Linux cannot
mount it (WO-458: EBUSY on every attempt). Operator data on that partition is unreachable at
precisely the moment it is needed. WO-458's `/dev/mapper` resolver makes the single-partition case
survivable; it does not make it a good layout.

**Survey of what still taught the old flow** (`rg -il 'etcher|diskpart|dd if=|6291456|12582912'`):
39 files matched. Most are work orders (historical record — left alone), scripts that still
implement the `dd` path, and smoke tests. The operator-facing documentation was the target:

| File | State before |
|------|--------------|
| `docs/STICK_QUICK_START.md` | Full Etcher procedure, fixed 6 GiB offset, Etcher screenshots |
| `tools/eggs/live-usb/MANUAL_STICK_WINDOWS_MACOS.md` | Second full Etcher procedure (duplicate) |
| `client/tools/live-usb/USB_STICK_AFTER_FLASH.md` | `dd` + union persistence — actively wrong |
| `tools/eggs/live-usb/HOW_TO_BUILD_AND_FLASH_EGGS.md` | `build-produce-flash-stick.sh` (dd) |
| `tools/eggs/live-usb/BUILD_AND_FLASH.md` | dd-first, no mention of Ventoy |
| `docs/README.md` | Index row said "Etcher" |

Three of those documented the **same** procedure independently. That duplication is how the
6 GiB offset rule survived in three places at once, so the fix reduces the count rather than
updating all three in parallel.

## 2. What was done

- **`docs/STICK_QUICK_START.md` — rewritten** as the single procedure: download → install Ventoy
  with **Option → Partition Configuration → "Preserve some space at the end of the disk"** →
  create `HIGHASCGEXF` in the reserved tail → **copy the ISO to the Ventoy partition, eject
  safely, verify the hash** → starter zip onto `HIGHASCGEXF` → boot (Ventoy menu, then the
  HighAsCG GRUB menu). The three-partition table replaces the old two-layer one; the checklist and
  troubleshooting are rewritten around the failures actually hit this week, with *"invalid magic
  number"* first.
- **Windows-only, Disk Management, 32 GiB** (owner, second pass). The Linux and macOS partitioning
  sections were removed rather than kept as alternatives — the owner creates sticks on Windows, and
  a guide with three OS paths is a guide with two untested ones. Partitioning is now the **standard
  Disk Management** wizard (`Win + X` → Disk Management → right-click Unallocated → New Simple
  Volume → exFAT, label `HIGHASCGEXF`), not `diskpart`.

  **This reverses WO-457 specifically.** That WO removed Disk Management from the guide because it
  has no offset option, so an offset-less partition landed *inside* the flashed boot image. Under
  Ventoy the reserved space is the only free region and sits at the end of the disk, so the
  objection is gone — the guide says so in place, since an operator who remembers the old rule
  needs to know why it no longer applies. Sizing: **32 GiB stick, reserve 10000 MB**, which still
  leaves room for four or five ~3.7 GiB ISOs.
- **Nine `<!-- SCREENSHOT: … -->` placeholders** left at the points that need them (Ventoy device
  selection, the Partition Configuration dialog, Disk Management with the unallocated block, the
  format page, the ISO on the Ventoy root, the unzipped layout, the Ventoy and GRUB menus). The
  owner is adding the images. The old Etcher screenshots are dropped rather than left showing a
  retired tool.
- **`MANUAL_STICK_WINDOWS_MACOS.md` — narrowed** from a duplicate procedure to what was unique in
  it: the folder-by-folder layout of `HIGHASCGEXF`, server-drop mechanics, and the copy hazards.
  Stick-making now points at the quickstart.
- **`USB_STICK_AFTER_FLASH.md` — replaced** with a superseded notice. It taught `dd` plus the
  union persistence layer; following it breaks a Ventoy stick.
- **`HOW_TO_BUILD_AND_FLASH_EGGS.md` — rewritten** for `build-highascg-egg.sh` + copy-to-Ventoy,
  including the one-produce-per-boot rule (WO-464) and the `Done. ISO:` / `.sha256` wait (WO-462).
- **`BUILD_AND_FLASH.md`** — Ventoy banner at the top stating that the `dd` flow destroys a Ventoy
  stick *and its data partition*; build-only command promoted; the `dd` sections kept and labelled
  legacy, for recovery and non-Ventoy media.
- **`docs/README.md`** — index row updated.

Two errors were caught in the first draft's Linux section. That section was then removed by the
Windows-only pass, so neither is in the shipped guide — recorded here because the facts stay true
for anyone partitioning a stick from Linux:

- **`mkfs.exfat -L`, not `-n`.** Ubuntu 24.04 ships `mkfs.exfat` from **exfatprogs**, whose label
  flag is `-L`; `-n` is the older `exfat-utils` spelling and fails. Confirmed against
  `mkfs.exfat --help` and `dpkg -S` on the build host rather than assumed.
- **`parted` needs explicit bounds.** The draft had `mkpart primary` with no start/end, which
  cannot work; the free region has to be read from `parted … unit MiB print free` first.

Also noted and then dropped with the same pass: Ventoy has **no official macOS installer**. It is
no longer in the guide because the guide is Windows-only, but it is the reason a macOS path could
never have been a peer alternative — a Mac can only maintain a stick someone else prepared.

## 3. What was VERIFIED to work

- **Every relative link in all six edited files resolves** — checked programmatically against the
  filesystem. Caught a real error: the superseded notice used `../../../../docs/…` where
  `client/tools/live-usb/` is three levels deep, so all three of its links were broken.
- No live instruction to use Etcher, `dd` for an operator stick, or the 6 GiB offset survives in
  the operator path; the two remaining textual mentions are explicitly historical ("retired",
  "no longer applies"), which is deliberate — silently deleting the offset rule would leave
  operators with older sticks unable to place what they are looking at.
- `node tools/ci/check-max-file-lines.js` → 0 over 500. Full offline suite: **1929 pass / 0 fail /
  2 skip** (no test reads these docs; run to confirm nothing was coupled to them).

**Remains (owner):**

1. Walk the guide once on a fresh 32 GiB stick. The step most worth confirming is **step 3** —
   Disk Management on the unallocated block — because WO-457 explicitly banned that tool and an
   operator who remembers the ban needs to see it work.
2. Add the images at the nine `<!-- SCREENSHOT: … -->` markers.
