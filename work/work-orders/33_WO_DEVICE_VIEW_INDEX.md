# WO-33 — Device view (program): index & dependency order

**Program goal:** Visual “back of rack” for **Caspar host** + optional **PixelHue**, click-to-inspect ports, cable graph, EDID/timing awareness, and **Caspar config write + restart** via existing APIs.

**Status:** Parent index — child WOs carry task checklists.  
**Created:** 2026-04-23 · **Updated:** 2026-05-18 (added WO-48, WO-49)

---

## Child work orders (execute in order unless noted)

| ID | Document | Topic | Depends on |
|----|----------|--------|------------|
| **33a** | [33a_WO_DEVICE_VIEW_DATA_MODEL_AND_API.md](./33a_WO_DEVICE_VIEW_DATA_MODEL_AND_API.md) | `DeviceGraph` schema, persistence, REST, tandem sync | — |
| **33b** | [33b_WO_DEVICE_VIEW_HOST_ENUMERATION.md](./33b_WO_DEVICE_VIEW_HOST_ENUMERATION.md) | GPU, DeckLink, audio discovery; align with generator | 33a (types for `live` snapshot) |
| **33c** | [33c_WO_DEVICE_VIEW_CASPAR_BACKPLANE_UI.md](./33c_WO_DEVICE_VIEW_CASPAR_BACKPLANE_UI.md) | Web: Caspar back SVG, entry point, inspector shell | 33a, 33b |
| **33d** | [33d_WO_DEVICE_VIEW_PIXELHUE_CABLING.md](./33d_WO_DEVICE_VIEW_PIXELHUE_CABLING.md) | PH device card, visual cable tool (select connector → cable icon → target), edges Caspar→PH, bind layer | 33a, 33c (canvas); PH API exists |
| **33e** | [33e_WO_DEVICE_VIEW_EDID_MATCH_AND_APPLY.md](./33e_WO_DEVICE_VIEW_EDID_MATCH_AND_APPLY.md) | Match/warn/suggest; wire apply/restart in inspector | 33c; 33d for PH-sourced timing |
| **33f** | [33f_WO_DEVICE_VIEW_SETTINGS_MIGRATION.md](./33f_WO_DEVICE_VIEW_SETTINGS_MIGRATION.md) | What moves from Settings; deep links; deprecation | 33c+ (after core UX) |
| **33g** | [33g_WO_DEVICE_VIEW_QA_DOCS_ACCESSIBILITY.md](./33g_WO_DEVICE_VIEW_QA_DOCS_ACCESSIBILITY.md) | Test matrix, a11y, operator notes | All prior for full pass |
| **33h** | [18_WO_OUTPUT_SLICER.md](./18_WO_OUTPUT_SLICER.md) | Pixel Mapping Node & Slicer (Video/DMX) | 33a, 33c |
| **40** | [40_WO_DEVICE_VIEW_GPU_XRANDR_SCREEN_DEST_SYNC.md](./40_WO_DEVICE_VIEW_GPU_XRANDR_SCREEN_DEST_SYNC.md) | GPU `xrandr` mode/pos from bound **screen destinations**; Override path; multi-head retile | 33a, 33b, 35; design: [docs/GPU_SCREEN_CONSUMER_AND_XRANDR.md](./docs/GPU_SCREEN_CONSUMER_AND_XRANDR.md) |
| **40a** | [40a_WO_PIXEL_MAP_GPU_XRANDR_CASPAR_ALIGNMENT.md](./40a_WO_PIXEL_MAP_GPU_XRANDR_CASPAR_ALIGNMENT.md) | **`pixel_map_out` → `gpu_out`**: per-head signal, bbox vs destination-only heads, inherited canvas modes, Caspar window alignment | 40, 33h, 33a |
| **42** | [42_WO_SOURCES_LIVE_THUMBNAILS_AND_MEDIA_THUMB_FOLDER.md](./42_WO_SOURCES_LIVE_THUMBNAILS_AND_MEDIA_THUMB_FOLDER.md) | Sources **Live** tab list thumbnails (wait-for-play on any ch/layer, one-shot + manual reload); PRINT/HQ clutter → hidden media subfolder | 33a (extra live sources); touches web + `live-thumbnail-cache` |
| **48** | [48_WO_LAYER_ROUTE_LIVE_SOURCE_REUSE.md](./48_WO_LAYER_ROUTE_LIVE_SOURCE_REUSE.md) | Scene layer row → **`addExtraLiveSource`** with `route://ch-layer` so Sources **Live** can reuse one playing layer (PIPs / second screen) without duplicating media | 33a (`POST /api/device-view`); relates to [WO-46](./46_WO_LAYER_PLAYLISTS.md) |
| **49** | [49_WO_DEVICE_WIDE_SNAPSHOT_AND_MACHINE_PROFILE.md](./49_WO_DEVICE_WIDE_SNAPSHOT_AND_MACHINE_PROFILE.md) | **Device-wide snapshot:** one JSON **machine profile** (device graph + GPU / DeckLink–relevant settings), **save prompts for device name**, embed **rear-panel visual**; bundled generics + manual JSON drops (no submit UI) | 33a, 33c; aligns with [WO-39](./39_WO_SETTINGS_SYSTEM_HARDWARE.md), [WO-40](./40_WO_DEVICE_VIEW_GPU_XRANDR_SCREEN_DEST_SYNC.md) |

**Suggested release slices**

- **MVP-1 (internal):** 33a + 33b + 33c (Caspar-only device view, live + saved graph, inspector stub).
- **MVP-2:** + 33d + 33e (PixelHue + EDID + apply).
- **Hardening:** 33f + 33g.

---

## North-star (unchanged from original WO-33)

- **One bus, one “layer” of meaning on the switcher** for stacked PGM clips — do not create extra PixelHue layers for stacked media; cables map **buses/outputs to PH inputs and layers** per [tandem-topology] design.
- **Do not** fork Caspar apply/restart — always go through `POST /api/caspar-config/apply` (or documented successor).

---

## Open questions (program-level)

1. **Nav:** top-level “Devices” vs tab inside Settings — decide before 33c ships.
2. **Multi-Caspar** hosts — out of scope for v1 unless product reverses.
3. **PixelHue embed iframe** — optional experiment in 33d/33f, not default.

---

## Obsolete file name

The original monolith `33_WO_DEVICE_VIEW_CASPAR_AND_PIXELHUE.md` is **replaced** by this index + 33a–33g. If an old link points to the old name, add a one-line redirect note or symlink in git (optional).

*End of WO-33 index*
