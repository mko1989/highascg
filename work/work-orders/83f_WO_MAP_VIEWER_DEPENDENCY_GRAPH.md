# WO-83f — Map viewer: dependency edges, import graph visualization, flat graph toggle

> **⚠️ AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the **Work Log** section at the bottom documenting what was done.
> 2. Update task checkboxes to reflect current status.
> 3. Leave clear **Instructions for Next Agent** at the end of their log entry.
> 4. Do **NOT** delete previous agents' log entries.

**Parent:** [WO-83 index](./83_WO_INTERACTIVE_PROJECT_MAP.md)  
**Status:** Not started  
**Prerequisites:** 83b + 83c (cross-reference data with `meta.imports` / `meta.importedBy`), 83d (viewer shell)

---

## 1. Objective

Add visual **dependency edges** (arrows / lines) between nodes to show import/require relationships, and provide an alternative **flat graph mode** that shows all files at one level with their connections — useful for understanding module coupling and dependency hotspots.

---

## 2. Dependency edge rendering

### 2.1 When to show edges

Edges are **only rendered at file-level views** (Layer 4) — when the user is viewing the children of a module and those children are `kind: "file"` nodes with `meta.imports` / `meta.importedBy`.

| Current view level | Edge rendering |
|-------------------|----------------|
| Layer 0–2 (OS, services, modules) | **No edges** — relationships are hierarchical (parent-child) |
| Layer 3 (groups) | **No edges** — groups are organizational, not dependency-based |
| Layer 4 (files within a module) | **Yes** — show import arrows between visible files |
| Layer 5 (functions) | **Optional** — show caller/callee if data available |

### 2.2 Edge types

| Type | Visual | Meaning |
|------|--------|---------|
| **Internal import** | Solid arrow, semi-transparent | File A `require('./file-b')` within the same module |
| **Cross-module import** | Dashed arrow, different color | File A `require('../other-module/file-c')` — links outside the current view |
| **External dependency** | Dotted line, muted color | File imports from `node_modules` (shown as a label, not a node) |

### 2.3 SVG overlay approach

Draw edges on an SVG layer positioned absolutely over the card grid:

```html
<div id="map-viewport">
  <div id="map-grid">
    <!-- cards -->
  </div>
  <svg id="map-edges" class="map-edges" aria-hidden="true">
    <!-- arrows rendered here -->
  </svg>
</div>
```

The SVG layer matches the grid dimensions and transforms, so edges stay aligned during pan/zoom.

### 2.4 Arrow rendering

```js
function renderEdge(svg, fromCard, toCard, type = 'internal') {
  const from = getCardAnchor(fromCard, 'right');   // {x, y} of right edge center
  const to = getCardAnchor(toCard, 'left');         // {x, y} of left edge center

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  const dx = to.x - from.x;
  const midX = from.x + dx * 0.5;

  // Bezier curve for smooth routing
  const d = `M ${from.x} ${from.y} C ${midX} ${from.y}, ${midX} ${to.y}, ${to.x} ${to.y}`;
  path.setAttribute('d', d);
  path.setAttribute('class', `map-edge map-edge--${type}`);
  path.setAttribute('data-from', fromCard.dataset.nodeId);
  path.setAttribute('data-to', toCard.dataset.nodeId);
  path.setAttribute('marker-end', 'url(#map-arrowhead)');

  svg.appendChild(path);
}

function getCardAnchor(cardEl, side) {
  const rect = cardEl.getBoundingClientRect();
  const gridRect = document.getElementById('map-grid').getBoundingClientRect();
  if (side === 'right') return { x: rect.right - gridRect.left, y: rect.top + rect.height / 2 - gridRect.top };
  if (side === 'left')  return { x: rect.left - gridRect.left, y: rect.top + rect.height / 2 - gridRect.top };
}
```

### 2.5 SVG defs (arrowhead marker)

```html
<svg id="map-edges">
  <defs>
    <marker id="map-arrowhead" viewBox="0 0 10 7" refX="9" refY="3.5"
            markerWidth="8" markerHeight="6" orient="auto-start-reverse">
      <polygon points="0 0, 10 3.5, 0 7" fill="currentColor" />
    </marker>
  </defs>
</svg>
```

### 2.6 Edge styles

