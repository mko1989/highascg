> **Provenance:** Haiku-generated inventory (2026-10-17) for [WO-593](../../work-orders/593_WO_godot_client_port_epic.md), spot-checked by hand where a WO relies on it. Line refs are to the 2026-10-17 tree (synced to `origin/main` d5521d50) and will drift; re-grep before acting on one.

# A. Device View inventory (client/components/device*.js, client/lib/device*.js, Device View CSS)

Scope: 80 device JS files (53 in `client/components/`, 27 in `client/lib/`) plus 12 CSS files under `client/styles/09*.css`. LOC from `wc -l`. Read-only inventory; no repo files were changed and no git commands were run.

Cross-area notes: a few files outside the glob are reached from Device View and are cited where they matter (`client/lib/streaming-channel-state.js`, `virtual-camera-state.js`, `mapping-node-service.js`, `replication-ui-state.js`, `decklink-add-input.js`, `extra-live-source-remove.js`, `live-audio-remove-input.js`, `v4l2-remove-input.js`, `settings-state.js`, `app-ws-handlers.js`, `app.js`, and the `components/` host and modal modules `inspector-*-host.js`, `live-input-modal*.js`, `caspar-config-modal.js`). Their endpoints are listed under "indirect" in the totals.

Layout of the sub-feature groups below:

1. Shell, data loading and orchestration
2. Cable gesture, SVG overlay and cable physics
3. Matrix view
4. Caspar rear panel (backplane)
5. Port bands and live-source / mapping cards
6. Screen destinations and host channels
7. GPU port model and rear-panel layout data (lib)
8. Inspector framework and destination inspector
9. Inspector: GPU outputs and video modeline
10. Inspector: DeckLink I/O
11. Inspector: stream, record, virtual camera, audio outputs
12. Inspector: Caspar server, hot backup, mapping nodes
13. Snapshots (save, load, rear-panel capture)

---

## 1. Shell, data loading and orchestration

- Files:
  - `client/components/device-view.js` — 66 LOC — entry point; `initDeviceView` builds the shell, creates the `state` object, registers the sub-modules, sends the WS subscribe.
  - `client/components/device-view-toolbar.js` — 281 LOC — builds the DOM shell (header, toolbar, layout panels, SVG cable overlay); Node/Matrix and Simple-wiring toggles; cable-loops slider.
  - `client/components/device-view-render.js` — 356 LOC — `ctx.load` (payload cache, background refresh, GPU-layout migration) and `ctx.renderFromState` (re-renders destinations, bands or matrix, edges list, live sources).
  - `client/components/device-view-events.js` — 259 LOC — all top-level listeners: Apply button, Save snapshot, cable keyboard shortcuts, document click for cable targets, resize observer, custom window events.
  - `client/components/device-view-selection.js` — 250 LOC — selection model (`selectKey`, `selectDevice`, `selectEdgeById`, `selectDestinationById`, `focusConnectorById`) and inspector host routing.
  - `client/components/device-view-actions.js` — 331 LOC — the only module that wraps the Device View HTTP API (`api.get` / `api.post`), plus the `settingsState` save path.
  - `client/components/device-view-helpers.js` — 313 LOC — graph lookups (`connectorById`, `connectorRole`, `orderEdgeForDeviceView`, `resolveConnectorId`, `isConnectorVisible`) and state-class helpers.
  - `client/components/device-view-ui-utils.js` — 260 LOC — status line, inspector table builder, nearest-connector hit test (`findNearestConnectorId`), `renderPreservingFocus`.
  - `client/lib/device-view-refresh.js` — 58 LOC — merges mutation responses into the in-memory payload so reloads avoid a full GET.
  - `client/components/device-view-inspector-render.js` is covered in group 8.
  - CSS: `client/styles/09-device-view.css` — 7 LOC (`@import` aggregator for 09a-09d); `client/styles/09a-device-view-layout-destinations.css` — 6 LOC (aggregator); `client/styles/09a1-device-view-layout-toolbar.css` — 87 LOC (layout, toolbar).
- What the operator can do:
  - Open the Devices tab and see the whole device graph: Screen destinations (left), Rear panel (Caspar hardware), port bands, cables, and an inspector for the selected item.
  - Toggle Node view (default) or Matrix view (checkbox, persisted; see group 3). Toggle Simple wiring (checkbox, persisted; groups 2 and 4).
  - Adjust "Cable loops" (messiness slider, `device-view-toolbar.js`) which feeds the cable physics (group 2). Hidden in Matrix or Simple mode (`device-view-toolbar.js:registerViewMode`, `updateMessinessVisibility`).
  - Press "Apply Caspar config (restart)" (`device-view-events.js:50-80`); the button shows "Applying…", streams `[Full apply] Step N` progress from the WS `log_line` (`device-view-events.js:57-66`).
  - Press "Reset all cabling", "Cancel cable", "Save device snapshot" (group 13), "View or edit generated Caspar config" (opens `caspar-config-modal.js`, `device-view-events.js:90`).
  - Undo last cable/destination action with Ctrl+Z / Cmd+Z (`device-view-events.js:205-208`; undo stack capped at 50 in `device-view-cable.js:95-108`).
  - Click any port, cable, destination, device or the "Server" entry to open its inspector; Escape cancels a pending cable (`device-view-events.js:196-200`).
- Rendering tech:
  - DOM only. The shell and every band are built with `document.createElement`, `innerHTML` and `textContent` (`device-view-toolbar.js:7` `buildDeviceViewShell`; `device-view-render.js:23` `registerDeviceViewRender`; `device-view-render.js:50-70` edges list built with `createElement`).
  - SVG: the cable overlay is an `<svg>` element created at `device-view-toolbar.js:130` and filled by `device-view-cables.js:216` `renderCableOverlay` (paths via `createElementNS`, `device-view-cables.js:280`).
  - Icons: inline SVG (`device-view-toolbar.js:25` `innerHTML` icon, `device-view-toolbar.js:31-45`).
  - No canvas 2D, WebGL, iframe, `<video>` or contenteditable in this area (grep: "canvas" appears only in text, e.g. `device-view-inspector-decklink-output.js:35`).
  - Full re-render model: `renderFromState` clears and rebuilds the bands (`device-view-render.js:~150-200`); `renderPreservingFocus` restores focus after the rebuild (`device-view-ui-utils.js:163`).
  - Layout: CSS grid/flex from `client/styles/09a1-device-view-layout-toolbar.css`; the cable overlay is `position: absolute` (`client/styles/09b1-device-view-connectors-overlay.css`).
- Interaction:
  - Click: connector dots and ports `device-view-bands-render.js:24` (dot click starts or completes a cable), `device-view-bands-render.js:109` (port click selects).
  - Keyboard (document level): Escape (`device-view-events.js:196`), Ctrl/Cmd+Z (`device-view-events.js:205`), Delete/Backspace on a selected cable (`device-view-events.js:212-219`, ignored inside inputs).
  - Pointer: window `pointermove` drives the ghost cable while a cable is armed (`device-view-events.js:181-191`, rAF-coalesced).
  - Document capture click resolves a cable target or cancels (`device-view-events.js:220-240`).
  - Resize: `window.onresize` plus `ResizeObserver` on the wrap and the external inspector host (`device-view-events.js:101-108`); both call `renderCableOverlay` through `rafThrottle` (`device-view-events.js:101`, `client/lib/raf-throttle.js`).
  - Custom DOM/window events consumed (`device-view-events.js`): `highascg-device-view-update-payload` (:37), `highascg-settings-applied` (:248), `highascg-device-view-reload` (:249), `highascg-device-view-focus-connector` (:250), `highascg-device-view-focus-device` (:254), `highascg-device-view-focus-server` (:257), `highascg-caspar-restart-dirty` (:258).
  - Tooltips: HTML `title` attributes throughout (e.g. `device-view-toolbar.js` snapshot and config buttons; `device-view-caspar-render.js:~180-190`).
  - Modals: `caspar-config-modal.js` (`device-view-events.js:90`), snapshot save/load (group 13), add live source (group 5).
- Server contract (this group, direct):
  - `GET /api/device-view` — `device-view-actions.js:20` (`loadDeviceView`, query `freshGpu=1` and `_ts=` cache-buster, `device-view-actions.js:9-20`). Called from `device-view-render.js:~255` and `device-view-render.js:~292` (through `Actions.loadDeviceView`).
  - `GET /api/settings` — `device-view-actions.js:50` (`loadSettings`); also `client/lib/settings-state.js:96` (`settingsState.load`, called from `device-view-render.js` `ctx.load`).
  - `POST /api/settings` — `device-view-actions.js:54` (`saveSettingsPatch`, which then dispatches `highascg-settings-applied`, `device-view-actions.js:57`); `device-view-actions.js:67` (`saveGpuPhysicalTopology`).
  - `POST /api/device-view` — `device-view-actions.js:142` (`applyPlan`, used by the destination panel "apply"), `:146` (`deviceGraph`), `:151` (`syncFromLive`, exported but no in-scope caller; see Area totals).
  - `POST /api/caspar-config/apply` — `device-view-actions.js:125` (`applyCasparConfig`, body `{force: true}`, `device-view-actions.js:121-125`); triggered from `device-view-events.js:84-86`.
  - `GET /api/device-view/snapshot` — `device-view-actions.js:31` (`prewarmDeviceViewSnapshot`, used by the cable prewarmer, group 2).
  - `GET /api/caspar-config/generate` — `device-view-actions.js:138` (also used by `caspar-config-modal.js:76`).
  - `POST /api/system/gpu-ports-reset` — `device-view-actions.js:321`.
- WS contract (this group):
  - Sent: `{type: 'device_view_subscribe'}` — `device-view.js:65`, `device-view-render.js:227` (on every `ctx.load`).
  - Read directly: `log_line` — `device-view-events.js:57` (regex `\[Full apply\]\s+(.{0,80})`, `device-view-events.js:62`).
  - Indirect: `gpu_topology_changed` is consumed by `client/lib/app-ws-handlers.js:283` and re-dispatched as the window event `highascg-device-view-reload` (`app-ws-handlers.js:285`), which `device-view-events.js:249` answers with a forced reload.
- Client state:
  - `state` object created at `device-view.js:~22-41`: `lastPayload, selectedKey, selectedConnectorId, selectedEdgeId, selectedDestinationId, selectedDeviceId, cableSourceId, hoveredEdgeId, casparRestartDirty, cablePointer, cableRegrab, suppressDocCableClickUntil, currentSettings, streamingStatus, undoStack`. `cableSourceHalf` is added dynamically (`device-view-cable.js:~190-205`).
  - Module-level cache in `device-view-render.js:14-17`: `lastPayload`, `lastPayloadAt`, `lastRequestId`; 5 s freshness window (`device-view-render.js:~231`, `isCached = ... < 5000`).
  - `client/lib/app-runtime.js` accessors: `getAppWs()` (`device-view-render.js:14`), `getAppStateStore()` (`device-view-live-sources-render.js:15`). Store keys read: `channelMap` (`device-view-live-sources-render.js:48`, `client/lib/device-view-host-channels-inputs.js:85`) and `configComparison` (`device-view-destinations-ui.js:115`).
  - `settingsState` singleton (`client/lib/settings-state.js`), imported by `device-view-actions.js:5`, `device-view-render.js:13`, `device-view-selection.js:8`.
  - localStorage: `device-view-matrix` (`device-view-toolbar.js:102` read, `:224` write); `highascg_device_view_simple_wiring` (`client/lib/device-view-simple-wiring-prefs.js:2-15`, see group 4).
  - sessionStorage: `highascg_factory_reset_gpu_layout` — read `device-view-render.js:236`, cleared `device-view-render.js:336`; key constant at `client/lib/device-view-gpu-port-constants.js:5`.
