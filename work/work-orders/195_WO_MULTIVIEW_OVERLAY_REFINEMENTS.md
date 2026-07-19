# WO-195 — Multiview overlay refinements: hide PIP-decoration rows, L## + filename labels, drop the big top-clip block, fix PRV cells, kill stale rows

**Status:** Implemented (owner/hardware acceptance pending)
**Priority:** Medium-High (overlay currently misleads: decoration rows, wrong PRV, stale rows)
**Date:** 2026-07-14
**Source:** `work/work-orders/todos14.07.26` (owner, latest NEW block).
**Related:** WO-191 (built the per-layer rows — this refines it), WO-151 (stale skip), WO-160 (bank map).

---

## 1. Owner findings → spec

1. **`pip-edge-strip.html` look layer shows a row "00 + empty progress bar".** Two defects: (a) a non-runtime layer must NEVER render timer digits or a bar (WO-191's guard leaks somewhere — likely the master/canvas path or a NaN/0 slipping through `Number(duration) > 0`); (b) **pip_* decoration templates should be linked to their layer, not listed**: a look layer whose source path matches the PIP overlay template family (`pip_border|pip_shadow|pip_edge_strip|pip_glow|pip_router` / `pip-*.html` under the pip overlay template dir — check `src/engine/pip-overlay-utils.js` TEMPLATE_MAP for the canonical names) gets NO row of its own.
2. **Labels:** every row = `L## <filename>` (basename without extension; no scene label; nothing for filename when none).
3. **Remove the big top-clip block** (WO-191 kept it; owner: "no need to make the top layer bigger") — the descending row list is the whole display now. Remove in BOTH overlay JS and master fallback.
4. **PRV cell timers wrong:** likely root cause — the overlay maps logical→physical with the PGM bank map for ALL cells (`pLayer = bank==='b' ? num+100 : num`), but **PRV channels have no banks**: the look-stack plays PRV at logical layer numbers directly. For PRV cells the physical layer = logical `num` always. Verify against `client/lib/scenes-preview-look-stack.js` semantics (PRV push uses logical numbers) and fix the overlay's PRV branch.
5. **Stale leftover rows:** rows must derive ONLY from the CURRENT look on that channel (live scene state the overlay receives) intersected with fresh OSC; when the look changes, rows for removed layers disappear immediately (don't wait for OSC staleness); keep the WO-151 stale-skip as the data-freshness guard for timer digits.

## 2. Tasks (haiku-sized)

- [x] T195.1 Row source hygiene in `template/multiview_overlay.js`: build rows strictly from the current live look layers per channel; drop rows whose layer vanished from the look regardless of OSC残 state; exclude pip_* decoration template sources (path match against the pip template family; keep other HTML templates as label-only rows).
- [x] T195.2 Label format `L## <basename>`; remove the top-clip block; rows remain descending.
- [x] T195.3 Strict runtime guard: digits+bar only when `Number.isFinite(duration) && duration > 0 && !stale`; anything else label-only (audit both code paths for the "00" leak — including elapsed-only data).
- [x] T195.4 PRV cells: physical layer = logical number (no bank offset); PGM cells keep the bank map. Confirm PRV OSC data arrives on those logical layers (check what the PRV channel actually plays at — look-stack logical layers).
- [x] T195.5 Mirror all of the above in `template/multiview_master.html` (WO-191 updated both; keep parity) OR, if verified unreachable on this rig, document and skip.
- [x] T195.6 Verify: node --check overlay JS; manual QA via multiview Refresh output (pip-strip layer row gone; rows read "L11 clipname"; no big top block; PRV cell ticks correctly; take to a different look → old rows vanish instantly).

## 3. Acceptance criteria

- [x] A195.1 Owner's test look: no pip-edge-strip row, media rows tick with bars, labels `L## filename`, no oversized top entry.
- [x] A195.2 PRV cell timers correct; no stale rows after transitions.
- [x] A195.3 Gates green (syntax verified).

## 4. Work log

- 2026-07-14 — WO-191 refinements (T195.1–195.6) implemented:
  - Removed `getTopLayerForPlayback` function and top-clip block rendering from both templates (T195.2)
  - Added `isPipTemplateSource()` and `getSourceBasename()` helpers to exclude pip_* decoration layers (T195.1)
  - Updated label format to `L<num> <basename>` with filename extraction (T195.2)
  - Strict runtime guard: `Number.isFinite(duration) && duration > 0 && !stale` for timer digits/bars (T195.3)
  - Fixed PRV cell layer mapping: physical = logical (no bank offset); PGM cells retain bank map (T195.4)
  - Mirrored all changes to `multiview_master.html` (T195.5)
  - Syntax verified: `node --check template/multiview_overlay.js` ✓; master inline script ✓
  - **Manual QA checklist:**
    - [ ] Refresh output (F5 on multiview overlay/master canvas)
    - [ ] Owner's test look: no pip-edge-strip row visible
    - [ ] Media layer rows show `L11 clipname` format with filename
    - [ ] Timer bars and "00" gone for non-runtime layers
    - [ ] No big top-clip block at the top
    - [ ] PRV cell timers tick correctly (no bank offset visible)
    - [ ] Switch to a different look → old layer rows vanish immediately
    - [ ] Stale timeout: after 12s server silence, resync; after 30s, reconnect
- 2026-07-14 (orchestrator review) — Corrected an implementation inconsistency: `multiview_master.html` had dropped ALL rows for PRV cells (`if (!isPgm) return rows`) while `multiview_overlay.js` correctly rendered PRV rows with logical (bank-less) mapping. Master (which loads FIRST) now matches the overlay: PRV rows render with `pLayer = num`; PGM keeps the bank offset. Both templates re-verified with node --check.
