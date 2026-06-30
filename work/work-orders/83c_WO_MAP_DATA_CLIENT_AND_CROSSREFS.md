# WO-83c — Map data: client component/lib scan, grouping, work-order cross-references (Layer 3, 4–5)

> **⚠️ AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the **Work Log** section at the bottom documenting what was done.
> 2. Update task checkboxes to reflect current status.
> 3. Leave clear **Instructions for Next Agent** at the end of their log entry.
> 4. Do **NOT** delete previous agents' log entries.

**Parent:** [WO-83 index](./83_WO_INTERACTIVE_PROJECT_MAP.md)  
**Status:** Not started  
**Prerequisites:** 83a (JSON schema), 83b (shared AST tooling — `parseFile`, `extractExports`, `extractImports`)

---

## 1. Objective

Extend `tools/map/generate-map-data.js` to **scan the `client/` directory tree**, apply intelligent **prefix-based grouping** to the 147 component files and 164 library files, reuse the AST extraction from 83b, and inject the result under `app:highascg-client`. Additionally, **cross-reference all nodes** (server + client) with work order mentions from `work/work-orders/*.md`.

---

## 2. Client directory structure

### 2.1 Directories to scan

| Directory | Contents | Layer |
|-----------|----------|-------|
| `client/app.js` | SPA entry point — tab routing, init, WebSocket connect | 3 (single file) |
| `client/components/` | 147 UI component files | 3 → 4 → 5 |
| `client/lib/` | 164 library/utility files | 3 → 4 → 5 |
| `client/styles/` | CSS stylesheets | 3 (list only, no AST) |
| `client/index.html` | SPA HTML shell | 3 (metadata only) |
| `client/setup.html` | First-run setup page | 3 (metadata only) |

**Do NOT scan:** `client/node_modules/`, `client/assets/`, `client/assets-source/`, `client/fonts/`, `client/fixtures/`, `client/tools/`.

### 2.2 `client/components/` — prefix groups

The 147 component files follow a naming convention. Group them into logical `kind: "group"` nodes by prefix:

| Prefix | Group label | Description | Example files |
|--------|------------|-------------|---------------|
| `device-view-` | Device View | Back-of-rack device graph, cables, inspectors | `device-view.js`, `device-view-bands-render.js`, `device-view-cables.js` |
| `device-view-inspector-` | Device View Inspectors | Per-connector-type inspector panels | `device-view-inspector-gpu.js`, `device-view-inspector-decklink.js` |
| `device-view-caspar-render-` | Device View Caspar Render | Rear panel rendering (backplane, markers, simple mode) | `device-view-caspar-render.js`, `device-view-caspar-render-markers.js` |
| `inspector-` | Inspector Panel | Main inspector panel and editor sub-panels | `inspector-panel.js`, `inspector-fill.js`, `inspector-mixer.js` |
| `inspector-global-border-` | Global Border Inspector | Border effect editor sub-panels | `inspector-global-border.js`, `inspector-global-border-effect.js` |
| `scenes-` | Scenes Editor | Scene list, editor, compose, preview, shared logic | `scenes-editor.js`, `scenes-compose.js`, `scene-list.js` |
| `scene-` | Scene Components | Scene-specific UI (layer row) | `scene-layer-row.js` |
| `timeline-` | Timeline Editor | Timeline canvas, editor, transport, handlers | `timeline-editor.js`, `timeline-canvas.js`, `timeline-transport.js` |
| `preview-` | Preview Canvas | PGM/PRV preview rendering and panel | `preview-canvas-panel.js`, `preview-canvas-draw-base.js` |
| `audio-mixer-` | Audio Mixer | Audio mixer panel and console views | `audio-mixer-panel.js`, `audio-mixer-view-console.js` |
| `multiview-` | Multiview Editor | Multiview canvas and editor | `multiview-editor.js`, `multiview-editor-canvas.js` |
| `pixel-map-` | Pixel Map Editor | LED pixel map editor | `pixel-map-editor.js`, `pixel-map-editor-canvas.js` |
| `previs-` | 3D Previs | 3D preview, model inspector, UV editor | `previs-pgm-3d.js`, `previs-mesh-inspector.js`, `previs-uv-editor.js` |
| `settings-` | Settings Modal | Settings tabs, hardware, ALSA, live audio, templates | `settings-modal.js`, `settings-modal-logic.js` |
| `sources-` | Sources Panel | Media browser, live sources, effects, templates | `sources-panel.js`, `sources-panel-helpers.js` |
| `header-bar-` | Header Bar | Top toolbar sections | `header-bar.js`, `header-bar-audio.js`, `header-bar-streaming.js` |
| `*-modal.js` | Modals | All modal dialogs | `logs-modal.js`, `usb-import-modal.js`, `load-project-modal.js` |
| (ungrouped) | Misc Components | Components not matching any prefix | `connection-eye.js`, `playback-timer.js`, `variables-panel.js` |

