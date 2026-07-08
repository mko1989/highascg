# WO-151 — Multiview timers + window sizing bugs (owner todos 2026-07-07)

**Status:** Planned
**Priority:** Medium-high
**Date:** 2026-07-07
**Source:** `work/todos07.07.26` (owner)

---

## 1. Bugs (owner-reported)

- [ ] B151.1 **Multiview window: wrong size calculations after applying timers.** Applying timers to the multiview perturbs the MV window/cell geometry. Locate the MV layout math (search: multiview config in `src/config/build-caspar-generator-*`, MV cell layout, timer overlay injection) and find why timer application changes size inputs (likely the timer overlay counts as a cell or resets a cached layout with different dims).
- [ ] B151.2 **Timers on MV don't work correctly** (owner: "timers on mv doesnt work correctly" — behavior unspecified). FIRST: reproduce and record what "incorrectly" means (wrong time? not ticking? wrong cell? drift?) — ask the owner or capture from the box, write the observed vs expected in this WO, then fix.

## 2. Acceptance criteria

- [ ] A151.1 Applying/removing timers leaves MV window + cell geometry identical (before/after screenshots or geometry dump in work log).
- [ ] A151.2 Timers show correct, ticking values in the right cells (owner confirms on hardware).
- [ ] A151.3 Gates green after fixes.

## 3. Work log

- 2026-07-07 — WO created from `work/todos07.07.26`. B151.2 needs a symptom description before work starts.

#### 2026-07-08 — B151.2 symptom (owner)

MV timers show a **stale/stopped state instead of what's actually on screen**. The MV timers are
rendered by the **multiviewer overlay template** (CasparCG CEF template) — so the suspect chain is:
the data feed into the overlay template (CG UPDATE cadence / payload) going stale, the template not
re-rendering on update, or the overlay layer not being refreshed when timer state changes.
Investigate: what pushes timer state to the template (grep CG ADD/UPDATE for the multiview overlay
in src/), whether updates keep flowing after the timer starts, and whether the template's internal
clock free-runs vs being re-synced.