```css
.map-edge {
  fill: none;
  stroke-width: 1.5;
  pointer-events: stroke;
  transition: stroke-opacity 200ms, stroke-width 200ms;
}

.map-edge--internal {
  stroke: rgba(139, 92, 246, 0.3);      /* violet, semi-transparent */
  color: rgba(139, 92, 246, 0.3);       /* for arrowhead fill */
}

.map-edge--cross-module {
  stroke: rgba(34, 211, 238, 0.25);     /* cyan, dashed */
  stroke-dasharray: 6 3;
  color: rgba(34, 211, 238, 0.25);
}

.map-edge--external {
  stroke: rgba(148, 163, 184, 0.15);    /* slate, dotted */
  stroke-dasharray: 2 3;
  color: rgba(148, 163, 184, 0.15);
}

/* Hover: highlight the edge and connected cards */
.map-edge:hover,
.map-edge--highlighted {
  stroke-width: 2.5;
  stroke-opacity: 1;
}

.map-edge--internal:hover,
.map-edge--internal.map-edge--highlighted {
  stroke: rgba(139, 92, 246, 0.8);
  color: rgba(139, 92, 246, 0.8);
}

.map-edge--cross-module:hover,
.map-edge--cross-module.map-edge--highlighted {
  stroke: rgba(34, 211, 238, 0.7);
  color: rgba(34, 211, 238, 0.7);
}
```

---

## 3. Hover highlighting

### 3.1 Card hover → highlight connected edges

When hovering a file card:
1. Find all edges where `data-from` or `data-to` matches the card's node ID.
2. Add `map-edge--highlighted` class to those edges.
3. Add `map-card--connected` class to the cards at the other end of highlighted edges.
4. Dim all other cards and edges (add `map-card--dimmed` / `map-edge--dimmed`).

```css
.map-card--dimmed {
  opacity: 0.3;
  transition: opacity 200ms;
}

.map-card--connected {
  box-shadow: 0 0 12px rgba(139, 92, 246, 0.4);
  border-color: #8b5cf6 !important;
}

.map-edge--dimmed {
  stroke-opacity: 0.05;
}
```

### 3.2 Edge hover → highlight source and target

When hovering an SVG edge:
1. Highlight the edge itself.
2. Highlight source and target cards.
3. Show tooltip with: `"scene-take.js → scene-transition.js"`.

---

## 4. Dependency stats badges

When viewing a file-level grid, show import/export statistics on each card:

```html
<div class="map-card__badges">
  <span class="map-card__badge map-card__badge--imports" title="Imports 5 files">← 5</span>
  <span class="map-card__badge map-card__badge--imported-by" title="Imported by 12 files">→ 12</span>
</div>
```

Files with high `importedByCount` (≥10) get a special "hotspot" glow:

```css
.map-card--hotspot {
  box-shadow: 0 0 20px rgba(245, 158, 11, 0.2);
  border-color: #f59e0b;
}
```

---

## 5. Toggle controls

### 5.1 Edge visibility toggle

Add to the toolbar:

```html
<div class="map-toolbar__controls">
  <label class="map-toggle">
    <input type="checkbox" id="map-toggle-edges" checked>
    <span class="map-toggle__label">Show dependencies</span>
  </label>
  <label class="map-toggle">
    <input type="checkbox" id="map-toggle-cross-module">
    <span class="map-toggle__label">Cross-module edges</span>
  </label>
</div>
```

- **Show dependencies** (default: ON at file level): render internal import edges.
- **Cross-module edges** (default: OFF): show dashed arrows to files outside the current module — these can get very dense.

### 5.2 Flat graph mode toggle

```html
<button id="map-toggle-flat" class="map-toolbar__btn" title="Toggle flat dependency graph">
  <span>🕸️</span> Graph View
</button>
```

When activated:
1. Instead of showing children of the current module, show **all files in the current subtree** (flatten the hierarchy).
2. Render all import edges between them.
3. Position files using a **force-directed layout** (simple spring simulation) or a **grid with edge routing**.
4. The breadcrumb still works — shows the scope of the flattened view.

### 5.3 Force-directed layout (for flat graph mode)

Simple physics simulation:

```js
class ForceLayout {
  constructor(nodes, edges, width, height) {
    this.nodes = nodes.map(n => ({
      ...n,
      x: Math.random() * width,
      y: Math.random() * height,
      vx: 0, vy: 0
    }));
    this.edges = edges;
    this.width = width;
    this.height = height;
  }

  tick(iterations = 100) {
    for (let i = 0; i < iterations; i++) {
      // Repulsion between all nodes
      for (let a = 0; a < this.nodes.length; a++) {
        for (let b = a + 1; b < this.nodes.length; b++) {
          const dx = this.nodes[b].x - this.nodes[a].x;
          const dy = this.nodes[b].y - this.nodes[a].y;
          const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
          const force = 5000 / (dist * dist);
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          this.nodes[a].vx -= fx;
          this.nodes[a].vy -= fy;
          this.nodes[b].vx += fx;
          this.nodes[b].vy += fy;
        }
      }

      // Attraction along edges
      for (const edge of this.edges) {
        const a = this.nodes.find(n => n.id === edge.from);
        const b = this.nodes.find(n => n.id === edge.to);
        if (!a || !b) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const force = dist * 0.01;
        a.vx += (dx / dist) * force;
        a.vy += (dy / dist) * force;
        b.vx -= (dx / dist) * force;
        b.vy -= (dy / dist) * force;
      }

      // Apply velocity with damping
      for (const node of this.nodes) {
        node.vx *= 0.85;
        node.vy *= 0.85;
        node.x += node.vx;
        node.y += node.vy;
        // Contain within bounds
        node.x = Math.max(50, Math.min(this.width - 50, node.x));
        node.y = Math.max(50, Math.min(this.height - 50, node.y));
      }
    }
    return this.nodes;
  }
}
```