**Grouping algorithm:**

```js
const COMPONENT_GROUPS = [
  { prefix: 'device-view-inspector-', label: 'Device View Inspectors', description: 'Per-connector-type inspector panels in Device View' },
  { prefix: 'device-view-caspar-render-', label: 'Device View Caspar Render', description: 'Rear panel rendering — backplane SVG, markers, simple mode' },
  { prefix: 'device-view-', label: 'Device View', description: 'Back-of-rack device graph — cables, destinations, mappings, snapshots' },
  { prefix: 'inspector-global-border-', label: 'Global Border Inspector', description: 'Global border effect editor sub-panels — effect, ArtNet, slices' },
  { prefix: 'inspector-', label: 'Inspector Panel', description: 'Main inspector panel and content editor sub-panels' },
  { prefix: 'scenes-', label: 'Scenes Editor', description: 'Scene editing, compose preview, preview runtime' },
  { prefix: 'scene-', label: 'Scene Components', description: 'Scene-specific UI components — layer row' },
  { prefix: 'timeline-', label: 'Timeline Editor', description: 'Timeline canvas, editor, transport, clip rendering, handlers' },
  { prefix: 'preview-', label: 'Preview Canvas', description: 'PGM/PRV preview rendering, draw routines, compose snapshots' },
  { prefix: 'audio-mixer-', label: 'Audio Mixer', description: 'Audio mixer faders, VU meters, console view, sync' },
  { prefix: 'multiview-', label: 'Multiview Editor', description: 'Multiview layout canvas, editor, interaction' },
  { prefix: 'pixel-map-', label: 'Pixel Map Editor', description: 'LED pixel map editor and canvas' },
  { prefix: 'previs-', label: '3D Previs', description: '3D preview, model loader, UV editor, texture mapping' },
  { prefix: 'settings-', label: 'Settings Modal', description: 'Settings tabs — hardware, ALSA mixer, live audio, templates, updates' },
  { prefix: 'sources-', label: 'Sources Panel', description: 'Media browser, live sources, effects, ingest, templates' },
  { prefix: 'header-bar-', label: 'Header Bar', description: 'Top toolbar — audio, streaming, replication, LED test, config strip' },
];
// After prefix groups: collect remaining *-modal.js into "Modals" group
// Remaining files go into "Misc Components"
```

**Important:** prefixes must be checked **longest first** to avoid `device-view-inspector-` matching `device-view-` before the more specific prefix.

### 2.3 `client/lib/` — prefix groups

Same approach for the 164 lib files:

| Prefix | Group label | Description |
|--------|------------|-------------|
| `device-view-gpu-port-` | GPU Port Logic | GPU port discovery, merging, layout, topology |
| `device-view-` | Device View Logic | Cable resolve, host channels, refresh, GPU source inherit |
| `audio-mixer-` | Audio Mixer Logic | Meter loops, peaks, state, bus meters, fader bind |
| `live-audio-` | Live Audio Logic | Audio inputs, routing, play targets, state |
| `previs-` | Previs Logic | Scene, model loader, UV mapper, texture, state |
| `scene-state-` | Scene State | Scene state helpers, look logic, layer logic, persistence |
| `scenes-preview-` | Scenes Preview | Preview global border, look stack, push scene, snapshot |
| `project-` | Project Logic | Files, hardware, media, import, load, state |
| `replication-` | Replication UI | Media spread, status banner, UI state |
| `timeline-` | Timeline Logic | State, clip interp, clip layout, track heights |
| `pip-overlay-` | PiP Overlay | AMCP commands, registry |
| `optional-modules-` | Optional Modules | Client manifest, meta, registry |
| `lower-third-` | Lower Thirds | CG data, roster import |
| `streaming-` | Streaming Logic | Channel state |
| `companion-` | Companion Logic | Button preview, location parse |
| `compose-preview-` | Compose Preview | URL builder |
| `global-border-` | Global Border | ArtNet map, WebSocket |
| `mapping-` | Mapping Logic | Node service, state |
| `app-` | App Core | Runtime, status, toast, scene deck, multiview sync, WS handlers |
| `audio-` | Audio Utils | Channel layouts, routes, volume scale |
| (ungrouped) | Misc Libraries | Remaining utility files |

