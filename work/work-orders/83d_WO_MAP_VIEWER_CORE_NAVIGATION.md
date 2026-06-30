# WO-83d — Map viewer: core navigation, node cards, drill-down, breadcrumbs, metadata sidebar

> **⚠️ AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the **Work Log** section at the bottom documenting what was done.
> 2. Update task checkboxes to reflect current status.
> 3. Leave clear **Instructions for Next Agent** at the end of their log entry.
> 4. Do **NOT** delete previous agents' log entries.

**Parent:** [WO-83 index](./83_WO_INTERACTIVE_PROJECT_MAP.md)  
**Status:** Not started  
**Prerequisites:** 83a (data to render — at minimum the static OS/service layers)

---

## 1. Objective

Build the **interactive map viewer** — a standalone HTML page (`client/map.html`) with its own CSS and JS that:
1. Loads `map-data.json` and renders the root level as a grid of styled **node cards**.
2. Supports **click-to-drill** into any node's children with smooth animated transitions.
3. Provides **breadcrumb navigation** to jump back to any ancestor level.
4. Shows a **metadata sidebar** with details about the focused/hovered node.
5. Uses a **dark theme** consistent with the HighAsCG operator UI aesthetic.

This is the core viewer — search, zoom, and dependency edges are in 83e and 83f.

---

## 2. Page structure

### 2.1 File layout

```
client/
├── map.html                          ← standalone HTML page
├── components/
│   └── map-explorer.js               ← main viewer class (ES module)
└── styles/
    └── map-explorer.css              ← all map-specific styles
```

### 2.2 HTML shell (`map.html`)

```html
<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>HighAsCG — Project Map</title>
  <meta name="description" content="Interactive architecture map of the HighAsCG playout stack">
  <link rel="stylesheet" href="styles/map-explorer.css">
  <!-- Google Font: Inter -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
</head>
<body>
  <div id="map-root">
    <header id="map-header">
      <a href="/" class="map-logo" title="Back to HighAsCG">← HighAsCG</a>
      <nav id="map-breadcrumb" aria-label="Navigation breadcrumb"></nav>
      <div id="map-header-actions">
        <button id="map-search-trigger" title="Search (Ctrl+K)">🔍 Search</button>
      </div>
    </header>
    <main id="map-viewport">
      <div id="map-grid" role="tree" aria-label="Project architecture map"></div>
    </main>
    <aside id="map-sidebar" class="map-sidebar--collapsed" aria-label="Node details"></aside>
    <div id="map-loading" class="map-loading">
      <div class="map-loading__spinner"></div>
      <p>Loading project map…</p>
    </div>
  </div>
  <script type="module" src="components/map-explorer.js"></script>
</body>
</html>
```

---

## 3. Node card design (normative)

### 3.1 Card structure

Each node renders as a card:

```html
<article class="map-card map-card--{kind}" data-node-id="{id}" role="treeitem" tabindex="0">
  <div class="map-card__icon">{icon}</div>
  <div class="map-card__content">
    <h3 class="map-card__label">{label}</h3>
    <p class="map-card__description">{description}</p>
    <div class="map-card__badges">
      <span class="map-card__child-count" title="{N} children">▸ {N}</span>
      <!-- optional badges: -->
      <span class="map-card__badge map-card__badge--route" title="{N} routes">🌐 {N}</span>
      <span class="map-card__badge map-card__badge--wo" title="Linked to {N} work orders">📋 {N}</span>
    </div>
  </div>
</article>
```

### 3.2 Card sizing

| Level depth | Card width | Card height | Grid columns |
|-------------|-----------|------------|-------------|
| 0 (root — Ubuntu children) | 320px | 120px | 3–4 responsive |
| 1 (services, apps) | 280px | 110px | 3–5 responsive |
| 2 (modules) | 260px | 100px | 4–6 responsive |
| 3 (groups, files) | 240px | 90px | 4–6 responsive |
| 4–5 (functions, routes) | 220px | 80px | 5–8 responsive |

Cards use CSS Grid with `auto-fill` and `minmax()` for responsive columns.

