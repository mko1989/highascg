# PiP Overlay Architecture

This document describes how HighAsCG handles HTML-based overlays (borders, glows, shadows) on Picture-in-Picture (PiP) layers.

## The Challenge
CasparCG `MIXER FILL` commands typically align a video layer (e.g., Layer 10) to a specific screen region. If an HTML overlay (e.g., Layer 11) is placed exactly on top with the same `FILL`, any effect drawn "outside" the HTML frame is clipped by the layer's boundaries.

## The Solution: Layer Expansion

To allow for "outside" borders, HighAsCG performs a coordinate transformation:

1.  **Expansion:** The engine calculates a larger `MIXER FILL` for the graphics layer. The expansion amount (in pixels) is derived from the effect's parameters (e.g., border width).
2.  **Mapping:** The engine translates the original video coordinates into the expanded layer's coordinate system. This is passed to the HTML template as the `inner` rectangle.
3.  **Rendering:** The HTML template uses `inner` to place a frame that exactly matches the video PiP's position, but it now has "margin" space within its own layer to draw effects outward.

### Coordinate Math
If the video is at `(vx, vy)` with scale `(vw, vh)` and we want a border of `b` pixels:
- `ox = b / channelWidth`
- `layerX = vx - ox`
- `layerW = vw + 2 * ox`
- `inner.l = ox / layerW`

## Template Implementation
The templates (e.g., `pip_border.html`) use the following CSS strategy for outside borders:
- `box-sizing: content-box`
- `border: {width}px ...`
- `margin: -{width}px`

This "pulls" the expanded border back so its inner edge aligns with the video edge, while the border itself grows into the expanded margin of the CasparCG layer.

## PiP Router
To optimize performance, HighAsCG can combine multiple overlays into a single layer using `pip_router.html`. This router iterates through a stack of effects and applies the same coordinate logic to each, reducing AMCP overhead and improving sync.

## Common Pitfalls
- **Resolution Mismatch:** If the engine's channel resolution (e.g., 1080p) doesn't match CasparCG's actual output, the pixel-to-normalized conversion will be slightly off, causing the border to overlap or gap.
- **Z-Order:** Overlays are placed on layers `p + 1`, `p + 2`, etc., where `p` is the video layer. The router always uses `p + 1`.
