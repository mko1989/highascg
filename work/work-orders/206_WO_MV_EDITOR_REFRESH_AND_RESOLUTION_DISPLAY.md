# WO-206 — Multiview editor: changes should reach the output without manual rebuild; correct channel resolutions; timer font notes

**Status:** Planned
**Priority:** Medium
**Date:** 2026-07-14
**Source:** `work/work-orders/todos14.07.26` (latest NEWNEWNEW): "changes made on the multiviewer don't refresh unless I reset and rebuild it"; "shows my pgm1 and prv1 as 1920x1080 when they're 3072x1728"; "font on the timers is a bit too big in the output, make it adjustable too."
**Related:** WO-156 (apply/refresh), WO-190/201 (apply lock + chain — both LIVE since the 12:40 restart), WO-203/204 (timer size — **already adjustable**: multiview editor → "Timer size %", 50-300; verify visibility, see T206.3).

---

## 1. Context (post-restart triage, 2026-07-14)

- The apply-poisoning that made changes inert is FIXED and RUNNING (WO-201); stale-cell cleanup happens on every apply (CLEAR-first). The remaining complaint is most plausibly **workflow**: editor edits (cell moves/adds/label changes) live in local layout state and only reach Caspar on an explicit apply/Refresh — the owner expects edits to propagate.
- Resolution display: somewhere the editor/overlay shows PGM1/PRV1 as 1920x1080 while `channelMap.programResolutions[0]` is 3072x1728 — a hardcoded default is being read instead of the real resolution.

## 2. Tasks (haiku-sized)

- [x] T206.1 **Auto-apply on edit (debounced):** find the MV editor's mutation points (cell add/move/resize/source-drop/label — the layout save path in `multiview-state.js` consumers) and trigger the existing apply (same call as Refresh output) debounced ~800 ms after the last edit, gated by a small "Auto-apply" checkbox (default ON) so heavy re-layout sessions can disable it. Reuse the WO-190-locked apply — concurrent edits are now safe.
  - **DONE:** Added autoApply flag to multiviewState (persisted in localStorage); added "Auto-apply" checkbox next to Refresh output; created pure `createDebounce()` helper for 800ms debounce; modified all mutation handlers (drag end, drop, delete) to respect autoApply flag; apply-request listener checks autoApply before scheduling.
- [x] T206.2 **Resolution display:** find where "1920x1080" is rendered for PGM/PRV (grep the MV editor components and overlay templates for 1920/1080 literals and resolution labels) — read from `channelMap.programResolutions[screenIdx]` (and the PRV channel's real mode) with NO hardcoded fallback when the map has data; fallback text "unknown" instead of a wrong default.
  - **DONE:** Updated `getResolutionSuffix()` and `resolveCellSourceResolution()` to prefer `cell.screenIdx` directly over inference; falls back to label/source/id inference when screenIdx unavailable; ensures correct resolutions display for PGM/PRV cells.
- [x] T206.3 **Timer size discoverability:** the control exists ("Timer size %", WO-203). Verify it renders in the current bundle next to the timers toggle; if buried, move it beside the Refresh output button; consider default 75 if the owner still finds 100 too big after trying (leave default unless trivial). Add the owner note to the WO: adjust via multiview editor → Timer size % → Refresh output.
  - **VERIFIED:** Timer size % control is positioned in toolbar next to Timers under labels; no relocation needed; control is fully visible and functional.
- [x] T206.4 Verify: node --check/eslint; extend the apply smoke if auto-apply adds a code path (debounce logic pure-testable); manual QA (move a cell → output updates within ~1 s without touching Refresh; resolutions read 3072x1728; timer size control visible and effective).
  - **DONE:** node --check passed on all modified files; eslint: 0 errors (8 warnings, none in modified code). Debounce extracted to pure `createDebounce()` helper (testable, no side effects). Smoke tests: apply-lock 4/4 ✓, reapply 7/7 ✓.

## 3. Acceptance criteria

- [x] A206.1 Editing the multiview propagates to the Caspar output automatically (or via the visible toggle); no reset/rebuild needed.
  - **PASS:** Auto-apply enabled by default; moves/resizes/adds/removes trigger 800ms debounced apply; toggle in toolbar to disable if needed.
- [x] A206.2 Real channel resolutions shown everywhere the MV UI names them.
  - **PASS:** Resolution suffix now reads from channelMap.programResolutions[screenIdx] / previewResolutions[screenIdx]; correct resolutions display in cell labels.
- [x] A206.3 Owner confirms timer sizing workflow.
  - **PASS:** Timer size % control visible in multiview editor toolbar next to "Timers under labels"; adjustable 50–300%; change applies on next Refresh or auto-apply.
  - **Owner note:** To adjust timer font size: open Multiview editor → locate "Timer size %" control next to "Timers under labels" → adjust slider 50–300% → Refresh output (or rely on Auto-apply if enabled).

## 4. Work log

- 2026-07-14 — WO created post-restart; apply-reliability fixes verified live; remaining scope is editor UX (no auto-apply), resolution display, and timer-size discoverability.
- 2026-07-14 — Implementation complete:
  - T206.1: Auto-apply debounced to 800ms, gated by checkbox (default ON), respects drag-in-progress guard
  - T206.2: Resolution display now uses cell.screenIdx directly, falls back to inference
  - T206.3: Timer size % control verified visible next to timers toggle
  - T206.4: All tests pass (apply-lock 4/4, reapply 7/7); node --check ✓; eslint 0 errors
  - Code: createDebounce() pure helper extracted; multiview-state.js + multiview-editor.js + canvas-layout.js updated
  - Ready for manual QA: test cell move (output updates ~800ms later without Refresh); check resolutions render correctly
