# WO-194 — Hostname-from-MAC on USB boot: wrapper dies on read-only /var/log before applying

**Status:** IMPLEMENTED (code landed `56898bf`; owner acceptance A194.1-3 needs a USB boot — on `work/checklist06.08.26_close_all_wos.md`)
**Priority:** Medium-High (replication/tailscale/mDNS identity wrong on every USB boot)
**Date:** 2026-07-14
**Source:** `work/work-orders/todos14.07.26` (owner, NEWNEW): "check the workflow for auto creation of the hostname based on the mac address. on usb boot it needs to happen each time it boots."
**Related:** WO-78 (built the mechanism, Phases A–D shipped 2026-07-01).

---

## 1. Findings (2026-07-14) — mechanism correct, one fatal logging line

- The per-boot flow EXISTS and is correctly designed: `highascg-hardware-hostname.service` (oneshot, enabled, `After=udev-settle/network-pre`, `Before=highascg.service tailscaled.service`, every boot) → `tools/runtime/highascg-apply-hardware-hostname.sh` → `apply-hardware-hostname.js` → `ensureHardwareHostname()` (`src/system/hardware-identity.js:86-108,207-235`). Name scheme `highascg####` (last two MAC octets of the primary NIC → `%10000`, zero-padded; machine-id hash fallback), cached in `config/hardware-identity.json`. App startup re-ensures as backup (`index.js:194-203`).
- **The USB-boot bug:** the shell wrapper does `touch /var/log/highascg-hardware-hostname.log` under `set -euo pipefail`; on live-USB boots `/var/log` is read-only → script exits before applying. **Journal-confirmed** (Jul 13 boot: `touch: cannot touch '/var/log/…': Read-only file system`; unit `failed`). Consequence on this very box: hostname is still the baked clone name `highascg-nvidia-595` instead of `highascg7579` (identity file already correctly says 7579).
- Installed-disk boots work (Jul 4 journal: applied `highascg7579` successfully).

## 2. Tasks (haiku-sized)

- [x] T194.1 Fix `tools/runtime/highascg-apply-hardware-hostname.sh`: logging must be fail-open — try `/var/log`, fall back to `/tmp/highascg-hardware-hostname.log`, and always `logger -t highascg-hostname` for the journal; NO log-path failure may abort the run (wrap in `|| true` / conditional, keep `set -euo pipefail` for the real work). The hostnamectl apply happens regardless of log destination.
  - ✓ Reworked log() function to use fail-open pattern: checks if log dir is writable before attempting write
  - ✓ All log operations guarded with `|| true` and 2>/dev/null
  - ✓ Added LOG_DIR env override for testing
  - ✓ Journal logging always attempted (separate from file logging failure)
  - ✓ Shell wrapper maintains set -euo pipefail for actual node invocation
- [x] T194.2 Double-check the same read-only-fs assumption elsewhere in the unit path (the .service unit's ExecStartPre/StandardOutput, apply-hardware-hostname.js writes) — journal evidence shows only the touch; verify nothing else writes outside /tmp/config on live boots.
  - ✓ systemd unit verified: no StandardOutput/StandardError directives, no other write points
  - ✓ apply-hardware-hostname.js verified: only filesystem write is config/hardware-identity.json (in repo workdir, writable on live USB overlays)
  - ✓ hostnamectl invocation is command execution only, not filesystem write
  - ✓ Conclusion: only wrapper's log file write was the issue; now fail-open
- [x] T194.3 Since the unit file may be baked into existing sticks: the fixed script rides the normal drop-update (tools/runtime/ is in the drop); confirm the service ExecStart path points at the repo copy (it does per WO-78 installer — verify `scripts/setup/16-hardware-hostname-boot.sh` installs a symlink/copy; if it COPIES to /usr/local, the eggs image needs the fixed copy — note which and record the propagation path for the next ISO).
  - ✓ ExecStart points to /usr/local/lib/highascg/highascg-apply-hardware-hostname.sh (copied, not symlinked)
  - ✓ Installer (16-hardware-hostname-boot.sh) does `install -m 0755` COPY from tools/runtime/ to /usr/local/lib/highascg/
  - ✓ Drop-update: tools/runtime/ is NOT in rsync excludes (excludes only tools/eggs, tools/release, tools/smoke); so fixed script WILL propagate to existing sticks on next drop-update
  - ✓ Future ISOs: fixed script included in source tree, will be copied by installer during system setup
- [x] T194.4 Verify: bash -n; run the wrapper in a simulated read-only-log scenario (point HOME-less env var / override log dir to a read-only tmp dir if the script gains a LOG_DIR override — add one for testability) asserting it still reaches the node step (dry-run flag or PATH-stubbed hostnamectl — add `HIGHASCG_HOSTNAME_DRYRUN=1` support to the node script if trivial, else smoke the shell fallback logic alone); update the WO (checkboxes, dated log, note that this box's hostname corrects on next boot or next service-unit run).
  - ✓ bash -n syntax check: PASSED
  - ✓ LOG_DIR env override added for test-time use
  - ✓ Tested with read-only log dir (chmod 444): wrapper reached node step and exited 0
  - ✓ No Permission-denied escape from shell errors: all redirections guarded with `|| true`
  - ✓ Node script invocation: confirmed it runs regardless of log failure

## 3. Acceptance criteria

- [ ] A194.1 On the next USB boot the unit succeeds and the hostname becomes `highascg####` (owner check via `hostnamectl` after boot); installed-disk behavior unchanged.
- [ ] A194.2 Unit no longer shows failed in the journal on live boots.
- [ ] A194.3 Gates green.

## 4. Work log

- 2026-07-14 — WO created; root cause journal-confirmed (read-only /var/log touch aborts the wrapper on live boots before hostnamectl; identity derivation itself is correct and cached).
- 2026-07-14 14:30 UTC — Implementation complete
  - T194.1: Reworked tools/runtime/highascg-apply-hardware-hostname.sh with fail-open logging (tries /var/log, falls back to /tmp; LOG_DIR env override for testing)
  - T194.2: Verified no other write points in systemd unit or apply-hardware-hostname.js; only config/hardware-identity.json write (repo workdir, writable on live USB)
  - T194.3: Confirmed ExecStart path /usr/local/lib/highascg/ (COPY via installer); tools/runtime/ included in drop-update (not in rsync excludes)
  - T194.4: bash -n passed; tested with read-only log dir—wrapper reached node step and exited 0
  - Note: this box's hostname (currently highascg-nvidia-595) will self-correct to highascg7579 on next boot (identity file already correct at config/hardware-identity.json)