### 3.3 Color coding

Use the color table from the [WO-83 index](./83_WO_INTERACTIVE_PROJECT_MAP.md). Each `kind` maps to:
- `--card-bg`: background color
- `--card-border`: border color (1.5px solid)
- `--card-icon-bg`: icon circle background (slightly lighter than card bg)

CSS custom properties per kind:

```css
.map-card--os       { --card-bg: #1e293b; --card-border: #475569; }
.map-card--service  { --card-bg: #1e3a5f; --card-border: #3b82f6; }
.map-card--application { --card-bg: #064e3b; --card-border: #10b981; }
.map-card--module   { --card-bg: #2e1065; --card-border: #8b5cf6; }
.map-card--group    { --card-bg: #312e81; --card-border: #6366f1; }
.map-card--file     { --card-bg: #451a03; --card-border: #f59e0b; }
.map-card--function { --card-bg: #083344; --card-border: #06b6d4; }
.map-card--route    { --card-bg: #3b0764; --card-border: #d946ef; }
/* ... all kinds from index */
```

### 3.4 Icons per kind

| Kind | Icon | Rendering |
|------|------|-----------|
| `os` | 🖥️ | Emoji in `.map-card__icon` |
| `bootloader` | ⚡ | |
| `kernel` | 🧬 | |
| `driver` | 🔌 | |
| `subsystem` | ⚙️ | |
| `init` | 🔄 | |
| `service` | 🟢 | |
| `application` | 📦 | |
| `session` | 🖼️ | |
| `filesystem` | 💾 | |
| `module` | 📁 | |
| `group` | 📂 | |
| `file` | 📄 | |
| `function` | ƒ | Styled letter in monospace |
| `class` | 🏗️ | |
| `constant` | 🔒 | |
| `route` | 🌐 | |
| `ws-event` | ⚡ | |
| `config` | ⚙️ | |
| `script` | 📜 | |

---

## 4. Navigation system

### 4.1 Drill-down (click to enter)

When a card with `children.length > 0` is clicked:

1. **Save current state** to history stack: `{ nodeId, scrollPosition }`.
2. **Animate out**: current cards scale down (0.95) + fade out (opacity 0) over 200ms.
3. **Update breadcrumb**: append the clicked node's label.
4. **Replace grid contents** with the children of the clicked node.
5. **Animate in**: new cards start scaled up (1.05) + faded out, animate to normal (1.0, opacity 1) over 300ms, staggered by 20ms per card (max 10 stagger groups).
6. **Update URL hash**: `#/path/to/node` (e.g., `#/ubuntu/systemd/svc:highascg`).
7. **Update document title**: `"HighAsCG Map — {node.label}"`.

Nodes with `children.length === 0` (leaf nodes): clicking shows the **metadata sidebar** instead.

### 4.2 Breadcrumb navigation

The breadcrumb bar shows the path from root to current node:

```
🖥️ Ubuntu  ›  🔄 systemd  ›  🟢 highascg.service  ›  📦 HighAsCG Server  ›  📁 API Router & Routes
```

- Each breadcrumb segment is clickable — navigates back to that level.
- The root segment (Ubuntu) always visible.
- On narrow viewports, collapse middle segments to `…` (show first + last 2).

### 4.3 Back navigation

- **Browser back** (`popstate` event): restores previous level from history stack.
- **Escape key**: navigates up one level.
- **Backspace key** (when no input focused): navigates up one level.
- **Breadcrumb click**: jumps to that ancestor level.

### 4.4 URL hash routing

Format: `#/segment1/segment2/...` where each segment is a `node.id`.

```
#/                                    → root (Ubuntu children)
#/systemd                             → systemd children
#/systemd/svc:highascg                → highascg.service children
#/systemd/svc:highascg/app:highascg-server → HighAsCG Server children (modules)
#/systemd/svc:highascg/app:highascg-server/mod:engine → engine module children (files)
#/systemd/svc:highascg/app:highascg-server/mod:engine/file:src%2Fengine%2Fscene-take.js → scene-take.js children (functions)
```

