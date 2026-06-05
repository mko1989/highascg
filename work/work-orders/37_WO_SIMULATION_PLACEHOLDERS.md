# Work Order 37: Simulation Mode Placeholders (Preshow Prep)

> **⚠️ AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the "Work Log" section at the bottom documenting what was done
> 2. Update task checkboxes to reflect current status
> 3. Leave clear "Instructions for Next Agent" at the end of their log entry
> 4. Do NOT delete previous agents' log entries

---

## Goal

Enhance the **Offline Preparation / Simulation Mode** by allowing operators to create "Placeholder" media assets. These placeholders enable designing complex layouts, PIPS, and multi-layered looks without having the actual high-resolution media files present or a live CasparCG connection.

## Scope

- **Simulation Mode Only**: This feature should only be visible when the system is in `offline_mode` or using the simulated AMCP client.
- **Sources Browser Integration**: Add a new tab in the left-hand Sources Browser titled "Placeholders".
- **Placeholder Generation**: Provide a UI to generate virtual clips from a set of templates.

## Tasks

### Phase 1: Sources Browser UI
- [x] **T1.1** Update `sources-panel.js` to include a "Placeholders" tab.
- [x] **T1.2** Hide the "Placeholders" tab when the system is in production/online mode.
- [x] **T1.3** Implement the "Add Placeholder" UI (modal or inline) with a dropdown for templates.

### Phase 2: Template System
- [x] **T2.1** Define a set of standard placeholder templates (e.g., "Color Grid", "SMPTE Bars", "Aspect Ratio Guide", "Countdown").
- [x] **T2.2** Logic to generate placeholder metadata:
    - **Label**: User defined or auto-generated (e.g., `PLC_PGM1_GRID`).
    - **Resolution**: Dropdown selection (1080p, 4K, custom).
    - **Duration**: Default 60s or infinite.

### Phase 3: Simulated Media Integration
- [x] **T3.1** Update `amcp-simulated.js` to recognize placeholder IDs.
- [x] **T3.2** Ensure placeholders appear in the `CLS` (Content List) results in simulation mode so they can be dragged onto timelines.
- [x] **T3.3** Implement basic Canvas rendering for placeholders in the Preview Panel (e.g., drawing the template name and resolution).

## Technical Considerations

- **State Persistence**: Placeholders should be saved into the project's local state (IndexedDB) so they persist across reloads in offline mode.
- **Sync Safety**: Ensure that placeholders are *never* synced to a real CasparCG server as actual media files, but are instead treated as "missing media" or flagged for replacement upon publishing.

---

## Work Log

### 2026-05-01 — Phase 1-3 Completed
**Work Done:**
- Implemented `placeholder-state.js` for client-side management.
- Integrated placeholders into `project-state.js` for persistence.
- Added "Placeholders" tab to `sources-panel.js` (visible in offline mode).
- Created `placeholder-modal.js` for asset creation.
- Intercepted `/api/media` in `api-client.js` to merge placeholders into CLS results.
- Added visual placeholder rendering in `preview-canvas-draw-stacks.js`.

**Instructions for Next Agent:**
- Refine the Canvas rendering with more accurate template-specific visuals (e.g. actual bars/grid).
- Implement local file mapping for placeholders (T4.1 in WO 14).

---
*Work Order created: 2026-04-30 | Parent: 14_WO_OFFLINE_PREPARATION_MODE.md*
