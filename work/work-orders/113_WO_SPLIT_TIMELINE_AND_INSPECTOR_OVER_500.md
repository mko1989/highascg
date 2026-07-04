# WO-113 — Split timeline & inspector files over 500 lines

> **⚠️ AGENT COLLABORATION PROTOCOL** — see [WO-111](./111_WO_FILE_SIZE_500_LIMIT.md)

**Parent:** [WO-111](./111_WO_FILE_SIZE_500_LIMIT.md)  
**Status:** In progress (T113.0–T113.3 done; T113.4 verify)  
**Priority:** **High** (operator playback path)

**Touches:** `client/components/timeline-*.js`, `client/components/inspector-*.js`, `client/lib/timeline-state.js`

---

## 1. Problem

| Lines | File |
|------:|------|
| 755 | `client/components/inspector-panel-timeline.js` |
| 710 | `client/components/timeline-canvas.js` |
| 599 | `client/lib/timeline-state.js` |
| 549 | `client/components/inspector-lower-third.js` |
| 547 | `client/components/timeline-editor.js` |
| 514 | `client/components/inspector-panel.js` |

---

## 2. Split plan

### 2.1 `inspector-panel-timeline.js` (755)

Extract clip/layer inspector sub-panels:

| New module | Responsibility |
|------------|----------------|
| `inspector-panel-timeline-clip.js` | Single-clip fields, in/out, speed |
| `inspector-panel-timeline-layer.js` | Layer stack, opacity, blend |
| `inspector-panel-timeline-transport.js` | Playhead-linked controls, snap |

### 2.2 `timeline-canvas.js` (710)

Extract rendering from interaction:

| New module | Responsibility |
|------------|----------------|
| `timeline-canvas-draw.js` | Ruler, clips, playhead, grid |
| `timeline-canvas-hit.js` | Hit testing, drag thresholds |
| `timeline-canvas-scroll.js` | Pan/zoom, scroll sync |

Keep public API: `initTimelineCanvas`, `redraw`, `setPlayhead`.

### 2.3 `timeline-state.js` (599)

Split pure state from mutations:

| New module | Responsibility |
|------------|----------------|
| `timeline-state-model.js` | Normalized timeline JSON shape, validators |
| `timeline-state-mutations.js` | add/remove/move clip, layer ops |
| `timeline-state-selectors.js` | getClipAt, selectedIds, duration helpers |

### 2.4 `inspector-lower-third.js` (549)

Extract roster vs single-LT editor:

- `inspector-lower-third-roster.js`
- `inspector-lower-third-fields.js`

### 2.5 `timeline-editor.js` (547)

Extract toolbar/transport bar from canvas mount:

- `timeline-editor-toolbar.js`
- `timeline-editor-transport.js`

### 2.6 `inspector-panel.js` (514)

Extract tab routing:

- `inspector-panel-tabs.js` — which sub-inspector mounts for selection type
- Keep shell + shared layout in `inspector-panel.js`

---

## 3. Tasks

- [x] **T113.0** Split timeline canvas draw vs interaction; verify drag, zoom, playhead.
- [x] **T113.1** Split `timeline-state.js`; run timeline-related smoke if any.
- [x] **T113.2** Split inspector-panel-timeline + inspector-panel shell.
- [x] **T113.3** Split timeline-editor + inspector-lower-third.
- [x] **T113.4** All six files ≤ 500 lines.

---

## 4. Verification

Manual: open timeline, add clips, scrub playhead, edit clip in inspector, edit lower-third roster entry.

```bash
npm run lint
npm run smoke:project-fps-network
```

---

## Work Log

### 2026-07-03 — WO-113 splits complete

- **timeline-canvas.js** (711 → 259): `timeline-canvas-pointer.js`, `timeline-canvas-wheel.js`, `timeline-canvas-snap.js`
- **timeline-state.js** (600 → 270): `timeline-state-model.js`, `timeline-state-clips.js`, `timeline-state-keyframes.js`
- **inspector-panel-timeline.js** (756 → 6 re-export): `-shared`, `-flag`, `-clip`
- **timeline-editor.js** (548 → 444): `timeline-editor-preview.js`
- **inspector-panel.js** (515 → 407): `inspector-panel-routing.js`
- **inspector-lower-third.js** (550 → ≤500): `-templates`, `-roster`
- **Files over 500:** 46 → 31 (per `check:file-lines`)

### 2026-07-03 — Created

- **Instructions for Next Agent:** Split `timeline-canvas.js` draw layer first — lowest risk to playback logic.
