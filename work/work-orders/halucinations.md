# Hallucination and Codebase Audit Report

## Summary
A comprehensive scan of the codebase was performed on 2026-04-29. The scan focused on three areas:
1.  **Line Count Violations**: Identifying files exceeding the 500-line maintainability limit.
2.  **Breakdown Discrepancies**: Identifying missing or outdated items in `PROJECT_BREAKDOWN.md` and related work orders.
3.  **Hallucination Check**: Identifying suspicious code, comments, or non-existent dependencies.

---

## 1. Line Count Violations (> 500 lines)

The following files exceed the 500-line limit and should be considered for modularization:

| Lines | File | Category |
|-------|------|----------|
| 793 | `src/config/config-generator-builders.js` | Backend |
| 751 | `web/components/device-view-inspectors.js` | Frontend |
| 578 | `src/engine/pip-overlay.js` | Backend |
| 554 | `web/components/sources-panel-helpers.js` | Frontend |
| 525 | `web/styles/04-media-lists-drag-dashboard.css` | CSS |
| 511 | `web/components/header-bar.js` | Frontend |
| 507 | `web/components/system-settings.js` | Frontend |
| 506 | `templates/led_grid_test.html` | HTML |
| 505 | `src/config/defaults.js` | Backend |

> [!NOTE]
> Several large files previously listed in `PROJECT_BREAKDOWN.md` (e.g., `web/components/device-view.js` at 1357 lines) have been successfully modularized and are now well below the limit.

---

## 2. Project Breakdown Discrepancies

### Missing Features (Not Started)
The following features are listed in `PROJECT_BREAKDOWN.md` but have no implementation in the current codebase:
- **WO-18: Output Slicer**: No files found in `src` or `web`.
- **WO-31: Stage Auto-Follow**: No implementation found.
- **WO-32: CG Overlay Studio**: No implementation found.

### Skeleton/Partial Implementations
- **WO-19: Person Tracking**: Only a skeleton registration exists in `src/tracking/register.js` and a directory in `web/assets/modules/tracking`.

### Outdated Information
- `PROJECT_BREAKDOWN.md` is significantly outdated regarding file sizes and structure. Most of the "Monoliths" listed in the breakdown (Line 452 onwards) have already been split into smaller modules (e.g., `device-view.js`, `scene-state.js`, `routing.js`).
- The breakdown lists `src/config/routing.js` at 677 lines, but it has been modularized.

---

## 3. Hallucination Check

A deep scan for suspicious patterns, nonsensical logic, and non-existent dependencies was performed.

### Suspicious Dependencies
- **`wetransfert`** (with a 't'): Initially suspected as a typo/hallucination, but confirmed as a valid (though niche) unofficial WeTransfer API package on NPM.

### Suspicious Logic/Comments
- No "hallucinated" logic or AI-generated filler text was found in the first-party source code.
- All recent additions (PixelHue protocol handling, Device View graph logic) align with the project requirements and reference documentation.

### Stray/Prototype Files
- **`physics_cable_loops_v3.html`**: Found in the root directory. This appears to be a prototype for the "hanging/gravity" cable rendering mentioned in the UX backlog (`project_status.md`), but it is not integrated into the main application.

---

## Recommendations
1.  **Modularize `src/config/config-generator-builders.js`**: This is currently the largest JS file and handles multiple XML fragment types.
2.  **Split `web/components/device-view-inspectors.js`**: As Device View grows, this file is becoming a new monolith.
3.  **Update `PROJECT_BREAKDOWN.md`**: Refresh the line counts and file lists to reflect the current modular state of the repository.
