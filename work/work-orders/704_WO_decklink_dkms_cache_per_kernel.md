# WO-704 — DeckLink DKMS: build once per kernel, not every live boot

**Status: DONE in repo (2026-10-23; smoke-wo704 7/7, decklink install smokes 49/49 incl. the new 7, real `dkms add`/`build` skip
proven on a scratch DKMS tree) — proven on a live ISO boot only: the second boot from the same stick logs
"restored … (no compile)" and `highascg-decklink-install` takes seconds instead of ~1m53s**

Follow-up of [WO-702](./702_WO_iso_live_boot_defects_64.md) "Open" (DeckLink DKMS rebuild on every live boot). Owner
23.10: "Build once per kernel, not every boot". WO-92's rule stands: no BMD binaries ship in the ISO. What is cached
is the module the operator's own box built from the package the operator downloaded, kept on the operator's stick.

## Investigation

- **The cost.** On .64 (22.10 ISO) the critical chain was `highascg.service @2m37` ← `highascg-exfat-sync` ←
  `highascg-decklink-install +1m53s`. A live boot starts with an empty `/var/lib/dkms`. The decklink exclude list
  (`tools/eggs/live-usb/penguins-eggs-exclude-decklink.list`) strips `var/lib/dkms/blackmagic*`,
  `usr/src/blackmagic-*`, the `updates/dkms` .ko and `var/lib/dpkg/info/desktopvideo.*`. So every boot runs
  `dpkg -i` from the stick's `decklink/`, and the postinst compiles both modules.
- **What the vendor postinst does** (`/var/lib/dpkg/info/desktopvideo.postinst`, 16.2a1, `build_driver`). It runs
  `dkms add`, then `dkms build`, then `dkms install --force`, each `|| return 1`. It then modprobes the modules that
  were built (not `snd_blackmagic_io`).
- **What DKMS 3.4.4 does** (`/usr/sbin/dkms`):
  - `is_module_added` (l. 2006) needs `<tree>/<mod>/<ver>/source` to be a symlink to a directory.
  - `is_module_built` (l. 2012) only needs `<tree>/<mod>/<ver>/<krel>/<arch>/module/`.
  - `maybe_build_module` (l. 2040) prints "already built … skip" and returns 0 unless `--force` is given.
  - `do_install` (l. 1773) runs `is_module_built … || do_build`. With `--force`, `maybe_install_module` only
    uninstalls a previous install first.
  - `add_module` (l. 1251) dies 3 "DKMS tree already contains" when the module is already added. When the module is
    not added, it just makes `build/` and the `source` link (l. 1270), even if the built tree is already there.
  - Header checks (`prepare_kernel`) are only reached from `do_build`.
- **Rejected: `dkms mktarball` / `ldtarball`.** `ldtarball` is `load_tarball && add_module`, so it leaves the module
  *added*. The postinst's unconditional `dkms add` then dies "already contains" and `build_driver` returns before
  build and install. The module would never be installed.
- **What a built tree holds.** On this box (6.8.0-117-generic, 16.2a1), `/var/lib/dkms/blackmagic-io/16.2a1/<krel>/x86_64`
  holds `module/{blackmagic-io,snd_blackmagic-io}.ko.zst`, `Module.symvers` and `log/make.log`. Compressed sizes:
  blackmagic-io 559 KB, blackmagic 262 KB.
- **The prerm cannot interfere.** The desktopvideo prerm runs `dkms remove --all`, but only on remove or upgrade. On a
  live boot `var/lib/dpkg/info/desktopvideo.*` is excluded, so no prerm runs.

## What was done

- **`scripts/lib/decklink-dkms-cache-lib.sh` (new; sourced by the install lib).** It holds the cache functions. They
  are in their own file so `decklink-install-lib.sh` stays at 305 lines.
  - Cache root: `decklink_dkms_cache_root` returns the first mounted of `/home/casparcg/exfat` or
    `/home/casparcg/bridge`, plus `/decklink/dkms-cache`. `DECKLINK_DKMS_CACHE_ROOT` overrides it for tests.
  - Layout: `<cache>/<krel>/<mod>-<deb-ver>-<arch>.tar.gz`, a `.sha256` sidecar, and `manifest.txt`
    (`desktopvideo=` / `kernel=` / `arch=` / `saved=`). The archive holds `<dkms-ver>/<krel>/<arch>/`. That way the
    lookup key is the deb version, which is known before `dpkg -i`, and DKMS's own version directory comes back
    exactly as it was.
  - `decklink_dkms_cache_restore ver krel` runs before `dpkg -i`:
    1. Verify the sha256.
    2. Extract into a temp dir.
    3. Require exactly one top-level dir and a `module/*.ko*` inside it.
    4. `mv` the tree into `<tree>/<mod>/<dkms-ver>/<krel>`. It never touches a version DKMS already holds, and it
       makes no `source` link, so the postinst `dkms add` still succeeds.
    - It sets `DECKLINK_DKMS_CACHE_RESTORED` and returns rc 0 only when every module came back.
  - `decklink_dkms_cache_save ver krel [force]` runs only after both modules are loaded.
    - It archives the build that the `kernel-<krel>-<arch>` link points at.
    - It writes `*.tmp.$$` beside the target and then renames it, so the write is atomic.
    - `tar --owner=0 --group=0` and no mode work keep it exFAT-safe.
    - An existing entry is kept unless `force` is passed.
  - `decklink_dkms_cache_prune` keeps the current kernel plus the newest other kernel (`DECKLINK_DKMS_CACHE_KEEP=2`).
    It only deletes kernel-named dirs (`^[0-9]+\.[0-9]+…`).
  - `decklink_dkms_cache_rebuild` handles a restored module that does not load, for example one signed with another
    box's Secure Boot MOK. It installs the prereqs, then runs `dkms build --force` and `dkms install --force` with the
    active DKMS version, then modprobes.
