# Work Order 13: Final Polish & Security Hardening

> **⚠️ AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the "Work Log" section at the bottom documenting what was done
> 2. Update task checkboxes to reflect current status
> 3. Leave clear "Instructions for Next Agent" at the end of their log entry
> 4. Do NOT delete previous agents' log entries

---

## Goal

Finalize the CasparCG production environment with a focus on **Security Hardening** (restricting all access to Local & Tailscale only), **API Polish** (Variable Batching), and **Companion Integration** (exposing all new HighAsCG features like Audio, Streaming, and OS control).

## Tasks

### Phase 1: Security Hardening (Firewall & SSH)

- [x] **T1.1** Explicitly restrict SSH (port 22) to RFC1918 (10/172/192) and Tailscale interfaces in `install.sh`.
- [x] **T1.2** Add "IP/Network Security" section to the Boot Orchestrator status banner.
- [x] **T1.3** Verify `ufw` rules cover all HighAsCG ports (9590, 8554, 8889, etc.).

### Phase 2: API Polish (Variable Batching)

- [x] **T2.1** Implementation of `GET /api/variables/batch`.
  - Optimized for initial sync.
  - Category filtering.
- [x] **T2.2** Enhanced Searchable UI for Variables.
  - "Copy Companion Key" helper in `web/components/variables-panel.js`.

### Phase 3: Companion Module Enhancements

- [x] **T3.1** Update `companion-module-highpass-highascg` actions:
  - `Master Volume` (Mixer Mastervolume)
  - `Layer Volume` (Mixer Volume)
  - `Log Level` (Basic Log Level)
  - `Streaming Toggle` (Streaming API)
  - `Apply OS Settings` (Settings API)
- [x] **T3.2** Update Companion variables:
  - `streaming_active`, `uptime`, `audio_monitoring_source`.

### Phase 4: Web UI & Final UX

- [x] **T4.1** Ensure WebRTC Preview is available in Scenes/Timeline editors.
- [x] **T4.2** Added "Connected via..." indicator in the header (Local vs Tailscale vs Wan).

---

## Technical Considerations

- **SSH Hardening**: Use `ufw allow from <source> to any port 22` instead of just global allow.
- **Companion Sync**: The bridge should handle the batch variable API gracefully.

---

## Work Log

### 2026-04-04 — Final Polish & Hardening Completed
**Work Done:**
- **Security**: Updated `install.sh` to restrict SSH and Firewall to Local/Tailnets.
- **API**: Implemented `GET /api/variables/batch` for efficient synchronization.
- **Companion**: Added new actions (Streaming, Log Level, OS Apply, Volume) and variables.
- **UI**: Added "Category" filters and "Network Context" indicator (Local/LAN/Tailscale/WAN).
- **Verification**: All smoke tests passed.

**Status:** ALL PHASE 21 TASKS COMPLETED.

**Instructions for Next Agent:**
- The system is now production-ready and hardened.
- Perform field testing with real CasparCG hardware.
- Continue with any remaining non-critical JSDoc or refactoring as needed.

---
*Work Order created: 2026-04-04 | Parent: 00_PROJECT_GOAL.md*
