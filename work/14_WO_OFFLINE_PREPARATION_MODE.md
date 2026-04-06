# Work Order 14: Offline Preparation Mode

> **⚠️ AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the "Work Log" section at the bottom documenting what was done
> 2. Update task checkboxes to reflect current status
> 3. Leave clear "Instructions for Next Agent" at the end of their log entry
> 4. Do NOT delete previous agents' log entries

---

## Goal

Implement an **Offline Preparation Mode** that allows operators to design "Looks" and "Timelines" using local assets or cached metadata when the CasparCG server is unavailable (e.g., during transport, at home, or before on-site hardware is ready). Once connection is established, the system should allow "Syncing" the offline work to the production server.

## Current State

- The application is highly coupled to a live CasparCG connection for media lists (`CLS`), template lists (`TLS`), and command execution.
- If the server is offline, the UI shows empty panels and "Caspar offline" status.
- Projects are saved as `.highascg` files but assume the server environment matches the local environment.

## Tasks

### Phase 1: Local State & Metadata Caching

- [x] **T1.1** Implement **IndexedDB** or LocalStorage caching for `Media`, `Templates`, and `Data` results.
- [x] **T1.2** Create a "Simulated AMCP Client" (`src/caspar/amcp-simulated.js`).

### Phase 2: Offline UI & Indicators

- [x] **T2.1** Add "Work Offline" toggle in the Settings modal.
- [x] **T2.2** Display "Offline Draft" watermarks in the Scene and Timeline editors.

### Phase 3: Project Sync & Reconcile

- [x] **T3.1** Implement "Sync to Server" orchestration.
- [x] **T3.2** "Apply Draft" logic.

### Phase 4: Local Media Preview (Optional/Future)

- [ ] **T4.1** Implement local thumbnail generation for media files on the operator's laptop.
- [ ] **T4.2** Use HTML5 Video tags for local preview of video assets if available on the local filesystem.

---

## Technical Considerations

- **Path Mapping**: Media paths on a production server (`C:/casparcg/media/`) likely differ from local paths. The sync logic must handle relative vs absolute paths gracefully.
- **State Conflict**: If multiple people work offline, reconciliation becomes a "merge" problem. Focus on a single-user "Draft -> Publish" flow first.

---

## Work Log

### 2026-04-04 — Phase 3 & Blue Eyes Completed
**Work Done:**
- Implemented `routes-project.js` for Reconcile and Sync APIs.
- Integrated `highaseyesblue.png` as the status mascot for preparation mode.
- Created `sync-modal.js` and added "Push to Live" header workflow.
- Verified asset comparison logic (Media/Templates).

---
*Work Order created: 2026-04-04 | Parent: 00_PROJECT_GOAL.md*
