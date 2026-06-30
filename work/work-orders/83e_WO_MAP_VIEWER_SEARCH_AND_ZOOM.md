# WO-83e — Map viewer: full-text search, pan/zoom, minimap, keyboard navigation

> **⚠️ AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the **Work Log** section at the bottom documenting what was done.
> 2. Update task checkboxes to reflect current status.
> 3. Leave clear **Instructions for Next Agent** at the end of their log entry.
> 4. Do **NOT** delete previous agents' log entries.

**Parent:** [WO-83 index](./83_WO_INTERACTIVE_PROJECT_MAP.md)  
**Status:** Not started  
**Prerequisites:** 83d (core viewer with `MapExplorer` class)

---

## 1. Objective

Add three discovery/interaction features to the map viewer:
1. **Full-text search overlay** — Ctrl+K / Cmd+K opens a command-palette style search across all nodes by label, description, file path, and function name.
2. **Pan & zoom** — scroll-to-zoom and drag-to-pan when a level has many cards (or when the user wants an overview).
3. **Minimap** — small corner overview showing the current viewport position relative to the full grid.
4. **Keyboard navigation** — arrow keys, Enter, Escape for hands-free browsing.

---

## 2. Full-text search

### 2.1 Search index

Build an in-memory search index when `map-data.json` loads:

```js
class SearchIndex {
  constructor(rootNode) {
    this.entries = [];  // flat list of { node, path, searchText }
    this._buildIndex(rootNode, []);
  }

  _buildIndex(node, parentPath) {
    const path = [...parentPath, node];
    const searchText = [
      node.label,
      node.description || '',
      node.meta?.path || '',
      node.meta?.name || '',
      node.meta?.unit || '',
      node.id,
    ].join(' ').toLowerCase();

    this.entries.push({ node, path, searchText });

    if (node.children) {
      for (const child of node.children) {
        this._buildIndex(child, path);
      }
    }
  }

  search(query, limit = 50) {
    const q = query.toLowerCase().trim();
    if (!q) return [];

    const terms = q.split(/\s+/);
    const results = [];

    for (const entry of this.entries) {
      const allMatch = terms.every(t => entry.searchText.includes(t));
      if (allMatch) {
        // Score: exact label match > label starts-with > label contains > description contains
        let score = 0;
        const labelLower = entry.node.label.toLowerCase();
        if (labelLower === q) score = 100;
        else if (labelLower.startsWith(q)) score = 80;
        else if (labelLower.includes(q)) score = 60;
        else score = 40;

        // Boost file/function nodes (more specific = more useful)
        if (entry.node.kind === 'function') score += 5;
        if (entry.node.kind === 'file') score += 3;
        if (entry.node.kind === 'route') score += 4;

        results.push({ ...entry, score });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }
}
```

### 2.2 Search overlay UI

Design: **command palette** (similar to VS Code's Ctrl+K, GitHub's /, Spotlight):

```html
<dialog id="map-search-overlay" class="map-search">
  <div class="map-search__container">
    <div class="map-search__input-row">
      <span class="map-search__icon">🔍</span>
      <input id="map-search-input" type="text" placeholder="Search nodes, files, functions, routes…"
             autocomplete="off" spellcheck="false" autofocus>
      <kbd class="map-search__shortcut">Esc</kbd>
    </div>
    <div id="map-search-results" class="map-search__results" role="listbox">
      <!-- search results rendered here -->
    </div>
    <footer class="map-search__footer">
      <span><kbd>↑↓</kbd> Navigate</span>
      <span><kbd>Enter</kbd> Go to node</span>
      <span><kbd>Esc</kbd> Close</span>
    </footer>
  </div>
</dialog>
```

### 2.3 Search result item

```html
<div class="map-search__result" role="option" data-index="0">
  <span class="map-search__result-icon">{icon}</span>
  <div class="map-search__result-content">
    <span class="map-search__result-label">{label}</span>
    <span class="map-search__result-path">{breadcrumb path}</span>
  </div>
  <span class="map-search__result-kind">{kind}</span>
</div>
```

### 2.4 Search interaction

| Action | Behavior |
|--------|----------|
| `Ctrl+K` / `Cmd+K` | Open search overlay |
| Type query | Debounce 100ms, then search and render results |
| `↑` / `↓` | Move highlight through results |
| `Enter` | Navigate to highlighted result (close overlay, drill to node, show breadcrumb) |
| `Escape` | Close search overlay |
| Click result | Same as Enter |
| Click backdrop | Close search overlay |

