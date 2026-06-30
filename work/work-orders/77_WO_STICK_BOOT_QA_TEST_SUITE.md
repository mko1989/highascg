# Work Order 77: Operator USB stick — post-boot QA test suite (read-only)

> **⚠️ AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the **Work Log** section at the bottom documenting what was done.
> 2. Update task checkboxes to reflect current status.
> 3. Leave clear **Instructions for Next Agent** at the end of their log entry.
> 4. Do **NOT** delete previous agents' log entries.

**Status:** Phase A shipped (read-only test runner + 10 modules); Phase B–C outstanding  
**Priority:** **High** — gate stick releases without on-stick hotfixes  
**Parent / context:** [00_PROJECT_GOAL.md](./00_PROJECT_GOAL.md)

**Builds on:**
- [47_WO_EXFAT_DATA_MOUNT_AND_MTIME_BOOT_SYNC.md](./47_WO_EXFAT_DATA_MOUNT_AND_MTIME_BOOT_SYNC.md) — exFAT mount + boot sync
- [52_WO_BRIDGE_DISK_PARTITION_AND_USB_SYNC.md](./52_WO_BRIDGE_DISK_PARTITION_AND_USB_SYNC.md) — operator volume layout
- [66_WO_BOOT_DROP_UPDATE_VERSION_AND_WEBUI_UPDATE.md](./66_WO_BOOT_DROP_UPDATE_VERSION_AND_WEBUI_UPDATE.md) — `drop-update/` retain mode
- [73_WO_CALAMARES_SYSTEMD_CASPAR_NUCLEAR.md](./73_WO_CALAMARES_SYSTEMD_CASPAR_NUCLEAR.md) — systemd Caspar ownership

**Related scripts (legacy — do not delete):**
- `tools/eggs/live-usb/verify-live-stick.sh` — persistence + branding (union persist era)
- `tools/eggs/live-usb/verify-config-persistence.sh` — shorter config checks
- `tools/eggs/live-usb/verify-highascg-stick-boot.sh` — **build host** pre-flash checks
- `tools/runtime/diagnose-caspar-supervisors.sh` — Caspar-only diagnostic

**New canonical post-boot suite:**
- `tools/runtime/stick-boot-test/run-stick-boot-tests.sh`

---

## 1. Problem statement

Stick bring-up has been **reactive**: boot, notice a failure, patch the laptop or reflash. We need a **repeatable, read-only QA gate** after booting from the operator USB stick that:

| Gap | Today | Impact |
|-----|-------|--------|
| No single “is this stick good?” command | Scattered verify/diagnose scripts | Operators and agents miss checks |
| Tests mixed with fixes | diagnose scripts print `sudo bash …` repair hints | Muddy signal on playout floor |
| exFAT-only stick (no union persist) | `verify-live-stick.sh` still emphasizes `persistence` cmdline | False failures on current layout |
| drop-update / Caspar / UI not one report | Separate logs and manual `pgrep` | Slow release sign-off |

**Goal:** One command on the **booted playout machine** prints PASS/WARN/FAIL for the full operator-stick contract — **no mutations**, exit code 1 only on FAIL.

---

## 2. Product behaviour (normative)

### 2.1 When to run

| When | Command |
|------|---------|
| After cold boot from stick (laptop or bench) | `bash ~/highascg/tools/runtime/stick-boot-test/run-stick-boot-tests.sh` |
| Fast smoke (skip AMCP VERSION + journal tail) | `…/run-stick-boot-tests.sh --quick` |
| List modules | `…/run-stick-boot-tests.sh --list` |

Run as user `casparcg` (root not required). Script must **never** `systemctl restart`, `chown`, `rsync`, or edit files.

### 2.2 Test modules (Phase A)

| # | Module | PASS criteria (summary) |
|---|--------|-------------------------|
| 01 | `test-01-live-identity` | Hostname, live/overlay hint, NVIDIA stamp |
| 02 | `test-02-stick-layout` | `LABEL=HIGHASCGEXF` block device |
| 03 | `test-03-exfat-operator` | exFAT mounted at `~/exfat`, operator dirs, sync map |
| 04 | `test-04-drop-update` | `drop-update/` has full server drop shape + retain marker |
| 05 | `test-05-systemd-wo47` | WO-47 + Caspar + highascg units present; none `failed` |
| 06 | `test-06-caspar-supervisor` | ≤1 `run.sh`, exactly 1 main casparcg, cwd + config path |
| 07 | `test-07-amcp-playout` | `:5250` listening; optional `VERSION` |
| 08 | `test-08-highascg-ui` | `highascg.service` active; HTTP 200/30x; `dist-web/` |
| 09 | `test-09-openbox-wiring` | Autostart does not duplicate systemd Caspar |
| 10 | `test-10-boot-journal` | server-update / sync / exfat-boot units not failed |

