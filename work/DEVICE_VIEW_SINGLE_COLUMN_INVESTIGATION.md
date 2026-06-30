# Device View single-column layout — investigation log

**Date:** 2026-06-29  
**Work order context:** [82_WO_DEVICE_VIEW_SIMPLE_WIRING_MODE.md](./work-orders/82_WO_DEVICE_VIEW_SIMPLE_WIRING_MODE.md)  
**Status:** **Unresolved** — operator still sees all rear ports in a single column; programmed GPU/DeckLink/Stream column order is ignored.

---

## Reported symptom

With **Simple wiring OFF** (classic wire / backplane view), the Device View still renders **all connectors in one vertical column**, ignoring the existing 3-column rear-panel layout (GPU | DeckLink | Stream/Record/Audio) and any saved port order.

Simple wiring mode itself may look acceptable; the regression is that **adding WO-82 simple view work visually broke the standard wire-based Device View**, and fixes attempted so far have not restored it on the operator machine.

---

## GitHub reference snapshot (known-good baseline)

The last **committed** version on GitHub `main` predates local WO-82 work and should represent the working standard wire view.

| | |
|--|--|
| **Path** | [`work/device-view-github-reference/`](./device-view-github-reference/) |
| **Commit** | `250f344` — `feat: hot backup robustness, stick produce pipeline, and operator UI expansions` |
| **Remote** | `https://github.com/mko1989/highascg.git` branch `main` |

See [`work/device-view-github-reference/README.md`](./device-view-github-reference/README.md) for file list and refresh instructions.

### Local-only files (not on GitHub)

Uncommitted WO-82 additions in the working tree:

| File | Purpose |
|------|---------|
| `client/components/device-view-caspar-render-simple.js` | Simple-mode rear panel (vertical node stack) |
| `client/components/device-view-caspar-rear-data.js` | Shared rear-panel data extracted from classic render |
| `client/lib/device-view-simple-wiring-prefs.js` | `localStorage` key `highascg_device_view_simple_wiring` |
| `client/lib/device-view-refresh.js` | Phase D partial-refresh helpers (mostly reverted in JS paths) |

### Modified vs GitHub (17 files, ~800 insertions)

Key paths diverging from `origin/main`:

- `client/components/device-view.js` — simple wiring toggle, `renderFromState`, `applyLayoutGrid`, tab re-entry hook
- `client/components/device-view-bands-render.js` — branch to `renderCasparBandSimple` vs `renderCasparBand`
- `client/components/device-view-caspar-render.js` — refactor to `buildCasparRearPanelData`, inline grid on slots
- `client/components/device-view-cables.js` — orthogonal cable lanes for simple mode
- `client/styles/09a1-device-view-layout-toolbar.css` — min-width, `!important` grid, container queries
- `client/styles/09b2-device-view-backpanel-hardware.css` — WO-82 simple node CSS + backpanel grid changes
- `client/styles/09b3-device-view-inspector-sidebar.css` — media-query edits
- `client/styles/09a3-device-view-segments-mapping.css` — removed `.device-view__panel-row`
- `client/styles/01b-layout-panels-workspace.css`, `02a-workspace-tabs-scenes-preview-host.css` — workspace min-width
- `client/app.js` — `onDeviceViewTabActivated` on Devices tab

---

## What the GitHub version does (wire view)

From `work/device-view-github-reference/`:

### Main layout (3 workspace columns)

`09a1-device-view-layout-toolbar.css`:

```css
.device-view__layout {
  display: grid;
  grid-template-columns: 240px 180px 1fr 340px;
}
.device-view--external-inspector .device-view__layout {
  grid-template-columns: 240px 180px 1fr;
}
```

**Caveat on GitHub too:** `09b3-device-view-inspector-sidebar.css` has:

```css
@media (max-width: 768px) {
  .device-view__layout { grid-template-columns: 1fr !important; }
}
```

That collapses the **whole** Device View to one column when the **browser viewport** is ≤768px (not when the center pane is narrow). This was already on `main` before WO-82; it may contribute on small windows but is not the full story for “ports in single column.”

### Rear panel (3 hardware columns)

`device-view-caspar-render.js` builds:

1. `.device-view__backpanel-slots` with **three** `.device-view__backpanel-column` children
2. Slots assigned by index: `sIdx 0,3 → col1`, `1,4 → col2`, else `col3` (GPU/Record, DeckLink/Audio, Stream)

`09b2-device-view-backpanel-hardware.css`:

```css
.device-view__backpanel-slots {
  display: grid;
  grid-template-columns: max-content max-content max-content;
  width: 100%;
}
```

Markers are appended into per-slot `.device-view__backpanel-slot-connectors` containers (flex column **within** each slot), not into a single global stack.

### Bands render (GitHub)

`device-view-bands-render.js` always calls `renderCasparBand(internalCtx)` — **no** simple-mode branch.

---

## What WO-82 changed (likely regression surface)

1. **New render path** — `renderCasparBandSimple` replaces classic backplane when `simpleWiring` is true; uses `.device-view__simple-nodes-stack` (explicit single column by design).
2. **Refactor** — rear-panel data moved to `device-view-caspar-rear-data.js`; classic render shortened.
3. **CSS growth** — ~150 lines of simple-wiring styles in `09b2`; risk of global selectors affecting wire view if classes leak or specificity is wrong.
4. **Layout hardening attempts** — multiple rounds of min-width, `!important`, inline `grid-template-columns` on `.device-view__layout` and `.device-view__backpanel-slots`, workspace `min-width: 480px`, removal of 768px/420px stack rules, `.device-view--simple-wiring` scoping.
5. **Partial refresh** — Phase D helpers added then mostly reverted; full `load()` restored on mutations per operator request.
6. **Cable overlay** — `buildOrthoLaneMap` / `buildOrthogonalCable` when simple mode on; `useOrtho = simpleWiring === true` (strict boolean).

