# WO-462 — New ISO won't boot from Ventoy: "invalid magic number / you need to load the kernel first"

**Status: IN PROGRESS (root cause CORRECTED in §1b 2026-08-10 — a build/copy race, not an unflushed write; guard landed; owner must recopy the 1221 stick)**

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

**First conclusion (2026-08-10, WRONG — see §1b): the copy was never flushed.** exFAT was thought
to have committed the size while the data write-back was abandoned, e.g. by pulling the stick.
That explained the shape but not the cause; a second occurrence on a different stick disproved it.

**Ruled out:** an ISO/Ventoy format incompatibility. The same Ventoy stick already booted the
structurally identical 2026-08-07 ISO on machine `.27` (its VTOYEFI carries that build's
`2026-08-07-12-40-19-00` volume id). Nothing about the ISO layout changed; only this file's
contents on the stick.

**Why nothing warned:** `ls -l` on the stick shows the correct size, so the copy looked complete.
Size is not evidence of a good copy — only a hash is.

## 1b. Round 2 — the real root cause (owner: *"new stick with new iso and same issue"*)

A fresh stick with the **1221** build failed identically, which kills the unclean-removal theory.
Same measurements, same verdict — source good, copy bad:

- source `…_1221.iso`: 1 827 840 blocks × 2048 = file size; kernel extracts as a valid bzImage
  (`4d 5a`); `sha256 = 90e6de812a3fdb7104ee5e76f8a1c0e244ed6c891a9757f2cb06c821cfa056a6`
- stick copy: identical size, kernel extracts as **`data`** (`76 a1 79 7b`)
- first differing byte: **2 546 831 361 (~2.37 GiB)** — a clean prefix again, but at a completely
  different offset than the 256 MiB of round 1

**The ISO keeps changing for minutes after it appears.** `build-highascg-egg.sh` runs
`eggs produce` (which creates the file, timestamped in its *name*), then
`patch-iso-squashfs-calamares.sh` (unsquashfs → mksquashfs), then
`inject-iso-boot-branding.sh:152-159` which **re-packs the entire ISO** with xorriso. Filesystem
timestamps on the build host prove the window:

