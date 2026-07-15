# WO-241 — Art-Net & pixel-mapping capability docs + production walkthroughs

**Status:** Done (2026-07-15) | **Date:** 2026-07-15
**Source:** owner: "write for me new artnet and pixel mapping features and possibilities. what can we produce with it and how. create new files with walkthroughs"

## Deliverables (new files under docs/)
- [x] docs/ARTNET_PIXEL_MAPPING.md — the capability landscape after the WO-234 rebuild: the THREE engines (highascg JS live pipeline WO-179; native improved-artnet consumer with per-fixture regions + sws averaging; #1751 pixel consumer full-frame raster), what each is for, comparison table, current limits (native = config-file+restart; JS = live-editable), what productions are possible (LED walls, pixel tape, matrix/blinder walls, house-light sACN, floor grids, audience wristband-style effects from video content...).
- [x] docs/WALKTHROUGH_ARTNET_LED_WALL.md — end-to-end: video content → native artnet consumer regions (REAL config schema extracted from the built source) → universes/fixtures; plus the pixel-consumer variant for raw grid walls.
- [x] docs/WALKTHROUGH_PIXELMAP_FIXTURES.md — the highascg pixel-map editor flow (live-editable): fixtures, region sampling, sACN/Art-Net output, mirroring, rates — grounded in the actual UI (client/components/pixel-map-editor.js, WO-179).
- [x] Link all three from docs/ARCHITECTURE.md related-list.

## Rules
Every config example must be REAL: extract the artnet consumer's XML schema from /home/casparcg/caspar-build/src-tree/src/modules/artnet/ (parse code, cite file:line) and the pixel consumer's from its module; UI walkthrough steps verified against the current client code. Mark clearly what needs the caspar-config+restart vs what is live-editable. Honest NOT-YET sections (WO-228 hybrid, WO-180 GDTF) so possibilities vs shipped stays crisp.

## Work log
- 2026-07-15 — All three docs written from source ground truth (built tree `/home/casparcg/caspar-build/src-tree/src/modules/{artnet,pixel}/` + highascg `src/sampling|src/artnet|client/`); every schema element cited file:line. Features badged [LIVE-EDITABLE] / [CONFIG+CASPAR-RESTART] / [PLANNED]. ARCHITECTURE.md Related list links added. Honest findings recorded in the docs: config generator emits no `<artnet>`/`<pixel>` blocks (manual edit via the Device View config editor, lost on regen); JS Art-Net output clamped to universes 0-15 by dmxnet; `dmxState.addFixture()` currently has no UI caller (fixture creation via settings API/console; editing is full UI); JS region average strides at ≤64 samples/cell vs native SWS_AREA full box filter.
