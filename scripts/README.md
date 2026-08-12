# HighAsCG Scripts — Organizational Guide

This directory contains ~150+ shell scripts, Python helpers, and utilities organized by lifecycle phase and deployment scope. This guide clarifies what runs when and prevents cross-category confusion.

---

## Four Script Categories

### 1. **Provisioning** — Empty server → playout box
**When:** Zero-configuration deployment on new/recovered hosts  
**Scope:** `scripts/setup/`, `scripts/boot/`, `scripts/exfat/install-*`, `scripts/replication/`, `work/bootstrap-*.sh`  
**Idempotent:** Yes (where possible)  
**Who runs:** System integrator (first-time setup) or ISO production (during live-USB clone)

#### `scripts/setup/` — ordered numbered steps (01–16)
Core provisioning sequence: kernel, NVIDIA, NDI, CasparCG, browser, permissions, boot.

**Numbered flow (01–16):**
- `01-kernel-117.sh` — Pin kernel 6.8.0-117
- `02-verify-kernel-117.sh` — Verify kernel after reboot
- `03-nvidia-open-595.sh` — NVIDIA open modules
- `04-ndi.sh` — NDI runtime libraries
- `05-caspar-deps.sh` — CasparCG system dependencies
- `06-decklink-manual.md` — Manual (DeckLink card only)
- `07-node-highascg.sh` — Node.js + HighAsCG runtime + deps
- `08-caspar-cef-scanner.sh` — CasparCG scanner + CEF
- `09-openbox-autostart.sh` — X11 + OpenBox + autostart
- `10-playout-performance.sh` — Governor + apt auto-upgrade disable
- `11-boot-branding.sh` — GRUB/boot splash (optional)
- `12-passwordless-sudo.sh` — NOPASSWD allowlist (hardcoded from src/)
- `12b-syncthing-highascg.sh` — Syncthing dev repo sync (optional)
- `13-caspar-systemd-units.sh` — Caspar systemd installation (hardcoded from src/)
- `13b-syncthing-media-pair.sh` — Syncthing playout media folder (optional)
- `13-usb-ingest.sh` — USB ingest polkit rules (hardcoded from src/)
- `14-power-button-network-reset.sh` — Power button handler (hardcoded from src/)
- `14b-private-volume-bootstrap.sh` — Private LVM volume setup (optional)
- `15-licenses-install.sh` — Caspar/CEF license files
- `16-hardware-hostname-boot.sh` — Hardware detection + hostname

**Helper libraries:**
- `lib/install-helpers.sh` — Common functions (apt block, user creation)
- `lib/install-helpers-github.sh` — GitHub asset download/verify
- `lib/install-helpers-packages.sh` — Package selection by NVIDIA driver version
- `lib/install-config.sh` — Config file template installation
- `lib/decklink-install-lib.sh` — DeckLink SDK helpers
- `lib/apt-block-service-starts.sh` — Prevent daemon auto-start during install

**Helpers (in setup/ root):**
- `check-decklink.sh` — Verify DeckLink card presence
- `fix-caspar-and-grub.sh` — Recovery: reinstall Caspar libs + GRUB (fast path)
- `install-exfat-sync-map.sh` — Map exFAT partitions for boot sync
- `install-tailscale-deb-for-iso.sh` — Tailscale ISO inclusion
- `reinstall-cef.sh` — Caspar CEF redownload
- `sync-caspar-supervisor-wiring.sh` — Update supervisor systemd links
- `verify-boot-branding.sh` — Verify boot logo installed
- MANUAL_INSTALL.md — Step-by-step guide with copy-paste commands
- README.md → *This file* (setup flow documentation)
- `*.conf.example` and `*.md` — Config templates

#### `scripts/boot/` — Boot-time preparation
- `install-nvidia-persistenced-boot-order.sh` — NVIDIA persistence daemon
- `install-host-boot-branding.sh` — Host boot logo
- `install-fast-boot-network.sh` — Network stack optimization for boot

#### `scripts/exfat/install-*.sh` — ExFAT volume systemd units
- `install-exfat-systemd-units.sh` — Main installer
- `install-exfat-units-exfat.sh` — exFAT mount + sync
- `install-exfat-units-bridge.sh` — Bridge mode hooks
- `install-exfat-units-enable.sh` — Enable/start systemd services