On page load: parse hash, walk the tree to find the target node, render that level, build breadcrumb.

---

## 5. Metadata sidebar

### 5.1 Trigger

- **Click** a leaf node (no children) → sidebar opens.
- **Right-click** or **long-press** any node → sidebar opens with that node's details.
- **Hover** (optional, desktop only): show condensed tooltip after 500ms delay.

### 5.2 Sidebar contents

```html
<aside id="map-sidebar">
  <button class="map-sidebar__close" aria-label="Close">&times;</button>
  <header class="map-sidebar__header">
    <span class="map-sidebar__icon">{icon}</span>
    <h2 class="map-sidebar__title">{label}</h2>
    <span class="map-sidebar__kind">{kind}</span>
  </header>
  <p class="map-sidebar__description">{description}</p>

  <!-- Meta fields (conditional by kind) -->
  <section class="map-sidebar__meta">
    <!-- For files: -->
    <dl>
      <dt>Path</dt><dd><code>{meta.path}</code></dd>
      <dt>Lines</dt><dd>{meta.lines}</dd>
      <dt>Size</dt><dd>{meta.bytes} bytes</dd>
      <dt>Exports</dt><dd>{meta.exports?.length || 0}</dd>
      <dt>Imports</dt><dd>{meta.imports?.length || 0}</dd>
      <dt>Imported by</dt><dd>{meta.importedBy?.length || 0}</dd>
    </dl>
    <!-- For functions: -->
    <dl>
      <dt>Signature</dt><dd><code>{label}</code></dd>
      <dt>Lines</dt><dd>{meta.line}–{meta.endLine}</dd>
      <dt>Async</dt><dd>{meta.async ? 'Yes' : 'No'}</dd>
    </dl>
    <!-- For services: -->
    <dl>
      <dt>Unit</dt><dd><code>{meta.unit}</code></dd>
      <dt>ExecStart</dt><dd><code>{meta.exec}</code></dd>
      <dt>Ports</dt><dd>{meta.ports?.join(', ')}</dd>
    </dl>
    <!-- For routes: -->
    <dl>
      <dt>Method</dt><dd><code>{meta.method}</code></dd>
      <dt>Path</dt><dd><code>{meta.path}</code></dd>
      <dt>Handler</dt><dd><code>{meta.handler}</code></dd>
    </dl>
  </section>

  <!-- Work order links -->
  <section class="map-sidebar__work-orders" data-if="meta.relatedWOs">
    <h3>Related Work Orders</h3>
    <ul>
      <li><a href="...">WO-82: Device View Simple Wiring</a></li>
    </ul>
  </section>

  <!-- Imports list (for files) -->
  <section class="map-sidebar__imports" data-if="meta.imports">
    <h3>Imports ({meta.imports.length})</h3>
    <ul><!-- clickable links to navigate to the imported file node --></ul>
  </section>

  <!-- Imported By list -->
  <section class="map-sidebar__imported-by" data-if="meta.importedBy">
    <h3>Imported By ({meta.importedBy.length})</h3>
    <ul><!-- clickable links --></ul>
  </section>
</aside>
```

### 5.3 Sidebar animation

- Opens: slide in from right edge (300px width), 200ms ease-out.
- Closes: slide out to right, 150ms ease-in.
- On mobile/tablet: slides up from bottom (full width, 60% height).

---

## 6. CSS design specification

### 6.1 Global

```css
:root {
  --map-bg: #0f0f17;
  --map-surface: #1a1a2e;
  --map-text: #e2e8f0;
  --map-text-muted: rgba(226, 232, 240, 0.6);
  --map-border: rgba(255, 255, 255, 0.08);
  --map-accent: #8b5cf6;
  --map-font: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  --map-mono: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
  --map-radius: 12px;
  --map-card-radius: 10px;
  --map-transition: 200ms ease;
}

body {
  margin: 0;
  background: var(--map-bg);
  color: var(--map-text);
  font-family: var(--map-font);
  overflow: hidden;  /* map manages its own scroll */
}
```

### 6.2 Card styles

