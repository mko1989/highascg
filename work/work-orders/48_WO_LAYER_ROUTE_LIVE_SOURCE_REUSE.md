# Work Order 48: Layer route as reusable Live source (resource saving)

## Objective

Let operators **publish a single playing layer** (e.g. channel 1, layer 10) as a **Caspar route consumer** (`route://channel-layer`) and **reuse that picture** anywhere the product already accepts route sources (other scene layers, multiview cells, second screen), **without** duplicating the same playlist/media fill on multiple layers.

**Primary use case:** One widescreen with several PIPs showing the **same** ad rotation, plus the same picture on a **second display** — build the list once on the “authoring” PIP layer, then **route** it into the other placements.

## Relationship to existing work

| Work | Relationship |
|------|----------------|
| **[WO-46](./46_WO_LAYER_PLAYLISTS.md)** | List workflow on one layer is the natural **publisher** for a layer route; this WO does not change playlist semantics. |
| **[WO-42](./42_WO_SOURCES_LIVE_THUMBNAILS_AND_MEDIA_THUMB_FOLDER.md)** | Live tab tiles and optional `thumbnailChannel` / per-source thumbs may need awareness of **`routeType: layer`** (or equivalent) later; v1 can reuse generic route handling. |
| **[WO-33 index](./33_WO_DEVICE_VIEW_INDEX.md)** | **`extraLiveSources`** persistence goes through **`POST /api/device-view`** (`addExtraLiveSource` / `removeExtraLiveSource`) — same mechanism as Device View / live input flows. |

## UI/UX requirements

1. **Layers list control (scene composer)**  
   On each row in the scene **layer strip** (same list as layer number, copy/paste style, remove — see [`web/components/scene-layer-row.js`](../web/components/scene-layer-row.js)), add a **small icon button** (e.g. **arrow / “route out”**) with tooltip: **“Add this layer as a Live route (reuse picture without duplicating media).”**

2. **Sources → Live tab**  
   On success, the operator sees a **new draggable tile** under **Sources → Live** alongside Program / Preview / DeckLink routes. Default label: **`Route: Ch{N} L{M}`** (exact copy bikeshed OK; may include scene name if cheaply available).

3. **Feedback**  
   Toast or inline confirmation: **“Added to Live sources”**. If the same `value` already exists, **upsert** (replace label/metadata) per existing dedupe rules — message should not imply failure. **Modifiers on ↗:** **Shift+click** adds a route on the **PGM** bus for the look’s main; **Ctrl/Cmd+click** forces **PRV** (falls back to PGM if preview is disabled). Labels get a ` PGM` / ` PRV` suffix for disambiguation.

4. **Removal**  
   Removing the tile uses the **existing** extra live source removal path (same as other custom Live entries); must **not** remove the original layer or its fill.

## Functional requirements

- [x] **F1.** The created live source item uses **`value: route://<casparChannel>-<layerNumber>`**, consistent with `getRouteString` in [`src/config/routing-map.js`](../src/config/routing-map.js) (same convention as DeckLink input routes `route://inputsCh-N` and audio monitor routes).

- [x] **F2.** Persist via **`addExtraLiveSource`** on [`POST /api/device-view`](../src/api/routes-device-view.js): item must include at least **`type: 'route'`**, stable **`value`**, human **`label`**, and a distinct **`routeType`** (e.g. **`layer`** or **`layer_route`**) so the Live tab can style or document it separately from `pgm` / `prv` / `decklink`.

- [x] **F3.** **Channel resolution** must use the **actual Caspar channel** the scene will use when taken / previewed — **not** a hard-coded channel 1. Implementation must read the same channel mapping the editor / take path already uses (virtual mains, program channel index, etc.).

- [x] **F4.** Optional: populate **`resolution` / `fps`** from `channelMap` for that channel when available (match shape of built-in entries in [`web/components/sources-panel-helpers.js`](../web/components/sources-panel-helpers.js) `buildLiveSources`).