---

## 6. Tasks

### Phase A: Edge rendering

- [x] **T1** Add SVG overlay element to `map.html` with arrowhead marker definition.
- [x] **T2** Implement `renderEdges(currentNode)` — iterate file nodes' `meta.imports`, match to sibling nodes, call `renderEdge()`.
- [x] **T3** Implement `renderEdge(svg, fromCard, toCard, type)` — Bezier curve SVG path with arrowhead.
- [x] **T4** Implement `getCardAnchor(cardEl, side)` — compute anchor point relative to grid.
- [x] **T5** Classify edges: internal (same module), cross-module (different module), external (node_modules).
- [x] **T6** Style edges per §2.6 CSS (solid/dashed/dotted, color-coded, semi-transparent).
- [x] **T7** Re-render edges on window resize and after pan/zoom transform changes.
- [x] **T8** Clear edges when navigating to a non-file-level view.

### Phase B: Hover highlighting

- [x] **T9** Implement card hover → highlight connected edges + connected cards, dim unrelated.
- [x] **T10** Implement edge hover → highlight source/target cards, show tooltip.
- [x] **T11** Clear highlighting on mouseout.
- [x] **T12** Add `map-card--hotspot` class to files with `importedByCount ≥ 10`.

### Phase C: Toggle controls

- [x] **T13** Add "Show dependencies" checkbox to toolbar; wire toggle to edge visibility.
- [x] **T14** Add "Cross-module edges" checkbox; wire toggle to cross-module edge rendering.
- [x] **T15** Persist toggle state in `localStorage`.

### Phase D: Flat graph mode

- [x] **T16** Add "Graph View" toggle button to toolbar.
- [x] **T17** Implement `flattenSubtree(node)` — collect all file nodes from the current subtree.
- [x] **T18** Implement `ForceLayout` class per §5.3 — spring-based physics simulation.
- [x] **T19** Render flat graph: position cards absolutely using layout positions, draw all edges.
- [x] **T20** Toggle back to hierarchical view: restore grid layout, clear force positions.
- [x] **T21** Ensure drill-down still works from flat graph (clicking a file opens its functions).

### Phase E: Visual polish

- [x] **T22** Add dependency count badges to file cards (← imports, → imported-by).
- [x] **T23** Animate edges appearing/disappearing (fade in/out on toggle).
- [x] **T24** Add edge tooltip on hover: "filename.js → target.js".
- [x] **T25** Ensure edges are not rendered during drill-in/out animations (wait for animation end).

---

## 7. Acceptance criteria

1. Viewing a module's files shows SVG arrows between files that import each other.
2. Hovering a file card highlights its import/dependency edges and dims unrelated nodes.
3. "Show dependencies" toggle hides/shows all edges.
4. "Graph View" button switches to a flat force-directed layout with all edges visible.
5. Edge types are visually distinct: solid internal, dashed cross-module, dotted external.
6. Files with ≥10 importers show a "hotspot" glow.
7. Edges stay aligned during pan/zoom.
8. Edges are not shown at non-file levels (modules, groups, OS layers).

---

## Work Log

### 2026-06-29 — Initial Creation
**Work Done:**
- Created sub-order for dependency edge visualization with SVG overlay, hover highlighting, toggle controls, flat graph mode with force-directed layout.
- 25 tasks across 5 phases.

**Instructions for Next Agent:**
- Ensure 83b/83c cross-reference data is present (`meta.imports`, `meta.importedBy`).
- Start with Phase A (T1–T8): basic edge rendering at file level.
- The force-directed layout (Phase D) is the most complex piece — implement it last.

### 2026-06-30 — Dependency Edge Render & Flat Graph
**Work Done:**
- Completed all tasks from Phase A through E.
- Implemented `DependencyGraph` class and integrated it into `MapExplorer`.
- Added SVG arrows for internal and cross-module dependencies.
- Added force-directed flat graph mode.
- Added hover states and badges for edge endpoints.

**Instructions for Next Agent:**
- This WO is complete. Proceed to WO-83g for integration and hosting.

---
*Work Order created: 2026-06-29 | Parent: [WO-83](./83_WO_INTERACTIVE_PROJECT_MAP.md)*
