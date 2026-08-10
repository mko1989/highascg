# WO-462 — New ISO won't boot from Ventoy: "invalid magic number / you need to load the kernel first"

**Status: IN PROGRESS (root cause proven + stick recopied 2026-08-10; owner QA: boot the stick)**

Owner (todos10.08): *"ive built new eggs and it wont start from the stick. it says invalid magic
number you need to load the kernel first."*

## 1. Investigation

The two messages are one sequence: GRUB's `linux` command aborts with **"invalid magic number"**
when the file it loaded is not a bzImage, and the following `initrd` line then reports
**"you need to load the kernel first"**. So `linux /live/vmlinuz-6.8.0-117-generic` read bytes
that were not a kernel. Note what this implies: GRUB had already read `grub.cfg`, `theme.cfg`,
`font.pf2` and `splash.png` off the same ISO — the owner *saw the branded menu* — so the early
blocks of the image were intact.

**The built ISO is provably good.** On the build host:

- `xorriso -toc` reports **1 827 840 data blocks**; 1 827 840 × 2048 = **3 743 416 320** bytes,
  exactly the file size. The image is internally consistent, not truncated.
- `/live/` contains `vmlinuz-6.8.0-117-generic`, `initrd.img-6.8.0-117-generic`,
  `filesystem.squashfs`, and the grub.cfg `linux`/`initrd` lines reference those exact versioned
  names — no path mismatch.
- The extracted kernel is `Linux kernel x86 boot executable bzImage, version 6.8.0-117-generic`,
  first bytes `4d 5a` (`MZ`).
- `sha256 = caef6125a74b1a95beaf9787c78ef213b32d091e69d107e603daa51730321436`

**The copy on the stick was corrupt.** With the stick mounted on the build host:

| | source `/home/eggs/…` | stick `…/exfat/…` |
|---|---|---|
| size | 3 743 416 320 | 3 743 416 320 (**identical**) |
| sha256 | `caef6125…21436` | `91c13b70…743fb` (**differs**) |
| `/live/vmlinuz-…` first bytes | `4d 5a` (`MZ`) | `0f 94 55 c2` |
| `file` on that kernel | `Linux kernel x86 boot executable bzImage` | **`data`** |

`cmp` puts the **first differing byte at offset 268 423 169** (~256 MiB). Everything before that
matches; `/boot/grub/grub.cfg` extracted from the stick image is byte-identical to the source.
Everything after is stale.

**Root cause: the copy was never flushed.** exFAT committed the directory entry with the full
3.7 GB size while only the first ~256 MiB of data reached the device; the remaining clusters still
held whatever was there before. The stick was pulled (or the copy abandoned) before the page cache
was written back. That produces precisely the observed failure shape — a correct-looking file, a
menu that renders from the early blocks, and a garbage kernel further in.

**Ruled out:** an ISO/Ventoy format incompatibility. The same Ventoy stick already booted the
structurally identical 2026-08-07 ISO on machine `.27` (its VTOYEFI carries that build's
`2026-08-07-12-40-19-00` volume id). Nothing about the ISO layout changed; only this file's
contents on the stick.

**Why nothing warned:** `ls -l` on the stick shows the correct size, so the copy looked complete.
Size is not evidence of a good copy — only a hash is.

## 2. What was done

- Deleted the corrupt ISO from the stick, re-copied from `/home/eggs`, ran `sync`, and re-hashed
  (result recorded in §3).
- `tools/eggs/live-usb/verify-stick-iso.sh` (new) — compares an ISO on a stick against the build
  output: size first, then sha256, and on mismatch prints both hashes plus the first differing
  byte offset. `--all <mount-point>` sweeps every ISO >100 MB on the stick. Exits non-zero with
  "Do NOT boot this stick" so it can gate a copy script later. The header documents the failure
  mode above, because the symptom (a GRUB error about magic numbers) points nowhere near the
  actual cause (an unflushed copy).

No change to the ISO build: it was never at fault.

## 3. What was VERIFIED to work

- Every claim in §1 is a command run on the build host with the stick attached — image block
  arithmetic, kernel extraction from **both** copies, `file` output, both sha256 values, and the
  `cmp` offset. The corrupt kernel was extracted from the stick image itself, which is as direct
  as this gets: GRUB's error is reproduced by `file` calling the same bytes `data`.
- **Recopy verified.** After `rm` + `cp` + `sync`, the stick copy hashes
  `caef6125a74b1a95beaf9787c78ef213b32d091e69d107e603daa51730321436` — **identical to the source**.
  The stick now carries a byte-correct ISO.
- `verify-stick-iso.sh` exercised on all three outcomes with synthetic files: identical → `OK`,
  rc 0; short file → `size differs … copy truncated`, rc 1; **same size with one flipped byte** →
  `CONTENT DIFFERS at identical size`, both hashes, `first differing byte: byte 500001`, rc 1.
  That third case is this incident's exact shape, so the helper is proven against it rather than
  merely written for it. `bash -n` clean; usage and missing-file paths exercised.

**Remains (owner):**

1. Boot the stick. The ISO also now carries the WO-458 Ventoy mount fix and the WO-459 slideshow
   wording — but **only if this stick's ISO was built after those commits**; the 1128 build
   predates them, so a fresh `build-highascg-egg.sh` is still owed for those two.
2. Standing rule: after copying an ISO to a stick, `sync`, unmount, then
   `bash tools/eggs/live-usb/verify-stick-iso.sh <iso-on-stick>` before trusting it. Pulling a
   stick without unmounting is what caused this.
3. If a recopy ever fails verification a second time, suspect the stick/port rather than the
   procedure — read-back here ran at ~14 MB/s, which is USB-2-class and unusually slow for this
   hardware.
