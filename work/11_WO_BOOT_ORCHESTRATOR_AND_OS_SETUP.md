# Work Order 11: Boot Orchestrator & OS Setup

> **⚠️ AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the "Work Log" section at the bottom documenting what was done
> 2. Update task checkboxes to reflect current status
> 3. Leave clear "Instructions for Next Agent" at the end of their log entry
> 4. Do NOT delete previous agents' log entries

---

## Goal

Create a **Boot Orchestrator** CLI script that runs on server startup, displays network status, and manages the lifecycle of the Linux display stack (nodm, openbox) and CasparCG. Refactor the configuration system to move away from intermediate "data pushing" in favor of a robust file-based source-of-truth.

## Requirements

- **CLI Interface**: Display IP on boot, interactive setup for screens/EDIDs.
- **Config Refactor**: Server reads config from disk on start/reload; settings UI writes to file and triggers reload.
- **Hardware Mapping**: Map physical screens to X-canvas positions.
- **Service Integration**: Manage system services (`nodm`, `highascg-server`).

## Tasks

### Phase 1: Configuration Refactor (Data Flow)

- [x] **T1.1** Create `src/config/config-manager.js`.
  - Load and save `highascg.config.json`.
  - Provide a schema-validated "current config".
  - Implement a `reload()` mechanism that signals other subsystems.
- [x] **T1.2** Update `src/api/routes-settings.js`.
  - Move from mutating `ctx.config` directly to using `configManager.save()`.
- [x] **T1.3** Implement "Config Reload" signaling.
  - Subsystems (Streaming, OSC) subscribe to config changes.

### Phase 2: CLI Boot Orchestrator

- [x] **T2.1** Create `scripts/boot-orchestrator.js`.
  - Auto-display local IP addresses using Node `os` module.
  - Simple `readline` or `inquirer` menu for setup.
- [x] **T2.2** Hardware Information Gathering.
  - Run `xrandr` (if X is up) or `ls /sys/class/drm` to list connected displays.
  - Parse EDID info where available.

### Phase 3: Setup & Hardware Mapping

- [x] **T3.1** Implement screen positioning logic.
  - CLI menu: "Identify Screen" (flash colors) -> "Assign Position".
  - Update `highascg.config.json` with X/Y coordinates.
- [x] **T3.2** CasparCG Configuration Extension.
  - Update `config-generator.js` to include:
    - Custom video modes.
    - Global multiview toggle.
    - Audio device mapping.
    - Decklink/NDI I/O options.

### Phase 4: OS & Service Management

- [x] **T4.1** Implement "Apply & Launch" logic.
  - Script to generate/update `/etc/X11/xorg.conf` or equivalent (for screen positioning).
  - Restart `nodm` / `openbox` services.
- [x] **T4.2** Web GUI System Settings.
  - Mirror CLI setup in a new "System" tab in the web UI.

---

## Technical Considerations

- **Permissions**: Managing OS services (nodm) and X11 config requires root/sudo. The orchestrator may need to be run with elevated privileges or via specialized wrappers.
- **Headless Mode**: The CLI should be usable via SSH.
- **Browser-Side Sync**: Ensure the web UI reflects changes made via the local CLI.

---

## Work Log

### 2026-04-04 — Agent Implementation (Major Refactor)
**Work Done:**
- **Refactor:** Created `src/config/config-manager.js` for centralized disk-based configuration.
- **Orchestrator:** Implemented `scripts/boot-orchestrator.js` for CLI display mapping and network status.
- **UI:** Developed the "System" tab in the web Settings modal for hardware configuration.
- **OS Control:** Added `xrandr` and `nodm` service management via `src/utils/os-config.js`.
- **Generator:** Enhanced `config-generator.js` with support for custom modes, multiscreen layouts, and professional I/O (Decklink/NDI).

**Status:**
- All core tasks are complete and verified.

**Instructions for Next Agent:**
- Phase 1-4 are verified. Continue with WO-12 (Production Installer) or as directed.

### 2026-04-04 — Initial Creation
**Work Done:**
- Outlined the Boot Orchestrator and Config Refactor plan based on user requirements.

**Instructions for Next Agent:**
- Start on **Phase 1**: Implement the `ConfigManager` to centralize all config disk I/O.
- Review existing `config-generator.js` to see how to merge the new OS-level screen mappings.

---
*Work Order created: 2026-04-04 | Parent: 00_PROJECT_GOAL.md*