#### `scripts/exfat/` — High-ASCII runtime wired into systemd
**These are installed to `/etc/highascg/systemd-exfat/` or copied to `bin/` on playout machines:**
- `highascg-exfat-bootstrap.sh` — First-boot exFAT mount
- `highascg-exfat-arrive.sh` — Hot-plug USB detect
- `highascg-exfat-boot.sh` — Boot-time sync + apply
- `highascg-exfat-network-apply.sh` — Network config from exFAT
- `highascg-exfat-remount-sync.sh` — Mount + sync on demand
- `highascg-exfat-server-update.sh` — Pull updates from exFAT
- `highascg-apply-server-drop.sh` — Apply dropped server updates
- `highascg-bridge-boot.sh` — Bridge mode boot hook
- `highascg-bridge-arrive.sh` — Bridge hot-plug
- `highascg-fix-config-permissions.sh` — Fix config ownership
- `highascg-webui-server-update.sh` — Pull web UI updates
- `write-highascg-systemd-unit.sh` — Generate systemd service from template
- `apply-bridge-label-highascgdat.sh` — Bridge partition label

#### `scripts/replication/` — SSH peer sync setup
- `setup-replication-ssh.sh` — Configure SSH for peer replication
- `install-replication-ssh-wrapper.sh` — Install wrapper script

#### `scripts/lib/` — Sourced by setup scripts
Utility functions (listed above)

#### Other provisioning scripts (root of `scripts/`)
- `install.sh` — Monolithic installer (legacy; still works; phases 1–5)
- `fix-host-boot-*.sh` — Boot troubleshooting (duplicate sources in `scripts/fix/`)
- `fix-boot-emergency-recovery.sh` — EFI/GRUB recovery
- `fix-highascg-no-exfat-startup-block.sh` — exFAT mount ordering
- `clean-eggs-dev-host.sh` — Clear local eggs build state

---

### 2. **Eggs/ISO Production** — Build bootable HighAsCG live USB
**When:** Creating a live-USB installer for new playout machines  
**Scope:** `tools/eggs/live-usb/` (~75 scripts), `work/run-eggs-*.sh` wrappers  
**Idempotent:** No (destructive flash; requires confirmation)  
**Who runs:** Build operator with live-USB device connected

#### `tools/eggs/live-usb/` — ISO/squashfs build helpers
**High-level orchestrators:**
- `build-highascg-egg.sh` — Full ISO bake (prepare → build → compress squashfs)
- `build-produce-flash-stick.sh` — Clone ISO to USB + flash bootloader
- `prepare-eggs-clone-with-exfat.sh` — Calamares + theme + exFAT prep

**ISO content assembly:**
- `pack-exfat-starter-zip.sh` — Bundle exFAT starter files
- `penguins-eggs-exclude-*.list` — Files to exclude from squashfs
- `merge-penguins-eggs-exclude-highascg.sh` — Merge fragments into eggs config

**Calamares installer patching:**
- `fix-calamares-shellprocess.sh` — Patch offline l10n + logs
- `install-eggs-calamares.sh` — Calamares + theme install on host
- `patch-iso-squashfs-calamares.sh` — Re-patch ISO squashfs
- `verify-calamares-installed.sh` — Verify Calamares readiness
- `install-grub-for-calamares-iso.sh` — BIOS/UEFI bootloader
- `highascg-calamares-branding.service` (moved to tools/eggs/live-usb/)

**ISO verification:**
- `verify-startup-on-host.sh` — Boot-test before produce
- `verify-iso-squashfs-excludes.sh` — Verify ISO contents
- `verify-config-persistence.sh` — Test exFAT persistence
- `verify-calamares-installed.sh` — Verify ISO installer

**ExFAT helpers:**
- `stop-and-unmount-wo47-for-eggs-produce.sh` — Pause exFAT before produce
- `diagnose-highascg-startup.sh` — Debug boot failures
- `audit-eggs-clone-host.sh` — Pre-produce sanity check
- `unmask-exfat-systemd.sh` — Reverse systemd masks
- `strip-host-swap-for-live-iso.sh` — Swap fstab for ISO

**Live-USB theme:**
- `highascg-eggs-theme/` — Calamares branding assets
- `install-eggs-live-grub-theme.sh` — GRUB2 boot theme