- **`scripts/lib/decklink-install-lib.sh` → `decklink_install_vendor_pair`.**
  - It restores first. On a full hit it skips `decklink_ensure_dkms_prereqs`: `dkms install` of a built tree needs
    no headers, so a hit needs no apt or network.
  - It then runs dpkg as before.
  - If something was restored but the modules are not loaded, it rebuilds and saves with `force`. Otherwise, when
    the modules are loaded, it saves.
  - Every cache call is `|| true` or a plain condition, so the cache never changes the function's return code.
  - The source line is `source "$(dirname "${BASH_SOURCE[0]}")/decklink-dkms-cache-lib.sh"`.
- **`scripts/exfat/install-exfat-systemd-units.sh`** installs the new lib beside the old one in
  `/usr/local/lib/highascg/`.
- **`scripts/runtime/decklink-install-from-exfat.sh`** logs `dkms cache (WO-704): N module tree(s) restored` to
  `/var/log/highascg/decklink-install.log`. The per-module cache lines go to stderr, which ends up in the journal.

### Ordering (reported only — owner has not approved a change)

How `highascg.service` ends up waiting for the DeckLink install:

- `scripts/exfat/install-exfat-systemd-units-units.sh:288` gives `highascg-decklink-install.service`
  `Before=casparcg-scanner.service casparcg-server.service highascg.service highascg-exfat-sync.service`.
- `…-units.sh:186` gives `highascg-exfat-sync.service` an `After=… ${decklink_install_svc} …`, and `:187` gives it
  `Before=highascg.service`.
- `highascg.service` has `After=… highascg-exfat-sync.service`.
- `scripts/setup/13-caspar-systemd-units.sh:46-47` adds the decklink install to `casparcg-server`'s `After=`.

Proposed decoupling:

1. Drop `highascg.service highascg-exfat-sync.service` from line 288's `Before=`.
2. Drop `${decklink_install_svc}` from line 186's `After=`.
3. Keep `casparcg-scanner` and `casparcg-server` behind the driver, since Caspar is what opens the card.

Not checked: whether node's hardware probe (`src/api/system-hardware-decklink.js`) caches "no DeckLink" when it
starts before the module loads.

## Verified

- `node --test tools/smoke/smoke-wo704-decklink-dkms-cache.test.js` passes **7/7**. It uses fake
  `dpkg` / `dkms` / `modprobe` / `uname` on PATH, with a temp DKMS tree and a temp cache. It covers:
  - a save → restore round trip;
  - fallback for a sha256 mismatch, an archive without a .ko, a missing sidecar, another version, and no stick;
  - restore never overwriting an existing version;
  - unforced save keeping an entry and forced save replacing it;
  - prune keeping the current and newest other kernel;
  - a full install cycle (the miss compiles and saves; the next boot gets `skip-build` for both modules and needs no
    prereqs);
  - a rejected cached module getting rebuilt with `--force` and re-saved;
  - an unwritable stick still giving rc 0;
  - wiring pins.
- Mutation-checked: each of these breaks at least one test: removing the restore call, removing the rebuild, keeping
  the current kernel out of prune, and dropping the checksum check.
- The real DKMS on this box (non-root, with `--dkmstree` set to a scratch dir):
  - `decklink_dkms_cache_save` of the real `/var/lib/dkms` built trees;
  - restore into an empty scratch tree (`rc=0 restored=2`);
  - real `dkms add -m blackmagic(-io) -v 16.2a1` → "Creating symlink …/source";
  - real `dkms build` → `Module blackmagic-io/16.2a1 already built for kernel 6.8.0-117-generic (x86_64), skip.`,
    rc 0, in 0.04 s;
  - `dkms status` → `built`.
  - `dkms install` needs root and was not run. `do_install` (l. 1773) only builds when `module/` is missing.
- Re-run decklink smokes (every smoke that reads the install lib, install-exfat units or the runtime script, incl. the 7
  new): **49/49**.
- `bash -n` passes on all three scripts. `check-max-file-lines`: 0 over. `npm run lint`: 0 errors.
  `format:check`: clean.
- **Only a live boot can prove:**
  - that the 2nd boot from the same stick skips the compile (journal "restored … (no compile)", the
    decklink-install unit time);
  - that `dkms install --force` as root takes the cached .ko and that `modprobe` accepts it with Secure Boot on (the
    rebuild fallback covers a rejection);
  - that the exFAT write survives a hot unplug (the temp file + rename leaves either the old entry or the new one).
