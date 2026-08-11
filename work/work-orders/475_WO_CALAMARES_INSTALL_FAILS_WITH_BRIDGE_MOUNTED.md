# WO-475 — Calamares install fails while the bridge partition is mounted

**Status: DONE (11.08.2026, verified: offline suite green with a new positional-order gate,
`bash -n` clean) — owner QA: the next reinstall must get past partitioning with HIGHASCGDAT
present, and `~/bridge` must be back after the installer closes**

## 1. Investigation

Owner 11.08: *"i just had an issue while reinstalling thru calamares, the bridge partition was still
mounted which made the install fail even when i left this partition untouched. so running calamares
install needs to unmount the bridge partition."*

**Why "untouched" does not help.** Calamares' partition module (KPMcore) commits the layout and then
asks the kernel to re-read the target disk's partition table (`BLKRRPART`). The kernel refuses with
`EBUSY` while **any** partition on that disk is mounted — not just the ones being edited. On a
playout box the bridge is `nvme0n1p3` (`LABEL=HIGHASCGDAT`, exFAT), i.e. a partition of the very
disk the OS is installed onto:

```
/dev/nvme0n1p3 on /home/casparcg/bridge type exfat (rw,relatime,uid=1000,gid=1000,…)
/dev/nvme0n1p3 on /home/casparcg/highascg/media/bridge type exfat (…)   ← bind of its media/ dir
```

Two mounts of the same device, and the second is a bind **inside** the first, so the parent cannot
be released until the bind is.

**Nothing was releasing them.** `tools/runtime/launch-calamares.sh` stops
`casparcg-server` / `casparcg-scanner` / `highascg` (WO-423 — only the installer on the glass) and
then launches Calamares. It never touched the WO-47/52 volumes. The mounts are also actively
defended: `highascg-bridge-arrive.service` remounts on the udev event, so a hand `umount` during the
install can be undone under the installer's feet.

Prior art exists for the produce path only —
`tools/eggs/live-usb/stop-and-unmount-wo47-for-eggs-produce.sh` does exactly this dance so stick and
bridge content is not baked into `filesystem.squashfs`. The install path had no equivalent.

## 2. What was done

Inlined the release into `tools/runtime/launch-calamares.sh` rather than adding a new script.
That is deliberate: the launcher is already installed to `/usr/local/bin` by
`scripts/setup/13-caspar-systemd-units.sh` and already covered by the sudoers rule, so it reaches
every ISO with no second deployment step to forget (cf. WO-471, where a boot script existed twice
and patching only one copy would have been a no-op).

- `release_bridge()` stops **and runtime-masks** `home-casparcg-bridge.mount`,
  `home-casparcg-highascg-media-bridge.mount`, `highascg-bridge-arrive.service`,
  `highascg-bridge-boot.service`, `highascg-bridge-media-prep.service` and
  `highascg-exfat-sync.service`, then unmounts the media bind first and `~/bridge` second. The mask
  is what stops udev remounting mid-install; `--runtime` means it evaporates on the reboot into the
  freshly installed system, so nothing can be left masked permanently.
- A busy mount is reported with `fuser -mv` before falling back to `umount -l`, and a still-mounted
  path warns loudly rather than aborting — a warning still lets the operator try, and Calamares'
  own error is the better teacher if it fails anyway.
- Ordering: the release runs **after** the WO-423 service stops. `highascg.service` holds the media
  root and the projects sync open, so releasing first would just hit EBUSY.
- `restore_bridge()` unmasks and remounts, and is wired to `trap … EXIT INT TERM` so a cancelled or
  crashed installer cannot leave the box without its media disk. Starting the media bind pulls the
  prep service and the parent mount back in via its own `Requires=`.
- The **exFAT operator stick is deliberately left mounted**: it is the live boot medium, not an
  install target, and pulling it out from under the running installer would be its own bug. Asserted
  in the gate so nobody "helpfully" adds it later.

`tools/eggs/live-usb/verify-calamares-installed.sh` now also greps the **installed**
`/usr/local/bin/launch-calamares.sh` for `release_bridge`, so an ISO built from an older copy is
caught by the verifier instead of by a failed install.

`docs/CALAMARES_INSTALL_TO_DISK.md` gained a troubleshooting row naming the symptom, plus the manual
`systemctl stop` for anyone who starts Calamares by hand instead of through Settings → Install to
disk.

### Side finding — the boot sync reverted a live config edit mid-session

WO-473's exclude was written to `config/exfat-sync.json` at 10:33 and was gone by the time the
suite ran. The journal names the culprit: a stick insert at **11:04** fired the arrive chain, and
`highascg-exfat-sync` ran `boot bridge-modular-config (bridge): volume → project only (copied=46)`
— `bootPrefer: exfat` means the BRIDGE's `configs/` overwrites `config/` wholesale, with mtimes
preserved (both files came back stamped 2026-07-02). This is intended behaviour (WO-415: config
reset on stick insert is how a clean ISO stays clean), so the lesson is not "add a guard" but
**where a config change has to land**: the committed repo copy (for fresh installs) AND the
volumes' `configs/` copies (for this box). Both were re-applied, and the bridge's
`audio_outputs.json` re-blanked. The stick was not mounted at the time of writing and still owes
the same two edits on its next insert.

## 3. What was verified

- New gate `tools/smoke/smoke-calamares-releases-bridge.test.js` (registered in the curated `FILES`
  list) asserts the fix **positionally**, since the ordering is the fix: stop services → release →
  calamares → restore, plus the EXIT trap, both mount points in deepest-first order, the arrive unit
  being stopped, runtime-only masking, and that the stick is untouched. 3/3 pass.
