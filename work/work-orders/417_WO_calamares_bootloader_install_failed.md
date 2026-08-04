# WO-417 — Calamares "failed to install boot loader" on target machine (03.08 ISO); session log unrecoverable → log-rescue baked into ISO

**RESOLVED 04.08 — owner: reflash + install on the target machine WORKED ("i already did reflash and install and it worked"). The bootloader failure did not reproduce with the 03.08+ fixes baked in; the session-log rescue stays in the ISO as permanent evidence plumbing. CLOSED.**

**Status: IN PROGRESS (2026-08-03 — ISO payload audited clean, root cause NOT determinable without the target's session log; log-rescue implemented so the next failure is diagnosable. Needs next produce + owner retry)**

Owner report (`todos03.08.26` line 33): ran `eggs produce` + flash, took the stick to a
different machine, ran the Calamares installer — install failed with "failed to install
boot loader". (The produce+flash run itself is WO-416 — the flash died in phase 2/5;
the ISO slice was complete, which is why the stick still live-booted.)

## Investigation

**The shipped ISO's bootloader machinery is intact.** Audited the actual artifact from the
failed run — `/home/eggs/mnt/highascg-nvidia-595_amd64_2026-08-03_1259.iso`'s squashfs tree
(unpacked at `/home/eggs/mnt/squashfs-calamares-patch-root`, the exact tree
`patch-iso-squashfs-calamares.sh` repacked at 13:03):

- `etc/calamares/modules/bootloader.conf` — full sbin paths (`/usr/sbin/grub-install` etc.,
  the WO-73-era chroot-PATH fix), `installEFIFallback: true`.
- `etc/calamares/modules/before_bootloader_context.conf` — both firmware branches present
  (EFI: grub-efi-amd64-signed + shim-signed; BIOS: grub-pc + grub-pc-bin).
- `var/lib/dpkg/status` — grub-pc, grub-pc-bin, grub-efi-amd64-bin, grub-efi-amd64-signed,
  shim-signed, grub-common, grub2-common all `install ok installed`.
- `usr/lib/grub/` — both `i386-pc` and `x86_64-efi`(+signed) module trees present.
- Exclude lists don't touch grub payload (only regenerated files: grub.cfg, device.map).

So every previously-diagnosed cause of this exact error (chroot PATH exit 127/1, missing
grub-pc on Legacy BIOS — see `install-grub-for-calamares-iso.sh` header) is fixed IN this ISO,
and the owner's run log showed the verify steps green.

**Why we can't root-cause further: the evidence self-destructs.** The exec sequence
(`etc/calamares/settings.conf`) runs `bootloader` mid-sequence and `shellprocess@logs` (the
`calamares-logs-helper.sh` archiver) at the END. A bootloader failure aborts the sequence, so
nothing is ever copied to the target disk, and `~/.cache/calamares/session.log` lives in the
live session's tmpfs — gone at reboot. Remaining candidate causes (all machine-side, all
indistinguishable without that log):

- live session booted Legacy BIOS while the target disk is GPT without a bios_grub partition
  (manual/replace partitioning path) → grub-install "embedding is not possible";
- EFI-booted install where efibootmgr can't write NVRAM (buggy/locked firmware);
- target disk enumeration quirks (NVMe/VMD — `probe-internal-storage.sh` exists in the ISO
  for this, but the log would tell);
- owner's partitioning choice interacting with the above (Erase vs Replace vs Manual).

## What was done

Made the NEXT failure diagnosable — the session log is now continuously mirrored to the
stick's exFAT during any live install:

- `tools/eggs/live-usb/calamares-session-log-rescue.sh` (new) — POSIX sh loop: every 20 s,
  if any `/root|/home/*/.cache/calamares/session.log` exists, copy it to
  `LABEL=HIGHASCGEXF → logs/calamares-session-<host>.log` + sync. Reuses an existing mount of
  the label (the live stack's WO-413 poller usually has it mounted); mounts/unmounts its own
  private mountpoint (`/run/calamares-log-rescue`) only otherwise — never touches system mounts.
- `tools/eggs/live-usb/systemd/calamares-session-log-rescue.service` (new) —
  `ConditionPathExists=/run/live/medium` so it is live-session-only (inert on installed
  systems and on the build host, where `fix-calamares-shellprocess.sh` also runs).
- `fix-calamares-shellprocess.sh` — installs the helper to `/usr/libexec/calamares/` and
  enables the unit (multi-user wants symlink) in whatever ROOT it targets, i.e. it rides the
  existing `patch-iso-squashfs-calamares.sh` repack into every future ISO.
- `verify-iso-squashfs-excludes.sh` — new `bad` gate: ISO verify fails if the enabled unit or
  helper is missing from the squashfs.
- `tools/smoke/smoke-wo417-calamares-log-rescue.test.js` (new, in curated CI list) — pins the
  wiring: live-only condition, ExecStart path, install+enable lines, verify gate, and the
  own-mount-only unmount discipline.

## What was VERIFIED

- Squashfs audit above (read-only, on the real 03.08 artifact).
- Scratch-ROOT run of `fix-calamares-shellprocess.sh` (root check stripped, HERE pinned):
  helper lands 0755 in `usr/libexec/calamares/`, unit + relative wants symlink land in
  `etc/systemd/system/` — verified with readlink + ExecStart grep.
- Functional harness of the rescue loop (stubbed blkid/findmnt, 1 s interval, fake session.log
  with a grub-install error line): the log appeared at `<mp>/logs/calamares-session-<host>.log`
  with correct content.
- Smoke 2/2; curated suite green apart from the pre-existing WO-415 monitor reds (1803/2).
- **NOT yet verified:** a real produce with the rescue unit in the ISO (next produce runs the
  new verify gate), and a real failed-install log landing on exFAT.

## Owner QA / next steps

1. Re-run the full produce+flash (WO-416's fix makes the flash survive the poller; restart
   highascg first so the running poller knows the inhibit file).
2. Retry the install on the target machine. If it fails again, plug the stick into any box and
   read `HIGHASCGEXF:/logs/calamares-session-*.log` — paste it into a todos file; the
   grub-install stderr in it will name the real cause.
3. When reporting, note the target machine's boot mode (UEFI vs Legacy in firmware setup) and
   which partitioning option was chosen (Erase / Replace / Manual) — that plus the log
   disambiguates the candidate causes above.
