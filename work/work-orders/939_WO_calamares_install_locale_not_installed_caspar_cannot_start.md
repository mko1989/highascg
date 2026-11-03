# WO-939 — Calamares installs keep a locale the image does not carry (en_US.UTF-8) and Caspar cannot start

**Area:** os-iso, caspar-build
**Status: DONE (03.11.26 — on .35: control run with the Calamares locale aborts (134, `_S_create_c_locale`), the same env through `caspar_sanitize_locale` answers AMCP `VERSION`; boot guard rewrote a copy of the Calamares locale.conf; this box restarted with the new run.sh (no-op, AMCP up); offline curated 5285/0. The next ISO build is the proof that the guard unit ships)**

Owner, 03.11.26: "investigate why caspar wont start on a second machine 192.168.0.35 … ive just did the install via
calamares on it with the latest iso."

## Investigation

`.35` (highascg5868, Ubuntu 26.04.1, kernel 7.0.0-38, Calamares install from the 02.11 ISO). Diagnosed by a
subagent; the load-bearing facts were re-checked by hand.

- **The screen gate is fine.** `~/.highascg/run/caspar-screens-ready` existed (09:57) and run.sh launched Caspar.
  Caspar crash-looped every 10–30 s; node logged `AMCP down for 604s — no casparcg main process`.
- **Every launch threw at startup** (`journalctl -b -u casparcg-server`, 15 hits in that boot):
  ```
  std::exception::what: locale::facet::_S_create_c_locale name not valid
   8# std::locale::locale(char const*) in libstdc++.so.6
  10# main in /home/casparcg/highascg/bin/casparcg
  ```
- **The service environment named a locale that doesn't exist.** `/etc/locale.conf` (written by Calamares at
  09:50; `/etc/default/locale` symlinks to it) held `LANG=en_US.UTF-8` plus nine `LC_*=en_US.UTF-8`. The Caspar
  process environment had `LANG=en_US.UTF-8`.
- **The image carries no locales.** `locale -a` → `C`, `C.utf8`, `POSIX`. There is no `locale-archive` and no
  `locale-gen`, and `dpkg-query` says `locales … not-installed`. The build host is the same; it simply runs
  `LANG=C.UTF-8`, so it never hits this. This is not an exclude-list loss (unlike WO-430/936): the package was
  never on the master.
- **Why the live session hides it:** the ISO boots with `locales=C.UTF-8` (WO-870 F4). Only an installed system
  gets Calamares' pick.
- **Why the old fix point is dead:** `calamares-l10n-helper.sh` (runs `locale-gen` when it exists) is installed
  into `/etc/calamares`. Since eggs 26.10 that tree is unused (WO-870 Phase 4). eggs generates `installer.d`
  and the module confs at install time, and we deliberately ship no module overlays
  (`install-eggs-config.sh:8`). So nothing at install time can be relied on to fix the locale.

## What was done

Two layers that do not depend on Calamares:

- **`tools/runtime/casparcg-supervisor-lib.sh` `caspar_sanitize_locale`, called by `run.sh` right after the lib is
  sourced (before any launch).** It checks `LC_ALL`, `LANG` and every `LC_*` with libc itself
  (`LC_ALL=<v> locale` prints "Cannot set …" on stderr for a missing locale; `C`/`POSIX`/`C.UTF-8` are built in).
  If any value can't load, it exports `LANG=LC_ALL=C.UTF-8` and logs `[run.sh] locale not installed: … (WO-939)`.
  Caspar needs no user locale, and an installed one (e.g. `pl_PL.UTF-8` with the package) is left alone. This
  alone keeps Caspar starting on every install, including the boot where the file is still wrong.
- **`highascg-locale-guard.service` + `tools/runtime/highascg-locale-guard.sh`** (root oneshot,
  `DefaultDependencies=no`, `Before=sysinit.target casparcg-server highascg nodm`, `WantedBy=sysinit.target`).
  When `/etc/locale.conf` names a locale that isn't installed, the script rewrites the file to `LANG=C.UTF-8`
  (the build host's own setting) via temp file + rename, keeping `locale.conf.bak-wo939` once. PID 1 has read
  the old file by then, so the repair takes effect from the next boot. Shells and every other service are clean
  after that.
- **Shipping:** `pre-produce-preflight.sh` (root, runs before every clone) installs the script to
  `/usr/local/lib/highascg/` and the unit to `/etc/systemd/system/`, enables it, and FAILs the build if it doesn't
  enable. This is the same "refresh right before the clone" pattern as the WO-481 launcher. No separate owner
  step: the next `build-highascg-egg.sh` puts it in the ISO.
- **Verifier:** `verify-iso-squashfs-excludes.sh` FAILs an ISO that has neither `usr/lib/locale/locale-archive`
  nor the enabled guard (`sysinit.target.wants/` link + script).
- Rejected: installing `locales` on the master (needs network + a package change on the live box, and Calamares
  would still be free to pick a language nobody generated); forcing `LC_ALL` in the unit files (would override a
  locale the operator really installed).

## What was verified

- **On .35, real libc and the real binary**, with casparcg-server stopped:
  - Control: `env LANG=en_US.UTF-8 LC_TIME=… LC_NUMERIC=… bin/casparcg` → Aborted, exit 134,
    `_S_create_c_locale name not valid`.
  - The same env through `. casparcg-supervisor-lib.sh; caspar_sanitize_locale; exec bin/casparcg` → AMCP
    `201 VERSION OK 2.5.1 deac375bb Stable`, 0 locale errors, log line `locale not installed: LANG=en_US.UTF-8
    LC_NUMERIC=en_US.UTF-8 LC_TIME=en_US.UTF-8 — starting Caspar with C.UTF-8 (WO-939)`.
  - Boot guard on a copy of the Calamares file → rewritten to `LANG=C.UTF-8` with a `.bak-wo939`.
  - The service was started again and is up (AMCP VERSION OK).
- The owner had already fixed .35 by hand (`/etc/locale.conf` → `LANG=C.UTF-8` 10:18, reboot 10:19). The new
  `run.sh` and lib were copied there afterwards; both files matched this repo's previous commit byte for byte
  first, with `.pre-wo939` copies left beside them. The guard unit is copied into .35's tree but not installed
  there (needs root; the file is already correct).
- This box: `systemctl restart casparcg-server` with the new run.sh → AMCP up, no WO-939 log line (C.UTF-8, no-op).
- Offline: new `smoke-wo939-locale-guard.test.js` (6 tests: fallback and its log, untouched C.UTF-8 / installed
  locales / empty env, one bad category is enough, the .35 locale.conf rewritten with backup, good / missing
  file untouched, wiring: run.sh order, unit ordering, preflight install, ISO verifier). A fake `locale` on PATH
  makes the result host-independent (CI has en_US). Curated suite 5285/0; lint 0 errors; shellcheck clean.
- **Not yet proven:** an ISO built with the new preflight, then a Calamares install that boots straight into a
  working Caspar with `/etc/locale.conf` repaired.
