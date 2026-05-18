# Work order status (lightweight index)

**Note:** Per-WO checklists and specs live in `work/*_WO_*.md`.

## WO-33 — Device view (split)

| ID | File | Status | Last touch |
|----|------|--------|------------|
| 33 (parent) | [33_WO_DEVICE_VIEW_INDEX.md](./33_WO_DEVICE_VIEW_INDEX.md) | In progress | 2026-04-24 |
| 33a | [33a_WO_DEVICE_VIEW_DATA_MODEL_AND_API.md](./33a_WO_DEVICE_VIEW_DATA_MODEL_AND_API.md) | In progress | 2026-04-24 |
| 33b | [33b_WO_DEVICE_VIEW_HOST_ENUMERATION.md](./33b_WO_DEVICE_VIEW_HOST_ENUMERATION.md) | Draft | 2026-04-23 |
| 33c | [33c_WO_DEVICE_VIEW_CASPAR_BACKPLANE_UI.md](./33c_WO_DEVICE_VIEW_CASPAR_BACKPLANE_UI.md) | In progress | 2026-04-24 |
| 33d | [33d_WO_DEVICE_VIEW_PIXELHUE_CABLING.md](./33d_WO_DEVICE_VIEW_PIXELHUE_CABLING.md) | In progress | 2026-04-24 |
| 33e | [33e_WO_DEVICE_VIEW_EDID_MATCH_AND_APPLY.md](./33e_WO_DEVICE_VIEW_EDID_MATCH_AND_APPLY.md) | Draft | 2026-04-23 |
| 33f | [33f_WO_DEVICE_VIEW_SETTINGS_MIGRATION.md](./33f_WO_DEVICE_VIEW_SETTINGS_MIGRATION.md) | Draft | 2026-04-23 |
| 33g | [33g_WO_DEVICE_VIEW_QA_DOCS_ACCESSIBILITY.md](./33g_WO_DEVICE_VIEW_QA_DOCS_ACCESSIBILITY.md) | In progress | 2026-04-24 |

### WO-33 recent updates (2026-04-24)

- Expanded server PixelHue API coverage in `src/api/routes-pixelhue.js` and `src/pixelhue/client.js` to include:
  - screen ops (`take`, `cut`, `ftb`, `freeze`)
  - layer ops (`select`, `source`, `zorder`, `window`, `umd`, `layer-preset apply`)
  - read endpoints (`layer-presets`, `source-backup`)
  - firmware fallback for layer select (`/layers/select` -> `/screen/select`)
- Added frontend PixelHue service layer in `web/lib/pixelhue-api.js`.
- Added modular Device View PixelHue controls in `web/components/device-view-pixelhue-controls.js`:
  - global and per-screen controls
  - show preset apply to preview/program
  - layer select/source/z-order/window/UMD/style apply
  - source-backup read/write panel
- Added backend payload validation hardening for PixelHue write routes (`take`, `cut`, `preset-apply`, `source-backup`, plus existing layer array checks).
- Added smoke script `tools/smoke-pixelhue-validation.js` and npm script `smoke:pixelhue-validation`.
- Device View follow-up updates:
  - destination inspector now supports editable labels (names)
  - destination video mode now supports standard Caspar presets plus `custom` width/height/fps editing
  - destination main index is no longer hard-capped to 4 in Device View data model and channel intent mapping
  - added destination input/output node dots; destination input dot can be used as a cable endpoint
  - fixed cable cancellation and expanded connector-id resolution so output-to-input cabling works in more cases
- UX backlog note: cable rendering should support a natural hanging/gravity style (curved sag) for connected lines.

*Legacy link:* [33_WO_DEVICE_VIEW_CASPAR_AND_PIXELHUE.md](./33_WO_DEVICE_VIEW_CASPAR_AND_PIXELHUE.md) (redirects to index)

## WO-34 — Switcher-style bus transition rebuild

| ID | File | Status | Last touch |
|----|------|--------|------------|
| 34 | [34_WO_SWITCHER_BUS_TRANSITION_REBUILD.md](./34_WO_SWITCHER_BUS_TRANSITION_REBUILD.md) | Draft | 2026-04-25 |

### WO-34 initial scope (2026-04-25)

- New 3-channel per-screen architecture: `PGM bus`, `PRV bus`, `OUT` channel.
- Bus-level TAKE behavior for CUT/MIX (switcher-like transitions).
- Clip start policy matrix:
  - `restart_on_take`
  - `continue_from_prv`
  - `sync_with_pgm_same_layer`
- Migration + compatibility flag from legacy layer-transition model.

Update the table when a WO’s shipping state changes.

## WO-37 — Simulation Mode Placeholders (Preshow Prep)

| ID | File | Status | Last touch |
|----|------|--------|------------|
| 37 | [37_WO_SIMULATION_PLACEHOLDERS.md](./37_WO_SIMULATION_PLACEHOLDERS.md) | Not started | 2026-04-30 |

### WO-37 initial scope (2026-04-30)

- Add "Placeholders" tab to Sources Browser in simulation mode.
- Dropdown templates for generating virtual sources with specific resolutions/labels.
- Offline-only visibility (Simulation Mode).
