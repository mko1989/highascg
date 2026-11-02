# WO-936 — Every Calamares install from an ISO since 30.10 failed: the exclude list dropped live-boot's payload

**Area:** os-iso
**Status: DONE (02.11.26 — cause read from .10's Calamares log; generated list no longer drops usr/lib/live; verifier FAILs the 02.11 ISO and passes a fixture; the next ISO + install on .10 is the proof)**

Owner, 02.11.26: "was installing highascg to the .10 thru calamares and got an installation failed notice. if you can
check it out and fix on the host whatever that is"

## Investigation

`.10`, `~/.cache/calamares/session.log` (19:22–19:26):

- Partitioning, unpackfs, machine-id, fstab, locale and keyboard all ran clean.
- Job 19/20, "Installing bootloader…", runs `/etc/penguins-eggs.d/installer.d/krill-chroot-runner.sh` and exits 1.
  Its step `install-initramfs` (`update-initramfs -u -k all` in the target chroot) failed:
  ```
  cp: cannot stat '/usr/lib/live/boot': No such file or directory
  E: /usr/share/initramfs-tools/hooks/live failed with return 1.
  update-initramfs: failed for /boot/initrd.img-7.0.0-38-generic with 1.
  [WARNING] Step 'install-initramfs' failed, continuing with remaining steps...
  ```
  The runner sets `FAILED=1` and exits 1 at the end, so Calamares reports "Installation failed". GRUB itself installed.
  (`grub-probe: cannot find a GRUB drive for /dev/sda2` is os-prober looking at the USB stick: noise.)
- On the live system, `dpkg -l` lists `live-boot` and `live-boot-initramfs-tools`, and the hook
  `/usr/share/initramfs-tools/hooks/live` is there, but `/usr/lib/live/boot` is not. The hook copies it
  unconditionally once `/usr/bin/live-boot` exists.
- Why it is missing: the generated `/etc/penguins-eggs.d/custom.exclude.list` (lines 22–23) holds `lib/live/*` **and**
  `usr/lib/live/*`.
  - `lib/live/*` comes from the old refractasnapshot template, `penguins-eggs-exclude-old-template.list` (WO-870
    1.3).
  - `generate-eggs-config.js` `withTwinsAndDedupe` adds a `usr/` twin to every `lib/` line (WO-430, merged-usr).
  - On merged-usr the template line matched nothing; its twin removed live-boot's payload.
- Since when: since `3c179d72` (WO-870 Phase 2, 30.10), every ISO built with the generated list. The live boot itself
  works, because its initramfs is built on the host before the squashfs; only the installed target rebuilds one.
- `coa`'s own built-in excludes carry no `lib/live` pattern (checked with `strings /usr/bin/coa`).

## What was done

- **`penguins-eggs-exclude-old-template.list`:** the `lib/live/*` line is gone, with a comment saying why.
  `var/lib/live/config/*` (live-config state) stays.
  - The payload is small: live-boot's shell scripts.
  - live-boot acts only with `boot=live`, so an installed system that carries it in its initramfs boots normally.
  - Purging live-boot in the target instead would mean a custom krill step in the coa runner: more moving parts for
    no gain.
- **`smoke-wo870-eggs-config.test.js`:** the generated list, in both embed modes, has no `lib/live` or
  `usr/lib/live` pattern.
- **`verify-iso-squashfs-excludes.sh`:** fails when the squashfs ships live-boot's initramfs hook without
  `usr/lib/live/boot`.

## What was VERIFIED

- Verifier on `/home/eggs/highascg-nvidia-615-2026-11-02_1131.iso`: **FAIL** (the bug). On a fixture squashfs with the
  hook and the payload: **OK**.
- The generated list keeps only `var/lib/live/config/*` among the live patterns.
- `smoke-wo870-eggs-config.test.js`: 18 passed, 0 failed.
- **Not yet proven:** a Calamares install from the next ISO.
