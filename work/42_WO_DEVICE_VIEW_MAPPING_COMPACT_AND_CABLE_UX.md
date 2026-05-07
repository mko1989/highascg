# Work Order 42: Device View — Compact Mapping Node & Cable/Inspector UX

## Goal

Restore a **predictable, dense Device View** for pixel mapping: **small nodes**, **clear cable affordances**, **inspector parity with other connectors**, and **reliable completion** of mapping-output → physical output cables (including DeckLink). Align interaction patterns with WO-40 (connector `+`/dots) where sensible, without duplicating contradictory UX.

## Problem Statement (Current Pain)

- Mapping output → DeckLink (or other Caspar output) **appears valid in UI (green target)** but **connection fails or feels broken** in practice.
- Pixel mapping **band/card has grown oversized** (toolbar + output config rows + ports + large actions); operators need a **compact processor node** comparable to other Device View blocks.
- **Cable workflow is inconsistent**: unclear whether to click dot vs port vs “something else”; cancellation behavior should match mental model (**click cable icon / connector** to arm or complete; **click empty space** cancels).
- **Inspector**: selecting a mapping connector / dot should **always** surface the same inspector details as selecting that connector elsewhere (no dead clicks).

## Product / UX Requirements

### A) Mapping node layout (compact)

- Default presentation: **small card** with:
  - **Label** (and optional subtitle collapsed).
  - **Single compact control** to add outputs (not a full second toolbar duplicating Mapping Editor).
  - **Input**: one row — dot + **cable placeholder icon** (SVG) — behaves as cable endpoint.
  - **Outputs**: one row per output **or** horizontally stacked chips — each: dot + cable icon + minimal label (truncate).
- **Secondary actions** (rename / duplicate / delete / open editor): overflow menu, icon row, or kebab — **not** a large multi-button strip by default.
- **Remove or relocate** long-form output label/mode editors from the band into **inspector-first** (band shows summary only). Optional: expand-on-demand accordion “Output details” if operators insist on inline edits.

### B) Cable affordances (everywhere in Device View)

- Beside **every** connector that participates in cabling (mapping in/out, DeckLink virtual/GPU ports, destination feeds, etc.), render a **neutral cable-icon placeholder** (SVG):
  - Click starts cable **from** that connector (if rules allow source role).
  - When cable is armed, valid targets stay highlighted; clicking target’s **cable icon or connector body or node dot** completes the edge.
- **Node dot** remains a valid hit target for **selection + cable complete**, consistent with physical ports.
- **Clicking anywhere else** (backdrop / non-target) **cancels** armed cable (already partially implemented via document listener — verify no regressions with new icons).

### C) Inspector integration

- Clicking **mapping node dot** or **mapping port row** sets inspector to that connector’s inspector (same payload as selecting connector elsewhere).
- Inspector content for `pixel_map_in` / `pixel_map_out` must stay aligned with WO-41 (hint, open editor, per-output label/mode when `pixel_map_out`).

### D) Visual hierarchy / compression

- Audit CSS for `.device-view__mapping-*` and band spacing; target **similar density** to DeckLink/GPU port rows.
- Ensure cable overlay z-index still allows **hit-testing** on new cable icons (WO-40 z-order note).

## Engineering Investigation (Must Do Before Pixel-Pushing)

These explain “green but fails” class bugs:

1. **Frontend edge ordering vs backend `edgeConnectAllowed`**  
   - Client: `web/components/device-view-helpers.js` — `orderEdgeForDeviceView`, `connectorRole` (DeckLink `decklink_io` uses `caspar.ioDirection` for in vs out).  
   - Server: `src/config/device-graph-edges.js` — `edgeConnectAllowed`, `addEdgeToGraph` (includes `sink_already_connected` for Caspar outputs).  
   **Deliverable**: reproduce failing pair in devtools; compare ordered `{ sourceId, sinkId }` POST body with server rejection reason.

2. **`decklink_out` vs `decklink_io` (direction `out`)**  
   Confirm suggested connectors for “Program → DeckLink” rows use kinds/refs the graph validator expects; verify UI resolves connector IDs that exist in **both** `graph.connectors` and `suggested.connectors`.

3. **Green highlight without successful POST**  
   Trace `device-view.js`: `updateUI` uses `orderEdgeForDeviceView` for hover targets; `tryAddCable` uses same ordering — if mismatch (e.g. `connectorById` null for suggested-only id), fix **single source of truth** for “allowed edge”.

4. **DeckLink consumer single-input rule**  
   `addEdgeToGraph`: Caspar output sinks allow only one incoming edge. If user expects multi-feed, document; if UI shows green for occupied sink, fix UX (show “replace cable” not green).

## Implementation Plan

### Phase 1 — Model / API confidence

- Add structured logging or UI toast on `addEdge` failure with **`reason`** from API (`sink_already_connected`, `allowed: destination_to_output`, etc.).
- Unit-test matrix: `pixel_map_out` × (`decklink_io` out, `decklink_out`, `gpu_out`) × ordering reversal.

### Phase 2 — Compact mapping band

- Refactor `web/components/device-view-mappings-render.js`: extract **compact node** layout; move heavy editors out.
- Update `web/styles/03d-mapping-editor.css` (and Device View bundle if separate) for compressed rows / overflow actions.

### Phase 3 — Cable icons & hit targets

