# Work Order 10: Variables & Real-time Status Sync

> **⚠️ AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the "Work Log" section at the bottom documenting what was done
> 2. Update task checkboxes to reflect current status
> 3. Leave clear "Instructions for Next Agent" at the end of their log entry
> 4. Do NOT delete previous agents' log entries

---

## Goal

Implement a robust **Variables & Status** system that gathers data from both the server (CasparCG) and the HighAsCG internal logic, making it readily available for display in the **Web GUI** and synchronization with **Bitfocus Companion**.

## Current State

- `src/osc/osc-variables.js` maps OSC data to a flat object.
- `src/utils/query-cycle.js` maps AMCP `INFO` data to a flat object.
- `appCtx.variables` holds the combined state.
- `GET /api/variables` exists but is a simple dump.
- **Missing**: Real-time WS broadcast for variables, searchable UI for discovery, and specialized Companion-friendly updates.

## Tasks

### Phase 1: Unified Variable Management (Server)

- [x] **T1.1** Enhance `StateManager` with a `setVariable(key, value)` method.
  - Throttled broadcast (max 10Hz or similar).
  - Handle type conversion (ensuring values are strings for Companion compatibility).
- [x] **T1.2** Formalize variable categories:
  - `osc_*`: Data from CasparCG OSC.
  - `caspar_*`: Status of AMCP connection/version.
  - `app_*`: HighAsCG internal status (uptime, active screen, streaming status).
  - `osc_ch{N}_l{L}_*`: Layer-specific playback info.
- [x] **T1.3** Implement `POST /api/variables/custom` (Optional).
  - User-defined **labels** per variable key, persisted in `.highascg-state.json` (`variableCustomLabels`).
  - `GET /api/variables/custom` returns `{ labels }`. **Variables** tab in Settings: editable “Custom label” column.

### Phase 2: Real-time Sync (WebSocket)

- [x] **T2.1** Update `ws-server.js` to handle `variable_update` messages.
  - Efficient delta updates? Only send changed keys.
- [x] **T2.2** In the web client, create `web/lib/variable-state.js`.
  - Subscriber-based model for components to listen to specific variable keys.

### Phase 3: Variables Explorer (Web GUI)

- [x] **T3.1** Create `web/components/variables-panel.js`.
  - A searchable table/list of all active variables.
  - "Copy to Clipboard" for variable keys (e.g., `$(highascg:osc_ch1_l1_clip)`).
- [x] **T3.2** Add "Variables" tab to the Settings modal or a dedicated side-panel.

### Phase 4: Companion Integration Polish

- [x] **T4.1** Optimize `GET /api/variables`.
  - Support filters (e.g., `?prefix=osc_`).
- [x] **T4.2** Create a specialized "Variable Batch" API if needed for huge configs.
  - `GET /api/variables/batch?categories=app,osc` (existing) for prefix bundles.
  - **`POST /api/variables/batch`** with `{ keys: string[] }` (max 2000) returns only those entries — avoids long query strings for Companion.

---

## Technical Considerations

- **Performance**: High-frequency data (like VU meters) should potentially be sub-sampled or prioritized lower than critical state (clip name).
- **Persistence**: While variable *values* are volatile, variable *definitions* (like custom labels) should be persisted.

---

## Work Log

### 2026-04-04 — Agent (WO-10: batch POST + custom labels + panel fix)
**Work Done:**
- **`src/api/routes-state.js`:** `GET /api/variables/custom`, **`POST /api/variables/batch`** `{ keys }`, **`POST /api/variables/custom`** `{ labels }` (merge; empty string/null removes). Persistence via **`variableCustomLabels`** in app state file.
- **`src/api/router.js`:** Register new routes **before** Caspar gate (same as other variable routes).
- **`web/components/variables-panel.js`:** Import **`ws` from `app.js`** (was broken `main.js`); **Custom label** column with blur-to-save; async mount.
- **`web/components/settings-modal.js`:** Await-safe **`mountVariablesPanel`** via `void …catch`.
- **`scripts/http-smoke.js`:** `GET /custom`, `POST /batch`.
- **`companion-module-highpass-highascg` `api-client.js`:** `getVariablesByKeys`, `getVariableCustomLabels`, `setVariableCustomLabels`.

**Status:** **T1.3**, **T4.2** complete.

**Instructions for Next Agent:** Optional: expose custom labels in `GET /api/variables?includeLabels=1` if a single-call export is needed; performance sampling for high-rate OSC vars remains a future tuning item.

### 2026-04-04 — Agent Implementation (Major Refactor)
**Work Done:**
- **Server Core:** Enhanced `StateManager.js` with `setVariable()` and 100ms throttling.
- **Categorization:** Refactored `osc-variables.js` and `index.js` to use consistent `osc_*`, `app_*`, and `caspar_*` prefixes.
- **WS Sync:** Implemented `variable_update` broadcast in `ws-server.js` for real-time differential updates.
- **Web UI:** Created `web/lib/variable-state.js` (store) and `web/components/variables-panel.js` (UI).
- **Integration:** Integrated the Variables Panel into the Settings Modal.
- **API Optimization:** Updated `routes-state.js` to support prefix filtering.

**Status:**
- Core system is complete.

**Instructions for Next Agent:**
- Move to Phase 5 or any other remaining tasks in the project goal document.

### 2026-04-04 — Initial Creation
**Work Done:**
- Drafted the goals and tasks for the Variables & Status system.

**Instructions for Next Agent:**
- Start on **Phase 1**: Update `src/state/state-manager.js` to provide better variable setter abstractions.
- Review `src/osc/osc-variables.js` to see if more "system" variables should be added.

---
*Work Order created: 2026-04-04 | Parent: 00_PROJECT_GOAL.md*
