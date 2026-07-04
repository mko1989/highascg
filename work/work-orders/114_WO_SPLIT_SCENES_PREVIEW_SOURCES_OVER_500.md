# WO-114 — Split scenes, preview & sources files over 500 lines

> **⚠️ AGENT COLLABORATION PROTOCOL** — see [WO-111](./111_WO_FILE_SIZE_500_LIMIT.md)

**Parent:** [WO-111](./111_WO_FILE_SIZE_500_LIMIT.md)  
**Status:** Complete (T114.0–T114.4)  
**Priority:** **High**

**Touches:** `client/components/scenes-*.js`, `client/components/scene-*.js`, `client/components/preview-*.js`, `client/components/sources-panel.js`, `client/lib/scene-state.js`

---

## 1. Problem

| Lines | File |
|------:|------|
| 677 | `client/components/sources-panel.js` |
| 642 | `client/components/scenes-editor.js` |
| 626 | `client/components/preview-canvas-panel.js` |
| 547 | `client/components/scene-list.js` |
| 512 | `client/lib/scene-state.js` |

---

## 2. Split plan

### 2.1 `sources-panel.js` (677)

Already has logical tabs — split by media source family:

| New module | Responsibility |
|------------|----------------|
| `sources-panel-media.js` | Local media browser, thumbnails |
| `sources-panel-live.js` | Live inputs, ingest list |
| `sources-panel-templates.js` | Template/CG picks |
| `sources-panel-shell.js` | Tab chrome, shared search, drag-start |

### 2.2 `scenes-editor.js` (642)

Extract compose preview vs deck editing:

| New module | Responsibility |
|------------|----------------|
| `scenes-editor-deck.js` | Layer rows, take preview, bank buttons |
| `scenes-editor-compose.js` | Compose snapshot, PGM/PRV wiring |
| `scenes-editor-ws-sync.js` | stateStore subscriptions, debounced redraw |

### 2.3 `preview-canvas-panel.js` (626)

Extract draw routines (pattern used elsewhere):

| New module | Responsibility |
|------------|----------------|
| `preview-canvas-draw-pgm.js` | PGM layer compositing |
| `preview-canvas-draw-prv.js` | Preview/program bus |
| `preview-canvas-panel-host.js` | Mount, resize, toolbar |

### 2.4 `scene-list.js` (547)

Extract list rendering vs CRUD actions:

- `scene-list-render.js`
- `scene-list-actions.js` (rename, delete, duplicate)

### 2.5 `scene-state.js` (512)

Mirror `timeline-state` pattern:

- `scene-state-model.js`
- `scene-state-mutations.js`

---

## 3. Tasks

- [x] **T114.0** Split sources-panel by tab; verify drag-to-layer from each tab.
- [x] **T114.1** Split scenes-editor; verify scene take + compose preview.
- [x] **T114.2** Split preview-canvas-panel draw modules.
- [x] **T114.3** Split scene-list + scene-state.
- [x] **T114.4** All five files ≤ 500 lines.

---

## 4. Verification

```bash
npm run lint
npm run smoke:compose-preview
npm run smoke:media-browser
```

Manual: scene take, sources drag, preview PGM/PRV update.

---

## Work Log

### 2026-07-03 — WO-114 splits complete

- **sources-panel.js** (678 → 457): `-project-gather`, `-media-selection`, `-decklink-drop`, `-render`
- **scenes-editor.js** (643 → 492): `-deck-thumb`, `-deck-drop`, `-layer-route`
- **preview-canvas-panel.js** (627 → 453): `preview-canvas-destination-overlay.js`
- **scene-list.js** (548 → 224): `scene-list-column.js`
- **scene-state.js** (513 → 468): `scene-state-layer-ops.js` mixin
- **Files over 500:** 31 → 26

### 2026-07-03 — Created

- **Instructions for Next Agent:** Start with `sources-panel.js` — clearest tab boundaries.