#### `work/run-eggs-*.sh` — High-level orchestrators
**Main wrappers (≤4 variants):**
- `run-eggs-clone-flash.sh` — Clone ISO + flash to USB (plain terminal, no tmux)
- `run-eggs-clone-flash-tmux.sh` — Clone ISO + flash (tmux multiplexed for monitoring)
- `run-eggs-clone-flash-inner.sh` — Inner loop (called by clone-flash; do not run directly)
- `run-eggs-prepare-safe.sh` — Prepare host (Calamares + theme; safe for build host)
- `run-eggs-produce-from-host.sh` — Produce ISO (requires `eggs produce` on build host)
- `run-eggs-produce-clone-only.sh` — ISO only (no flash to USB)

#### Deprecated eggs wrappers (moved to `work/deprecated/eggs-wrappers/`)
- Previously: 2–3 additional variants (merged into main 4-variant set per T143.3)

---

### 3. **Runtime (Shipped with Server)** — Scripts spawned by Node.js / systemd
**When:** Server is running; triggered by user actions or boot events  
**Scope:** `tools/runtime/` (60+ scripts), some `scripts/exfat/highascg-*` (wired into systemd)  
**Idempotent:** Varies (most are safe to re-run)  
**Who runs:** Bridge application (via subprocess), systemd services, or operators

**IMPORTANT NAMING TRAP:** `scripts/runtime/` does NOT contain runtime scripts. It contains **INSTALLERS** for runtime scripts (e.g., `decklink-install-from-exfat.sh`). Actual runtime is in `tools/runtime/`.

#### Runtime-Wired Helpers (called from src/)
These are invoked by the Node.js application at runtime. Each lists its call site:

| Script | Call Site | Purpose |
|--------|-----------|---------|
| `caspar-kill-main.sh` | `src/utils/caspar-restart.js` | Force Caspar process termination |
| `casparcg-supervisor-lib.sh` | `run.sh` (startup loader) | Supervisor daemon functions |
| `confine-pointer-barriers.py` | `src/system/pointer-confine.js` | XFixes pointer barrier confinement (playout UI lock) |
| `cef-interactive-x11.py` | `src/system/cef-bridge-subprocess.js` | CEF subprocess sandbox control |
| `highascg-launch-operator-firefox.sh` | `src/api/routes-system-browser.js` | Launch operator Firefox on :1 |
| `highascg-network-apply.sh` | **Installed to `/usr/local/lib/highascg/`** then called from `src/api/system-hardware-network.js` | Apply network config |
| `highascg-network-reset.sh` | `src/api/system-hardware-network.js` | Reset network to defaults |
| `highascg-nvidia-x-apply.sh` | `src/utils/nvidia-display-policy.js` | Apply NVIDIA X11 config |
| `highascg-operator-snap-home.sh` | `src/system/cef-bridge-subprocess.js` | Operator sandbox $HOME setup |
| `highascg-replication-ssh.sh` | **Installed to `/usr/local/lib/highascg/`** then called from `src/api/routes-media-replication.js` | SSH peer sync wrapper |
| `print-api-token.sh` | `src/api/auth-token-file.js` | Output API token (diagnostic) |
| `exfat-sync-cli.js` | `highascg-exfat-sync.service` (systemd) | Poll exFAT mtime → update server |

**Installation into `/usr/local/lib/highascg/`:**
Some helpers are copied to `/usr/local/lib/highascg/` during provisioning (readable by playout processes on live-USB):
- `highascg-network-apply.sh` — installed by `scripts/exfat/install-exfat-units-exfat.sh`
- `highascg-replication-ssh.sh` — installed by `scripts/replication/install-replication-ssh-wrapper.sh`
- `highascg-vcam-modules-up.sh` — installed by `scripts/setup/12-passwordless-sudo.sh` (v4l2 kernel modules)
- `fix-calamares-branding.sh` → `/usr/local/lib/highascg/fix-calamares-branding.sh` — Installed by `tools/eggs/live-usb/install-eggs-calamares.sh`

