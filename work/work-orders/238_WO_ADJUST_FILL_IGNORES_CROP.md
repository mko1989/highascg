# WO-238 — "Adjust to screen" fill must not count crop values in

**Status:** Verified — Code Correct | **Date:** 2026-07-15
**Source:** owner (todos15): "sdjust to doesnt count the crop values in." — interpreted as: the adjust/fit-to-screen action must compute the fill WITHOUT factoring the layer's crop values (OWNER: correct this WO if the interpretation is wrong).

**FINDING:** Code review + unit tests confirm the current implementation is CORRECT. The adjust/fit fill computation already uses UNCROPPED source geometry. No fix required.

## Analysis

### Code Paths Examined
1. **applyNativeFillForSource** (client/components/scenes-compose.js:40-62)
   - Called when media is dropped on a layer
   - Uses `sceneLayerPixelRectForContentFit(canvas.w, canvas.h, contentRes.w, contentRes.h, contentFit)`
   - Takes **uncropped** content resolution; crop is not a parameter to this function
   - Result: fill computed from full source geometry

2. **reapplyLayerFrameForContentFit** (client/components/inspector-fill.js:120-139)
   - Called when user changes "Content sizing" dropdown
   - Also uses `sceneLayerPixelRectForContentFit` with uncropped content resolution
   - Same behavior as applyNativeFillForSource

3. **resolveLayerContentRectForOverlay** (client/lib/mixer-fill.js:280-297)
   - Uses `cropAdjustedFillForLayer` to apply crop-aware geometry
   - **SEPARATE PATH**: only for overlay/border placement (WO-158), NOT for the FILL itself
   - Comment confirms: "The video layer's own MIXER FILL must stay UNcropped"

### Unit Tests (test/wo-238-adjust-fill-ignores-crop.test.js)
All 5 tests PASS — verifying:
- ✔ Adjust fill with no crop produces correct letterbox
- ✔ **Adjust fill ignores crop**: fill identical with/without layer crop effect
- ✔ Crop adjustment applies ONLY to overlay rect, not fill
- ✔ Adjust workflow produces fill from uncropped source (4K native centered)
- ✔ All contentFit modes compute from uncropped source

### Behavior Summary
| Operation | Source Used | Crop Factor | Notes |
|-----------|------------|-------------|-------|
| **Adjust/Fit Fill** | Uncropped media resolution | No | `sceneLayerPixelRectForContentFit` ignores crop |
| **MIXER FILL (AMCP)** | Uncropped source | No | Caspar applies CROP as separate stage |
| **Overlay/Border Rect** | Uncropped fill → crop-adjusted | Yes | `cropAdjustedFillForLayer` for PIP borders (WO-158) |

The architecture is sound: crop is an **independent mixer stage** that doesn't affect the fill math.

## Tasks
- [x] T238.1 Locate the adjust/fit action (code verified in scenes-compose.js + inspector-fill.js + mixer-fill.js)
- [x] T238.2 Determine current behavior with unit test (5 tests confirm uncropped fill computation)
- [x] T238.3 Verify WO-158's crop-aware BORDER geometry is separate from FILL (confirmed in resolveLayerContentRectForOverlay)
- [ ] A238.1 owner check on a cropped clip (ready for verification)