### 2.4 Additional client files

Scan as direct children of `app:highascg-client`:

| File | Kind | Description |
|------|------|-------------|
| `client/app.js` | `file` | SPA entry point — tab routing, init sequence, WebSocket connection |
| `client/index.html` | `file` | SPA HTML shell — head meta, body structure, script tags |
| `client/setup.html` | `file` | First-run setup wizard page |
| `client/styles.css` | `file` | Global CSS imports |

---

## 3. Work-order cross-reference system

### 3.1 Scan work orders for file/function mentions

After all code nodes are generated, scan `work/work-orders/*.md` for mentions of:
- File names (e.g., `scene-take.js`, `device-view.js`)
- Function names (e.g., `executeSceneTake`, `renderCableOverlay`)
- Module names (e.g., `src/engine/`, `src/replication/`)
- Route paths (e.g., `/api/scenes`, `/api/device-view`)

### 3.2 Algorithm

```js
async function crossReferenceWorkOrders(allNodes, workOrderDir) {
  const woFiles = glob.sync('*.md', { cwd: workOrderDir });
  const woIndex = {};  // nodeId → [{ wo: "WO-82", title: "...", mention: "line content" }]

  for (const woFile of woFiles) {
    const match = woFile.match(/^(\d+[a-z]?)_WO_/);
    if (!match) continue;
    const woNum = match[1];
    const content = fs.readFileSync(path.join(workOrderDir, woFile), 'utf8');
    const title = content.split('\n').find(l => l.startsWith('# '))?.replace(/^#\s*/, '') || woFile;

    for (const node of allNodes) {
      // Match by file basename, function name, module path, or route path
      const searchTerms = [
        node.label,                           // "scene-take.js"
        node.meta?.name,                      // "executeSceneTake"
        node.meta?.path,                      // "src/engine/scene-take.js"
        node.meta?.path?.split('/').pop(),     // "scene-take.js" from path
      ].filter(Boolean);

      for (const term of searchTerms) {
        if (term.length < 4) continue;  // skip very short terms
        if (content.includes(term)) {
          if (!woIndex[node.id]) woIndex[node.id] = [];
          woIndex[node.id].push({ wo: `WO-${woNum}`, title, file: woFile });
          break;  // one match per WO per node is enough
        }
      }
    }
  }

  // Attach to nodes
  for (const node of allNodes) {
    if (woIndex[node.id]) {
      node.meta = node.meta || {};
      node.meta.relatedWOs = woIndex[node.id];
    }
  }
}
```

### 3.3 Output format

```json
{
  "id": "file:src/engine/scene-take.js",
  "meta": {
    "relatedWOs": [
      { "wo": "WO-34", "title": "Switcher Bus Transition Rebuild", "file": "34_WO_SWITCHER_BUS_TRANSITION_REBUILD.md" },
      { "wo": "WO-60", "title": "CG-Only Looks Deck Visual", "file": "60_WO_CG_ONLY_LOOKS_DECK_VISUAL.md" }
    ]
  }
}
```

---

## 4. CSS file listing (no AST)

For `client/styles/`:
- List all `.css` files as `kind: "file"` nodes
- Include `meta.lines` and `meta.bytes`
- Group by filename convention (same prefix logic)
- **No AST parsing** — CSS is not JS
- Description: extract the first `/* comment */` if present

---

## 5. Tasks

### Phase A: Client component scan (Layer 3)

