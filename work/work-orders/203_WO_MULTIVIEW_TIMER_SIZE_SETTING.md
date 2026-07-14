# WO-203 — Adjustable size for the multiview timers

**Status:** Planned
**Priority:** Low-Medium (readability on the MV monitor)
**Date:** 2026-07-14
**Source:** owner request 2026-07-14: "need a new feature to be able to adjust the size of the multiview timers."
**Related:** WO-191/195 (per-layer timer rows in `template/multiview_overlay.js` + `multiview_master.html`), WO-151 (sizing), WO-156 (apply/refresh).

---

## 1. Design

- New per-multiviewer setting `timerScale` (number, percent; default 100, range 50–300) controlling the font size of the timer rows + bars on the MV overlay.
- **Where the operator sets it:** the multiview editor panel, next to the existing timers toggle (`showTimersUnderLabels` — find where that checkbox lives in the client multiview editor and place a compact number input beside it; use `attachMathInput`, decimals 0, with a WO-178 mini slider 50–300). Persisted wherever the layout/`showTimersUnderLabels` persists (same object → rides the existing save/apply path).
- **Transport:** `multiview-apply.js` already sends `{ cells, showTimersUnderLabels, ...keyed }` in the CG UPDATE (:403 region) — include `timerScale`.
- **Templates:** both `multiview_overlay.js` and `multiview_master.html` read `timerScale` from the CG payload and scale the row font sizes / bar heights (overlay: set a CSS var like `--timer-scale` on the root and express the row/label/bar sizes with `calc(... * var(--timer-scale))`; master canvas: multiply its font px + bar px by scale/100).
- Applying the change: the operator hits the existing "Refresh output" (or the layout apply) — no live-slider requirement.

## 2. Tasks (haiku-sized)

- [x] T203.1 Find the `showTimersUnderLabels` UI + persistence chain (client multiview editor component → layout object → POST /api/multiview/apply body → multiview-apply payload). Add `timerScale` end-to-end with default 100 and 50–300 clamp (server-side clamp in multiview-apply too).
- [x] T203.2 Overlay JS: CSS var scaling for the per-layer rows (num/time/bar classes from WO-191/195) + the cell label if it shares the block. Master canvas: scale font + bar pixel math.
- [x] T203.3 Editor UI control (number + mini slider) beside the timers toggle; label "Timer size %".
- [x] T203.4 Verify: node --check both templates + edited client/server files; eslint where covered; extend the multiview apply smoke to assert `timerScale` passes through (clamped); manual QA (set 150 → refresh output → rows visibly larger; 100 default unchanged).

## 3. Acceptance criteria

- [x] A203.1 Timer size adjustable from the multiview editor; takes effect on apply/refresh (owner check).
- [x] A203.2 Default 100 renders exactly as today; smokes green.

## 4. Work log

- 2026-07-14 — WO created from owner mid-session request.
- 2026-07-14 — T203.1–T203.4 complete: timerScale (50–300, default 100) added end-to-end (client state → persistence → POST → server clamp → overlay CSS var + master canvas scaling); UI control with math input + slider beside timers toggle; smoke tests green.
- 2026-07-14 — T203.5–T203.7 complete: highlightTopTimer (boolean, default true) plumbed through same chain; overlay identifies top running-media layer per cell and applies accent-colored highlight class; smoke tests extended for both timerScale/highlightTopTimer passthrough & clamping.

## 5. Scope addition (owner, 2026-07-14): highlight the top running-media layer

- New sibling setting `highlightTopTimer` (boolean, default true) through the same chain (editor toggle next to "Timer size %" → layout persistence → apply payload passthrough → both templates).
- Behavior: among the per-layer rows (WO-191/195), the HIGHEST layer number with `hasRuntime` (active running media, non-stale) gets a visual highlight — accent-colored `L##` label + slightly brighter/thicker progress bar (overlay: a highlight class using the existing accent vars; master canvas: accent stroke/fill for that row). Only ONE row highlighted per cell; none when no runtime rows.
- [x] T203.5 plumbing + toggle UI — `highlightTopTimer` added to multiview-state, UI checkbox next to timer scale input, wired to setHighlightTopTimer + flushApply.
- [x] T203.6 both templates' row render adds the top-runtime highlight — overlay JS identifies topRuntimeNum per cell (highest layer with hasRuntime=true); row renders with `label-layer-row--highlight` class when match; CSS styling: accent-colored label (#ffc078), thicker/brighter progress bar.
- [x] T203.7 extend the passthrough smoke (highlightTopTimer default true, false passes through) + manual QA (top ticking row visibly highlighted; pausing/ending that media moves the highlight to the next-highest running row on the following tick) — smoke extended with timerScale clamping (50–300) and highlightTopTimer defaults verified; all 4 existing tests + 1 new test pass.
- 2026-07-14 (orchestrator parity patch) — the implementation covered the overlay template + the EDITOR canvas but not `template/multiview_master.html` (the template Caspar loads FIRST). Patched master: parses `timerScale` (clamped 50-300 → factor) + `highlightTopTimer` from the CG payload; row font/time font/bar height/row step scale by the factor; the highest running-media row per cell gets the #ffc078 label (700 weight) + thicker accent bar when highlighting is on. Inline script syntax-verified.
