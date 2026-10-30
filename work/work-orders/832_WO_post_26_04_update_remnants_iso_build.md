# WO-832 — Post-update remnants: ISO build, kernel pin, NVIDIA, 26.04 package names

**Status: OPEN (30.10)**
**Source:** REPORT §4a–4d and §7e. Owner 30.10: *"the kernel pin and the eggs theme path before the next ISO build. that
and other remnants of pre update should be fixed (nvidia etc)"*.
**Related:** WO-430, WO-431, WO-779, memory: eggs excludes vs merged-usr.

Scope:

- 4a `install-eggs-live-grub-theme.sh` points at `/usr/lib/penguins-eggs/…`; eggs 26.10.25 keeps the theme in
  `/etc/penguins-eggs.d/branding.default`, so the next produce exits 1.
- 4b the liveroot bind-mount guard fails open under pipefail.
- 4c `/etc/highascg/pinned-kernel` says 6.8.0-117, the box runs 7.0.0-38 → the owner runs the sudo command; the scripts
  must also refuse to purge the running kernel.
- 4d `08-caspar-cef-scanner.sh` stops and disables casparcg-server.
- NVIDIA remnants: the stale `/usr/local/bin/highascg-nvidia-x-apply.sh`, the third-party licence list for driver 615.
- 26.04 package names in `install.sh` (`libsfml-*2.6`, `policykit-1`).
- `findmnt -L` (not an option) in the stick test lib, test-03 and `flash-stick-common.sh:300`, plus the stick-test
  counting bugs in §7e.

Never run `eggs produce`, the sync/purge script, or any stick script while fixing these.

## 1. Investigation

See REPORT §4 and §7e.
