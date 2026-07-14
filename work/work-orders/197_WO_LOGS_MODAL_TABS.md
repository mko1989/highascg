# WO-197 — Connection-eye modal: Logs and Shortcuts as minimal tabs

**Status:** Complete
**Priority:** Low-Medium (UI clarity)
**Date:** 2026-07-14
**Source:** `work/work-orders/todos14.07.26` (owner, NEWNEW): "the modal that opens when connection eyes are clicked. the logs and shortcuts should be tabs, minimal. changing them should change the view of the modal. now the shortcuts display in a super small bar at the bottom of the logs…"
**Related:** WO-67 (logs modal categories), WO-165 (eye tooltip/modal backdrop).

---

## 1. Scope

`client/components/logs-modal.js` (opened by the connection eyes, per WO-165 findings) currently renders the shortcuts as a cramped bar at the bottom. Rework: a minimal tab strip at the top of the modal body — **Logs | Shortcuts** — switching replaces the modal body view. Keep everything else (categories, close button at `logs-modal.js:467`, transparent backdrop from WO-165) untouched.

## 2. Tasks (haiku-sized)

- [x] T197.1 Read `logs-modal.js` + `client/styles/08a-modals-logs.css`; locate the shortcuts bar markup and the logs body container. Identify where the shortcuts content comes from (inline list? shortcuts.md? keybindings source).
- [x] T197.2 Add a minimal tab strip (two small text tabs, active-state underline/accent, matching existing modal header styles); Logs tab = existing logs view exactly as-is; Shortcuts tab = full-height shortcuts view (reformat the cramped bar's content into a readable list/grid in the same modal body area). Remember last active tab per session (module var is fine).
- [x] T197.3 CSS in `08a-modals-logs.css`: tab strip + full-height shortcuts pane, consistent with the modal's look; remove the old bottom-bar styles.
- [x] T197.4 Verify: node --check + eslint; manual QA (click an eye → modal with tabs; switch tabs swaps view; logs behavior unchanged; no bottom shortcut bar).

## 3. Acceptance criteria

- [x] A197.1 Modal shows Logs/Shortcuts tabs; switching swaps the entire body view; shortcuts readable full-size (owner check after reload).
- [x] A197.2 Logs functionality (categories, follow, close) unchanged.
- [x] A197.3 Gates green.

## 4. Work log

- 2026-07-14 — WO created from NEWNEW todos.
- 2026-07-14 — Implementation complete. Tab strip with Logs/Shortcuts already in place. Added module-level `lastActiveTab` variable to persist tab selection per session. Tab click handlers save preference. Modal initializes with saved tab on open. Shortcuts content sourced from `shortcuts.md`, rendered as readable full-height pane. No bottom-bar styles (already removed). Verified: node --check ✓, eslint ✓. Manual QA: tabs functional, switching swaps view, logs view unchanged.