- Browser-only APIs:
  - `ResizeObserver` — `device-view-events.js:103-108`.
  - `window.onresize` — `device-view-events.js:102`.
  - `requestAnimationFrame` (double-rAF for overlay redraw after mode change) — `device-view.js:59-60`, `device-view-toolbar.js:249-250`, `device-view-render.js:222`.
  - `window`/`document` `addEventListener` custom events and `pointermove` (see Interaction).
  - `document.addEventListener('click', …, true)` capture phase — `device-view-events.js:220-221`.
  - `setTimeout` for focus restore — `device-view-ui-utils.js:242`.
  - `sessionStorage` / `localStorage` (see Client state).
- Port-risk notes:
  - Caching semantics are behavioural, not algorithmic: a 5 s in-process payload cache (`device-view-render.js`), a 3 s HTTP cache on `GET /api/device-view` (`device-view-actions.js:13-19`), and explicit `forceRefresh` after every mutation (many call sites). A port must reproduce "mutation implies refetch", not just the cache window.
  - Stale-while-revalidate: the stale path renders the old payload then refetches (`device-view-render.js:~240-270`). Race-safety uses `lastRequestId` (module-level).
  - DOM-entangled: the whole orchestration is DOM id/class-based (`refs` from the shell). The logic that selects which inspector to show and in what order is pure state transitions but is interleaved with DOM calls.

---

## 2. Cable gesture, SVG overlay and cable physics

- Files:
  - `client/components/device-view-cable.js` — 455 LOC — cable state machine: arm, complete, re-grab a cable end, undo, add cable with GPU/screen settings seeding and PRV layer note.
  - `client/components/device-view-cables.js` — 331 LOC — SVG overlay renderer: draws edges as paths (physics routes, simple-wiring bezier, DeckLink key-fill rails), ghost cable while dragging.
  - `client/components/device-view-cables-physics.js` — 223 LOC — deterministic Verlet "hanging cable" simulation and cable colour hash; cached per edge.
  - `client/components/device-view-cable-outputs.js` — 155 LOC — removal and bulk-reset of edges, destination output-layer note (PGM/PRV), and DeckLink-to-destination output assignment; stream/record/audio/vcam removal helpers.
  - `client/components/device-view-cable-affordance.js` — 29 LOC — the small "cable hook" dot appended to each port (`appendCableAffordance`).
  - `client/lib/device-view-cable-messages.js` — 31 LOC — human-readable server rejection texts (pure).
  - `client/lib/device-view-cable-preflight.js` — 117 LOC — materialises missing `gpu_pN` / `dst_in_*` connector rows into the saved graph before `addEdge` (pure graph transform).
  - `client/lib/device-view-cable-regrab.js` — 165 LOC — pure decision logic for re-grabbing a cable end (`pickRegrabCandidate`, `planCableRegrab`, `planRegrabRollback`); header says no DOM/network/state.
  - `client/lib/device-view-cable-resolve.js` — 85 LOC — canonical connector id resolution (`gpu_pN` vs `DP-N` bracket names), GPU sink conflict check (pure).
  - `client/lib/device-view-snapshot-prewarm.js` — 84 LOC — keeps the server's live snapshot warm for 2.5 s while a cable gesture is open (`PREWARM_INTERVAL_MS = 2500`, line 18).
  - `client/lib/device-view-output-layer.js` — 57 LOC — reads the `{outputLayer}` note on destination edges (1 = PGM, 2 = PRV) and anchor keys (pure).
  - CSS: `client/styles/09b1-device-view-connectors-overlay.css` — 265 LOC (cable line, overlay, connector dots).
- What the operator can do:
  - Cable mode is click-to-click, not drag: click an output connector (destination output, `caspar_out`, `pixel_mapping_out`) to arm, then click a valid input (`device-view-cable.js:190-213`). Invalid targets are highlighted red and valid ones green (`device-view-cable.js` `ctx.updateUI`, classes `device-view__connector-target--valid|invalid`).
  - Select an existing cable by clicking its path (`device-view-cables.js:298-304`), then either press Delete/Backspace (`device-view-events.js:212`) or click one of its ends to lift that end and drop it on another port (re-grab, `device-view-cable.js:168-188`, `commitCableRegrab` `device-view-cable.js:224`).
  - Escape or clicking empty space restores a held cable end without writing to the server (`device-view-events.js:196-200`, `device-view-events.js:220-240`).
  - Cable loops ("messiness" slider) adds 0–2 deterministic coils to a cable; visible only in Node view (`device-view-cables-physics.js:29-58`, `device-view-toolbar.js` `updateMessinessVisibility`).
  - Simple wiring mode draws straight-ish Bezier curves with radial fanning instead of hanging cables (`device-view-cables.js:~160-205`, `buildSmoothSimpleCable`).
  - Hover a cable entry in the edges list to highlight the cable (`device-view-render.js:~60-70`).
  - "Reset all cabling" (`device-view-cable-outputs.js:22-23` confirm, then bulk removal).
  - Ctrl+Z undoes the last cable/destination change (up to 50 steps, `device-view-cable.js:95-125`).
- Rendering tech:
  - SVG: `<svg>` overlay created in `device-view-toolbar.js:130`; each cable is a `<path>` created with `document.createElementNS('http://www.w3.org/2000/svg', 'path')` (`device-view-cables.js:280`); ghost path with `stroke-dasharray` (`device-view-cables.js:324-327`); key-fill label is an SVG `<text>` (`device-view-cables.js:68-76`).
  - Viewbox set each pass to the wrap size (`device-view-cables.js:240-248`).
  - Colour per cable: `getCableColor(id)` from a 33-entry palette (`device-view-cables-physics.js:6-27`, hash at `:15-22`).
  - Anchor positions come from DOM measurement: `connectorCenter` uses `getBoundingClientRect` relative to the surface (`device-view-cables.js:89-115`); `buildConnectorPositionMap` caches anchor positions for a render pass (`device-view-cables.js:~140-175`).
- Interaction:
  - Click on port dot: `device-view-bands-render.js:24-28` (`addPortNodeDot`, starts or completes a cable).
  - Click on card/port: `device-view-caspar-render-markers.js` (dot click at `:~225`, marker click at `:~305`).
  - Cable path click: `device-view-cables.js:298`.
  - Pointer move: `device-view-events.js:181-191` sets `state.cablePointer` and redraws the ghost (rAF-coalesced).
  - Document capture click for target resolution: `device-view-events.js:220-240`, using `findNearestConnectorId` (`device-view-ui-utils.js:105`, hit radius `CONNECTOR_HIT_RADIUS_PX = 22` at `device-view-ui-utils.js:95`).
  - Keyboard: see group 1.
  - No HTML5 drag is used for cable creation; drag is only used for reordering and for DeckLink-to-destination assignment (groups 4, 5, 6).
- Server contract (this group):
  - `POST /api/device-view` `{addEdge:{sourceId,sinkId}}` — `device-view-actions.js:206` (`addCable`), called at `device-view-cable.js:~330` and `:~287` (regrab).
  - `POST /api/device-view` `{removeEdge:{id}}` — `device-view-actions.js:210` (`removeEdge`), `device-view-cable.js` regrab (`removeEdge` in `commitCableRegrab`), `device-view-cable-outputs.js:10`.
  - `POST /api/device-view` `{removeAllEdges:true}` — `device-view-actions.js:214` (`removeAllEdges`), `device-view-cable-outputs.js:22-30`.
  - `POST /api/device-view` `{updateConnector:{id,patch}}` — `device-view-actions.js:218` (`updateConnector`), `device-view-cable.js` (GPU/Caspar mode patch), `device-view-cable-outputs.js` (output-layer path).
  - `POST /api/device-view` `{deviceGraph: graph}` — `device-view-actions.js:146` (`saveDeviceGraph`), called by `device-view-cable-outputs.js` and by `device-view-bands-render.js:428`.
  - `POST /api/settings` — `device-view-actions.js:54` (`saveSettingsPatch`) called with `deviceGraph`/`screenDestinations` for undo (`device-view-cable.js:110-125`) and with seeded screen-consumer defaults (`device-view-cable.js` add-cable path, via `lib/screen-consumer-defaults.js`).
  - `POST /api/device-view` `{syncFromLive:true}` — exported at `device-view-actions.js:151` but not called from `client/` (recovery path uses `recoverDeviceGraphForCable`, which does `saveGpuPhysicalTopology` + `loadDeviceView`, `device-view-actions.js:~70-100`).
  - `GET /api/device-view/snapshot` — prewarm, `device-view-actions.js:31`, called every 2.5 s during a gesture (`device-view-cable.js:84`).
  - Error handling: the server's rejection text arrives as `res.error` (`device-view-cable.js:~328-330`) and in thrown errors; mapped by `describeCableRejection` (`lib/device-view-cable-messages.js:15`).
- WS contract: none directly in this group.
- Client state:
  - Cable gesture state on `state`: `cableSourceId`, `cableSourceHalf` (`device-view-cable.js:~52`), `cablePointer`, `cableRegrab`, `suppressDocCableClickUntil` (`device-view-cable.js:~190-205`), `undoStack` (`device-view-cable.js:95-108`).
  - Module cache `cableCache` (Map keyed by edge id, value `{key, pts}`) in `device-view-cables-physics.js:~212-223`; key is the endpoint coordinates to 0.1 px plus loop count.
  - `messiness` read from the slider value (`device-view-cable.js` `getCOCtx`), `simpleWiring` from the checkbox.
  - localStorage: none for cables.
- Browser-only APIs:
  - `getBoundingClientRect` — `device-view-cables.js:~96, 110-115`; `device-view-ui-utils.js:105-125`.
  - SVG DOM (`createElementNS`) — `device-view-cables.js:68, 71, 280, 324`.
  - `requestAnimationFrame` — `device-view-events.js:~186-190`.
  - `window.addEventListener('pointermove')` — `device-view-events.js:181`.
  - `ResizeObserver` — `device-view-events.js:103-108`.
  - `Date.now()` for suppression windows — `device-view-cable.js:~190`.
- Port-risk notes:
  - Physics (pure logic, portable as-is): `buildCable` in `device-view-cables-physics.js:29-212`. Algorithm: build waypoints (16 px boot drop at line 30; loop positions from a deterministic `srand` at lines 66-70; coil points at lines 80-95 with `STEPS_PER_LOOP = 36`), then Verlet integration with `gravity = 0.85` (`:139`), `ITERS = 200` (`:140`), `SUBSTEPS = 6` (`:141`), three constraint families (direct segments; 2-hop bending with stiffness 0.6 on loops / 0.06 on straight; 3-hop bending 0.3 / 0.02). Endpoints pinned after each substep (`:~175-180`).
  - `srand(n, seed)` = `fract(sin(n*127.1 + seed*311.7) * 43758.5453)` (`:~16-19`). Float64 `Math.sin` is required for the same output.
  - `getOrBuild` seed for string ids = sum of char codes (`device-view-cables-physics.js:~217-218`), not a hash; cache is unbounded.
  - Colour hash uses 32-bit integer wrap: `h = (h << 5) - h + charCode` (`device-view-cables-physics.js:~20`). A port must emulate int32 overflow (`<<` truncates to 32 bits in JS; GDScript ints are 64-bit) or colours differ.
  - Simple-wiring curve (`buildSmoothSimpleCable`, `device-view-cables.js:~140-175`): cubic Bezier, tension `max(80, |dx|*0.5)`, fan step `π/10`. Pure.
  - DeckLink key-fill side rail (`buildDecklinkKeyFillSideLink`, `device-view-cables.js:~17-45`): orthogonal polyline with a 26 px gap and a 12 px label offset. Pure.
  - DOM-entangled: anchor coordinates are read from the rendered DOM each pass (`connectorCenter`, `device-view-cables.js:89`). Any port needs an equivalent layout engine for connector positions; the overlay is not computable from the graph alone.
  - Cable ends are hit-tested by Euclidean distance to element centres within 22 px (`device-view-ui-utils.js:95-125`).
  - `device-view-cable.js` mixes state-machine logic with network writes and is the most branchy file in the area (see Area totals).