- [x] **F5.** After add, UI updates without full reload: apply returned **`extraLiveSources`** via existing **`__highascgApplyExtraLiveSources`** pattern (see [`web/components/sources-panel.js`](../web/components/sources-panel.js), [`web/components/live-input-modal.js`](../web/components/live-input-modal.js)).

## Edge cases and product decisions

| Situation | Expected behaviour (v1) |
|-----------|-------------------------|
| Layer empty / not yet filled | **Recommend:** allow add with tooltip “No signal until this layer is filled”; **alternative:** disable button — pick one and document. |
| Operator clicks **twice** for same ch/layer | **Upsert** by `value` (already supported server-side). |
| Consumer layer plays **`route://X-Y` on layer Y** | **Implemented:** compose + layer-list drops block when the route’s `channel-layer` matches the **edit bus** target for that layer (`resolveLookStackChannelForBus` + `parseRouteChannelLayer`). |
| Layer number reassigned in scene | Old **`route://`** entry in `extraLiveSources` may **stale-point** to wrong layer — **out of scope** v1; manual remove from Live tab. |

## Technical implementation notes

1. **Server:** No new endpoint required if `addExtraLiveSource` accepts the payload; verify validation does not reject unknown `routeType` values.

2. **Client — layer row:** [`web/components/scene-layer-row.js`](../web/components/scene-layer-row.js) — `addExtraLiveSource`, **Shift+↗** (PGM bus) / **Ctrl+↗** (PRV bus), self-route guard on strip **drop**.

3. **Client — compose:** [`web/components/scenes-compose.js`](../web/components/scenes-compose.js) — same self-route guard when dropping a Live route onto a layer.

4. **Shared helper:** [`web/lib/look-stack-amcp-channel.js`](../web/lib/look-stack-amcp-channel.js) — `resolveLookStackChannelForBus`; [`web/components/scenes-shared.js`](../web/components/scenes-shared.js) — `parseRouteChannelLayer`.

5. **Caspar:** Confirm fork/build supports **`PLAY … route://N-M`** for **program-style** layers (repo already uses channel-layer routes for inputs and audio in [`src/api/routes-audio.js`](../src/api/routes-audio.js)).

## Non-goals (v1)

- Automatic cleanup when a layer is deleted from the scene.  
- Renaming / editing route URL from a dedicated inspector (use remove + re-add, or future settings).  
- NDI or external mirror as substitute for `route://`.

## Acceptance criteria

1. From the **scene layers list**, one click adds **`route://<ch>-<layer>`** to **`config.extraLiveSources`** and the tile appears in **Sources → Live** without refresh.  
2. Dragging that tile onto **another layer** (or multiview cell, if supported for route sources) shows the **same** picture as the source layer while the source keeps playing the real fill.  
3. Removing the tile from Live **only** removes the extra source record; **original layer unchanged**.  
4. No regression: existing Program / Preview / DeckLink / browser extra live entries unchanged.

## Implementation steps

- [x] **Phase 1:** Resolve `{ casparChannel, layerNumber }` from scene editor context for the clicked row (align with take/preview channel mapping).  
- [x] **Phase 2:** Add button + handler in `scene-layer-row.js`; call `addExtraLiveSource`; toasts + error handling.  
- [x] **Phase 3:** Live tab presentation for `routeType: 'layer'` (icon/tooltip/help text).  
- [x] **Phase 3b:** Self-route guard on compose + layer-strip drops; **Shift+↗** / **Ctrl+↗** for PGM vs PRV Live tiles; shared `resolveLookStackChannelForBus`.  
- [ ] **Phase 4:** Manual QA — single screen, dual screen, multiview cell, scene on non-1 program channel; verify single decode for duplicated PIPs (Caspar producer / INFO sanity check as far as practical).

---

*Created: 2026-05-18 · Depends on: existing `extraLiveSources` + Caspar route producers (no WO prerequisite).*
