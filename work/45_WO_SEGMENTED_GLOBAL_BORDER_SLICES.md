# Work Order 45: Segmented Global Border (Multi-Slice Support)

## Objective
Expand the existing "Global Border" feature to support complex LED wall layouts. Instead of applying a single border to the entire output canvas, users should be able to define multiple "slices" (rectangles). Each slice will receive the same animated border effect independently, allowing for consistent visuals across non-contiguous surfaces like totems and main walls.

## Real-life Example
A display composed of:
- **Totem 1**: Left side (e.g., 0% to 11% width).
- **Main Wall**: Center (e.g., 11% to 89% width).
- **Totem 2 (Mirror)**: Right side (e.g., 89% to 100% width).
A "Global Border" should appear as three distinct boxes, one around each physical segment.

## Proposed Changes

### 1. Data Model & Config
- **File**: `src/config/defaults.js` (and persistence)
- **Change**: Extend the `globalBorder` object to include an optional `slices` array.
  ```javascript
  globalBorder: {
    enabled: false,
    type: 'pip_border',
    params: { ... },
    slices: [
      { x: 0, y: 0, w: 0.11, h: 1.0 }, // Totem 1
      { x: 0.11, y: 0, w: 0.78, h: 1.0 }, // Main
      { x: 0.89, y: 0, w: 0.11, h: 1.0 }  // Totem 2
    ]
  }
  ```

### 2. Backend Logic
- **File**: `src/engine/global-border.js`
- **Change**: Update `buildGlobalBorderCgJson` to include the `slices` array in the data sent to the CG template. Ensure backward compatibility if `slices` is empty (default to full canvas).

### 3. Template Update
- **File**: `template/pip_edge_strip.html`
- **Change**:
  - Update the `update` function to parse the `slices` array.
  - Modify `render()` to loop through `state.slices`.
  - For each slice, create a separate `.svg-container` and render the SVG border inside it.
  - Apply the same animation parameters (speed, color, thickness) to all slices to maintain a synchronized look.

### 4. UI / Inspector
- **File**: `web/components/inspector-panel-views.js` (or relevant border settings panel)
- **Change**: 
  - Add a "Slices" section in the Global Border settings.
  - Add a button to "Add Slice".
  - For each slice, show inputs for X, Y, Width, and Height (normalized 0-100%).
  - Provide a "Full Canvas" preset to quickly reset.

## Verification Plan

### Manual Verification
1. Open Global Border settings.
2. Enable a border type (e.g., Pulsing).
3. Add two slices (e.g., Left half and Right half).
4. Verify that two independent borders appear on the CasparCG output.
5. Change border color or speed and verify both slices update simultaneously.
6. Verify that clearing slices reverts to the standard full-canvas border.