```css
.map-card {
  background: var(--card-bg);
  border: 1.5px solid var(--card-border);
  border-radius: var(--map-card-radius);
  padding: 16px;
  cursor: pointer;
  transition: transform var(--map-transition), box-shadow var(--map-transition), border-color var(--map-transition);
  display: flex;
  gap: 12px;
  align-items: flex-start;
  position: relative;
  overflow: hidden;
}

.map-card::before {
  /* Glassmorphism overlay */
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, rgba(255,255,255,0.04) 0%, transparent 50%);
  pointer-events: none;
}

.map-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3), 0 0 0 1px var(--card-border);
  border-color: color-mix(in srgb, var(--card-border) 100%, white 20%);
}

.map-card:focus-visible {
  outline: 2px solid var(--map-accent);
  outline-offset: 2px;
}

.map-card__icon {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  background: rgba(255, 255, 255, 0.06);
  flex-shrink: 0;
}

.map-card__label {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.3;
  color: var(--map-text);
}

.map-card__description {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--map-text-muted);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.map-card__child-count {
  font-size: 11px;
  color: var(--map-text-muted);
  margin-top: 6px;
  display: inline-block;
}
```

### 6.3 Animations

```css
/* Drill-in: cards leaving */
@keyframes map-drill-out {
  from { transform: scale(1); opacity: 1; }
  to   { transform: scale(0.92); opacity: 0; }
}

/* Drill-in: new cards entering */
@keyframes map-drill-in {
  from { transform: scale(1.06); opacity: 0; }
  to   { transform: scale(1); opacity: 1; }
}

/* Drill-out (going back up) */
@keyframes map-drill-back-out {
  from { transform: scale(1); opacity: 1; }
  to   { transform: scale(1.06); opacity: 0; }
}

@keyframes map-drill-back-in {
  from { transform: scale(0.92); opacity: 0; }
  to   { transform: scale(1); opacity: 1; }
}

.map-card--entering {
  animation: map-drill-in 300ms ease forwards;
}

.map-card--leaving {
  animation: map-drill-out 200ms ease forwards;
}

/* Loading spinner */
@keyframes map-spin {
  to { transform: rotate(360deg); }
}

.map-loading__spinner {
  width: 40px;
  height: 40px;
  border: 3px solid var(--map-border);
  border-top-color: var(--map-accent);
  border-radius: 50%;
  animation: map-spin 0.8s linear infinite;
}
```

---

## 7. MapExplorer class API

### 7.1 Constructor

```js
class MapExplorer {
  constructor(rootEl, dataUrl = 'assets/map-data.json') {
    this.rootEl = rootEl;
    this.dataUrl = dataUrl;
    this.data = null;           // parsed map-data.json
    this.currentNode = null;    // current focus node
    this.path = [];             // breadcrumb path (array of node references)
    this.historyStack = [];     // for back navigation
    this.sidebarNode = null;    // node shown in sidebar
  }

  async init()                  // load data, parse hash, render initial view
  renderLevel(node)             // render node's children as card grid
  drillInto(node)               // animate transition to node's children
  navigateToPath(pathIds)       // jump to a specific path (from hash or breadcrumb)
  navigateUp()                  // go up one level
  renderBreadcrumb()            // update breadcrumb bar
  showSidebar(node)             // open metadata sidebar for node
  hideSidebar()                 // close sidebar
  findNodeById(id, root)        // recursive find in tree
  findPathToNode(id, root)      // find path from root to node
  updateHash()                  // sync URL hash with current path
  handleHashChange()            // respond to popstate/hashchange
}
```

### 7.2 Rendering strategy

- **Only render direct children** of the current focus node (not grandchildren).
- Each card shows `children.length` as a badge to indicate drillability.
- Leaf nodes (no children) get a distinct visual treatment (no drill arrow, click opens sidebar).
- **Max cards per view**: if a node has > 100 children, paginate with "Show more" or virtual scroll.

---

## 8. Tasks