### 2.5 Search styles

```css
.map-search {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 15vh;
  border: none;
}

.map-search__container {
  width: min(600px, 90vw);
  max-height: 70vh;
  background: #1a1a2e;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 16px;
  box-shadow: 0 24px 48px rgba(0, 0, 0, 0.5);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.map-search__input-row {
  display: flex;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  gap: 12px;
}

.map-search__input-row input {
  flex: 1;
  background: transparent;
  border: none;
  color: var(--map-text);
  font-size: 16px;
  font-family: var(--map-font);
  outline: none;
}

.map-search__results {
  overflow-y: auto;
  max-height: 50vh;
  padding: 8px;
}

.map-search__result {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 100ms;
}

.map-search__result:hover,
.map-search__result--active {
  background: rgba(139, 92, 246, 0.15);
}

.map-search__result-label {
  font-weight: 600;
  font-size: 14px;
}

.map-search__result-path {
  font-size: 11px;
  color: var(--map-text-muted);
  display: block;
}

.map-search__result-kind {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--map-text-muted);
  padding: 2px 6px;
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 4px;
  flex-shrink: 0;
}

.map-search__footer {
  display: flex;
  gap: 16px;
  padding: 10px 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  font-size: 11px;
  color: var(--map-text-muted);
}

.map-search__footer kbd {
  background: rgba(255, 255, 255, 0.08);
  padding: 1px 5px;
  border-radius: 3px;
  font-family: var(--map-font);
  font-size: 10px;
}
```

### 2.6 Match highlighting

When rendering search results, wrap matched substrings in `<mark class="map-search__highlight">`:

```css
.map-search__highlight {
  background: rgba(250, 204, 21, 0.25);
  color: #fef08a;
  border-radius: 2px;
  padding: 0 1px;
}
```

---

## 3. Pan & zoom

### 3.1 Implementation approach

Use CSS `transform: scale(S) translate(Tx, Ty)` on the `#map-grid` container.

```js
class PanZoom {
  constructor(viewportEl, gridEl) {
    this.viewport = viewportEl;
    this.grid = gridEl;
    this.scale = 1;
    this.translateX = 0;
    this.translateY = 0;
    this.minScale = 0.3;
    this.maxScale = 3;
    this.isPanning = false;
    this.startX = 0;
    this.startY = 0;
  }

  // Scroll wheel → zoom (centered on cursor position)
  handleWheel(e) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newScale = Math.max(this.minScale, Math.min(this.maxScale, this.scale * delta));

    // Zoom toward cursor position
    const rect = this.viewport.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const ratio = newScale / this.scale;
    this.translateX = cx - ratio * (cx - this.translateX);
    this.translateY = cy - ratio * (cy - this.translateY);
    this.scale = newScale;

    this.applyTransform();
  }

  // Mouse drag → pan
  handleMouseDown(e) {
    if (e.target.closest('.map-card')) return; // don't pan when clicking cards
    this.isPanning = true;
    this.startX = e.clientX - this.translateX;
    this.startY = e.clientY - this.translateY;
    this.grid.style.cursor = 'grabbing';
  }

  handleMouseMove(e) {
    if (!this.isPanning) return;
    this.translateX = e.clientX - this.startX;
    this.translateY = e.clientY - this.startY;
    this.applyTransform();
  }

  handleMouseUp() {
    this.isPanning = false;
    this.grid.style.cursor = '';
  }

  // Pinch-to-zoom (touch)
  handleTouchStart(e) { /* ... */ }
  handleTouchMove(e) { /* ... */ }

  // Reset to default view
  resetView() {
    this.scale = 1;
    this.translateX = 0;
    this.translateY = 0;
    this.applyTransform();
  }

  applyTransform() {
    this.grid.style.transform = `translate(${this.translateX}px, ${this.translateY}px) scale(${this.scale})`;
    this.grid.style.transformOrigin = '0 0';
    // Notify minimap
    this.onViewportChange?.();
  }
}
```

### 3.2 Zoom controls (floating)

```html
<div class="map-zoom-controls">
  <button class="map-zoom-btn" id="map-zoom-in" title="Zoom in">+</button>
  <button class="map-zoom-btn" id="map-zoom-reset" title="Reset zoom">⟳</button>
  <button class="map-zoom-btn" id="map-zoom-out" title="Zoom out">−</button>
  <span class="map-zoom-level" id="map-zoom-level">100%</span>
</div>
```