- `bash -n tools/runtime/launch-calamares.sh` clean; full offline suite **1950 tests, 1948 pass,
  0 fail, 2 skip**.
- WO-423's ordering guard repointed: it searched for the first `systemctl start` anywhere, which is
  now inside `restore_bridge()` (defined above the launch). It asserts on the playout restart loop
  specifically — same intent, unambiguous anchor.
- Unit names confirmed against this box's `systemctl list-unit-files`, and the media bind's
  `Requires=${bridge_prep_svc} home-casparcg-bridge.mount` confirmed in
  `scripts/exfat/install-exfat-units-bridge.sh` — that is what makes the restore a single
  `systemctl start`.

**Not verified live:** no install was run — that would wipe this box. The release/restore path is
exercised for real only on the next reinstall. Owner QA: partitioning should now pass with
HIGHASCGDAT present, and `~/bridge` + `~/highascg/media/bridge` must be mounted again after the
installer closes (or after cancelling it).

---

## WO-481 — the WO-475 fix did not reach the machine the owner installed from

**Status: DONE (11.08.2026) — owner QA: next install attempt**

Owner 11.08, after WO-475 shipped: *"running the calamares setup did not unmount the bridge
partition making the install impossible."*

**WO-475 patched the repo copy; the running system uses an installed copy.**
`scripts/setup/13-caspar-systemd-units.sh` does `install -m 0755 tools/runtime/launch-calamares.sh
/usr/local/bin/launch-calamares.sh`, and the sudoers rule points at `/usr/local/bin`. Editing
`tools/runtime/` therefore changes nothing on a box until that installer re-runs — and on a **live
USB the launcher is baked into `filesystem.squashfs`**, so an ISO produced before WO-475 can never
have it. WO-475's own note ("no second deployment step to forget") was right about future ISOs and
wrong about every machine already built. That is the WO-471 two-copies trap again, one level up.

Evidence on this box: `/usr/local/bin/launch-calamares.sh` and the repo copy are byte-identical
*now* (mtime 12:39, after the owner deployed), and `journalctl` records `home-casparcg-bridge.mount`
being unmounted at 12:38:56 — so the mechanism works where it is installed. No
`highascg-calamares-launch-*` transient unit appears in this box's journal at all, i.e. the failing
install was started elsewhere, from an older copy.

**Fix — make it independent of how Calamares was started.**

- `launch-calamares.sh` gained a `--release-bridge` mode: the WO-475 `release_bridge()` and its
  arrays moved above the transient-unit re-exec, and the flag runs it and exits. One implementation,
  two entry points; the logic is never duplicated.
- `fix-calamares-shellprocess.sh` now writes `shellprocess@release_bridge.conf`
  (`dontChroot: true`, calls the launcher with that flag, tolerates its absence) **and inserts it as
  the first step of the `exec:` sequence in `settings.conf`** — after the operator has chosen a
  layout, before Calamares commits anything. Pure awk, idempotent, skips the `- partition` entry
  under `show:`. That covers a terminal `calamares`, a desktop entry, and our launcher alike.

**Still true and unavoidable:** a live stick produced before this carries the old squashfs. Until an
ISO is produced, the operator must either run the installed launcher (`sudo -n
/usr/local/bin/launch-calamares.sh`, once refreshed) or unmount by hand first:

```bash
sudo systemctl stop home-casparcg-highascg-media-bridge.mount home-casparcg-bridge.mount
```

Verified: `bash -n` clean; the awk insertion dry-run against this box's real
`/etc/calamares/settings.conf` put `- shellprocess@release_bridge` above `- partition` under
`exec:` and left the `show:` copy alone; smoke extended (4/4) to pin the `--release-bridge` mode and
that it exits before the re-exec; WO-423's ordering guard repointed to the playout stop loop, since
`release_bridge()`'s definition now legitimately precedes the re-exec. Offline suite **1958 tests,
1956 pass, 0 fail, 2 skip**.

### WO-481 addendum — closing the produce hole (owner: *"do i need to run anything else before producing new eggs?"*)

Checking what a produce actually runs turned up two more traps:

1. **`eggs produce` images the LIVE filesystem**, so `/usr/local/bin/launch-calamares.sh` is what
   ships — never the repo copy. Nothing in `build-highascg-egg.sh` refreshed it, which is precisely
   how WO-475 shipped an ISO with the old launcher. `pre-produce-preflight.sh` (already called by
   the build) now installs the repo copy over it, immediately before `fix-calamares-shellprocess.sh`
   and the verifier, i.e. the last point before the squashfs clone.
2. **A launcher predating WO-481 does not recognise `--release-bridge`** — it would fall past the
   flag check into the FULL launch path: stop playout, wait for X, start a second Calamares from
   inside the first one's shellprocess step. The module's command now greps the launcher for the
   flag before calling it, and `verify-calamares-installed.sh` checks for the flag rather than the
   function name (a WO-475-era launcher has the function but not the mode, so the old check passed
   on exactly the file that would misbehave).

Everything else a produce needs was already automatic: `pre-produce-preflight.sh` runs
`stop-and-unmount-wo47-for-eggs-produce.sh` (bridge + stick stopped, runtime-masked and unmounted —
a hand `umount` does not survive, the arrive unit remounts) and `fix-calamares-shellprocess.sh`
(which now also writes `shellprocess@release_bridge.conf` and schedules it), then
`verify-calamares-installed.sh` gates the lot.