**WARN** does not fail the run. **FAIL** sets exit code 1.

### 2.3 Build host vs playout host

| Script | Runs on |
|--------|---------|
| `verify-highascg-stick-boot.sh` | Eggs **build host** before `eggs produce` / flash |
| `run-stick-boot-tests.sh` | **Booted stick** playout machine |

---

## 3. Implementation phases

### Phase A — Read-only suite (shipped 2026-06-29)

- [x] **T77.A.1** `stick-boot-test/stick-test-lib.sh` — PASS/WARN/FAIL counters, no side effects
- [x] **T77.A.2** `run-stick-boot-tests.sh` — orchestrator, `--quick`, `--list`
- [x] **T77.A.3** Tests 01–10 under `stick-boot-test/tests/`
- [ ] **T77.A.4** Document in `docs/STICK_QUICK_START.md` § Post-boot QA (one paragraph + command)

### Phase B — Release gate integration

- [ ] **T77.B.1** Eggs host: after `build-produce-flash-stick.sh`, print reminder to run suite on target hardware
- [ ] **T77.B.2** Optional: `HIGHASCG_STICK_BOOT_TEST=1` in tmux flash log appendix (SSH runner)
- [ ] **T77.B.3** CI smoke: run lib + syntax-check all test scripts (no hardware)

### Phase C — Extended coverage

- [ ] **T77.C.1** `test-11-replication` — optional when `replication.json` enabled (peer ping, role)
- [ ] **T77.C.2** `test-12-companion` — companion.service + port 8001
- [ ] **T77.C.3** `test-13-gpu-display` — `DISPLAY=:0`, xrandr mode count, nvidia-smi
- [ ] **T77.C.4** JSON report mode `--json` for support bundle ingestion (WO-67)
- [ ] **T77.C.5** Cold-boot **twice** checklist script (config survives second boot) — still read-only compare

### Phase D — Stick image hardening (separate from tests)

Tests inform fixes baked into **next** `eggs produce`, not on-stick patches:

- [ ] **T77.D.1** `prepare-eggs-clone-with-exfat.sh` must pass `verify-highascg-stick-boot.sh` before produce
- [ ] **T77.D.2** Include `run.sh` in `drop-update/` seed members (stick hotfix path)
- [ ] **T77.D.3** Sign-off record template in work log after full PASS on reference laptop

---

## 4. Acceptance criteria

- [ ] Boot reference stick on bench laptop → `run-stick-boot-tests.sh` → **0 FAIL**
- [ ] At most **one** `run.sh` and **one** main `casparcg` in test 06
- [ ] `drop-update/tools/runtime/exfat-sync-cli.js` present on exFAT (test 04)
- [ ] Operator UI reachable at `http://<ip>/` (test 08)
- [ ] Re-run after 24h uptime — still PASS (no slow leaks / duplicate supervisors)

---

## 5. File map

| Path | Role |
|------|------|
| `tools/runtime/stick-boot-test/run-stick-boot-tests.sh` | Entry point |
| `tools/runtime/stick-boot-test/stick-test-lib.sh` | Shared PASS/WARN/FAIL |
| `tools/runtime/stick-boot-test/tests/test-*.sh` | Individual modules |
| `work/work-orders/77_WO_STICK_BOOT_QA_TEST_SUITE.md` | This WO |

---

## 6. Work log

### 2026-06-29 — Phase A: read-only stick boot test suite

- Added `tools/runtime/stick-boot-test/` with orchestrator + 10 read-only test modules covering exFAT, drop-update shape, systemd chain, Caspar supervisor singularity, AMCP, UI, Openbox wiring, boot journal.
- Lives under `tools/runtime/` (not `tools/eggs/`) so embed-server ISO excludes do not strip it from the stick.
- Deliberately **no fix commands** in test output — failures point to WO/build-host fixes for the next flash.
- Legacy verify scripts retained; this suite is the canonical **post-boot** gate.

**Instructions for Next Agent:** Run suite on booted stick hardware; log FAIL lines in Work Log; implement Phase B reminder in `build-produce-flash-stick.sh`; add `run.sh` to drop-update seed (T77.D.2); extend Phase C as needed.