Position: bottom-right corner, vertically stacked, with glassmorphism background.

---

## 4. Minimap

### 4.1 Design

A small (180×120px) overview rectangle in the bottom-left corner showing:
- All card positions as colored dots (color = kind)
- A viewport rectangle showing the current visible area
- Click on minimap to jump to that area

### 4.2 Implementation

```js
class Minimap {
  constructor(containerEl, explorerInstance) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 180;
    this.canvas.height = 120;
    this.canvas.className = 'map-minimap__canvas';
    containerEl.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.explorer = explorerInstance;
  }

  render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, 180, 120);

    // Background
    ctx.fillStyle = 'rgba(15, 15, 23, 0.85)';
    ctx.fillRect(0, 0, 180, 120);

    // Draw each card as a small dot
    const cards = this.explorer.currentCards;
    if (!cards.length) return;

    const gridBounds = this.explorer.getGridBounds();
    const scaleX = 170 / gridBounds.width;
    const scaleY = 110 / gridBounds.height;
    const scale = Math.min(scaleX, scaleY);

    for (const card of cards) {
      const x = 5 + (card.x - gridBounds.x) * scale;
      const y = 5 + (card.y - gridBounds.y) * scale;
      ctx.fillStyle = KIND_COLORS[card.kind] || '#666';
      ctx.fillRect(x, y, 4, 3);
    }

    // Draw viewport rectangle
    const vp = this.explorer.getViewportBounds();
    ctx.strokeStyle = '#8b5cf6';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(
      5 + (vp.x - gridBounds.x) * scale,
      5 + (vp.y - gridBounds.y) * scale,
      vp.width * scale,
      vp.height * scale
    );
  }
}
```

### 4.3 Styles

```css
.map-minimap {
  position: fixed;
  bottom: 20px;
  left: 20px;
  width: 180px;
  height: 120px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  overflow: hidden;
  z-index: 100;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
  backdrop-filter: blur(8px);
  cursor: pointer;
  transition: opacity 200ms;
}

.map-minimap:hover {
  border-color: var(--map-accent);
}

/* Hide minimap when zoom is 100% (default view) */
.map-minimap--hidden {
  opacity: 0;
  pointer-events: none;
}
```

---

## 5. Keyboard navigation

### 5.1 Key bindings

| Key | Context | Action |
|-----|---------|--------|
| `Ctrl+K` / `Cmd+K` | Any | Open search overlay |
| `Escape` | Search open | Close search |
| `Escape` | Sidebar open | Close sidebar |
| `Escape` | Grid focused | Navigate up one level |
| `Backspace` | Grid focused (no input) | Navigate up one level |
| `Enter` | Card focused | Drill into focused card |
| `Space` | Card focused | Open sidebar for focused card |
| `→` / `ArrowRight` | Grid | Focus next card |
| `←` / `ArrowLeft` | Grid | Focus previous card |
| `↓` / `ArrowDown` | Grid | Focus card in next row |
| `↑` / `ArrowUp` | Grid | Focus card in previous row |
| `Home` | Grid | Focus first card |
| `End` | Grid | Focus last card |
| `+` / `=` | Grid | Zoom in |
| `-` | Grid | Zoom out |
| `0` | Grid | Reset zoom |

### 5.2 Focus management

- When a level is rendered, focus the first card.
- Tab key moves between header controls and the grid area.
- Cards use `tabindex="0"` and `:focus-visible` styling.
- Arrow key navigation calculates grid columns from the container width and card width to determine row jumps.

```js
handleArrowNavigation(direction) {
  const cards = [...this.grid.querySelectorAll('.map-card')];
  const focused = document.activeElement;
  const currentIndex = cards.indexOf(focused);
  if (currentIndex === -1) { cards[0]?.focus(); return; }

  const cols = Math.floor(this.grid.clientWidth / (cards[0]?.offsetWidth + gap));
  let nextIndex;

  switch (direction) {
    case 'right': nextIndex = Math.min(currentIndex + 1, cards.length - 1); break;
    case 'left':  nextIndex = Math.max(currentIndex - 1, 0); break;
    case 'down':  nextIndex = Math.min(currentIndex + cols, cards.length - 1); break;
    case 'up':    nextIndex = Math.max(currentIndex - cols, 0); break;
  }

  cards[nextIndex]?.focus();
  cards[nextIndex]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
```