---

## 3. Matrix view

- Files:
  - `client/components/device-view-matrix.js` — 198 LOC — builds the sources × sinks crosspoint table and the add-buttons toolbar.
  - `client/lib/device-view-matrix-ports.js` — 117 LOC — derives matrix rows and columns from the payload (`extractMatrixPorts`, `isSingleInputSinkId`); pure, split out "so it is testable".
  - CSS: `client/styles/09e-device-view-matrix.css` — 129 LOC.
- What the operator can do:
  - Switch to Matrix view (checkbox in the toolbar). The Node view, rear panel and destination panels are hidden (`device-view-toolbar.js` `syncMatrixMode`).
  - Click a crosspoint to connect or disconnect a source to a sink. A PRV source row writes an edge note `{"outputLayer":2}` (`device-view-matrix.js:~176-190`).
  - Crosspoint on a single-input sink (a Caspar output) replaces the existing feed, like a router (`device-view-matrix.js` comment block near the connect branch; `isSingleInputSinkId`).
  - Click a row or column header to select that item in the inspector (`device-view-matrix.js:108-115`, `:130-138`).
  - Add: "+ Destination", "+ Stream", "+ Record", "+ Pixel Map", "+ Live input", "+ Virtual cam" (`device-view-matrix.js:~17-80`).
- Rendering tech: DOM table (`document.createElement('table')`, `device-view-matrix.js:91-92`); cell content is a `div.matrix-dot` via `innerHTML` (`device-view-matrix.js:~166-169`). No canvas or SVG.
- Interaction:
  - Click on each `<td>` (`device-view-matrix.js:156`) toggles the edge in a copied graph (`JSON.parse(JSON.stringify(...))`), then writes the whole graph.
  - Click on header `<th>` (`device-view-matrix.js:108`, `:130`).
  - No drag, no keyboard shortcuts in this view.
- Server contract:
  - `POST /api/settings` with `{deviceGraph: newGraph}` — `device-view-matrix.js:182` (via `Actions.saveSettingsPatch`, `device-view-actions.js:54`). This writes the whole graph through the settings endpoint; the server-side single-feed rule is not applied here (per the code comment).
  - `POST /api/settings` with `{streamOutputs: next}` — `device-view-matrix.js:29`; `{recordOutputs: next}` — `device-view-matrix.js:42`.
  - `POST /api/device-view` `{addDestination}` — via `Actions.addDestination` (`device-view-matrix.js:19`, `device-view-actions.js:114`); `{addMappingNode:true}` — `device-view-matrix.js:50` (`device-view-actions.js:312`).
  - Virtual cam: `saveVirtualCameraConfig` from `client/lib/virtual-camera-state.js:63` (`POST /api/virtual-camera/config`) — `device-view-matrix.js:64+`.
  - Live input modal: `showLiveInputModal` (`device-view-matrix.js:55-58`, `client/components/live-input-modal.js`).
- WS contract: none directly.
- Client state: none persisted beyond the `device-view-matrix` localStorage flag (group 1). Reads `payload.graph`, `payload.settings`, `getAppStateStore()` (`device-view-matrix.js:56`).
- Browser-only APIs: none beyond DOM and `Date.now()` / `Math.random()` for new edge ids: `edge_${Date.now()}_${Math.floor(Math.random() * 1000)}` (`device-view-matrix.js:~178`).
- Port-risk notes:
  - Pure derivation logic in `device-view-matrix-ports.js` (portable).
  - Edge ids are generated client-side with timestamp + random suffix (collision-unlikely but not guaranteed unique).
  - Whole-graph overwrite on every click: concurrent edits from another client would be lost.

---

## 4. Caspar rear panel (backplane)

- Files:
  - `client/components/device-view-caspar-render.js` — 462 LOC — builds the Rear panel band: slots (GPU, DeckLink, USB video, Stream, Virtual cam, Record, Audio), slot headers with edit toggles, disconnected-GPU folder, "+" add buttons, column layout.
  - `client/components/device-view-caspar-render-simple.js` — 246 LOC — compact "simple node" layout for the rear panel (WO-82), with drag-to-reorder nodes.
  - `client/components/device-view-caspar-render-markers.js` — 341 LOC — creates the port markers (buttons with icon, label, status glow, cable dot) and their drag/drop handlers for GPU and DeckLink reorder.
  - `client/components/device-view-caspar-render-helpers.js` — 117 LOC — canonical GPU connector id resolution, rear-kind titles/icons, status resolver; re-exports `normRandrCaspar`.
  - `client/components/device-view-caspar-render-gpu-doc-listeners.js` — 86 LOC — document-level `gpu-layout-changed` listener, GPU layout save to localStorage, GPU layout JSON export (data-URI download).
  - `client/components/device-view-caspar-rear-data.js` — 155 LOC — builds the rear-panel connector data shared by the classic backplane and the simple layout (`buildCasparRearPanelData`).
  - `client/lib/device-view-decklink-order.js` — 37 LOC — persisted DeckLink rear order (`decklink_rear_panel_order`), order merge (pure except the storage read).
  - `client/lib/device-view-simple-wiring-prefs.js` — 19 LOC — simple-wiring toggle persistence.
  - CSS: `client/styles/09b2-device-view-backpanel-hardware.css` — 251 LOC (backplane, markers, slot headers); `client/styles/09d-device-view-simple-wiring.css` — 130 LOC (simple-wiring toggle and node layout).
- What the operator can do:
  - See hardware-like rear panel with slots: GPU (one jack per physical socket), DeckLink (BNC icons), USB video, Stream, Virtual cam, Record, Audio (`device-view-caspar-render.js:37-200`, slot titles at `:138`, `:158`).
  - GPU: pencil button toggles GPU edit mode; then drag GPU markers to reorder (`device-view-caspar-render.js:~225-260`, drag handlers `device-view-caspar-render-markers.js:248-285`). "Show all" and "Clear layout" buttons appear in edit mode (`device-view-caspar-render.js:~260-300`). "Clear layout" asks confirm (`device-view-caspar-render.js:285`) then clears the layout and calls `resetGpuLayout`.
  - Hidden GPU port count shown in the slot title (`device-view-caspar-render.js:~246`).
  - "Disconnected" GPU ports are folded into a `<details>` element (`device-view-caspar-render.js:~320-330`).
  - DeckLink: pencil toggles DeckLink edit mode; drag DeckLink markers to reorder (`device-view-caspar-render-markers.js:187-245`). Persists the order to localStorage.
  - "+" on Stream, Record, Virtual cam and Audio slots adds an output (`device-view-caspar-render.js:374-390`).
  - Simple layout: nodes can be dragged (`device-view-caspar-render-simple.js:220-224`).
  - Click any marker to open its inspector; the dot on each marker starts a cable.
  - Hover shows a `title` tooltip per port with kind, id and status (`device-view-caspar-render-markers.js:~140-150`).
- Rendering tech:
  - DOM. The backplane is a `div` with `<button>` markers (`device-view-caspar-render-markers.js:~120`, `marker.innerHTML` template at `:169`), icons as `<img src="/assets/…svg">` (`device-view-caspar-render-markers.js:~175`, `device-view-caspar-render.js` slot icons `/assets/bnc_female_axis.svg`, `/assets/hdmi-port-icon.svg`, `/assets/ethernet-port-icon.svg`, `/assets/record-port-icon.svg`, `/assets/jack-svg.svg`).
  - SVG: inline pencil icon built with `createElementNS` (`device-view-caspar-render.js:233-245`).
  - Placement: each marker gets computed `x`/`y` percentages (`device-view-caspar-render-markers.js:~20-60`, e.g. `x = ((sIdx + 0.4) / slots.length) * 100`), but `appendCasparRearPanelMarkers` appends markers into slot containers (`device-view-caspar-render-markers.js:~330-337`) and never reads `x`/`y`. Visible placement is therefore CSS flow inside columns (`device-view-caspar-render.js:~190-200`).
  - Column layout: three `device-view__backpanel-column` containers (`device-view-caspar-render.js:~180-200`).
  - No canvas/WebGL.
- Interaction:
  - HTML5 drag and drop on markers and simple nodes (see below).
  - Click: `marker.addEventListener('click', …)` → `onPortClick` (`device-view-caspar-render-markers.js:~306-310`); dot click → `onPortStartCable` (`:~314-325`).
  - Drag (DeckLink edit mode): `dragstart` writes `application/x-highascg-decklink-rear` (`device-view-caspar-render-markers.js:190`) and `application/x-highascg-connector` for `decklink_io` markers when not in edit mode (`:193`). `dragover` (`:197-200`), `drop` swaps DOM nodes and array entries and persists to localStorage (`:202-239`).
  - Drag (GPU edit mode): `dragstart` writes `application/x-highascg-gpu-port` (`:252`); `drop` swaps DOM nodes and entries in `customGpuItems`, persists to `gpu_custom_layout` (`:262-300`).
  - Simple nodes: `dragstart` writes `application/x-highascg-connector` (`device-view-caspar-render-simple.js:224`).
  - Custom event `gpu-layout-changed` listened at `device-view-caspar-render-gpu-doc-listeners.js:57`; no dispatcher exists under `client/` (grep), so this listener is currently inert.
  - `confirm()` on Clear layout (`device-view-caspar-render.js:285`).
- Server contract:
  - No direct HTTP here beyond `resetGpuLayout` → `POST /api/system/gpu-ports-reset` (`device-view-caspar-render.js` calls `Actions.resetGpuLayout`, `device-view-actions.js:321`). The rear panel data is from the `GET /api/device-view` payload passed in via `ctx` (group 1).
  - `load` callback re-fetches via `ctx.load` after gestures (`device-view-caspar-render.js:~265-300`).
- WS contract: none directly.
- Client state:
  - Module-level `gpuEditMode` and `decklinkEditMode` booleans (`device-view-caspar-render.js:16-17`).
  - `bindCasparGpuLayoutDocumentListeners` stores the latest context in module-level `listenerCtx` and binds the document listener once (`device-view-caspar-render-gpu-doc-listeners.js:20-60`).
  - localStorage: `gpu_custom_layout` (`device-view-caspar-render-gpu-doc-listeners.js:71` write; `device-view-caspar-render-markers.js:295` write); `decklink_rear_panel_order` (`device-view-caspar-render-markers.js:239` write; key constant `device-view-decklink-order.js:5`, read `:10`).
  - `highascg_device_view_simple_wiring` (`device-view-simple-wiring-prefs.js:2`).
  - Reads `ctx.currentSettings` and `lastPayload.settings` for `recordOutputs` and `streamOutputs` source labels (`device-view-caspar-render.js:~58-68`, WO-373).
- Browser-only APIs:
  - HTML5 DataTransfer: `dataTransfer.setData/getData/effectAllowed/dropEffect` (`device-view-caspar-render-markers.js:190-265`; `device-view-caspar-render-simple.js:221-224`).
  - `CSS.escape` (`device-view-caspar-render-markers.js:218`).
  - Blob/data-URI download: `exportGpuLayoutFile` builds `data:text/json;charset=utf-8,…` and clicks an `<a download>` (`device-view-caspar-render-gpu-doc-listeners.js:75-86`).
  - `document.addEventListener` for `gpu-layout-changed` (`device-view-caspar-render-gpu-doc-listeners.js:57`).
  - `confirm` (`device-view-caspar-render.js:285`).
  - `<details>` element for the disconnected folder (`device-view-caspar-render.js:~320`).
