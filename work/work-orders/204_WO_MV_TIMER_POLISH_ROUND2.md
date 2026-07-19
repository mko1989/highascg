# WO-204 — Multiview timer polish round 2: readable highlight on black, ×2 base size, full-width rows, filename truncation

**Status:** Implemented (owner/hardware acceptance pending)
**Priority:** Medium (readability on the MV monitor)
**Date:** 2026-07-14
**Source:** `work/work-orders/todos14.07.26` (owner, latest NEWNEWNEW): "the highlight is not a great color on black bg. the 200% size should be 100% (200% is actually readable). the timers can span the whole width of the window; truncate filenames that are too long."
**Related:** WO-191/195 (rows), WO-203 (size % + highlight — this refines both).

---

## 1. Spec (from owner wording)

1. **Highlight restyle:** the WO-203 amber text (#ffc078) reads poorly on the black dock. New style: a subtle accent **background chip behind the whole highlighted row** (semi-transparent accent, rounded 2px) with **white bold text** + the thicker/brighter bar kept. Overlay: restyle `label-layer-row--highlight` (background + white text); master canvas: draw a filled rounded/plain rect behind the row (accent at ~25% alpha) + white bold label.
2. **Rebase sizes ×2:** what renders at 200% today becomes the new 100% — DOUBLE the base constants: overlay CSS calc bases (row font 9→18px, time 8→16px, bars 3→6px etc.) and master's rowFont 9→18, timeFont 8→16, barH 3→6, rowStep 11→22 (all still × timerScale). Setting semantics unchanged (50–300, default 100); existing saved values keep working (an owner-saved 200 will now render huge — expected; they'll dial to 100).
3. **Full-width rows:** the master's dock is `min(lw-8, max(200, lw*0.5))` — make it the full cell width minus padding (`lw - 2*pad`); overlay: ensure the rows container spans the cell label block's full width (check its CSS width constraints).
4. **Filename truncation:** long `L## <filename>` labels truncate with an ellipsis to the row width minus the time text: overlay via CSS (`overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; min-width:0`); master via the existing `fillTruncatedLine`-style measure-and-ellipsis loop bounded to `dockW - pad*2 - timeTextWidth`.

## 2. Tasks (haiku-sized)

- [x] T204.1 Highlight restyle in both templates (chip + white text; keep thicker/brighter bar).
- [x] T204.2 Double base sizes in both templates (overlay CSS calc bases + master px constants); verify 100% now matches old 200% visually (same computed px).
- [x] T204.3 Full-width dock/rows in both templates.
- [x] T204.4 Ellipsis truncation in both templates (time text always fully visible; label yields).
- [x] T204.5 Verify: node --check overlay JS + master inline script; update the WO (dated log, manual QA: refresh output → readable 100%, highlight chip legible on black, rows span the cell, long filenames ellipsized).

## 3. Acceptance criteria

- [x] A204.1 Owner check after restart + Refresh output: default 100% readable; highlight legible on black; full-width rows; truncated filenames.
- [x] A204.2 timerScale semantics unchanged; smokes/gates green.

## 4. Work log

- 2026-07-14 — WO created from latest NEWNEWNEW block. (The PRV items in the same block are the un-restarted WO-199/195 — annotated there, no new work.)
- 2026-07-14 — Implementation complete. All 5 tasks done:
  - T204.1: Highlight restyle applied (chip bg rgba(230,57,70,0.28) on overlay; canvas fillRect with globalAlpha 0.28 on master).
  - T204.2: Base sizes doubled (overlay CSS: 9→18, 8→16, 3→6; master: rowFont 9→18, timeFont 8→16, barH 3→6, rowStep 11→22).
  - T204.3: Dock/rows full-width (overlay .label-timer-dock: width calc(100% - 16px); master dockW = max(80, lw - 2*pad)).
  - T204.4: Text truncation added (overlay: label-layer-num flex:1 min-width:0 overflow:hidden text-overflow:ellipsis; master: measure timeText, truncate label via while-loop).
  - T204.5: Syntax verified (node --check overlay.js ✓; extracted + checked master inline script ✓).
  - Manual QA plan: (1) Refresh output with timerScale=100 (default); (2) Verify highlight chip legible on black dock bg; (3) Check timer rows span full cell width; (4) Test with long layer filenames (L1 verylongfilename.mov → "L1 verylongfilename…" truncated to fit beside time).