---

## Investigation attempts (chronological)

### Session 1 — WO-82 broke Device View entirely

- Identified Phase D `reloadAfterEdit` passing live-only reload into `renderBands`
- Tab pane `#tab-device-view` could shrink to 0 width (`flex: 1 1 0` without `width: 100%`)
- Cable overlay measured from 0-width container on tab re-entry

### Session 2 — “Still single column” + restore wire view

- Blamed `@media (max-width: 768px)` forcing `grid-template-columns: 1fr !important` on `.device-view__layout`
- Moved collapse threshold to 420px, then removed single-column media query entirely
- Reverted mutation paths to full `load()` (device-view + settings + streaming)
- Added `min-width` + horizontal scroll on layout; locked backpanel to 3 columns in CSS
- Improved simple-mode cable lane spacing (`buildOrthoLaneMap`, 32px gap)

**Operator result:** still single column after hard refresh/restart.

### Session 3 — “Loop lock” / simple view spilling into wire view

Hypothesis: simple-mode single-column CSS or state locks layout and affects wire view after toggle.

Actions taken:

- Scoped simple-wiring CSS under `.device-view--simple-wiring` on root wrap
- `applyLayoutGrid()` — inline `grid-template-columns` on `.device-view__layout` every render
- Wire backpanel: `repeat(3, minmax(72px, 1fr))` in CSS + inline on `slotsEl` in `renderCasparBand`
- Removed dead `.device-view__panel-row { grid-template-columns: 1fr }` and 768px override for it
- `syncSimpleWiringMode()` toggles wrap class; `renderCasparBand` strips `device-view__band--caspar-simple`

**Agent browser verification (localhost:4200, after build):**

- With Simple wiring OFF: `layout` computed `240px 180px 320px`; three `backpanel-column` children at distinct `left` positions; `hasBackpanel: true`
- Toggle simple on/off: wrap gains/loses `device-view--simple-wiring`; backpanel returns with 3 slot columns

**Operator result:** still reports single column and lost port order — **fix not confirmed on production rig**.

---

## Open questions / next steps (no code in this doc)

1. **Confirm served bundle** — Browser Network tab: do `index-*.css` / `device-view-*.js` hashes match latest `dist-web/index.html` after `npm run build:client`? Server reads `dist-web/` from disk (no-cache headers on HTML).
2. **Confirm which “single column”** — Main layout (Destinations \| Mappings \| Rear) vs rear-panel slots (GPU \| DeckLink \| Stream) vs connectors stacked inside one slot?
3. **Runtime diagnostics on operator machine** (DevTools console):
   ```js
   const l = document.querySelector('.device-view__layout');
   const s = document.querySelector('.device-view__backpanel-slots');
   ({
     simple: document.querySelector('.device-view__simple-wiring-toggle input')?.checked,
     layoutGrid: l && getComputedStyle(l).gridTemplateColumns,
     layoutW: l?.getBoundingClientRect().width,
     slotsGrid: s && getComputedStyle(s).gridTemplateColumns,
     slotChildren: s ? [...s.children].map(c => c.className) : null,
     hasBackpanel: !!document.querySelector('.device-view__backpanel--caspar'),
     hasSimpleBand: !!document.querySelector('.device-view__band--caspar-simple'),
   })
   ```
4. **Diff-driven restore** — Use `work/device-view-github-reference/` to restore wire-view files from `origin/main` while keeping simple mode in a clearly isolated add-on (separate CSS file + class-gated render only).
5. **Check `localStorage`** — `highascg_device_view_simple_wiring === '1'` forces simple render on load even if UI appears off (unlikely if backplane visible).
6. **GPU/DeckLink order** — `readSavedDecklinkOrder()` / GPU layout prefs in `localStorage`; verify markers still land in `it.container` per slot after refactor (`device-view-caspar-render-markers.js`).

---

## Recommended restore strategy (for a future fix pass)

1. Reset wire-view files to GitHub `main` from `work/device-view-github-reference/`
2. Re-apply WO-82 simple mode as a **minimal additive** layer:
   - New files only (`*-simple.js`, `simple-wiring-prefs.js`)
   - One branch in `bands-render.js`
   - Simple styles in a **separate** stylesheet imported only when needed, or strictly under `.device-view--simple-wiring`
3. **Do not** change `09a1` layout grid or `01b`/`02a` workspace rules until wire view is verified on operator hardware
4. Build, hard-refresh, verify rear panel shows **three columns** before touching simple mode again

---

## Related files

| Role | Path |
|------|------|
| Investigation (this doc) | `work/DEVICE_VIEW_SINGLE_COLUMN_INVESTIGATION.md` |
| GitHub reference tree | `work/device-view-github-reference/` |
| WO-82 spec | `work/work-orders/82_WO_DEVICE_VIEW_SIMPLE_WIRING_MODE.md` |
| Live client (broken WIP) | `client/components/device-view*.js`, `client/styles/09*.css` |
| Production bundle | `dist-web/` (must run `npm run build:client` after client changes) |