- Port-risk notes:
  - Pure logic: `buildCasparRearMarkerLayoutItems` (`device-view-caspar-render-markers.js:7-95`) computes slot/row positions and the DeckLink "p1..p4" default reorder (`:~14-25`). Pure except it returns DOM containers.
  - Pure logic: `resolveCanonicalGpuConnectorId`, `casparRearKindTitle`, `casparRearKindToIcon` (`device-view-caspar-render-helpers.js:27-72`).
  - DOM-entangled: the drag-reorder mutates DOM order and the underlying arrays in lock-step (`device-view-caspar-render-markers.js:202-239`, `:262-300`). A port must reproduce "DOM order == array order" by construction.
  - Dead computed values: `x`/`y` on marker items are not used for placement (see Rendering).
  - Heavy use of module-level mutable flags (`gpuEditMode`, `decklinkEditMode`) shared across re-renders.

---

## 5. Port bands and live-source / mapping cards

- Files:
  - `client/components/device-view-bands-render.js` — 492 LOC — the port bands: DeckLink I/O and multiview bands, streaming band, virtual camera band, recording band, `renderBands` orchestrator, "Apply OS settings" button.
  - `client/components/device-view-live-sources-render.js` — 200 LOC — "Live input sources" band (DeckLink, NDI, USB, live audio, webpage) and the add-live-source modal opener.
  - `client/components/device-view-mappings-render.js` — 95 LOC — compact cards for pixel-mapping nodes (WO-42) with output ports and "add output".
  - `client/lib/device-view-decklink-keyfill.js` — 140 LOC — DeckLink fill+key helpers for overlay and inspector (pure). Listed here for the port cards; also used in group 10.
  - CSS: `client/styles/09a3-device-view-segments-mapping.css` — 177 LOC (segments, mapping cards, inspector inputs); `client/styles/09b3-device-view-inspector-sidebar.css` — shares the port styles (see group 8).
- What the operator can do:
  - DeckLink band: one card per DeckLink I/O input and output with direction, device index and status (`device-view-bands-render.js:33-200`). Shows "No DeckLink connectors detected yet. Use 'Sync from hardware' …" when empty (`:193`). Click a port to inspect; drag a DeckLink input port onto a destination output (`dragstart`, `:99-103`).
  - Streaming band: "RTMP output" and "No stream outputs configured." (`device-view-bands-render.js:200-240`), "+" adds a stream output (`:240` via `onAddStreamOutput`).
  - Virtual camera band: "No virtual camera output — click + to add." (`:232-272`), "+" adds (`:279`).
  - Recording band: "No record outputs configured." (`:272-310`), "+" adds (`:310`).
  - Live sources band: lists configured extra live sources and, via `+ Live input`, opens the add modal (`device-view-live-sources-render.js:18-40` `openAddLiveSourceModal`, `:145` `renderLiveSourcesBand`).
  - Mapping cards: "No mapping nodes. Click + to add." (`device-view-mappings-render.js:~60`), "Add mapping node" (`:39`), "+" on a card adds an output (`:85-87`).
  - "Apply OS settings" button: calls `Actions.applyOsSettings()` (`device-view-bands-render.js:461`).
- Rendering tech: DOM (`createElement`, `innerHTML` for empty states at `device-view-bands-render.js:~205-215`). No canvas or SVG beyond the shared overlay.
- Interaction:
  - Click on port: `b.addEventListener('click', () => onPortClick(…))` at `device-view-bands-render.js:109, 131, 149, 181, 223, 263, 295`.
  - Dot click: `device-view-bands-render.js:24-28` (`addPortNodeDot` → `onPortStartCable`).
  - HTML5 drag from DeckLink ports: `dragstart` with `application/x-highascg-connector` (`device-view-bands-render.js:99-103`, `:173-177`; `effectAllowed = 'copyMove'`).
  - Modal: `openAddLiveSourceModal` (`device-view-live-sources-render.js:18`) which calls `showLiveInputModal` (`./live-input-modal.js`).
  - Tooltips: `title` on ports ("Start or complete cable at this connector", `device-view-bands-render.js:24`) and mapping cards ("Cable anchor — arm or complete", `device-view-mappings-render.js:14`).
- Server contract:
  - `POST /api/settings` via `Actions.saveSettingsPatch` for stream/record/audio/virtual list edits — `device-view-bands-render.js` (6 call sites; `saveSettingsPatch`, `device-view-actions.js:54`).
  - `POST /api/device-view` `{addMappingNode:true}` — `device-view-bands-render.js:438` (`device-view-actions.js:312`).
  - `POST /api/device-view` `{deviceGraph}` — `device-view-bands-render.js:428` (`device-view-actions.js:146`).
  - `POST /api/settings/apply-os` — `device-view-bands-render.js:461` (`device-view-actions.js:71`).
  - Mapping nodes via `client/lib/mapping-node-service.js`: `addMappingOutput` (`device-view-mappings-render.js:87`) → `POST /api/device-view` `{deviceGraph}` (`mapping-node-service.js:151-152`) and friends (group 12).
  - Live-input modal (indirect): `GET /api/device-view` (`client/components/live-input-modal.js:107`), `GET /api/system/v4l2-devices?refresh=1` (`:274`), `GET /api/audio/devices?refresh=1` (`:275, :300`), `GET /api/ndi/list` (`:338`); submit paths in `live-input-modal-submit.js:92, 133, 183` `POST /api/device-view {addExtraLiveSource}`.
- WS contract: none directly.
- Client state:
  - Reads `ctx.live`, `lastPayload`, `selectedKey`, `cableSourceId`, `selectedConnectorId`, `simpleWiring`, `currentSettings` (`device-view-render.js:~130-150`).
  - Store key `channelMap` via `getAppStateStore().getState().channelMap` (`device-view-live-sources-render.js:48`).
  - No localStorage in this group.
- Browser-only APIs:
  - HTML5 DataTransfer (`device-view-bands-render.js:99-103`).
  - `dataTransfer.setData` (`device-view-bands-render.js:102-104`).
  - No ResizeObserver / MutationObserver here.
- Port-risk notes:
  - Pure derivation of card rows (`device-view-live-sources-render.js` rows at `:86-135`, from payload fields) is portable; the rendering is DOM.
  - `device-view-decklink-keyfill.js` (pure): `resolveDecklinkKeyFillState` (`:80`), `collectDecklinkKeyFillVirtualEdges` (`:117`).

---

## 6. Screen destinations and host channels

- Files:
  - `client/components/device-view-destinations-ui.js` — 308 LOC — "Screen destinations" panel: one card per destination (PGM/PRV, PGM only, Multiview, Pixel Map, Operator GUI, host channels), drop target for DeckLink connectors, output dots.
  - `client/lib/device-view-host-channels.js` — 329 LOC — virtual host-channel destinations (inputs bus, streaming encode bus, record, live sources): normalisation, listing, `mergeSettingsIntoDeviceViewPayload`, destination-type select population.
  - `client/lib/device-view-host-channels-inputs.js` — 192 LOC — which DeckLink/live-audio/v4l2 input slots are actually active on the wire and how they become host-channel rows (`isDecklinkInputSlotActive` at `:50`).
  - `client/lib/device-view-host-channels-destination-utils.js` — 77 LOC — slot extraction helpers (`decklinkSlotFromHostDestination`, `liveAudioSlotFromHostDestination`, `v4l2SlotFromHostDestination`, `findExtraLiveSourceForHostDestination`).
  - CSS: `client/styles/09a2-device-view-destinations-visual.css` — 350 LOC; `client/styles/09a3-device-view-segments-mapping.css` (shared).
- What the operator can do:
  - Add a destination from the "+" menu (`device-view-events.js:~120-175`): PGM/PRV, PGM only, Multiview, Pixel Map, Operator GUI, or a host-channel source (`host:` prefixed option, `device-view-events.js:~110-135`).
  - Each destination card shows its connections (`getDestinationConnectionLabel`, `device-view-destinations-ui.js:~110-125`) and an "output" port per half (PGM/PRV).
  - Drop a DeckLink connector onto a destination output dot to assign it (`device-view-destinations-ui.js:199-205`; title "Drop DeckLink connector to assign destination output", `:~199`). Calls `setDecklinkAsDestinationOutput` (`device-view-cable-outputs.js:56`).
  - Click a destination card to open its inspector (`device-view-destinations-ui.js:297`).
  - Remove or patch a destination from its inspector (group 8).
  - Empty state: "No destinations yet. Use + to add PGM/PRV, PGM only, Multiview, or a host channel…" (`device-view-destinations-ui.js:~55-70`).
- Rendering tech: DOM (`innerHTML` for cards at `device-view-destinations-ui.js:~65-90`; `createElement` for dots). No canvas.
- Interaction:
  - Click on output dot: `device-view-destinations-ui.js:185` (`outputDot.addEventListener('click', …)`).
  - Drop: `dragover` `:192`, `drop` `:199` (reads `application/x-highascg-connector`, `parseDecklinkDrop` at `:~99-110`, accepts only `kind === 'decklink_io'`).
  - Click on new-destination tile: `:241`, `:297`.
  - Hover intent highlight: `mouseenter`/`mouseleave` (`device-view-destinations-ui.js:295-296`).
  - Native `title`s used for hints.
- Server contract:
  - `POST /api/device-view` `{addDestination}` — `device-view-actions.js:114` (`addDestination`, types `pgm_only|multiview|host_channel|pixelmap|operator_gui|pgm_prv`).
  - `POST /api/device-view` `{updateDestination:{id,…}}` — `device-view-actions.js:85` (`patchDestination`).
  - `POST /api/device-view` `{removeDestination:{id}}` — `device-view-actions.js:89`.
  - `POST /api/device-view` `{applyPlan}` — `device-view-actions.js:142` (`applyDeviceViewPlan`).
  - `POST /api/settings` `{screenDestinations}` path via `saveSettingsPatch` for undo (`device-view-cable.js:110-125`).
  - `POST /api/device-view` `{removeExtraLiveSource}` and `{addExtraLiveSource}` — via lib (indirect; see group 5).
  - `GET /api/settings` (through `settingsState`, `client/lib/settings-state.js:96`) for `caspar.channelMap` merging.
- WS contract: none directly.
- Client state:
  - `state.lastPayload.screenDestinations.destinations` (`device-view-events.js:~128`), `state.currentSettings.screenDestinations`.
  - Store keys: `configComparison` (`device-view-destinations-ui.js:115`), `channelMap` (`client/lib/device-view-host-channels-inputs.js:85`).
  - `highlightDestinationIntent` local highlight (`device-view-destinations-ui.js` `localHighlightIntent`).
- Browser-only APIs: HTML5 DataTransfer (`:100`, `:192-205`, `:247-254`); `dragleave` class removal (`:198`, `:253`).
- Port-risk notes:
  - Host-channel derivation is pure over `payload` plus a channel map (`device-view-host-channels-inputs.js:50-94`, `device-view-host-channels.js:109-242`) — portable.
  - `mergeSettingsIntoDeviceViewPayload` (`device-view-host-channels.js:302`) is a pure merge; `findScreenDestinationById` at `:324`.
  - The DeckLink drop path writes through `setDecklinkAsDestinationOutput` which calls `updateDestinationOutputLayer` path (group 2).

---

## 7. GPU port model and rear-panel layout data (lib)

