# WO-86: Device View Routing Matrix

## Goal
Transform the Device View from purely visual node/wire layouts into a professional routing matrix (Dante / Excel style), allowing rapid, dense cross-point assignments.

## Requirements
1. **Terminology Update:** Rename the "Simple Wiring" toggle to "Node View".
2. **New Mode Toggle:** Introduce a "Matrix View" toggle.
3. **Matrix Layout:** 
   - Render a 2D grid.
   - Sources (e.g., Host channels, screen outputs) are listed vertically on the right side.
   - Sinks (e.g., Jacks, device inputs) are listed horizontally along the top.
   - Intersections represent routing cross-points.
4. **Interactive Routing:**
   - Active routes are indicated by a visual marker (e.g., a filled circle/check).
   - Clicking an empty intersection connects the source to the sink.
   - Clicking an active intersection disconnects the route.
5. **Hover Crosshairs:**
   - Hovering over any intersection must visually highlight the corresponding Source row and Sink column, creating a crosshair effect so users never lose their place in the dense grid.

## Sub-Orders / Phases
- **Phase A:** UI Toggles & Layout Shell
  - Rename Simple View.
  - Implement Matrix View toggle and conditional rendering of the canvas vs matrix container.
- **Phase B:** Data Extraction & Grid Rendering
  - Parse the current `lastPayload` for all available sources and sinks.
  - Render the HTML table/grid with headers on top and right.
- **Phase C:** Interactivity & Hover Guides
  - Implement click handlers to mutate `lastPayload.graph.edges`.
  - Implement CSS hover crosshairs.
