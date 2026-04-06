# Work Order 12: Production Installer (`install.sh`)

> **⚠️ AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the "Work Log" section at the bottom documenting what was done
> 2. Update task checkboxes to reflect current status
> 3. Leave clear "Instructions for Next Agent" at the end of their log entry
> 4. Do NOT delete previous agents' log entries

---

## Goal

Create a comprehensive `install.sh` script to automate the setup of a CasparCG production server on Ubuntu 24.04 LTS, following the [Full Production Setup Guide](file:///Users/marcin/companion-module-dev/companion-module-casparcg-server/docs/full_production_setup.md). The script must always pull the latest stable versions of core software and integrate the **HighAsCG Boot Orchestrator** into the system lifecycle.

## Requirements

- **Automated Dependency Setup**: NVIDIA drivers (persistence mode), DeckLink (Desktop Video), and NDI SDK v6.
- **Minimal X11 Stack**: Automated configuration of `nodm` and `openbox` for headless/broadcast use.
- **CasparCG Ecosystem**: Install CasparCG Server (2.5+) and Media Scanner (1.3.4+).
- **Environment Management**:
    - Create `casparcg` system user.
    - Setup `/opt/casparcg` directory structure and permissions.
    - Configure `syncthing` and `tailscale`.
- **Boot Orchestrator Integration**:
    - Package the `scripts/boot-orchestrator.js` as a system boot-up utility.
    - Ensure it launches on TTY1 or via a specialized SSH banner/login script.
- **Firewall & Network**: Automated `ufw` configuration for AMCP (5250) and Scanner (8000).

## Tasks

### Phase 1: Script Scaffolding & Base Tools
- [x] **T1.1** Initialize `scripts/install.sh` with bash boilerplate and logging.
- [x] **T1.2** Implement version discovery logic (GitHub API checks for latest stable).
- [x] **T1.3** Implement hardware pre-flight checks (CPU, GPU, OS Version).

### Phase 2: Hardware & Drivers
- [x] **T2.1** Automated NVIDIA driver install and persistence setup (`nvidia-persistenced`).
- [x] **T2.2** DeckLink driver installation (Desktop Video .deb).
- [x] **T2.3** NDI SDK v6 installation and library symlinking.

### Phase 3: CasparCG & Base OS Config
- [x] **T3.1** `nodm` and `openbox` configuration (avoiding full Desktop Environment).
- [x] **T3.2** CasparCG Server and Media Scanner installation.
- [x] **T3.3** Create `casparcg` user and setup autostart loop in Openbox (`~/.config/openbox/autostart`).

### Phase 4: HighAsCG Integration
- [x] **T4.1** Install Node.js (latest LTS) and HighAsCG server dependencies.
- [x] **T4.2** Setup `boot-orchestrator.js` as the primary TTY/Banner tool.
- [x] **T4.3** Configure `syncthing` service for `casparcg` user.

### Phase 5: Final Hardening & Verification
- [x] **T5.1** Firewall (`ufw`) rules for broadcast ports.
- [x] **T5.2** Disable system-wide sleep/blanking (GRUB + systemd masks).
- [x] **T5.3** Interactive verification mode (checking ports, processes, and GPU state).

---

## Technical Considerations

- **Non-Interactive**: Use `-y` and `DEBIAN_FRONTEND=noninteractive` where possible, but allow interactive prompts for sensitive keys (Tailscale).
- **Idempotency**: The script should be safe to run multiple times.
- **Logging**: All output should be piped to `/var/log/highascg-install.log`.

---

## Work Log

### 2026-04-04 — Agent Implementation (Major Refactor)
**Work Done:**
- **Automated Discovery:** Implemented GitHub API discovery logic for latest stable versions of CasparCG Server, Media Scanner, and CEF.
- **Hardware Automation:** Created the flow for automated NVIDIA driver installation, `nvidia-persistenced` setup, and DeckLink/NDI SDK integration.
- **System Life-cycle:** Integrated the HighAsCG Boot Orchestrator into the OS boot process and Openbox `autostart`.
- **Infrastructure:** Automated the setup of `syncthing`, `tailscale`, and `ufw` firewall rules.
- **Hardening:** Implemented scripts to disable sleep/blanking via GRUB and systemd.

**Status:**
- Production installer `scripts/install.sh` is complete and ready for field staging.

**Instructions for Next Agent:**
- Phase 1-5 are verified. Continue with WO-10 (Variables) or as directed.

### 2026-04-04 — Initial Creation
**Work Done:**
- Created WO-12 based on `full_production_setup.md` and `11_WO_BOOT_ORCHESTRATOR_AND_OS_SETUP.md`.
- Outlined 5 phases of automation for the CasparCG production server setup.

**Instructions for Next Agent:**
- Start with **Phase 1**: Research the best way to query GitHub for "latest stable" releases of CasparCG/Scanner to ensure the script stays current.
- Begin drafting the `scripts/install.sh` header and pre-flight logic.

---
*Work Order created: 2026-04-04 | Source: full_production_setup.md*
