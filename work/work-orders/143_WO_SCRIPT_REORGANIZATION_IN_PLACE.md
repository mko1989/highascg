# WO-143 — Script reorganization (in place) + CI script-path guard

**Status:** Planned
**Priority:** Medium
**Date:** 2026-07-07
**Depends on:** WO-141 (commits landed on main first).

---

## 1. Goal

Owner decision: **reorganize in place** — keep current directories, move dead/one-off scripts to deprecated dirs, document the categories. No path moves of anything wired (systemd units, sudoers, /usr/local installs on this machine and flashed sticks must not break).

Grounding (full inventory done 2026-07-07): ~25 scripts confirmed wired into Node/systemd; `scripts/setup/` (24 numbered steps + lib) is the canonical empty-server provisioner; `tools/eggs/live-usb/` (~75 scripts) is the ISO suite; 9 overlapping `work/run-eggs-*` orchestrators.

## 2. Tasks

### The map
- [ ] T143.1 Write `scripts/README.md` documenting four categories and where each lives:
  1. **Provisioning** (empty server → this machine): `scripts/setup/` + `scripts/lib/` + `scripts/boot/` + `scripts/exfat/install-*` + `scripts/replication/` + `work/bootstrap-*.sh`
  2. **Eggs/ISO production:** `tools/eggs/` + `work/run-eggs-*` wrappers
  3. **Runtime (spawned by Node/systemd):** confirmed-wired list in `tools/runtime/` + `scripts/exfat/highascg-*`, each documented WITH its call site (e.g. `src/system/pointer-confine.js` → `confine-pointer-barriers.py`)
  4. **Deploy/CI/QA:** `scripts/deploy/`, `tools/ci/`, `tools/startup/`, `tools/smoke/`
  Also list the do-not-use dirs: `scripts/legacy/`, `scripts/unused/`, `scripts/deprecated/`, `tools/eggs/live-usb/legacy-persistence/`, `tools/eggs/unused/`.
- [ ] T143.2 Fix `scripts/setup/` numbering collisions (`12-*` ×2, `13-*` ×3, `14-*` ×2) by renumbering — grep first to verify nothing references the numbers programmatically.
- [ ] T143.3 Collapse the 9 `work/run-eggs-*` wrappers into ≤4 documented variants (clone+flash, produce-from-host, clone-only, prepare-safe; merge `run-eggs-prepare-and-produce-safe.sh` into `run-eggs-prepare-safe.sh --produce`); retire the rest to deprecated. Update `package.json` script targets that reference retired wrappers.
- [ ] T143.4 Document the `scripts/runtime/` naming trap (contains INSTALLERS, not runtime scripts) in the README; rename dir to `scripts/installers/` ONLY if grep proves no external references.

### Deprecations (git mv, preserving history)
- [ ] T143.5 `work/confine_cursor.py` (superseded prototype) → `work/deprecated/`.
- [ ] T143.6 `tools/runtime/stick-boot-test/` (stray duplicate; canonical is `tools/startup/stick-boot-test/`) → `work/deprecated/`.
- [ ] T143.7 Non-wired `tools/runtime/` strays (confirm no references first): `casparcg-staged-start.sh`, `start-highascg.sh`, `cef-interactive-{api-smoke,load-test,watch-logs}.sh`, `patch-wo47-*.sh`, `wo47-*.sh` → `work/deprecated/tools-runtime/`.
- [ ] T143.8 `tools/runtime/calamares-*-helper.sh`, `fix-calamares-branding.sh` → `tools/eggs/live-usb/` (ISO helpers, misfiled). Update any references.
- [ ] T143.9 Reconcile loose `scripts/fix-*.sh` root copies vs `scripts/fix/` versions (they differ): keep newest, deprecate the other.

### Guard
- [ ] T143.10 Add a CI check (new `tools/ci/check-script-paths.js` or extend `check-require-integrity.js`) verifying every script path referenced from `src/`, `run.sh`, systemd unit writers, and `package.json` exists on disk. Wire into `npm run test:ci`.

## 3. Acceptance criteria

- [ ] A143.1 `scripts/README.md` categorizes every script directory; the wired-runtime list names call sites.
- [ ] A143.2 ≤4 `run-eggs-*` variants remain outside deprecated; `npm run eggs:*` targets still work (`bash -n` syntax check + help/dry-run output pasted).
- [ ] A143.3 Script-path CI guard green; deliberately breaking a path makes it fail (demonstrated in work log, then reverted).
- [ ] A143.4 All gates green after moves (`verify:repo-integrity`, `lint`, `test:ci`).

## 4. Work log

- 2026-07-07 — WO created from full script inventory.
