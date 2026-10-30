# PixelFlow -> HighAsCG Migration Breakdown

This breakdown is based on the extracted PixelFlow-facing code in `companion-module-pixelhue-switcher-main 2` and existing HighAsCG integration (`src/pixelhue`, `src/api/routes-pixelhue.js`, `client/lib/pixelhue-tandem.js`).

## 1) PixelFlow capability inventory (from extracted source)

Core transports and bootstrap:
- Device discovery: `/unico/v1/ucenter/device-list` (HTTPS `:19998`, insecure cert accepted)
- Session bootstrap: `/unico/v1/node/open-detail` + HS256 token from `sn` + `startTime`
- Model-aware endpoint map: P10/P20/P80/Q8/PF via `src/config/devices/*.ts`

Screen operations:
- Read screens: `GET /unico/v1/screen/list-detail`
- Switching: `PUT /unico/v1/screen/take`, `PUT /unico/v1/screen/cut`
- Program protection/state: `PUT /unico/v1/screen/ftb`, `PUT /unico/v1/screen/freeze`
- Layer selection alias used by firmware variants: `/unico/v1/screen/select` and `/unico/v1/layers/select`

Preset operations:
- Read presets: `GET /unico/v1/preset`
- Apply show preset: `POST /unico/v1/preset/apply`

Layer operations:
- Read layers: `GET /unico/v1/layers/list-detail`
- Route source to layer: `PUT /unico/v1/layers/source`
- Position/resize: `PUT /unico/v1/layers/window`
- Z-order: `PUT /unico/v1/layers/zorder`
- UMD metadata: `PUT /unico/v1/layers/umd`
- Layer style list/apply: `GET /unico/v1/layers/layer-preset/list-detail`, `PUT /unico/v1/layers/layer-preset/apply`

Input/system helpers:
- Read interfaces: `GET /unico/v1/interface/list-detail`
- Source backup read/write: `GET|PUT /unico/v1/system/ctrl/source-backup`

Realtime feedback:
- WebSocket stream at `wss://{host}:19998/unico/v1/ucenter/ws?client-type=8`
- TLV frame parsing and tag-based handlers (`WebSocketClient.ts`, `WebSocketHandling.ts`)

## 2) HighAsCG parity status (after this pass)

Already in HighAsCG before:
- Status, screens, presets, layers, interfaces
- take/cut/preset-apply
- generic `/api/pixelhue/proxy`

Added in this pass:
- `GET /api/pixelhue/layer-presets`
- `GET /api/pixelhue/source-backup`
- `POST /api/pixelhue/ftb`
- `POST /api/pixelhue/freeze`
- `POST /api/pixelhue/layer-select` (with fallback `layers/select` -> `screen/select`)
- `POST /api/pixelhue/layer-zorder`
- `POST /api/pixelhue/layer-window`
- `POST /api/pixelhue/layer-umd`
- `POST /api/pixelhue/layer-source`
- `POST /api/pixelhue/layer-preset-apply`
- `POST /api/pixelhue/source-backup`

## 3) Delivery phases to reach PixelFlow-like UX

Phase A - API parity (server) [DONE in this pass]
- Expand HighAsCG PixelHue server API to expose all major PixelFlow HTTP operations.
- Keep token/host details server-side only.

Phase B - Web client service layer
- Add `client/lib/pixelhue-api.js` wrappers for all `/api/pixelhue/*` endpoints.
- Add response normalizers for screen/layer/preset/interface lists.
- Centralize error mapping for firmware differences.

Phase C - PixelFlow feature UI panes
- Screens pane: take/cut/ftb/freeze controls per screen and global.
- Layers pane: select, source route, z-order, bounds, UMD edits.
- Layer style pane: browse/apply layer presets.
- Inputs/system pane: interfaces + source backup mode.

Phase D - Realtime state sync
- Implement server-side PixelHue WS client in `src/pixelhue/` (optional reconnect daemon).
- Broadcast normalized PixelHue events via existing HighAsCG WS channel.
- Update UI state stores for low-latency parity with PixelFlow app.

Phase E - Topology integration (Device View)
- Bind PixelHue screen/interface entities into device graph models.
- Use `routes-device-view` workflows to map destination/signal-chain to PixelHue route actions.
- Add safe dry-run + apply pipeline for PixelHue-linked cabling changes.

Phase F - QA and compatibility matrix
- Test matrix: P10/P20/P80/Q8/PF, plus firmware path variant coverage.
- Verify fallback behavior for `/layers/select` vs `/screen/select`.
- Add smoke tests for each new route and an integration script against a real switcher.

## 4) Immediate next implementation tasks

1. Add client wrappers in `client/lib` for new PixelHue endpoints.
2. Add PixelHue editor UI section (screens + layers basic controls) in Settings/Device View.
3. Add route-level validation (payload shape) on new endpoints to reduce bad writes.
4. Add automated smoke test script under `tools/` for endpoint sanity checks.