- [ ] **T1** Add `client/components/` walker: list all `.js` files (exclude sync-conflicts).
- [ ] **T2** Implement prefix-based grouping algorithm from §2.2 (longest prefix first, modals suffix group, ungrouped fallback).
- [ ] **T3** Create `kind: "group"` intermediate nodes with curated descriptions from the lookup tables.
- [ ] **T4** For each component file: create `kind: "file"` node with `meta.path`, `meta.lines`, `meta.bytes`.
- [ ] **T5** Inject component tree under `app:highascg-client.children`.

### Phase B: Client lib scan

- [ ] **T6** Add `client/lib/` walker: list all `.js` and `.json` files (exclude sync-conflicts).
- [ ] **T7** Implement prefix-based grouping for lib files from §2.3.
- [ ] **T8** Create `kind: "group"` nodes for lib groups.
- [ ] **T9** For each lib file: create `kind: "file"` node with metadata.
- [ ] **T10** Inject lib tree as a separate child group under `app:highascg-client`.

### Phase C: AST extraction for client files (Layer 4–5)

- [ ] **T11** Reuse `parseFile()`, `extractExports()`, `extractImports()` from 83b for client `.js` files.
- [ ] **T12** Handle client-specific import patterns: ES module `import ... from '...'` (client uses Vite/ESM).
- [ ] **T13** For client files: extract exported functions/classes as `kind: "function"` children.
- [ ] **T14** Build client-side import graph: `client/components/` ↔ `client/lib/` ↔ `client/app.js`.
- [ ] **T15** Build cross-tree import graph: identify any `client/` files that reference `src/` shared code (if any).

### Phase D: Additional client files

- [ ] **T16** Scan `client/app.js` as a direct child of `app:highascg-client` (SPA entry point).
- [ ] **T17** Add `client/index.html` and `client/setup.html` as metadata-only file nodes.
- [ ] **T18** Scan `client/styles/` — list CSS files with line/byte counts, group by prefix, no AST.

### Phase E: Work-order cross-references

- [ ] **T19** Implement `crossReferenceWorkOrders()` per §3 — scan all `work/work-orders/*.md` files.
- [ ] **T20** Attach `meta.relatedWOs` to every matching node (server + client).
- [ ] **T21** Log summary: "N nodes linked to M work orders".

### Phase F: Final validation

- [ ] **T22** Update `stats` in envelope: recount all nodes, verify per-layer counts.
- [ ] **T23** Verify: ≥147 component file nodes, ≥164 lib file nodes, ≥20 component groups, ≥15 lib groups.
- [ ] **T24** Verify: `app:highascg-client` has depth ≥3 (client → group → file → function).
- [ ] **T25** Verify: ≥100 nodes have `meta.relatedWOs` (cross-reference coverage).
- [ ] **T26** Full generation time still < 15 seconds with all three phases (83a + 83b + 83c).

---

## 6. Acceptance criteria

1. `app:highascg-client` has grouped children for components (≥15 groups) and libs (≥15 groups).
2. All 147 component files and 164 lib files appear as nodes (excluding sync-conflicts).
3. Prefix grouping correctly nests `device-view-inspector-gpu.js` under "Device View Inspectors" (not just "Device View").
4. Client-side import graph has `meta.imports` and `meta.importedBy` on each file.
5. Work-order cross-references link ≥100 nodes to their related WOs.
6. CSS files are listed with line counts but no AST extraction attempted.

---

## Work Log

### 2026-06-29 — Initial Creation
**Work Done:**
- Created detailed sub-order for client scan with full prefix-group definitions for 147 components (17 groups) and 164 libs (21 groups).
- Specified work-order cross-reference algorithm.
- 26 tasks across 6 phases.

**Instructions for Next Agent:**
- Ensure 83a and 83b are complete first (schema + AST tooling).
- Start with Phase A (T1–T5): component grouping — the prefix list must be matched **longest first**.
- The AST extractors from 83b should work for client files too, but note that `client/` uses ES modules (`import/export`) while `src/` uses CommonJS (`require/module.exports`).

---
*Work Order created: 2026-06-29 | Parent: [WO-83](./83_WO_INTERACTIVE_PROJECT_MAP.md)*
