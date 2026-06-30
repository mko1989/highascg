# WO-85 — Device View Simple Polish & Performance

> **⚠️ AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the **Work Log** section at the bottom documenting what was done.
> 2. Update task checkboxes to reflect current status.
> 3. Leave clear **Instructions for Next Agent** at the end of their log entry.
> 4. Do **NOT** delete previous agents' log entries.

**Status:** Not started
**Prerequisites:** None

## 1. Objective

Enhance the user experience of the new "Simple Wiring" mode in the Device View by improving its layout, distinctness of cable paths, and addressing performance issues in the standard wire view related to unoptimized background assets.

## 2. Investigation Findings

- **Performance (Standard Wire View):** The `client/assets/` folder contains very large, unoptimized background images (`highascgeyes.png` is 4.6MB, `highaseyesblue.png` is 3.1MB, and `logo.png` is ~1MB). Serving these large assets dynamically causes rendering lag and high memory consumption in the browser.
- **Simple View Layout:** Currently, `client/components/device-view-caspar-render-simple.js` outputs a `.device-view__simple-nodes-stack` which is locked to a single column (`flex-direction: column`) via `client/styles/09d-device-view-simple-wiring.css`.
- **Cable Routing:** `client/components/device-view-cables.js` draws cables using a deterministic loop algorithm. However, multiple cables terminating at the same node share the same exact terminal trajectory, making them run parallel and overlap. Furthermore, the color hashing can result in reused colors.

## 3. Implementation Plan

### Phase A: Asset Optimization (Performance)
The heavy background images must be compressed to significantly reduce network load and browser memory.
- Convert `highascgeyes.png`, `highaseyesblue.png`, and `logo.png` to highly optimized WebP files (or aggressively compress the PNGs if transparency requires it, though WebP supports transparency).
- Update the CSS/JS references in the Device View to point to the new, lighter `.webp` extensions.

### Phase B: Multi-Column Simple Layout
Transform the simple view from a tall, single-column stack into a dense 2-column or 3-column layout.
- Update `09d-device-view-simple-wiring.css` so `.device-view__simple-nodes-stack` uses `display: grid;` with `grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));` (or a similar multi-column approach).
- Ensure the categories (GPU, DeckLink, Stream, etc.) flow logically across the columns without breaking the internal alignment of the nodes.

### Phase C: Half-Star Cable Routing & Colors
Make it extremely easy to tell what is connected to what by fanning out the cables.
- **Half-Star Routing Algorithm:** In `device-view-cables.js`, when drawing the bezier/spline paths for simple view, detect if multiple cables share a destination coordinate. 
- Apply an angular offset (a "fanning" or "half-star" spread) to the final bezier control points leading into the terminal node. For example, if 3 lines connect to node X, they should approach from -30°, 0°, and +30° angles respectively, ensuring they never run closely parallel.
- **Color Distinctness:** The current `getCableColor` palette contains too many yellowish/brownish hues that bleed together. We will replace the palette with high-contrast, distinct colors (e.g., vibrant blue, magenta, emerald) and guarantee adjacent cables receive easily discernible hues.

---

## 4. Tasks

### Phase A
- `[ ]` **T1** Convert/compress the 3 large background assets to WebP.
- `[ ]` **T2** Update CSS/JS references to point to the optimized files.

### Phase B
- `[ ]` **T3** Refactor `.device-view__simple-nodes-stack` to use CSS Grid for 2 or 3 columns.
- `[ ]` **T4** Verify visual clarity of the new multi-column nodes layout.

### Phase C
- `[ ]` **T5** Implement convergence detection in the cable rendering loop to group cables sharing a destination.
- `[ ]` **T6** Apply radial angle offsets to the control points of converging cables to create the "half-star" spread shape.
- `[ ]` **T7** Ensure each cable within a converged group uses a distinctly visible color.

---

## Work Log

### 2026-06-29 — Initial Creation
**Work Done:**
- Created work order after investigating background image sizes and `device-view-caspar-render-simple.js` layout structures.
- Defined tasks for multi-column layout and half-star cable routing algorithm.

**Instructions for Next Agent:**
- Begin with Phase A by compressing the heavy PNG assets in `client/assets/` using ImageMagick or similar tools, and update their references. Then proceed to Phase B's layout adjustments in CSS.
---
*Work Order created: 2026-06-29 | Parent: None (Independent Feature Polish)*