---

## 6. Tasks

### Phase A: Search overlay

- [ ] **T1** Add search `<dialog>` HTML to `map.html`.
- [ ] **T2** Implement `SearchIndex` class — build flat index from tree, multi-term fuzzy search with scoring.
- [ ] **T3** Implement search overlay open/close: Ctrl+K / Cmd+K trigger, Escape close, backdrop click close.
- [ ] **T4** Implement debounced search-as-you-type (100ms debounce) with result rendering.
- [ ] **T5** Implement keyboard navigation in results: ↑/↓ to move highlight, Enter to select.
- [ ] **T6** Implement match highlighting in result labels (`<mark>` tags).
- [ ] **T7** Implement result selection: close overlay, navigate to node path, expand breadcrumb.
- [ ] **T8** Style the search overlay per §2.5 CSS spec.

### Phase B: Pan & zoom

- [ ] **T9** Implement `PanZoom` class per §3.1 — scroll-to-zoom, drag-to-pan, pinch-to-zoom.
- [ ] **T10** Add floating zoom controls (+ / ⟳ / − / level indicator) per §3.2.
- [ ] **T11** Wire zoom controls: button click → scale change, display current zoom %.
- [ ] **T12** Reset zoom on drill-down / drill-up (each new level starts at 100%).
- [ ] **T13** Ensure card click still works at non-100% zoom (transform coordinate mapping).
- [ ] **T14** Style zoom controls with glassmorphism.

### Phase C: Minimap

- [ ] **T15** Implement `Minimap` class per §4 — canvas rendering, kind-colored dots, viewport rectangle.
- [ ] **T16** Add minimap container to `map.html`.
- [ ] **T17** Update minimap on pan/zoom and on level change.
- [ ] **T18** Click-on-minimap → jump viewport to that position.
- [ ] **T19** Show/hide minimap: visible only when zoomed or when grid overflows viewport.

### Phase D: Keyboard navigation

- [ ] **T20** Implement arrow key grid navigation per §5.2 (right/left/down/up with column-aware row jumps).
- [ ] **T21** Implement Enter = drill in, Space = show sidebar, Escape = go up.
- [ ] **T22** Implement Home/End for first/last card focus.
- [ ] **T23** Implement +/−/0 for zoom control from keyboard.
- [ ] **T24** Add ARIA attributes: `role="tree"`, `role="treeitem"`, `aria-expanded`, `aria-level`.

### Phase E: Integration & testing

- [ ] **T25** Wire SearchIndex build into MapExplorer `init()`.
- [ ] **T26** Wire PanZoom into the viewport element.
- [ ] **T27** Verify: Ctrl+K opens search, typing "scene-take" finds the file node, Enter navigates to it with full breadcrumb.
- [ ] **T28** Verify: scroll-to-zoom works, drag-to-pan works, pinch-to-zoom works on tablet.
- [ ] **T29** Verify: arrow keys navigate cards, Enter drills in, Escape goes back.

---

## 7. Acceptance criteria

1. Ctrl+K / Cmd+K opens a search overlay with a text input.
2. Typing a query shows results within 200ms, scored by relevance.
3. Selecting a search result navigates directly to that node at any depth.
4. Scroll-to-zoom changes scale smoothly; drag-to-pan moves the grid.
5. Zoom controls show current zoom level; reset button returns to 100%.
6. Minimap appears when zoomed; shows viewport rectangle; click-to-jump works.
7. Arrow keys navigate between cards in the grid; Enter drills in; Escape goes up.
8. Search works with multi-word queries (e.g., "scene take engine" finds `scene-take.js` in `src/engine/`).
9. All interactions work on tablet with touch (pinch-to-zoom, tap, swipe search results).

---

## Work Log

### 2026-06-29 — Initial Creation
**Work Done:**
- Created sub-order for search overlay (command palette), pan/zoom (CSS transform), minimap (canvas), and keyboard navigation.
- Full CSS specs, class APIs, key bindings.
- 29 tasks across 5 phases.

**Instructions for Next Agent:**
- Ensure 83d (core viewer) is functional first.
- Start with Phase A (search) — most impactful feature.
- Pan/zoom (Phase B) is important when there are many nodes at one level (e.g., `src/api/` has 70 files).

---
*Work Order created: 2026-06-29 | Parent: [WO-83](./83_WO_INTERACTIVE_PROJECT_MAP.md)*
