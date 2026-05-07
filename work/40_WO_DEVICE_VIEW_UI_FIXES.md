# Work Order 40: Device View UI Enhancements

## Goal
Improve the visual clarity and interaction of cables and connectors in the Device View.

## Requirements

### 1. Node Connectors (Processors, Inputs, etc.)
- **Positioning**: The node dot (cable anchor) should be on the right edge of the box.
- **Plus Icon**: Add a `+` button to the LEFT of the node dot.
- **Functionality**: Clicking the `+` starts a new cable from that node.

### 2. Rear View Connectors (DeckLink, etc.)
- **Anchor Point**: Cables should start/end at the CENTER of the SVG connector image.
- **Anchor Style**: Remove the visible "node dot" for these connectors; the cable should terminate directly at the image center.
- **Plus Icon**: Add a `+` button OUTSIDE the connector image (next to it).
- **Functionality**: Clicking the `+` starts a new cable.

### 3. General Enhancements
- **Cable Colors**: Ensure a more diverse color palette to avoid similarity (DONE in WO-33, but verify).
- **Z-Order**: Ensure `+` buttons are always clickable and not obscured by cables.

## Implementation Plan

### Phase 1: CSS Updates
- Adjust `.device-view__connector-dot` and `.device-view__connector-plus` positioning.
- Use flexbox or absolute positioning to align `+` and `dot`.

### Phase 2: Render Updates
- **`device-view-bands-render.js`**: Update how processor/input nodes are rendered.
- **`device-view-helpers.js`**: Update `connectorCenter` to prefer the image center for physical ports.
- **`device-view-connector-actions.js`**: Ensure `+` buttons are correctly placed for physical ports.

### Phase 3: Scaling & Scrolling (WO-33 Follow-up)
- [x] Implement non-linear scaling for huge destinations.
- [x] Add overflow scrolling to destination layout.
- [x] Ensure cables re-render on scroll.

## Verification
- Check large destinations (e.g. 10000px) fit and scroll.
- Check cables connect to centers of DeckLink ports.
- Check `+` buttons work for starting cables.