#### Non-Wired Helpers (supplementary / diagnostic)
- `caspar-systemd-cleanup.sh` — Caspar systemd state cleanup
- `caspar-systemd-control.sh` — Systemd service control wrapper
- `casparcg-run.sh` — Caspar binary launcher (canonical copy for `/opt/casparcg/run.sh`)
- `diagnose-caspar-supervisors.sh` — Supervisor state introspection
- `clean-slate-reset.js` — Factory reset / wipe server config
- `launch-calamares.sh` — Start live-USB installer in running OS
- `capture-boot-xrandr.sh` — Record X11 display layout at boot
- `highascg-apply-hardware-hostname.js` / `.sh` — Hardware detection → hostname
- `highascg-clean-firefox-snap-leftovers.sh` — Firefox snap cleanup
- `highascg-tailscale-up.sh` — Tailscale network join
- `highascg-vcam-modules-up.sh` — Load v4l2loopback + vcam kernel modules
- `verify-power-button-setup.sh` — Diagnostic: power button handler
- `probe-internal-storage.sh` — Storage device inventory
- `replication-pair-qa.sh` — Peer sync testing
- `exfat-sync-cli.js` — exFAT mount-time sync

#### Calamares Helpers (ISO-related, moved to tools/eggs/live-usb/)
These are installed by `fix-calamares-shellprocess.sh` into the live-USB squashfs:
- `calamares-l10n-helper.sh` — Localization (offline-safe)
- `calamares-logs-helper.sh` — Installation log capture
- `calamares-nomodeset-helper.sh` → `/usr/sbin/calamares-nomodeset.sh` — GRUB nomodeset recovery
- `fix-calamares-branding.sh` → `/usr/local/lib/highascg/fix-calamares-branding.sh` — Boot logo repair

#### Deprecated / Stray in tools/runtime/ (moved to work/deprecated/tools-runtime/)
- `casparcg-staged-start.sh` — No external references; deprecated wrapper
- `start-highascg.sh` — No external references; deprecated launcher
- `cef-interactive-api-smoke.sh`, `cef-interactive-load-test.sh`, `cef-interactive-watch-logs.sh` — dev/debug only
- `stick-boot-test/` → `work/deprecated/` (wrapper; canonical is `tools/startup/stick-boot-test/`)

**NOTE:** `patch-wo47-exfat-boot-scripts.sh`, `wo47-*.sh` remain in tools/runtime/ (referenced by exFAT systemd units and eggs/live-usb/).

#### `scripts/runtime/` (naming trap — these are **INSTALLERS**, not runtime)
- `remove-highascg-web-proxy.sh` — remove the old nginx :80 proxy (WO-498; UI is served directly on :4200)
- `install-network-apply.sh` — network-apply script installer
- `decklink-install-from-exfat.sh` — DeckLink driver installer

---

### 4. **Deploy / CI / QA** — Build, test, release, monitor
**When:** CI/CD pipeline, smoke testing, release prep  
**Scope:** `scripts/deploy/`, `tools/ci/`, `tools/startup/`, `tools/smoke/`  
**Idempotent:** Varies (CI is idempotent; deploy is push-only)  
**Who runs:** GitHub Actions, integrator, or QA operator

#### `scripts/deploy/` — Release & backup
- `dev-push.sh` — Push to dev server / remote
- `push-backup-box.sh` — Mirror to backup replication target
- `extract-backup-box-local.sh` — Restore from backup

#### `tools/ci/` — Automated testing & validation
- `check-script-paths.js` — (**NEW**) Verify all referenced scripts exist on disk
- `run-local-ci.sh` — Run test suite locally
- `run-offline-tests.js` — Offline test harness
- `collect-offline-tests.js` — Manifest offline test files
- `verify-require-integrity.js` — Check `require()` paths
- And more: linting, type checks, build validation

#### `tools/startup/` — Live-USB boot verification
- `run-health-checks.sh` — Full playout readiness check
- `verify-live-stick.sh` — Verify live-USB boot chain
- `verify-passwordless-sudo.sh` — Verify NOPASSWD config
- `verify-caspar-autostart.sh` — Verify Caspar systemd
- `verify-storage-drivers.sh` — Storage device status
- `verify-decklink.sh` — DeckLink driver + card detection
- `stick-boot-test/` — Interactive boot simulator

#### `tools/startup/stick-boot-test/` — Boot simulator
- `run-stick-boot-tests.sh` — Test boot chain on live-USB
- Integrated into `run-health-checks.sh`

---

## Do Not Use (Deprecated / Legacy Directories)

