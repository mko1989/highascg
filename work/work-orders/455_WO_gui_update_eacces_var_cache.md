# WO-455 — GUI update on installed systems: EACCES mkdir /var/cache/highascg/updates

**Status: DONE (2026-08-07, suite 1891/0, CI run 31169663041 green; shipped in release 2026-08-07_122111 — machine 2 needs the one-time dir command below OR this release via stick, see Remains).**

Owner (todos07.08.26 addendum): update on an installed system (second machine) fails —
`phase: error EACCES permission denied mkdir /var/cache/highascg/updates`.

## Investigation FIRST

- WO-424 fixed the GUI update CHECK leg but recorded "NOT exercised: a full Apply on this
  box". First real Apply on an installed box found the next defect, one layer down:
- `src/system/server-update.js` (old :331) did `fs.mkdirSync('/var/cache/highascg/updates')`
  as the service user. On THIS box that works only because
  `install-exfat-systemd-units.sh:81-82` created the tree (root) back on Jun 28. On an
  INSTALLED system the dir cannot exist: the eggs exclude list ships **`var/cache/*` empty**
  (`penguins-eggs-exclude-highascg-fragment.list:126`), `/var/cache` is root-owned 755, and
  the node process runs as `casparcg` → EACCES before anything downloads. Every installed
  box fails its first GUI update this way.
- Lucky break: the deployed sudo helper's `validate_source_path`
  (`highascg-webui-server-update.sh:45`) accepts sources under `/var/cache/highascg/updates/*`
  **or `/tmp/highascg-updates/*`** — a fallback root the fleet's already-installed helpers
  will accept unmodified.

## What was done

1. `src/system/server-update.js` — `resolveUpdateCacheDir()`: try the real cache root
   (honours `HIGHASCG_UPDATE_CACHE`); on EACCES/EPERM/EROFS only, fall back to
   `/tmp/highascg-updates` and log which root the job used. Other errors still throw.
2. `scripts/exfat/highascg-webui-server-update.sh` — `ensure_cache_dirs()` at the top of
   `main()` (runs as root): creates `/var/cache/highascg{,/updates,/update-staging}` with
   `updates` owned by the service user. First successful update (via /tmp) self-heals the
   real cache tree for all subsequent ones.
3. NEW `scripts/tmpfiles.d/highascg.conf` — systemd-tmpfiles recreates the tree every boot;
   `install-exfat-systemd-units.sh` now deploys it to `/etc/tmpfiles.d/`. Once present in
   `/etc` on the golden box it rides every future eggs ISO (the `/etc` clone ships even
   though `var/cache/*` itself is excluded).
4. `tools/smoke/smoke-wo455-update-cache-fallback.test.js` (3 tests, curated list) pins all
   three legs; EACCES trigger condition proven live (mkdir under a 000-dir as non-root →
   EACCES).

## What was VERIFIED to work

- Suite 1891/0/2 incl. the new smoke and the untouched WO-423/424 neighbor smoke; bash -n on
  both scripts; unwired-exports + lint + prettier clean.
- NOT verified: a real Apply on an installed box (needs the owner's second machine — below).

## Remains owner

- **Second machine, pick ONE:**
  a. One-time unblock of the CURRENT code (fastest):
     `sudo mkdir -p /var/cache/highascg/updates && sudo chown -R casparcg:casparcg /var/cache/highascg/updates`
     — then Settings → System Updates works immediately (release 2026-08-07_122111 is newer
     than what it runs).
  b. Or get THIS code onto it via a stick drop-update; afterwards GUI updates need no manual
     step ever (the /tmp fallback covers the missing dir).
- **Golden box (this one), one-time so future ISOs ship the tmpfiles entry:**
  `sudo install -m 0644 /home/casparcg/highascg/scripts/tmpfiles.d/highascg.conf /etc/tmpfiles.d/highascg.conf`
