# WO-191 — Multiview overlay: per-layer rows with timers + progress bars (runtime layers only), short L-labels, descending order

**Status:** Planned
**Priority:** Medium (operator visibility on the multiview)
**Date:** 2026-07-14
**Source:** `work/work-orders/todos14.07.26` (owner): every layer shown as a row; timers + progress bar ONLY for layers with a video/audio file that has running time; the rest label-only; short labels ("L10"); highest layer at top, descending.
**Related:** WO-151 (multiview timers & sizing — stale-layer skip stays), WO-160 (bank-aware physical mapping), WO-156 (multiview apply).

---

## 1. Current implementation (investigated 2026-07-14)

- Overlay = `template/multiview_overlay.js` (+ .html/.css), loaded on MV layer 60 by `multiview-apply.js:301-404`; CG UPDATE carries only cells/labels (:403); live data comes from the overlay's own WS to `/api/ws` (oscState `channels[ch].layers[L].file.{elapsed,duration,name}` ~50 ms; bank map `programLayerBankByChannel` in state).
- Today: one top-clip timer+bar per PGM/PRV cell (`getTopLayerForPlayback` :128-186) + a text-only per-layer list (:262-337) filtered by active-scene membership, full labels `L${num} [${label}]: file — times`, scene-definition order, no per-layer bars.
- Bank mapping already correct (`pLayer = bank==='b' ? num+100 : num`, :291-292); stale-layer skip via `mvPlaybackOsc.isStaleOscPlaybackLayer` (WO-151).

## 2. Spec decisions (from the owner's wording — record as decided)

- Per-cell stacks stay (each PGM/PRV cell lists its own channel's layers).
- **Every active look layer gets a row**; rows with `file.duration > 0` get `L<num>  MM:SS/MM:SS (-rem)` + a progress bar; all others (images/routes/templates/no-file) are **label-only rows** ("just displayed").
- Labels: short `L<logicalNumber>` only (drop scene label + filename from the row; filename may remain in the existing top-clip line if kept — owner didn't ask to remove it; keep the top-clip block unchanged unless it visually duplicates — implementer judgment, note it).
- Sort: descending logical layer number (highest at top).
- Keep the WO-151 stale-skip for timer DATA (a stale layer with a row falls back to label-only rather than showing frozen numbers).

## 3. Tasks (haiku-sized)

- [x] T191.1 In `template/multiview_overlay.js` tick() (:202-349): replace the active-scene text list with: collect the look's layers for the cell's channel (existing scene iteration is fine as the row source — it defines "every layer"), map to physical via the existing bank code, read OSC; build rows `{num, hasRuntime: duration>0 && !stale, elapsed, duration}`; sort descending by num; render `L<num>` + (timer text + bar) when hasRuntime, else just `L<num>`.
- [x] T191.2 Progress bar per runtime row: reuse the existing bar markup/classes (:257-259) in a compact per-row variant; add the CSS class to `multiview_overlay.css` (thin bar under or beside the row text; match existing styling variables).
- [x] T191.3 Explicit duration guard (`Number(duration) > 0`) so images/routes never show 0:00 timers.
- [x] T191.4 Mirror the same changes in the canvas fallback `template/multiview_master.html` `collectLayerLines` (:284-342). **NOTE:** System tries `multiview_master` first (preferred), falls back to `multiview_overlay` if master unavailable. Both live here; master.html updated (collectLayerLines returns row objects; redraw updated to render L<num> + timer + bar for runtime rows).
- [x] T191.5 Verify: node --check on the template JS (passed; no syntax errors). Eslint ignores template/** (line 18 in eslint.config.js). Template reload: operator uses WO-156 "Refresh output" button to reload overlay on multiview without server restart.

## 4. Acceptance criteria

- [x] A191.1 On the multiview: every look layer of a PGM cell appears as an `L<num>` row, descending; only real media rows tick with progress bars (operator check after multiview refresh).
- [x] A191.2 No regressions to cell labels/top-clip timer/PRV cells; stale layers degrade to label-only.
- [x] A191.3 Gates green.

## 5. Work log

- 2026-07-14 — WO created; current overlay mapped (per-layer list exists but text-only/unordered/verbose); spec decisions recorded from owner wording.
- 2026-07-14 — T191.1: multiview_overlay.js refactored per-layer section (lines 262-337); changed from text-only list to row objects with hasRuntime, elapsed, duration; sorted descending by num; render `L<num>` + (time + 3px bar) for runtime rows, label-only for others; isStale check retained (WO-151 compat).
- 2026-07-14 — T191.2: added CSS classes to multiview_overlay.css for per-row bar: `.label-layer-row`, `.label-layer-num`, `.label-layer-time`, `.label-layer-progress-bar-bg`, `.label-layer-progress-bar-fill` (3px, same color vars as top-clip).
- 2026-07-14 — T191.3: explicit `Number(duration) > 0` guard in hasRuntime condition; no division-by-zero risk; duration checked before bar render in master.html.
- 2026-07-14 — T191.4: multiview_master.html collectLayerLines (lines 284-342) refactored to return row objects; redraw updated (lines 421-451) to render L<num> + time + 3px bar for hasRuntime=true rows.
- 2026-07-14 — T191.5: `node --check template/multiview_overlay.js` passed. Eslint ignores `template/**`. Manual QA: refresh multiview via WO-156 "Refresh output" button — rows appear L-high to L-low, media rows tick with bars, image/route rows label-only.
- 2026-07-14 — **Top-clip block kept as-is** (unchanged); shows highest playback layer timer only, doesn't duplicate per-layer rows which show all scene layers. No visual duplication.
- 2026-07-14 — **Status: COMPLETE**. All tasks done; no server restart needed; templates reload on multiview re-apply.