| Path | Reason | Status |
|------|--------|--------|
| `scripts/deprecated/` | **The single archive** — everything retired lives here (WO-273) | Archive; kept for diff reference. Never referenced by runtime. |
| `scripts/deprecated/legacy/` | Old install phases (1–5), was `scripts/legacy/` | Superseded by `scripts/setup/01-16` ordered flow |
| `scripts/deprecated/unused/` | Dead scripts (no references), was `scripts/unused/` | Keep for audit trail; do not run |
| `scripts/deprecated/lib/` | Abandoned 2026-07-04 split of `lib/install-helpers.sh` | All 23 functions still live in the monolith; nothing sourced these |
| `scripts/fix/` | Duplicate sources of root `fix-*.sh` | Keep newest; deprecate pair |
| `tools/eggs/live-usb/legacy-persistence/` | Old persistence schemes | Not used in current ISO |
| `tools/eggs/unused/` | Unused eggs modules | Audit trail only |
| `work/deprecated/` | Retired wrappers + stray helpers | Moved items only; do not reference |

---

## Where do I put a new script? (WO-273)

Answer these in order; the first "yes" is your directory.

1. **Does the running server, a systemd unit, or the operator GUI invoke it during playout?**
   → `tools/runtime/`. It ships in the release tarball and the exFAT drop-update, so it must
   work with no build host present. Add the call site to the runtime table above in the same
   commit — a runtime script with no named caller is indistinguishable from dead code.
   *(Naming trap, unchanged: `scripts/runtime/` holds INSTALLERS for runtime scripts, not
   runtime scripts.)*

2. **Does it install/configure a systemd unit or a runtime helper onto a host?**
   → `scripts/setup/` (numbered if part of the fresh-Ubuntu sequence), `scripts/boot/`,
   `scripts/exfat/`, or `scripts/replication/`. Run once per machine, never during playout.

3. **Does it only ever run on the build host** (eggs produce, release packaging, wiki,
   mirrors, QA)? → `tools/eggs/`, `tools/release/`, `tools/wiki/`, `tools/ci/`, `tools/map/`,
   `tools/smoke/`, `tools/startup/`. These may be excluded from the ISO.

4. **Is it superseded or dead?** → `scripts/deprecated/` (or `tools/eggs/unused/`). **Move,
   never delete** — `git mv` so history follows. `scripts/legacy/` and `scripts/unused/` were
   folded into `scripts/deprecated/{legacy,unused}/` by WO-273; do not recreate them. One
   archive, one meaning.

**Before you move anything:** name the caller first. `grep -rn <basename>` across `src/`,
`client/`, `scripts/`, `tools/`, `package.json`, `scripts/systemd/*.service`,
`/etc/systemd/system/`, `~/.config/openbox/autostart`, and the eggs exclude lists. Note that
basename grep alone is **not sufficient** — `tools/runtime/patch-wo47-exfat-boot-scripts.sh`
builds its fallback path as `"${HERE}/wo47-${name}"`, so `wo47-highascg-exfat-boot.sh` looks
unreferenced but is live. Grep for constructed paths (`${VAR}/...${VAR}`) too.

**When evidence is ambiguous, classify as runtime.** A wrong "deprecated" call breaks a live
playout box; a wrong "runtime" call only leaves clutter.

After any move run `npm run verify:script-paths` and `npm run test:ci`.

---

## Quick Reference: Where to Find What

| Task | Location | Type |
|------|----------|------|
| Fresh host setup | `scripts/setup/01-16` + `MANUAL_INSTALL.md` | Shell (ordered) |
| Fix broken boot | `scripts/fix/`, `scripts/boot/` | Shell (one-off) |
| Build live-USB | `work/run-eggs-*.sh` | Shell (wrappers) |
| Playout runtime | `tools/runtime/` (src/ wired) | Mixed (shell/Python/JS) |
| systemd units | `scripts/systemd/`, `scripts/exfat/` | INI/Shell |
| Tests & checks | `tools/ci/` | JS (Node) |
| Boot verification | `tools/startup/` | Shell |

---

## Notes

- **Systemd references:** Search `scripts/systemd/` for service/timer files. Many reference `/usr/local/lib/highascg/` (installed at provision time).
- **Live-USB image:** Built by `tools/eggs/live-usb/build-highascg-egg.sh`; uses `penguins-eggs` + custom squashfs excludes.
- **Shared installer path:** `scripts/setup/lib/` + `scripts/lib/` provide common functions.
- **Versioning:** Most scripts are idempotent or safe to re-run; check docs for exceptions (flash operations, reset, etc.).
