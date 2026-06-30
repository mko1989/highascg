# Post-boot health checks (`tools/startup`)

Read-only QA scripts for a **booted** live stick or playout host. This tree is **included in the ISO squashfs** (unlike `tools/eggs/`, which is build-host only).

## SSH workflow

```bash
ssh casparcg@<stick-ip>

# Full suite (persistence + exFAT + Calamares + 10 QA modules)
bash ~/highascg/tools/startup/run-health-checks.sh

# Fast smoke (skip AMCP VERSION + journal tail)
bash ~/highascg/tools/startup/run-health-checks.sh --quick

# Subsets
bash ~/highascg/tools/startup/verify-live-stick.sh
bash ~/highascg/tools/startup/stick-boot-test/run-stick-boot-tests.sh
bash ~/highascg/tools/startup/stick-boot-test/run-stick-boot-tests.sh --list
```

Exit code **0** = no FAIL (WARN alone is OK for stick-boot-test).

## Scripts

| Script | Purpose |
|--------|---------|
| `run-health-checks.sh` | Orchestrator — runs everything below |
| `verify-passwordless-sudo.sh` | Tailscale / Calamares / Caspar NOPASSWD + `/usr/local/lib` helpers |
| `verify-live-stick.sh` | Persistence, exFAT sync, GRUB/Plymouth, Calamares launch wiring |
| `stick-boot-test/run-stick-boot-tests.sh` | Modular QA (systemd, Caspar, AMCP, UI, Openbox, journal) |

## Build host only

ISO produce / flash checks stay under `tools/eggs/live-usb/` (not on stick).