- Files:
  - `client/lib/device-view-gpu-port-entries.js` — 468 LOC — builds rear-panel GPU port entries from the server topology (`buildGpuEntriesFromTopology` at `:81`, `entryFromTopologyRow` at `:41`, `buildRawGpuPortEntriesFromLive` at `:293`).
  - `client/lib/device-view-gpu-port-list.js` — 181 LOC — entry point for GPU port lists and layout items (`buildGpuLayoutItemsFromLive`, `buildGpuSelectablePortEntries`, `layoutItemsFromGpuEntries`, `entryToRearPanelGpuItem`, `gpuPhysicalPortCableId`); documents the `live.gpu` payload shape in its header (`:1-37`).
  - `client/lib/device-view-gpu-port-merge.js` — 147 LOC — merges entries with saved layout prefs (`mergeGpuLayoutEntriesWithPrefs` `:35`, `resolveGpuSlotIdFromSavedLayout` `:16`).
  - `client/lib/device-view-gpu-port-migrate.js` — 70 LOC — one-time migration of localStorage layout order to the server topology (`migrateLegacyGpuLayoutPrefsToServer` `:38`).
  - `client/lib/device-view-gpu-port-topology.js` — 63 LOC — effective-topology resolution and RTX 20/30 quad detection (`detectRtx2030QuadFromLive` `:20`, `resolveEffectiveGpuTopology` `:41`, `gpuTopologyMismatchActive` `:61`); the header marks quad detection as deprecated.
  - `client/lib/device-view-gpu-port-utils.js` — 241 LOC — counts usable connectors, expected port count, bracket-split consolidation (`consolidateBracketSplitEntries` `:206`), EDID monitor labels, icon hints, `collectGpuPortNameOptions` (`:112`), localStorage override read (`:59`).
  - `client/lib/device-view-gpu-port-layout-prefs.js` — 51 LOC — read/clear saved layout (`readGpuLayoutPrefs` `:13`, `clearGpuLayoutPrefs` `:4`, `gpuLayoutItemsToPhysicalTopology` `:33`).
  - `client/lib/device-view-gpu-port-constants.js` — 10 LOC — storage keys and `RTX_20_30_SOCKET_COUNT = 4` (`:10`).
  - `client/lib/device-view-gpu-port-trace-state.js` — 12 LOC — trace sequence counter.
  - `client/lib/device-view-gpu-layout-debug.js` — 478 LOC — tracing and diagnostics for the GPU layout (console output only; exposes `globalThis.__highascgGpuLayoutDebug` at `:~430-478`).
  - `client/lib/device-view-randr-norm.js` — 10 LOC — `normRandrCaspar` (strip `cardN-` and uppercase, `:8`); shared leaf.
  - CSS: none specific (uses the rear-panel classes in group 4).
- What the operator can do (indirect, through the GPU layout editor and rear panel, groups 4 and 9): see hidden/disconnected GPU ports, reorder them, map a display onto a socket, save/export/load the layout, reset the layout, and read a diagnostics report (console or clipboard).
- Rendering tech: none (pure data). `device-view-gpu-layout-debug.js` writes to `console.info/warn`.
- Interaction: none directly. Debug toggled by localStorage flag and by `globalThis.__highascgGpuLayoutDebug.enable()` / `.disable()` (`device-view-gpu-layout-debug.js:~440-460`), copied via `navigator.clipboard.writeText` (`device-view-gpu-layout-debug.js:470`).
- Server contract:
  - Read: `live.gpu` (`physicalMap.ports`, `physicalMap.effectiveTopology`, `connectors`, `displays`) from `GET /api/device-view` (documented in `device-view-gpu-port-list.js:4-37`).
  - Write: `POST /api/settings` `{gpuPhysicalTopology}` — `device-view-actions.js:67` (`saveGpuPhysicalTopology`); called by `device-view-render.js` migration, `device-view-inspector-gpu-layout-editor.js` (3 call sites), `device-view-cable.js` (`recoverDeviceGraphForCable` via `actions.js:~77`).
  - Read: `GET /api/settings` for `gpuPhysicalTopology` (`device-view-actions.js:50`; `device-view-render.js` merges via `mergeSettingsIntoDeviceViewPayload`).
  - `POST /api/system/gpu-ports-reset` — `device-view-actions.js:321` (via `resetGpuLayout`).
  - `POST /api/device-view` `{deviceGraph}` via `saveDeviceGraph` (group 1/2) for graph writes triggered by migration/layout.
- WS contract: none directly; `gpu_topology_changed` triggers a reload (group 1).
- Client state:
  - localStorage: `gpu_custom_layout` (`device-view-gpu-port-constants.js:7`), `gpu_custom_layout.bak` (`device-view-gpu-port-migrate.js:4`, write `:~46`), `gpu_custom_layout_migrated_v108` (`device-view-gpu-port-migrate.js:5`, read `:40`, write `:65`), `highascg_gpu_rear_port_count` (`device-view-gpu-port-constants.js:2`, read `device-view-gpu-port-utils.js:59`), `highascg_debug_gpu_layout` (`device-view-gpu-layout-debug.js:8`).
  - sessionStorage: `highascg_factory_reset_gpu_layout` (`device-view-gpu-port-constants.js:5`).
  - Module-level trace sequence (`device-view-gpu-port-trace-state.js:1-12`).
- Browser-only APIs:
  - `localStorage` and `sessionStorage` (see above); all access is in try/catch in most places (e.g. `device-view-gpu-port-migrate.js:~38-66`).
  - `navigator.clipboard` (`device-view-gpu-layout-debug.js:470`).
  - `globalThis` assignment (`device-view-gpu-layout-debug.js:~431`).
  - `console` tracing.
- Port-risk notes:
  - Largely pure: entry building, bracket consolidation, merging with prefs, topology resolution. These are portable as-is once the JSON payload shape is fixed.
  - Names are matched by normalised strings (`normRandrCaspar`, DP-N vs DP-(N+1) on the same socket; `device-view-gpu-port-entries.js:~6-12` comment). Port must keep string-based matching semantics.
  - Migration is one-shot and reads legacy localStorage, so behaviour depends on browser storage history.
  - `device-view-gpu-layout-debug.js` (478 LOC) is diagnostics only; not needed for function.

---

## 8. Inspector framework and destination inspector

- Files:
  - `client/components/device-view-inspectors.js` — 81 LOC — dispatcher: `renderConnectorInspector` chooses the kind-specific section (DeckLink, stream, vcam, record, audio, GPU, mapping); re-exports Caspar inspector.
  - `client/components/device-view-inspector-render.js` — 161 LOC — generic rows: `readableConnectorRows` (`:14`), `renderDeviceInspector` (`:77`), `renderEdgeInspector` (`:139`, remove edge button).
  - `client/components/device-view-destinations-inspector.js` — 12 LOC — barrel re-export of the destination inspector.
  - `client/components/device-view-destinations-inspector-form.js` — 468 LOC — screen destination form: name, mode (PGM/PRV, PGM only, Multiview, Pixel Map, Operator GUI), video mode / resolution with math input, layer, audio outputs, remove; `renderDestinationInspector` at `:13`.
  - `client/components/device-view-destinations-inspector-host-channel.js` — 323 LOC — host-channel and live-source inspector: label, route, source ID, Caspar channel; "Remove DeckLink input / NDI source / USB video input / browser source / live audio input / webpage source".
  - `client/components/device-view-destinations-inspector-modes.js` — 270 LOC — Caspar video-mode table and conversions (`CASPAR_VIDEO_MODE_SPECS` `:12`, `casparVideoModeToOsModeAndRate` `:59`, `matchCasparVideoModeFromDimensions` `:134`, `resolveGpuInspectorVideoMode` `:195`).
  - `client/components/device-view-destinations-inspector-operator-gui-fields.js` — 102 LOC — Operator GUI URL, physical port, "Launch / Bring to front" button (`POST /api/operator-gui/launch`).
  - `client/components/device-view-inspector-*` shared inspector helpers used across groups 9-12 are listed there.
  - CSS: `client/styles/09b3-device-view-inspector-sidebar.css` — 376 LOC (inspector sidebar, port sidebar, inputs).
- What the operator can do:
  - Select a device (Server, GPU, DeckLink, etc.) and see a table of readable fields: "AMCP port", "Caspar main", "Connected", "Connector", "Device ID", "Hardware ID", "Out cables", "In cables", etc. (`device-view-inspector-render.js:14-75`).
  - Select a cable and see its ids and "Remove" (`device-view-inspector-render.js:139-161`).
  - Edit a destination: name, mode, resolution and video mode via math input (`device-view-destinations-inspector-form.js`), layer, remove destination ("Remove destination" button text at `device-view-destinations-inspector-form.js:~440-460`).
  - Operator GUI destination: set the GUI URL, pick a physical port (or "Auto (operator monitor, else multiview jack)"), launch or bring the Firefox operator window to front (`device-view-destinations-inspector-operator-gui-fields.js:84`).
  - Host-channel / live source destination: see host layer, route and source id, and remove the source (`device-view-destinations-inspector-host-channel.js:51-53` rows and remove buttons).
  - Inspector for the destination list states "Details in right panel." when the external inspector host is used (`device-view-selection.js:14-30`).
- Rendering tech: DOM. Tables built with `buildInspectorTable` (`device-view-ui-utils.js:70`); forms built with `Object.assign(document.createElement(...))`. Inspector is rendered into the app's right panel (`device-view.js:~24-26`: `panel-inspector-scroll` / `panel-inspector-body`, class `device-view--external-inspector`).
- Interaction:
  - Selection flow: `ctx.selectKey`, `selectDevice`, `selectEdgeById`, `selectDestinationById` (`device-view-selection.js:61`, `:34`, `:148`, `:160`).
  - Inputs with change/blur handlers (`device-view-destinations-inspector-form.js` `addEventListener` ×16, `device-view-destinations-inspector-host-channel.js` ×6).
  - Math input: `attachMathInput` from `client/lib/math-input.js` (imported by the form and the modeline section).
  - Confirm and alert dialogs: the host-channel inspector asks `confirm()` before each remove (`device-view-destinations-inspector-host-channel.js:168, 201, 224, 247, 279, 305`) and shows `window.alert` on failure (`:188, 211, 234, 257, 290, 315`).
  - `title` tooltips ("Run in fullscreen mode", etc., in group 9).
- Server contract:
  - `POST /api/device-view` `{updateDestination}` / `{removeDestination}` — `device-view-actions.js:85`, `:89` (called from `device-view-selection.js` `ctx.patchDestination`/`ctx.removeDestination`, `device-view-selection.js:~210-215`).
  - `POST /api/operator-gui/launch` `{}` — `device-view-destinations-inspector-operator-gui-fields.js:84`.
  - `POST /api/device-view` `{updateConnector}` for connector caspar patches — `device-view-actions.js:218`.
  - Host-channel removal (indirect): `POST /api/device-view {removeExtraLiveSource}` (`client/lib/extra-live-source-remove.js:36`), `POST /api/raw` `STOP`/`MIXER CLEAR` AMCP lines (`extra-live-source-remove.js:15-16`), `POST /api/host-live/operator-fullscreen` (`extra-live-source-remove.js:33`), `POST /api/v4l2-inputs/config` (`client/lib/v4l2-remove-input.js:35`), `POST /api/audio/live-inputs/config` (`client/lib/live-audio-remove-input.js:50`).
- WS contract: none directly.
- Client state:
  - `state.selected*` (group 1).
  - `currentSettings`, `lastPayload` passed into each renderer.
  - Operator GUI launch result read from `res.reason` (`device-view-destinations-inspector-operator-gui-fields.js:~90`).
- Browser-only APIs:
  - `document.activeElement` / `input:focus` checks (`device-view-render.js:~62-67` `restoreInspectorSelection`; `device-view-ui-utils.js:163` `renderPreservingFocus` with selection save/restore).
  - `window.dispatchEvent(new CustomEvent('highascg-device-view-focus-connector', …))` (`device-view-destinations-inspector-form.js:118`, `device-view-destinations-inspector-host-channel.js:148`).
  - `window.dispatchEvent(new CustomEvent('highascg-device-view-update-payload', …))` from mapping inspector (`device-view-inspector-mapping.js:58, 97, 134`).
- Port-risk notes:
  - `device-view-destinations-inspector-modes.js` is pure lookup/conversion logic (CASPAR video mode specs and OS-mode mapping), portable as-is. It declares itself "Matches server `src/config/config-modes.js`" (`:1`), so a port must keep it in sync with the server.
  - Form and host-channel modules mix validation, patch building and DOM. Patch-building is pure but not separated.