- [x] **T1** Create `client/map.html` with the HTML shell from §2.2.
- [x] **T2** Create `client/styles/map-explorer.css` with all styles from §6 (dark theme, card kinds, animations, sidebar, breadcrumb, loading spinner, responsive grid).
- [x] **T3** Create `client/components/map-explorer.js` — `MapExplorer` class scaffold with `init()`, data loading, loading spinner.
- [x] **T4** Implement `renderLevel(node)` — grid of card elements from node's children, with icons, labels, descriptions, child count badges.
- [x] **T5** Implement card click handler: if children exist → `drillInto(node)`, else → `showSidebar(node)`.
- [x] **T6** Implement `drillInto(node)` — animate-out current cards, replace grid, animate-in new cards (staggered), update breadcrumb.
- [x] **T7** Implement `renderBreadcrumb()` — clickable segments, root always visible, responsive collapse.
- [x] **T8** Implement breadcrumb click → `navigateToPath(pathIds)`.
- [x] **T9** Implement `navigateUp()` — Escape key, Backspace key, breadcrumb parent click.
- [x] **T10** Implement URL hash routing: `updateHash()`, `handleHashChange()`, initial load from hash.
- [x] **T11** Implement browser back/forward via `history.pushState` + `popstate` listener.
- [x] **T12** Implement `showSidebar(node)` — slide-in panel with all meta fields, conditional sections by kind.
- [x] **T13** Implement `hideSidebar()` — slide-out animation, close button, click-outside.
- [x] **T14** Implement sidebar "Imports" and "Imported By" sections with clickable links that navigate to the referenced node.
- [x] **T15** Implement sidebar "Related Work Orders" section.
- [x] **T16** Implement loading state: show spinner while `map-data.json` loads, fade in grid when ready.
- [x] **T17** Handle empty children gracefully: show "No children" message with appropriate icon.
- [x] **T18** Handle data load failure: show error message with retry button.
- [x] **T19** Verify: open `map.html` directly in browser (file:// or via Vite dev server), navigate through all layers, breadcrumbs work, back button works.
- [x] **T20** Responsive: test on 1920px, 1366px, 1024px, 768px viewports — cards reflow, sidebar adapts.

---

## 9. Acceptance criteria

1. `map.html` loads `map-data.json` and renders Layer 0 (Ubuntu's children) as a card grid.
2. Clicking "systemd" drills in to show all services; clicking a service shows its children.
3. Drill-down works through all 6 layers (OS → service → app → module → file → function).
4. Breadcrumb bar shows the full path; each segment is clickable.
5. Browser back/forward restores previous levels.
6. URL hash reflects current position; reloading with a hash navigates to that node.
7. Metadata sidebar opens on leaf-node click with all available meta fields.
8. Loading spinner shows during data fetch.
9. Dark theme is visually polished — glassmorphism cards, smooth animations, proper typography.
10. No horizontal scroll on any viewport ≥768px.

---

## Work Log

### 2026-06-29 — Initial Creation
**Work Done:**
- Created detailed sub-order for the core map viewer UI with full HTML structure, CSS design specification, card rendering rules, navigation system (drill/breadcrumb/hash/back), metadata sidebar design, and MapExplorer class API.
- 20 tasks.

**Instructions for Next Agent:**
- Start with T1–T3: create the HTML page, CSS file, and JS class scaffold.
- Use the static Layer 0–1 data from 83a to test — you don't need the full AST data to build and verify the viewer.
- The viewer must work with just `map-data.json` loaded via `fetch()` — no server-side rendering.

### 2026-06-29 — Completed WO-83d Viewer UI
**Work Done:**
- Implemented `map.html`, `map-explorer.css`, and `map-explorer.js`.
- Implemented card glassmorphic styling, icon mapping, and depth tracking.
- Navigation logic handles hash routes, back buttons, and drill down click interactions.
- Added animated sidebars for leaf nodes to view meta contents like systemd units or commands.

**Instructions for Next Agent:**
- Move back to `83b_WO_MAP_DATA_SERVER_MODULES.md` to populate the map with dynamic AST data.

---
*Work Order created: 2026-06-29 | Parent: [WO-83](./83_WO_INTERACTIVE_PROJECT_MAP.md)*