| | time |
|---|---|
| name says | 12:21 |
| `mnt/iso/live/filesystem.squashfs` rewritten | 12:25:51 |
| `mnt/iso/boot/grub/grub.cfg` rewritten | 12:25:54 |
| `mnt/iso/live/initrd.img-…` rewritten | 12:25:59 |
| **final ISO bytes** | **12:26:00.662** |
| stick copy mtime | 12:26:00.660 (= source mtime, truncated to exFAT's 10 ms) |

The stick copy carries the source's **final** mtime, so it was made with a timestamp-preserving
copy that stamped the destination when it finished. But 3.7 GB at this stick's ~14 MB/s takes
4-5 minutes, so the copy must have *started* around 12:21-12:22 — the moment the filename
appeared — and run straight through the re-pack. It therefore read part of the pre-re-pack image
and part of the post-re-pack image. Clean prefix, then divergence, correct total size. Exactly
what both sticks show, and the differing offsets are just where each copy happened to be when the
image was rewritten under it.

**So: the operator started copying as soon as the ISO appeared in `/home/eggs`.** That is an
entirely reasonable thing to do — the file is there, it has a plausible name and a full size — and
nothing in the build said otherwise. The filename's timestamp is the *produce* time, not the
finish time, which actively encourages the mistake. Round 1's "unflushed copy" reading fitted the
evidence available then but named the wrong mechanism; this supersedes it.

## 2. What was done

- Deleted the corrupt ISO from the stick, re-copied from `/home/eggs`, ran `sync`, and re-hashed
  (result recorded in §3).
- `tools/eggs/live-usb/verify-stick-iso.sh` (new) — compares an ISO on a stick against the build
  output: size first, then sha256, and on mismatch prints both hashes plus the first differing
  byte offset. `--all <mount-point>` sweeps every ISO >100 MB on the stick. Exits non-zero with
  "Do NOT boot this stick" so it can gate a copy script later. The header documents the failure
  mode, because the symptom (a GRUB error about magic numbers) points nowhere near the cause.
- **`build-highascg-egg.sh` now writes `<iso>.sha256` as its very last action** (after the
  re-pack steps and after `verify-iso-boot-branding.sh`), and prints "DO NOT copy the ISO to a
  stick before this point" with the copy/`sync`/verify commands. The sidecar's *existence* is the
  ready signal the filename could never be — an ISO with no sidecar is either mid-build or from an
  older build.
- `verify-stick-iso.sh` consumes the sidecar: it uses the recorded hash instead of re-reading the
  source, and warns when the sidecar is missing that it "cannot confirm the build had finished".

The ISO build itself still produces a correct image — the defect was that it gave no way to tell
when the image was finished.

## 3. What was VERIFIED to work

- Every claim in §1 is a command run on the build host with the stick attached — image block
  arithmetic, kernel extraction from **both** copies, `file` output, both sha256 values, and the
  `cmp` offset. The corrupt kernel was extracted from the stick image itself, which is as direct
  as this gets: GRUB's error is reproduced by `file` calling the same bytes `data`.
- **Recopy verified.** After `rm` + `cp` + `sync`, the stick copy hashes
  `caef6125a74b1a95beaf9787c78ef213b32d091e69d107e603daa51730321436` — **identical to the source**.
  The stick now carries a byte-correct ISO.
- **Round 2 guard tested:** `smoke-wo462-iso-copy-race-guard.test.js` (5/5) asserts the sidecar
  exists and — positionally — that it is written *after* `patch-iso-squashfs-calamares.sh`,
  `inject-iso-boot-branding.sh` and `verify-iso-boot-branding.sh`, since a sidecar written before
  the re-pack would certify a torn image. Also pins the "DO NOT copy early" text, the sidecar
  consumption in the verifier, and that a size match still falls through to the hash compare.
  Sidecar-present / sidecar-absent paths exercised live: absent → the warning fires and it falls
  back to hashing the source; present → the recorded hash is used and a corrupt copy still fails.
- `verify-stick-iso.sh` exercised on all three outcomes with synthetic files: identical → `OK`,
  rc 0; short file → `size differs … copy truncated`, rc 1; **same size with one flipped byte** →
  `CONTENT DIFFERS at identical size`, both hashes, `first differing byte: byte 500001`, rc 1.
  That third case is this incident's exact shape, so the helper is proven against it rather than
  merely written for it. `bash -n` clean; usage and missing-file paths exercised.

**Remains (owner):**

1. **Recopy the 1221 ISO** — the current stick copy is torn. The Ventoy partition was mounted
   root-only at `/mnt/ventoy`, so this needs the owner:
   ```
   sudo rm -f /mnt/ventoy/highascg-nvidia-595_amd64_2026-08-10_1221.iso
   sudo cp /home/eggs/highascg-nvidia-595_amd64_2026-08-10_1221.iso /mnt/ventoy/ && sync
   bash tools/eggs/live-usb/verify-stick-iso.sh /mnt/ventoy/highascg-nvidia-595_amd64_2026-08-10_1221.iso
   ```
   Expected source hash: `90e6de812a3fdb7104ee5e76f8a1c0e244ed6c891a9757f2cb06c821cfa056a6`
   (that build has no sidecar — it predates the change; the verifier will warn, which is correct).
2. **Standing rule: wait for the build to print `Done. ISO: …` before copying.** From the next
   build on, the `<iso>.sha256` sidecar is the machine-checkable version of that rule.
3. The 1221 ISO still predates WO-458 (Ventoy dm mount), WO-459 (slideshow wording) and WO-461
   (GRUB contrast). A fresh `build-highascg-egg.sh` is owed for those.
4. Read-back from these sticks runs at ~14 MB/s (USB-2 class). Not a fault, but it is why the copy
   window is minutes wide and why the race is so easy to lose.