---

## 9. Inspector: GPU outputs and video modeline

- Files:
  - `client/components/device-view-inspector-gpu.js` — 474 LOC — GPU output controls: summary rows (`buildGpuInspectorSummaryRows` `:23`), monitor/video mode/stretch/fullscreen/windowed/border/vsync, pointer confine, interactive/operator monitor, name and aspect, OS/xrandr section entry, "Reset all settings for this screen" (`:358`).
  - `client/components/device-view-inspector-gpu-layout-editor.js` — 393 LOC — GPU layout editor shown in edit mode: reorder rows by drag, Assign display to socket, Hide all / Hide disconnected / Show all, Save, Export, Load, Reset layout.
  - `client/components/device-view-inspector-gpu-resolve.js` — 119 LOC — maps a physical rear jack to Caspar screen index (`gpu_p0 → 1`, `gpu_p2 → 3`), detected display lookups (pure).
  - `client/components/device-view-inspector-gpu-video-modeline.js` — 475 LOC — video mode select, EDID/xrandr display selection, custom WxH × fps, timing preview, "use detected display mode", OS apply.
  - `client/components/device-view-inspector-gpu-video-modeline-os-settings.js` — 103 LOC — OS-setting read/patch builders for per-port keys (`resolveMainScreenCount`, `readPortOsValue`, `buildPerPortOsSettingsPatch`, `expandBlanketOsPatch`).
  - `client/components/device-view-inspector-gpu-video-modeline-preview.js` — 235 LOC — debounced timing-preview request and mode-selection readers (`createModelineTimingPreview` `:97`, `createModeSelectionReaders` `:14`, `wireModelineInputEvents` `:180`).
  - `client/components/device-view-gpu-source-inherit.js` — 183 LOC — **orphan copy** (see Area totals). Same role as `client/lib/device-view-gpu-source-inherit.js`; no importer in the client uses this copy.
  - `client/lib/device-view-gpu-source-inherit.js` — 184 LOC — the live copy: resolves feed resolution from a cable source and builds screen-consumer settings patches (`resolveCableSourceResolution` `:121`, `gpuOutputBindingFromCableSource` `:132`, `gpuScreenInheritedSettingsPatch` `:155`, `mergeSettingsPatches` `:172`). Used by `device-view-cable.js`, `device-view-inspector-gpu-video-modeline.js`, `device-view-inspector-mapping.js`.
  - CSS: `client/styles/09a1-device-view-layout-toolbar.css` (layout); the inspector parts are in `09b3`.
- What the operator can do:
  - Choose the screen's video mode (standard or custom), EDID override, and display from the connected monitors (`device-view-inspector-gpu-video-modeline.js:34` `populateGpuVideoModelineSection`).
  - See the timing preview (CVT or GTF) for the chosen resolution; "Timing preview (CVT/GTF for the resolution below)" (`device-view-inspector-gpu-video-modeline-preview.js`, title text in group 9).
  - Apply the OS (xrandr) resolution and refresh via "OS apply backend" and OS settings (`device-view-inspector-gpu.js:~150-200`).
  - Set window/fullscreen/border/vsync and colour options; name and aspect ratio (`device-view-inspector-gpu.js:130-230`).
  - Set "pointer confine" auto/on/off (`device-view-inspector-gpu.js:181-197`, saved under `operatorTools.pointerConfine`).
  - Layout editor (edit mode): drag rows to reorder, Assign, Hide/Show, Save (writes `gpu_custom_layout` and the server topology), Export (JSON download), Load (JSON file; `alert` on invalid file, `device-view-inspector-gpu-layout-editor.js:329-345`), Reset layout (`confirm`, `:357`, then `resetGpuLayout`), "Unmapped live displays — assign to a socket" note.
- Rendering tech: DOM (`createElement` for inputs, `innerHTML` for small blocks). The layout editor uses HTML5 DnD rows.
- Interaction:
  - Form inputs: `addEventListener('change'|'input')` throughout (`device-view-inspector-gpu.js` `addEventListener` ×15, `device-view-inspector-gpu-video-modeline.js:~ 327-330`).
  - Drag rows: `dragstart` writes `application/x-highascg-inspector-gpu-slot` (`device-view-inspector-gpu-layout-editor.js:181-183`); `dragover` (`:196`) and `drop` (`:207-210`) reorder; `dragend` (`:185`), `dragleave` (`:206`).
  - File input for Load (`device-view-inspector-gpu-layout-editor.js:309-335`); Export via data-URI download (`:321`, `exportGpuLayoutFile`).
  - Debounced timing preview: `setTimeout(..., 280)` (`device-view-inspector-gpu-video-modeline-preview.js:138`).
  - Modal dialogs: `alert`, `confirm` (`device-view-inspector-gpu-layout-editor.js:331, 342, 345, 357, 371`).
- Server contract:
  - `POST /api/settings` via `saveSettingsPatch` — `device-view-inspector-gpu.js` (5 call sites; `device-view-actions.js:54`).
  - `POST /api/settings/apply-os` — `applyOsSettings` (`device-view-actions.js:71`; caller in `device-view-bands-render.js:461`).
  - `GET /api/hardware/modeline-preview?w=&h=&rate=&type=` — `device-view-actions.js:81` (`getModelinePreview`), called from `device-view-inspector-gpu-video-modeline-preview.js:146`.
  - `POST /api/settings` `{gpuPhysicalTopology}` — `device-view-actions.js:67` (layout editor, 3 call sites).
  - `POST /api/system/gpu-ports-reset` — `device-view-actions.js:321` (`resetGpuLayout`), layout editor 2 call sites.
  - Mapping lookups (indirect): `client/lib/mapping-node-service.js` (`resolveMappingOutputResolution`) for the video-mode stored in the screen destination.
- WS contract: none directly.
- Client state:
  - localStorage `gpu_custom_layout` (`device-view-inspector-gpu-layout-editor.js:335`).
  - Settings read from `currentSettings` (`device-view-inspector-gpu-video-modeline-os-settings.js:11-35`); `screen_N_system_id` style keys (`device-view-inspector-gpu-resolve.js:~1-10` header).
  - Module reads of `payload.live.gpu.displays`.
- Browser-only APIs:
  - HTML5 DataTransfer (`device-view-inspector-gpu-layout-editor.js:181-210`).
  - `File.text()` for JSON load (`device-view-inspector-gpu-layout-editor.js:329`).
  - `<a download>` data-URI export (`device-view-caspar-render-gpu-doc-listeners.js:75-86`).
  - `setTimeout` debounce (`device-view-inspector-gpu-video-modeline-preview.js:138`).
  - `window.alert` / `window.confirm`.
- Port-risk notes:
  - Pure logic: `device-view-inspector-gpu-resolve.js` (port index mapping, detected display lookup), `device-view-inspector-gpu-video-modeline-os-settings.js` (patch builders), `device-view-destinations-inspector-modes.js` (video mode table and dimension matching), `lib/device-view-gpu-source-inherit.js` (feed resolution and patch merge). All portable.
  - The timing preview (CVT/GTF) is computed by the server (`/api/hardware/modeline-preview`); the client only displays it. A Godot port should not re-derive timings from this client file.
  - `device-view-inspector-gpu-video-modeline.js` (475 LOC) mixes EDID, xrandr, mode selection, preview and patch building in one module.

---

## 10. Inspector: DeckLink I/O

- Files:
  - `client/components/device-view-inspector-decklink.js` — 79 LOC — entry: `renderDeckLinkIoControls` dispatches to input or output section.
  - `client/components/device-view-inspector-decklink-input.js` — 148 LOC — DeckLink input routing: "Start an input" / "Stop input" (calls the lib `decklink-add-input.js`).
  - `client/components/device-view-inspector-decklink-output.js` — 392 LOC — DeckLink output: inherit status and 1:1 passthrough text, consumer settings (latency, colour space, pixel format, channel layout, embedded audio, low-latency), fill+key (keyer) controls.
  - `client/components/device-view-inspector-decklink-rear-order.js` — 157 LOC — rear-panel DeckLink order editor: drag rows, Save, Export (JSON), Load (JSON file), Reset order.
  - `client/components/device-view-inspector-decklink-shared.js` — 103 LOC — option constants (`DECKLINK_LATENCY_OPTIONS` `:6`, `DECKLINK_COLOR_SPACE_OPTIONS` `:7`, `DECKLINK_PIXEL_FORMAT_OPTIONS` `:14`, `DECKLINK_CHANNEL_LAYOUT_OPTIONS` `:25`) and status formatting.
  - `client/lib/device-view-decklink-keyfill.js` — 140 LOC — fill+key pairing helpers (`decklinkConnectorByDeviceIndex` `:9`, `resolveDecklinkKeyFillState` `:80`, `collectDecklinkKeyFillVirtualEdges` `:117`) (pure).
  - `client/lib/device-view-decklink-order.js` — 37 LOC — listed in group 4 (rear order persistence).
  - CSS: DeckLink styles are in `09b3-device-view-inspector-sidebar.css` and `09b2-device-view-backpanel-hardware.css`.
- What the operator can do:
  - Start or stop a DeckLink input from the inspector (`device-view-inspector-decklink-input.js:21`; buttons "Start an input" / "Stop input"); starting replaces the slot's live channel with `PLAY … DECKLINK …` AMCP (lib `decklink-add-input.js:79-81`).
  - Choose consumer settings for a DeckLink output: latency, colour space, pixel format, channel layout, embedded audio, low latency (`device-view-inspector-decklink-output.js:98-280`).
  - Toggle "Fill + key" and configure the key output (`device-view-inspector-decklink-output.js:280-366`; checkbox `kfCheck` at `:290`).
  - See "1:1 passthrough <w>×<h> → SDI <mode>" and "Upstream: …" (`device-view-inspector-decklink-output.js:42-60`).
  - Reorder DeckLink rear ports (edit mode on the rear panel, or the inspector list), then Save, Export (JSON), Load (JSON) or Reset order (`device-view-inspector-decklink-rear-order.js:9-157`).
- Rendering tech: DOM. The rear-order list is a set of `<div>` rows with HTML5 drag (`device-view-inspector-decklink-rear-order.js:49-81`).
- Interaction:
  - Drag rows: `dragstart` (`:64-66`, `application/x-highascg-inspector-decklink-slot`), `dragover` (`:71`), `drop` (`:78-81`), `dragend` (`:68`), `dragleave` (`:75`).
  - Load: `fileIn.click()` (`:~122`) then `file.text()` (`:128`) and JSON parse.
  - Export: `data:text/json` + `<a download="decklink_rear_panel_order.json">` (`:~110-117`).
  - Input and checkbox change handlers (`device-view-inspector-decklink-output.js` `addEventListener` ×5; `device-view-inspector-decklink-rear-order.js` `addEventListener` ×5).
- Server contract:
  - `POST /api/device-view` `{updateConnector:{id, patch:{caspar:…}}}` — `device-view-inspector-decklink-output.js:264, 344` (`updateConnector`, `device-view-actions.js:218`).
  - DeckLink input start/stop (indirect, `client/lib/decklink-add-input.js`): `POST /api/raw` with `STOP <channel>`, `MIXER <channel> CLEAR`, `PLAY <channel> DECKLINK <n>` (`decklink-add-input.js:79-81`); `POST /api/host-live/decklink` (`:96`, `:116`, `:206`); `POST /api/device-view` `{addExtraLiveSource}` (`:183`, `:243`, `:261`); `{removeEdge}` (`:298`).
  - Rear order persistence is client-only (localStorage).
- WS contract: none directly.
- Client state:
  - localStorage `decklink_rear_panel_order` — written `device-view-inspector-decklink-rear-order.js:31`, removed `:146` (Reset order); read `client/lib/device-view-decklink-order.js:10`.
  - `window.__highascgApplyExtraLiveSources` global hook called after input changes (`device-view-inspector-decklink-input.js:125-126`; defined in `client/app.js:316`).
  - `decklinkEditMode` (group 4).