- Add shared SVG asset under `web/assets/` or inline sprite; reuse in `device-view-mappings-render.js`, `device-view-bands-render.js`, `device-view-caspar-render.js`, `device-view-destinations-render.js` as appropriate.
- Centralize “start cable / complete cable” handlers so dot + icon + port button share one code path (`device-view.js` + small helper module).

### Phase 4 — Inspector selection

- Ensure dot/icon clicks call same `selectKey` / `onPortClick` path as connector selection; verify `pixel_map_*` rows in `readableConnectorRows` stay in sync.

### Phase 5 — QA checklist

- Cable mapping out → DeckLink out on fresh graph and with **pre-existing** GPU cable (expect clear rejection message).
- Resize window / scroll destinations — cables still anchor correctly (WO-33).
- Touch targets ≥ 44×44 CSS px where possible for cable icons.

## Verification

- Operator can complete **three-wide** mapping → three DeckLinks without opening Mapping Editor (cabling only + inspector for modes if needed).
- Generated Caspar config still reflects cabling (`applyPixelMappingProgramScreens` tiles on fed program screen — see appendix).
- No regression on destination ↔ GPU / DeckLink direct cables.

## References

- WO-40: Device View connector `+`/dot placement.
- WO-41: Mapping integration model (update **channel** wording: dedicated `mappingChannels` slots are **deprecated**; tiling uses program channel — see appendix below).

---

## Appendix A — How CasparCG config is generated from Device View (step by step)

**Persistent source of truth**

1. **Operator edits** in Device View update **`ctx.config.deviceGraph`** on disk via `POST /api/device-view` (`src/api/routes-device-view.js`): payloads such as `{ deviceGraph }`, `{ addEdge: { sourceId, sinkId } }`, `{ removeEdge }`, `{ updateConnector }`, etc., merged through CRUD (`device-view-crud.js`) and `persistConfigPatch` into **`highascg.config.json`** (or configured config path).

**Flatten graph + screens into generator input**

2. **`buildCasparGeneratorFlatConfig(appConfig)`** (`src/config/build-caspar-generator-config.js`) starts from **`defaults.casparServer`** merged with **`appConfig.casparServer`**, audio routing, streaming, OSC ports.

3. **`merged.screen_count`** from **`resolveMainScreenCount`** (`src/config/routing-map.js`) — driven primarily by **tandem topology destinations**, not by counting mapping outputs.

4. **Graph-derived overlays** (order matters — same file):
   - **`applyDestinationOverridesToScreens`** — destination panel `videoMode` / custom width×height×fps → `screen_N_mode`, `screen_N_custom_*`.
   - **`applyDecklinkOverridesToScreens`** — walks **edges into `decklink_io`**; traces upstream (including through **`pixel_map_out` → `pixel_map_in`**) to `dst_in_*` or `caspar_pgm_*` → sets **`screen_N_decklink_device`** / multiview decklink when appropriate.
   - **`applyScreenConsumerOverridesFromCabling`** — whether PGM uses **screen consumer** vs DeckLink-only (`screen_N_screen_consumer`) based on GPU reachability from destination feeds.
   - **`applyAudioOutputOverridesToScreens`** — edges into **`audio_out`** → PortAudio consumer blocks per screen/multiview prefix.
   - **`applyPixelMappingProgramScreens`** — for each **`pixel_mapping`** node whose input is fed from a **program destination** (or `caspar_pgm_N`), collects **DeckLink sinks** from **`pixel_map_out`** edges in output order → **`screen_N_decklink_tiles`** + **custom channel width/height** (wide canvas + DeckLink **subregions / `<ports>`** in XML — see `config-generator-consumer-attach.js`).

**Channel numbering**

5. **`getChannelMap(config)`** (`routing-map.js`) assigns **integer Caspar channel numbers** for PGM/PRV pairs, optional multiview slot, DeckLink inputs host, streaming attach/dedicated, monitor, etc. **`mappingChannels` is intentionally empty**; mapping does not consume extra channel indices.

**XML assembly**

6. **`buildConfigXml(config)`** (`src/config/config-generator.js`) calls **`buildChannelsSection`** (`config-generator-channels.js`), which uses **`buildChannelPlan`** and for each main screen calls **`buildScreenPairChannels`** (`config-generator-consumer-attach.js`) — inserts **screen**, **DeckLink** (simple or **tiled** from `screen_N_decklink_tiles`), streaming/ffmpeg fragments, etc.

7. **Custom `<video-modes>`** entries are emitted when PGM uses **`custom`** geometry (e.g. combined mapping width).

**Apply / download**

8. **`GET /api/caspar-config/generate`** or **`POST /api/caspar-config/apply`** (`src/api/routes-caspar-config.js`) runs **`buildConfigXml(buildCasparGeneratorFlatConfig(ctx.config))`** and returns XML or writes to **`casparServer.configPath`** / **`CASPAR_CONFIG_PATH`**.

**End-to-end sentence**

> **Device View edges** persist in **`deviceGraph`** → **`buildCasparGeneratorFlatConfig`** interprets those edges (together with destinations and hardware hints) into **`screen_*` / multiview / audio fields** → **`getChannelMap`** assigns channel indices → **`buildConfigXml`** emits Caspar **`<channels>`** and **consumers** (including **mapping-wide DeckLink tiling** when applicable).
