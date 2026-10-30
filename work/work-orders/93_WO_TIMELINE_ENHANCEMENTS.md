# Work Order: Timeline Enhancements

**Area:** web-client
**Status: DONE (verified 30.10 by code check: timeline labels — rename in editor client/components/timeline-transport.js:265 and Sources browser Timeline tab client/components/sources-panel-helpers.js:192 (+ layer rename client/components/timeline-editor-handlers.js:427); clip drag to another layer client/components/timeline-canvas-pointer.js:241 (onMoveClip with target layer); layer reorder drag client/components/timeline-canvas-pointer.js:107,214 -> client/components/timeline-editor-handlers.js:376 -> client/lib/timeline-state.js:158 reorderLayer, layerHeights follow) — was: no status line**


## Overview
This work order outlines the required enhancements for timeline functionality, focusing on improving the user's ability to label, organize, and manage timeline layers and clips.

## Tasks

### 1. Timeline Labeling
*   **Requirement:** Users should be able to label timelines.
*   **Locations:**
    *   Timeline Editor interface.
    *   Sources Browser (Timeline tab).

### 2. Clip Re-assignment (Drag & Drop)
*   **Requirement:** Users should be able to grab a clip and drag it to another layer within the timeline.
*   **Functionality:**
    *   Enable drag-and-drop for clips between layers.
    *   Ensure the timeline state updates correctly after a drop.

### 3. Layer Reordering (Drag & Drop)
*   **Requirement:** Users should be able to grab and change the order of whole layers in the timeline.
*   **Functionality:**
    *   Enable drag-and-drop for entire layers (e.g., dragging layer headers/handles).
    *   Ensure the z-index/rendering order updates correctly based on the new layer order.
