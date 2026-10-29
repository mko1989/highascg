# State of pixel mapping (29.10.2026)

**What you asked for:** select parts of a screen's output (for example a 100 × 200 px area of the
Dioda program) and map each area to one pixel of a lighting fixture (for example the first pixel of a
PixelLine), so the fixture becomes an extension of the screen. Each area is averaged to one colour.
Density matters: an LED wall pixel is cm/m apart, a fixture pixel is much larger, so the mapping has
to choose the area per fixture pixel, not per screen pixel.

## What exists today

| Piece | Where | State |
|---|---|---|
| **Native pixel-map screen** (WO-242, primary since 15.07) | Device View → destination "Pixel Map" → `src/config/config-generator-consumer-attach.js` (`buildPixelmapChannel`), `docs/ARTNET_PIXEL_MAPPING.md` | **Works.** Whole screen as a grid of fixtures (columns × rows, RGB or RGBW). One Caspar channel plus a native `<artnet>` consumer. Samples the whole raster; no region selection; no averaging per region; not tied to the lighting patch (MVR/GDTF). |
| **Legacy JS pixel-map engine** (WO-179, WO-438) | `src/sampling/` (`dmx-sampling.js`, `sampling-worker.js`, `fixture-transform.js`), `docs/WALKTHROUGH_PIXELMAP_FIXTURES.md` | **Code exists and has the feature you describe**: a sample rectangle per fixture, a `grid` of cols × rows cells, `sampleMode: "average"` (`averageRegion`, `fixture-transform.js:41`), gamma, brightness, colour order, rotation and mirror. Live-editable, no Caspar restart. **Off by default** (`src/config/defaults-core.js:110` `legacyJsPixelmap: false`; `config/ui.json:7`). **Deprecated** by WO-242. Its fixture UI is hidden behind the flag. |
| **Lighting patch / fixtures** (WO-30 tracking, WO-180 GDTF, follow engine) | `src/fixtures/` (`follow-patch.js`, `gdtf-*.js`, `artdmx.js`) | Knows each head's universe, address, pose and GDTF mode. PixelLine heads are in the MHP rig (for example the 18-head X-Dot line and the Pixel Line heads). **Nothing connects these fixtures to screen regions.** |
| **Godot client** | `godot/client/` | **No pixel-map UI at all.** No way to draw a region on the screen or pick a fixture pixel. |

## What is missing for your use case

1. **Regions on the screen, per fixture pixel.** Choose a rectangle of a channel's output and assign it
   to pixel N of a fixture (not a screen grid). The legacy engine has the sampling; the choice of region
   is per fixture, not per grid.
2. **Link to the lighting patch.** A region should target a fixture from the patch (its universe, start
   address, pixel count, colour order), not a manually typed start channel. The patch is in
   `src/fixtures/follow-patch.js`.
3. **A UI.** A preview of the screen where the operator draws the rectangles, and a list of fixture pixels
   mapped to them. Lives in Godot (the operator's client), not the deprecated web inspector.
4. **Averaging per region, per pixel,** on the live frame at the frame rate the output needs. The legacy
   engine already averages; it must be re-linked to the patch and run without the legacy flag.
5. **Output without a loopback.** ArtDMX goes out on the lighting network. On this box a broadcast on :6454
   loops into the box's own lighting input (see the Art-Net memory). Tests use 127.0.0.1:6455.

## Decision

The legacy sampling code already does averaging and region sampling. The clean path is to re-use its
sampler inside the patch-based stack (not revive the deprecated flag), add a region-to-pixel mapping on
the patch, and build the Godot UI. Work order: **WO-807** (`work/work-orders/807_WO_region_to_fixture_pixel_mapping.md`).

## Related

- `docs/ARTNET_PIXEL_MAPPING.md` (the landscape), `docs/WALKTHROUGH_ARTNET_LED_WALL.md` (the native LED wall)
- WO-179 (legacy sampling), WO-242 (native pixel-map screens), WO-438 (pixel-map destination test guide)