- Browser-only APIs:
  - HTML5 DataTransfer for rows (`device-view-inspector-decklink-rear-order.js:64-81`).
  - `File.text()` (`:128`); `Blob`/data-URI download (`:~110-117`).
  - `alert` on an invalid order file (`device-view-inspector-decklink-rear-order.js:139`); `confirm` before Reset order (`:144`).
- Port-risk notes:
  - Pure: `decklink-order` (`orderDecklinkConnectors`), `keyfill` helpers and option constants.
  - DeckLink input start calls AMCP commands via `/api/raw` — the Godot port must issue the same server-side actions, not talk to CasparCG directly.

---

## 11. Inspector: stream, record, virtual camera, audio outputs

- Files:
  - `client/components/device-view-inspector-stream.js` — 365 LOC — stream output controls: RTMP/SRT fields (URL, stream key, SRT latency/streamid/passphrase), quality, codec, bitrate, start/stop, save, stream log, remove output.
  - `client/components/device-view-inspector-record.js` — 175 LOC — record output: name, CRF or video bitrate, audio bitrate, start/stop, save, record log, remove.
  - `client/components/device-view-inspector-virtual-cam.js` — 240 LOC — virtual camera (v4l2 loopback): device path, resolution, label, start/stop, save, remove, hide.
  - `client/components/device-view-inspector-audio.js` — 267 LOC — audio output: PortAudio / system audio device, buffer frames, FIFO ms, latency ms, PortAudio output layout, label, remove.
  - CSS: shared with group 8/9 (`09b3-device-view-inspector-sidebar.css`).
- What the operator can do:
  - Stream: enter RTMP or SRT URL, choose a quality preset and codec/bitrate, Save stream settings, Start stream, Stop stream, view "Stream log", remove the output (`device-view-inspector-stream.js:20-365`). Placeholders: `rtmp://server/app or srt://host:port`, `SRT latency ms`, `SRT streamid (optional)`. Clear the saved stream key or SRT passphrase (titles at `device-view-inspector-stream.js:~150-200`).
  - Record: name, video kbps (0 = CRF), audio kbps; Start record, Stop record, Save record settings, "Record log", Remove record output. Helper text: "Use cable from destination to choose which channel this record output captures." (`device-view-inspector-record.js:32-175`).
  - Virtual cam: device path (placeholder `/dev/video10`), resolution (`1920x1080`), label; Start / Stop virtual cam, Save settings, Remove output, Hide virtual camera (`device-view-inspector-virtual-cam.js:54-240`).
  - Audio: choose the output device (PortAudio or system), buffer frames, FIFO ms, latency ms, PortAudio layout up to 16 channels; Remove audio output (`device-view-inspector-audio.js:39-267`). Note text: "System Audio is stereo-only (headphones / monitor)." (`:~140-150`).
- Rendering tech: DOM (forms, `<select>`, `<input>`, `<pre>`-like log box via `innerHTML`/`textContent`). No canvas, no `<video>`.
- Interaction:
  - Form handlers via `addEventListener`/`onclick`. Log boxes subscribe to status (see WS).
  - Confirm before removal: stream (`device-view-inspector-stream.js:339`), record (`device-view-inspector-record.js:150`), audio (`device-view-inspector-audio.js:218`), virtual cam (`device-view-inspector-virtual-cam.js:211`).
  - `title` tooltips on SRT fields and remove buttons.
- Server contract:
  - Stream: `GET /api/streaming-channel` (via `getStreamingChannelStatus`, `device-view-actions.js:224`); `POST /api/streaming-channel/rtmp` `{action:'start'|'stop', …}` (`device-view-actions.js:238, 252`); `POST /api/project/streaming-credentials` (`device-view-actions.js:267`; stream key never returned by the server, per comment at `:~258`); `POST /api/settings` `{streamOutputs}` and `{streamingChannel}` (`device-view-inspector-stream.js:219`, `:287`).
  - Record: `POST /api/streaming-channel/record` `{action:'start'|'stop', outputId, …}` (`device-view-actions.js:295, 308`); `GET /api/streaming-channel` for status (`device-view-actions.js:279`); `POST /api/settings` `{recordOutputs}` (via `saveSettingsPatch`, `device-view-matrix.js:42` for add; inspector for save/remove).
  - Virtual cam (via `client/lib/virtual-camera-state.js`): `GET /api/virtual-camera/status` (`:36`), `POST /api/virtual-camera/config` (`:65`), `POST /api/virtual-camera/start` (`:74`), `POST /api/virtual-camera/stop` (`:83`).
  - Audio: `GET /api/audio/portaudio-devices?refresh=1&outputsOnly=false` (`device-view-inspector-audio.js:126`); `GET /api/audio/devices?refresh=1` (`:127`); `POST /api/settings` `{audioOutputs}` via `saveSettingsPatch` (`device-view-inspector-audio.js:202`).
  - Remove audio / stream / record / vcam outputs: `POST /api/settings` `{audioOutputs: filtered}` etc. (grep: `saveSettingsPatch({ audioOutputs: cur.filter(...) })`, `{streamOutputs: …}`, `{recordOutputs: …}`), and cable cleanup via `POST /api/device-view {removeEdge}` (`device-view-cable-outputs.js` helpers `removeStreamOutputConnector` `:89`, `removeRecordOutputConnector` `:107`, `removeAudioOutputConnector` `:124`, `removeVirtualCamOutputConnector` `:139`).
- WS contract (read):
  - `streaming_channel` — consumed through `subscribeStreamingChannelStatus` (`device-view-inspector-stream.js:360`, `device-view-inspector-record.js:169`). Source: `client/lib/app-ws-handlers.js:192` → `ingestStreamingChannelWsEvent` (`client/lib/streaming-channel-state.js:232`).
  - Virtual cam status: `subscribeVirtualCameraStatus` (`device-view-inspector-virtual-cam.js:148`); no WS (`client/lib/virtual-camera-state.js:29-50` uses HTTP refresh).
  - DOM event dispatched: `highascg-streaming-changed` (`device-view-inspector-stream.js:312, 324`); not listened to in device-view files.
- Client state:
  - Shared status stores in `client/lib/streaming-channel-state.js` (`getStreamingChannelStatus` `:205`, `subscribeStreamingChannelStatus` `:212`) and `client/lib/virtual-camera-state.js` (`getVirtualCameraStatus` `:21`).
  - `state.streamingStatus` on the orchestration state (`device-view-render.js:~254, 292`).
  - Log boxes hold `_streamStatusUnsub` / `_recordStatusUnsub` on DOM nodes (`device-view-inspector-stream.js:360`, `device-view-inspector-record.js:169`).
- Browser-only APIs: `setInterval`/`clearInterval` not used here; subscriptions are plain callbacks. No `ResizeObserver` or `MutationObserver`.
- Port-risk notes:
  - Stream and record controls are pure form-to-patch logic plus HTTP.
  - `streaming-channel-state.js` normalisation (`normalizeStreamingChannelStatus` `:109`) is shared with the rest of the app and lives outside this glob.

---

## 12. Inspector: Caspar server, hot backup, mapping nodes

- Files:
  - `client/components/device-view-inspector-caspar.js` — 277 LOC — Server inspector: project frame rate, network (interfaces, apply), host/hostname/platform/AMCP info, Factory reset (WO-59).
  - `client/components/device-view-inspector-replication.js` — 173 LOC — hot backup (replication) section: mode status, buttons, `renderReplicationInspector` `:11`.
  - `client/components/device-view-inspector-replication-controls.js` — 362 LOC — hot backup controls: scan for leaders, become leader, stop offering, connect, disconnect, refresh connection, apply Device View → Caspar; status polling.
  - `client/components/device-view-inspector-replication-shared.js` — 387 LOC — pure formatters and row builders for the hot-backup tables (`formatCasparFps` `:5`, `formatAgeMs` `:21`, `formatDriftMs` `:28`, `formatChannelParity` `:34`, `formatCasparParity` `:41`, `formatStatus` `:53`, `buildPeerRows` `:97`, `buildLocalRows` `:197`).
  - `client/components/device-view-inspector-mapping.js` — 366 LOC — pixel-mapping node inspector (WO-41): rename, duplicate, delete node; add/remove/edit outputs; "Propose outputs from input"; "Split input resolution evenly across outputs"; "Show Mapping Preview"; per-output custom modes; `renderMappingNodeInspector` `:23`, `renderMappingConnectorControls` `:341`.
  - CSS: `client/styles/09c-device-view-config-modal.css` — 120 LOC (`.caspar-config-modal` styles; used by `caspar-config-modal.js`, which is outside the device glob); `client/styles/09b2` hardware parts.
- What the operator can do:
  - Server: set the project frame rate ("Save project frame rate") that new outputs inherit (`device-view-inspector-caspar.js` text "Output video modes inherit this rate until you change them per connector."); see network interfaces and "Apply network"; "Factory reset" after confirm (`device-view-inspector-caspar.js:242-252`; confirm text "PURGE ALL CONFIG? …"). Factory reset calls `factoryResetConfig` which imports `client/lib/default-project.js` `performFactoryReset`.
  - Hot backup: "Scan for leaders", pick a leader, "Connect to leader", "Disconnect (standalone)", "Become leader", "Stop offering as leader", "Refresh connection", "Apply Device View → Caspar" (`device-view-inspector-replication.js:~40-60`, `device-view-inspector-replication-controls.js:116-337`). Status table with peer rows, local rows, warnings ("Live-state WebSocket disconnected — mirror may be stale after restart.", `device-view-inspector-replication-shared.js:377-380`).
  - Mapping node: rename, duplicate, delete, add output, remove output, propose outputs from the input, set custom mode per output, see "Mapping node not found." fallback (`device-view-inspector-mapping.js:341-366`).
- Rendering tech: DOM. Status tables are built by `buildInspectorTable`-style row arrays (`device-view-inspector-replication-shared.js`).
- Interaction:
  - Buttons with `onclick` (`device-view-inspector-replication-controls.js` ×7; `device-view-inspector-mapping.js` ×7).
  - Inputs with `change`/`input` (`device-view-inspector-mapping.js` ×5 `oninput|onchange`).
  - Replication poll: `setInterval(() => refreshStatus(), 3000)` (`device-view-inspector-replication-controls.js:353`), refreshed also on `highascg-device-view-focus-server` (`:355-356`).
  - `confirm` on factory reset (`device-view-inspector-caspar.js:245`).
- Server contract:
  - `GET /api/system/network` — `device-view-inspector-caspar.js:201`.
  - `POST /api/system/network/apply` — `device-view-inspector-caspar.js:183`.
  - `POST /api/settings` — project frame rate via `saveSettingsPatch` (`device-view-inspector-caspar.js`, 2 call sites).
  - `GET /api/replication/leaders` — `device-view-inspector-replication-controls.js:116`.
  - `GET /api/replication/status` — `device-view-inspector-replication-controls.js:152`; also `client/lib/replication-ui-state.js:94` (refresh-soon path).
  - `POST /api/replication/become-leader` — `:177`; `POST /api/replication/stop-leader` — `:194, :337`; `POST /api/replication/connect` — `:218`; `POST /api/replication/disconnect` — `:248`; `POST /api/replication/refresh-connection` — `:270`; `POST /api/replication/apply-device-view-caspar` — `:303`.
  - Mapping node via `client/lib/mapping-node-service.js`: `POST /api/device-view` `{removeMappingNode:{id}}` (`mapping-node-service.js:296`), `GET /api/device-view?_ts=` (`:148`), `POST /api/device-view` `{deviceGraph}` (`:152`); `proposeMappingOutputsFromInput` (`:385`), `renameMappingNode` (`:204`), `duplicateMappingNode` (`:221`), `deleteMappingNode` (`:290`), `addMappingOutput` (`:304`), `removeMappingOutput` (`:324`), `updateMappingOutputFields` (`:354`).
  - Factory reset: `client/lib/default-project.js` `performFactoryReset` (not in glob); also `POST /api/…` endpoints inside it are outside this area.
