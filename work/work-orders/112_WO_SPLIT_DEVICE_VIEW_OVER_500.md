# WO-112 — Split Device View files over 500 lines

> **⚠️ AGENT COLLABORATION PROTOCOL** — see [WO-111](./111_WO_FILE_SIZE_500_LIMIT.md)

**Parent:** [WO-111](./111_WO_FILE_SIZE_500_LIMIT.md)  
**Status:** Done — WO-112 complete 2026-07-03  
**Priority:** **High** (largest client cluster)

**Touches:** `client/components/device-view*.js`

---

## 1. Problem

Five Device View modules exceed 500 lines. The area already has 30+ sibling files — further splits should follow existing naming (`device-view-*`, `device-view-inspector-*`).

| Lines | File |
|------:|------|
| 850 | `client/components/device-view.js` |
| 827 | `client/components/device-view-inspector-replication.js` |
| 702 | `client/components/device-view-inspector-decklink.js` |
| 645 | `client/components/device-view-destinations-inspector.js` |
| 644 | `client/components/device-view-inspector-gpu-video-modeline.js` |

---

## 2. Split plan

### 2.1 `device-view.js` (850 → ≤500)

Extract orchestration leftovers into focused modules (many imports already exist):

| New module | Responsibility |
|------------|----------------|
| `device-view-toolbar.js` | Header buttons, cable toolbar, messiness slider, simple-wiring toggle |
| `device-view-event-handlers.js` | Click/drag handlers, cable connect flow, keyboard shortcuts |
| `device-view-refresh-cycle.js` | `refreshAll`, WS/settings subscription glue, tab activation |

Keep `device-view.js` as thin `initDeviceView` + layout shell + wiring imports.

### 2.2 `device-view-inspector-replication.js` (827)

Split by UI section:

| New module | Responsibility |
|------------|----------------|
| `device-view-inspector-replication-leader.js` | Leader role panel, pairing, push controls |
| `device-view-inspector-replication-follower.js` | Follower status, sync clock, failover hints |
| `device-view-inspector-replication-shared.js` | Shared table builders, API helpers |

Re-export single `renderReplicationInspector(...)` from the original file.

### 2.3 `device-view-inspector-decklink.js` (702)

Split by connector mode:

| New module | Responsibility |
|------------|----------------|
| `device-view-inspector-decklink-input.js` | Input routing, format selectors |
| `device-view-inspector-decklink-output.js` | Output/key-fill, mode lines |
| `device-view-inspector-decklink-shared.js` | Device enum, label helpers |

### 2.4 `device-view-destinations-inspector.js` (645)

Extract:

- `device-view-destinations-inspector-chips.js` — map chips, screen labels
- `device-view-destinations-inspector-form.js` — edit fields, validation, save patch

### 2.5 `device-view-inspector-gpu-video-modeline.js` (644)

Extract:

- `device-view-inspector-gpu-modeline-list.js` — mode table, custom mode rows
- `device-view-inspector-gpu-modeline-apply.js` — xrandr apply, persist, error surfacing

---

## 3. Tasks

- [x] **T112.0** Split `device-view.js`; verify cabling, snapshots, Caspar apply, inspector open/close.
- [x] **T112.1** Split replication inspector; verify leader/follower UI on replication smoke tests.
- [x] **T112.2** Split DeckLink inspector; verify input/output inspector on device with DeckLink edges.
- [x] **T112.3** Split destinations inspector; verify destination edit + chip display.
- [x] **T112.4** Split GPU modeline inspector; verify custom mode add/apply.
- [x] **T112.5** All five original paths ≤ 500 lines; `npm run lint` clean.

---

## 4. Verification

```bash
npm run lint
npm run test:device-graph
npm run test:device-snapshot
npm run test:replication
```

Manual: Device View tab — cable two connectors, open each inspector type implicated above, save snapshot, load snapshot.

---

## Work Log

### 2026-07-03 — Created

- Split plan drafted from file sizes and existing Device View module layout.
### 2026-07-03 — T112.0 device-view.js split

- Split `device-view.js` (851 → 66) into `device-view-toolbar.js`, `device-view-selection.js`, `device-view-cable.js`, `device-view-render.js`, `device-view-events.js`.
- Context object pattern: `register*` modules attach methods; thin orchestrator wires init order.
- Split `device-view-inspector-replication.js` (827 → 171) into `-shared.js`, `-controls.js`.
- `check:file-lines` count: 41 → 40 files over 500.
### 2026-07-03 — WO-112 complete (decklink, destinations, GPU modeline)

- Split `device-view-inspector-decklink.js` (702 → 51): `-shared`, `-output`, `-input`.
- Split `device-view-destinations-inspector.js` (645 → 11): `-modes`, `-form` (re-export aggregator).
- Split `device-view-inspector-gpu-video-modeline.js` (644 → 408): `-os`, `-apply`.
- `check:file-lines` count: 40 → 37 files over 500 (all five WO-112 targets ≤ 500).
- **Instructions for Next Agent:** WO-113+ per WO-111 — next largest client files (`inspector-panel-timeline.js`, etc.).