- WS contract (read):
  - `replication_status` — `client/lib/replication-ui-state.js:117` (`ws.on('replication_status', …)`) triggers a status refresh; used by the replication inspector indirectly.
- Client state:
  - Module-level `lastStatus`, `pollTimer` (`device-view-inspector-replication-controls.js:44-46`).
  - sessionStorage key for the replication inspector mode: lives in `client/lib/replication-ui-state.js:143-158` (`INSPECTOR_MODE_KEY`), used by this inspector.
  - Hot-backup project helpers in `client/lib/hot-backup-project.js` (no network calls in that file).
- Browser-only APIs:
  - `setInterval` (`:353`), `window.addEventListener('highascg-device-view-focus-server', …)` (`:356`).
  - `confirm` (`device-view-inspector-caspar.js:245`).
  - `sessionStorage` (indirect, `replication-ui-state.js`).
- Port-risk notes:
  - `device-view-inspector-replication-shared.js` formatters are pure (portable as-is), including the mirror-lag and parity wording.
  - Mapping layout proposal (`client/lib/mapping-node-service.js:120` `proposeMappingOutputLayout`, `:23-120` parsing and resolution helpers) is pure and portable.
  - Polling every 3 s and mode persistence define observable behaviour; the Godot port must reproduce the 3 s poll if it keeps the same UX.

---

## 13. Snapshots (save, load, rear-panel capture)

- Files:
  - `client/components/device-view-snapshot-modals.js` — 232 LOC — Save device snapshot modal (preview of the rear-panel PNG, download JSON) and Load device snapshot modal (file picker, dry-run preview, apply with mode choice).
  - `client/lib/device-snapshot-capture.js` — 46 LOC — `slugifyDeviceName` (`:7`), `captureRearPanelVisual` (`:21`, uses the vendored `html-to-image` `toPng` via dynamic import, `:25`).
  - Shared CSS: `09c-device-view-config-modal.css` (modal styles shared by the caspar config modal).
- What the operator can do:
  - "Save device snapshot" (toolbar button, title "Save device snapshot (cabling + GPU/DeckLink profile as JSON)"): name the device (placeholder `e.g. OB truck Caspar 1`), optionally include a rear-panel PNG, then download `<slug>.json` (`device-view-snapshot-modals.js:39-120`; file name shown as `File: ${slug}.json` `:~?`). Save text: "Saves device graph, screen destinations, GPU layout & DeckLink-related screen settings." (`:~45`).
  - "Load device snapshot": pick a `.json` file, press "Preview" for a dry run (lists "Mode", "Sections", "Changed keys"), choose apply mode (full or graphOnly), press "Apply" (`window.confirm`) to write (`device-view-snapshot-modals.js:120-232`).
  - Modal dismissal by clicking the backdrop (`device-view-snapshot-modals.js:24-26`).
- Rendering tech: DOM modal (fixed-position backdrop div appended to `document.body`, `device-view-snapshot-modals.js:16-31`). Rear-panel PNG via `html-to-image` (DOM-to-raster, `device-snapshot-capture.js:25-35`). The vendored module is mapped in `client/index.html:23` and `:47` (`/vendor/html-to-image/es/index.js`).
- Interaction:
  - Modal buttons (`onclick`, `:~85-95`), file input `onchange` (`:~150-170`), Preview/Apply handlers (`:~180-232`).
  - `window.confirm` before apply (`device-view-snapshot-modals.js` `applyBtn.onclick`).
  - Download via `URL.createObjectURL` and `a.click()` (`device-view-snapshot-modals.js:7-13`).
- Server contract:
  - `GET /api/device-snapshot/build` — `device-view-snapshot-modals.js:85` (`api.get`) and `device-view-actions.js:46` (`buildDeviceSnapshotEnvelope`, not called elsewhere).
  - `POST /api/device-snapshot/apply` `{snapshot, mode, dryRun: true}` — `device-view-snapshot-modals.js:191`.
  - `POST /api/device-snapshot/apply` `{snapshot, mode, dryRun: false}` — `device-view-snapshot-modals.js:215`.
  - `device-view-actions.js:38` (`applyDeviceSnapshot`) is exported but not called from `client/` (the modal calls `api.post` directly).
  - Reconcile modal (outside glob) also calls `device-view/snapshot` and `device-snapshot/build` (`client/lib/project-hardware-mismatch.js:33-34`).
- WS contract: none directly. After apply, the modal dispatches `highascg-settings-applied` (`device-view-snapshot-modals.js` apply handler) so the view reloads.
- Client state: none persisted; the loaded JSON lives in a closure (`lastParsed`).
- Browser-only APIs:
  - `Blob` and `URL.createObjectURL` / `URL.revokeObjectURL` (`device-view-snapshot-modals.js:7-13`).
  - `FileReader.readAsText` (`device-view-snapshot-modals.js:169-177`).
  - `html-to-image` (`device-snapshot-capture.js:25`): DOM rasterisation of the rear panel.
  - `window.confirm` (apply).
  - `document.body` modal append.
- Port-risk notes:
  - Snapshot JSON format is produced and validated by the server; the client only transports it. Port needs to keep the same JSON envelope.
  - The PNG of the rear panel is a DOM rasterisation; there is no native equivalent in this client, so a Godot port would render the panel itself or drop the image.
  - `slugifyDeviceName` is pure (`device-snapshot-capture.js:7`).

---

## Area totals

**Files and LOC (device JS and CSS)**

- Components: 53 JS files, 13,131 LOC (`client/components/device*.js`), includes 1 orphan copy (`client/components/device-view-gpu-source-inherit.js`, 183 LOC).
- Lib: 27 JS files, 3,469 LOC (`client/lib/device*.js`).
- CSS: 12 files, 1,902 LOC (`client/styles/09*.css`; of which 7 are `@import` aggregators: `09-device-view.css` 7, `09a-…layout-destinations.css` 6, `09b-…connectors-inspector.css` 4; content files: `09a1` 87, `09a2` 350, `09a3` 177, `09b1` 265, `09b2` 251, `09b3` 376, `09c` 120, `09d` 130, `09e` 129).
- Total: 80 JS files (16,600 LOC) plus 12 CSS files (1,902 LOC) = 18,502 LOC.

**Top 5 most complex files and why**

1. `client/components/device-view-cable.js` (455 LOC) — cable state machine: arm/complete, re-grab (`:168`, `:224`), add-cable path that writes edges, seeds screen consumer defaults and PRV layer, retries on unknown connector ids (`:301-400`), and an undo stack. Many async writes with rollback paths.
2. `client/components/device-view-cables-physics.js` (223 LOC) — Verlet hanging-cable simulation with three constraint families, 200 iterations × 6 substeps per cable (`:139-141`), deterministic `srand` coils (`:16-19`), int32 colour hash (`:15-22`), cache keyed by coordinates.
3. `client/lib/device-view-gpu-port-entries.js` (468 LOC) — builds rear-panel GPU port entries from topology and live data, collapses bracket-split DP-N/DP-(N+1) pairs onto one socket, consults EDID/xrandr names (`:81-293`).
4. `client/components/device-view-inspector-gpu-video-modeline.js` (475 LOC) — EDID/xrandr display selection, custom WxH×fps, timing preview wiring, OS apply, and patch construction in one module (`:34` `populateGpuVideoModelineSection`).
5. `client/components/device-view-caspar-render.js` (462 LOC) — rear-panel build: slot model, GPU/DeckLink edit toggles with module-level flags, layout mutation, confirm-dialog reset, and the layout-to-DOM contract that the marker drag code depends on (`:30-462`).

Honourable mention: `client/components/device-view-caspar-render-markers.js` (341 LOC) for drag-to-reorder that keeps DOM order and array order in sync by hand.

**Distinct API endpoints used by this area**

Direct (in device-view files):
- GET /api/device-view (query: freshGpu=1, _ts=)
- GET /api/device-view/snapshot
- POST /api/device-view (bodies: addDestination, updateDestination, removeDestination, applyPlan, deviceGraph, syncFromLive [no caller], addEdge, removeEdge, removeAllEdges, updateConnector, addMappingNode)
- GET /api/settings
- POST /api/settings (bodies: deviceGraph, screenDestinations, gpuPhysicalTopology, streamOutputs, recordOutputs, audioOutputs, streamingChannel, operatorTools, caspar/screen-consumer patches)
- POST /api/settings/apply-os
- GET /api/hardware/modeline-preview
- POST /api/caspar-config/apply
- GET /api/caspar-config/override [exported, no caller]
- POST /api/caspar-config/override [exported, no caller]
- GET /api/caspar-config/generate
- GET /api/streaming-channel
- POST /api/streaming-channel/rtmp
- POST /api/streaming-channel/record
- POST /api/project/streaming-credentials
- POST /api/system/gpu-ports-reset
- GET /api/system/network
- POST /api/system/network/apply
- POST /api/operator-gui/launch
- GET /api/audio/portaudio-devices
- GET /api/audio/devices
- GET /api/device-snapshot/build
- POST /api/device-snapshot/apply
- GET /api/replication/leaders
- GET /api/replication/status
- POST /api/replication/become-leader
- POST /api/replication/stop-leader
- POST /api/replication/connect
- POST /api/replication/disconnect
- POST /api/replication/refresh-connection
- POST /api/replication/apply-device-view-caspar

Indirect (shared libs or components reached from device-view files):
- POST /api/raw
- POST /api/host-live/decklink
- POST /api/host-live/ndi
- POST /api/host-live/webpage
- POST /api/host-live/browser
- POST /api/host-live/browser/interact
- POST /api/host-live/operator-fullscreen
- GET /api/ndi/list
- GET /api/system/v4l2-devices
- POST /api/v4l2-inputs/config
- GET /api/audio/live-inputs
- POST /api/audio/live-inputs/config
- POST /api/audio/live-inputs/apply
- GET /api/virtual-camera/status
- POST /api/virtual-camera/config
- POST /api/virtual-camera/start
- POST /api/virtual-camera/stop
- GET /api/replication/status (replication-ui-state)
- GET /api/streaming-channel (streaming-channel-state)

**Distinct WS message types used by this area**

- Sent by client: `device_view_subscribe` (`device-view.js:65`, `device-view-render.js:227`).
- Received directly: `log_line` (`device-view-events.js:57`).
- Received indirectly (via app WS handlers and shared state modules): `gpu_topology_changed` (`client/lib/app-ws-handlers.js:283` → window event `highascg-device-view-reload`, `device-view-events.js:249`); `streaming_channel` (`app-ws-handlers.js:192` → `streaming-channel-state.js`, consumed by `device-view-inspector-stream.js:360`, `device-view-inspector-record.js:169`, `device-view-render.js`); `replication_status` (`client/lib/replication-ui-state.js:117`).

**Notes on dead or inert code (factual, from grep)**

- `client/components/device-view-gpu-source-inherit.js` — untracked per the session git status snapshot; no importer under `client/`. The imported copy is `client/lib/device-view-gpu-source-inherit.js`.
- `document` event `gpu-layout-changed` is listened to at `device-view-caspar-render-gpu-doc-listeners.js:57` but nothing under `client/` dispatches it.
- Exported without a client caller: `syncDeviceGraphFromLive` (`device-view-actions.js:150`), `getCasparConfigOverride` / `saveCasparConfigOverride` (`:129`, `:133`), `buildDeviceSnapshotEnvelope` (`:46`), `applyDeviceSnapshot` (`:37`).
- `appendCasparRearPanelMarkers` ignores the computed marker `x`/`y` (`device-view-caspar-render-markers.js:98-341`).
