**Status: IN PROGRESS (2026-10-19) — slice 1 (read-only rear panel + cables) DONE (golden-tested against the web JS, box-verified in the GUI); next: slice 2 patching + undo. Parent: [WO-593](./593_WO_godot_client_port_epic.md). Depends on: WO-599. Largest single area after the live core.**

# WO-605 — Godot port: Device View (rear panel, cables, port bands, destinations, inspectors, snapshots)

## Investigation

Inventory (Haiku): [`work/godot-port/inventory/device-view.md`](../godot-port/inventory/device-view.md).
Scope: **80 JS files (53 components 13,131 LOC incl. 1 orphan; 27 lib 3,469 LOC) + 12 CSS (1,902) =
18,502 LOC**, 13 sub-features: shell/orchestration · cable gesture + SVG overlay + physics · matrix
view · Caspar rear panel · port bands + live-source/mapping cards · screen destinations + host
channels · GPU port model (lib) · inspector framework · GPU outputs + video modeline · DeckLink I/O ·
stream/record/vcam/audio outputs · Caspar server/hot backup/mapping nodes · snapshots.

- Rendering: DOM + inline **SVG** cable overlay; no canvas/WebGL.
- Interaction: click-to-click cable patching (not drag), HTML5 drag for port / GPU / DeckLink
  reordering and DeckLink→destination drops, keys Esc / Ctrl+Z / Delete, window `pointermove` for
  the ghost cable.
- Contract: ~36 direct endpoints (`/api/device-view` with `addDestination|updateDestination|removeDestination|applyPlan|deviceGraph|addEdge|removeEdge|removeAllEdges|updateConnector|addMappingNode`,
  `/api/settings`, `/api/settings/apply-os`, `/api/hardware/modeline-preview`, `/api/caspar-config/apply|generate`,
  `/api/streaming-channel/*`, `/api/system/network*`, `/api/device-snapshot/*`, `/api/replication/*`)
  + ~20 indirect. WS: sends `device_view_subscribe`; reads `log_line`, `gpu_topology_changed`,
  `streaming_channel`, `replication_status`.
- Complexity hot spots: `device-view-cable.js` (455: arm/complete, re-grab, edge writes with rollback,
  undo stack), `device-view-cables-physics.js` (223: Verlet hanging cables, 200 iterations × 6 substeps
  per cable, deterministic `srand` coils, **int32 colour hash** `:15-22`),
  `lib/device-view-gpu-port-entries.js` (468: DP-N/DP-(N+1) bracket-pair collapse, EDID/xrandr names),
  `device-view-inspector-gpu-video-modeline.js` (475), `device-view-caspar-render.js` (462).
- **Cable anchors come from DOM measurement** (`getBoundingClientRect`) — in Godot the equivalent is
  `Control.get_global_rect()` of the port widgets, which is simpler and exact.
- Orphan: `client/components/device-view-gpu-source-inherit.js` is an **untracked** stale copy
  (tracked code imports `client/lib/device-view-gpu-source-inherit.js` ✔ `git grep`); left over from
  the pre-sync working tree (2026-10-16 backup branch `backup/local-wip-2026-10-16`).

## Port plan

- Not `GraphEdit`: the device view is a skeuomorphic rear panel, not a node graph. Custom
  `Control`s per device/port + one `CableLayer` (`Control._draw()` with the ported Verlet curves, or
  `Line2D`), physics recomputed only when an endpoint moves (cache keyed by coordinates, as today).
- int32 colour hash: GDScript ints are 64-bit → port with explicit `& 0xFFFFFFFF` and sign fix;
  golden test against JS output for 1,000 ids.
- Pure lib (GPU port model, host channels, inspector modes/modeline) ported 1:1 with tests.
- Inspectors reuse the WO-601 section/controls framework.
- Order: read-only rear panel + cables → patching + undo → destinations/host channels →
  GPU/modeline → DeckLink → stream/record/vcam/audio → Caspar server/backup/mapping → snapshots.

## Acceptance

- Parity checklist `work/godot-port/parity/device-view.md`, owner-ticked.
- Same device graph rendered by web and Godot: identical cables/colours; an edit in one appears in
  the other.

## What was done / What was VERIFIED

Orphan-file claim verified by hand. Per-slice records below.

## Scope moved in from WO-601 (2026-10-18)
The inspector's "live sources + host channels" sub-feature belongs here, not in a Sources-tab inspector (owner rule
2026-07-26: per-input controls live in the device-view **host-channel inspector**,
`client/components/device-view-destinations-inspector-host-channel.js`, mounted per role). Web files to port with the
host-channel inspector: `inspector-browser-display.js` (URL/size/fps, operator-monitor interact, remove),
`inspector-webpage-host.js` (URL or template, reload — hard-coded `http://127.0.0.1:4200/template/` → client server
origin), `inspector-ndi-host.js` (`GET /api/ndi/list`), `inspector-decklink-host.js`, `inspector-v4l2-input.js`,
`inspector-live-audio-input.js` (device, shader-FFT source single-select, refresh, start/stop, remove),
`inspector-source-label.js` (`POST /api/sources/label`). Endpoints: see WO-601 inventory "Live sources and host channels".

## Slice 1 — read-only rear panel + cables (2026-10-19)

### Investigation
Reference: the web Devices tab on this box (screenshot 2026-10-19, `GET /api/device-view` of the same moment):
- **Payload.** `graph.connectors` (10): `dst_in_dst_*` (kind `destination_in`, device `destinations`, `externalRef` =
  the screen-destination id), `dlsdi_1..4` (`decklink_io`, `index` 0..3), `gpu_p0..p3` (`gpu_out`). `graph.edges` (2):
  `{id, sourceId: dst_in_*, sinkId: gpu_pN, note?}`. `screenDestinations.destinations[]` carries `mode`
  (`pgm_prv` | `pgm_only` | `multiview` | `stream` | `pixelmap` | `operator_gui` | `host_channel`), size, fps.
  `suggested.connectors` repeats the graph ones and adds stream/record/vcam/audio/v4l2 connectors when they exist.
  `live.gpu.physicalMap.effectiveTopology[]` = `{physicalPortId, dpA, dpB}` per socket; `live.gpu.displays[]` = the
  connected heads (`DP-6`, `DP-2`).
- **Layout** (web `device-view-destinations-ui.js`, `device-view-caspar-rear-data.js`): left card column "Screen
  destinations" — title, subtitle `destinationRectLabel` (`device-view-ui-utils.js:5`: OPG / PGM / PGM/PRV / MVR /
  PXM / STREAM + `WxH@fps`), one output dot, or for `pgm_prv` two half rows PGM / PRV each with a dot
  (WO-365 anchor key `dst_in_x#pgm|#prv`), and the routes under the card ("PGM: Gpu p3"). Right: "Rear panel" with
  slot columns GPU, DeckLink, (USB video), Stream, Virtual cam, Record, Audio. "Cables" list under it.
- **GPU socket label** = `labelForTopologyPairs` (`lib/device-view-gpu-port-entries.js:30`): `DP 0/1`, `HDMI …`,
  plus ` · <active head>` when a connected display matches one of the pair (`DP 2/3 · DP-2`). The full entry builder
  (468 lines: bracket-pair collapse, EDID names, virtual sockets) is not needed while the panel is read-only;
  slice 1 takes topology rows only and falls back to the gpu_out connectors' own labels when there is no topology.
- **Edge half**: `lib/device-view-output-layer.js:15` — `note` = number, JSON `{outputLayer}` or `outputLayer=N`;
  layer ≥ 2 → PRV.
- **Cables**: `device-view-cables-physics.js` — 32-colour palette, string hash `h = (h<<5) - h + c` (only the shift is int32-truncated; `h` itself is an exact double, so it
  can leave int32 range — e.g. `e_dst_in_dst_mvcrp9bs_1_gpu_p1` → −3115929809),
  index `abs(h)*7 % 32`; Verlet rope (gravity 0.85, 200 iterations × 6 substeps, pinned ends + "boot" points 16 px
  below the ends), loops 0–2 from the "Cable loops" slider (web default 0, not persisted). Seed = sum of id char codes.
- Web oddities not copied: the DeckLink column order comes from a per-browser localStorage order (box shows 4,2,3,1);
  the Cables list labels both destinations `dst_ch1` (`friendlyConnectorLabel` falls back to `mainScreenIndex`, which
  is 0 for both). Godot orders DeckLink by `index` and labels cables with the connector labels.
- Refresh triggers: tab shown, Refresh button, WS `gpu_topology_changed` (web `app-ws-handlers.js:283`).

### What was done
New `godot/client/features/devices/` (all under the 500-line limit):
- `cable_model.gd` — 1:1 port of `device-view-cables-physics.js`: palette, `hash_id` (`_i32` truncates only the
  shift, matching JS), `color_hex`, `seed_of`, `srand`, `build()` (waypoints + coils + Verlet `_relax`). Pure.
- `devices_model.gd` — payload → `{destinations, slots, cables}`: `output_layer` / `anchor_key` / `source_anchor`
  (output-layer.js), `gpu_pair_label` (labelForTopologyPairs), `dest_sub` (destinationRectLabel), GPU sockets from
  `live.gpu.physicalMap.ports` by `slotOrder` (fallback: gpu_out connectors), DeckLink by `index`, then Stream /
  Virtual cam / Record / Audio. Screen destinations only — host channels come with the destinations slice. Pure.
- `port_icon.gd` — one socket: the web's port SVG (copied to `assets/devices/`, rasterised at runtime with
  `Image.load_svg_from_buffer`, cached per size) or a dot; its centre is the cable anchor.
- `rear_panel.gd` — GPU and DeckLink plates (label | socket rows, REF drawn but never cabled), extra slots beside.
- `cable_layer.gd` — click-through overlay over the whole tab; polls anchor positions each frame (layout moves
  them without signals), rebuilds a cable only when its endpoints or the loop count change (web getOrBuild cache),
  draws shadow + colour polyline; `active_id` thickens one. `id#pgm` falls back to the plain id (web connectorCenter).
- `devices_tab.gd` — toolbar (title, Cable loops 0–2, status, ↻), destination cards (PGM/PRV half dots), rear panel,
  cables list (hover = highlight). Fetches `GET /api/device-view` when shown, on ↻, and on WS
  `gpu_topology_changed`.
- `app/shell.gd` — the Devices placeholder replaced by `DevicesTab`.
Not GraphEdit, per the port plan: Controls for cards/sockets + one `_draw` layer.

### What was VERIFIED
- `tests/test_devices_cable.gd` (golden, values generated by running the web module under Node): colour of 10 ids
  incl. a 73-char id and a non-ASCII one, `hash_id` / `seed_of` for 4 ids (one hash outside int32), and six full
  `build()` polylines — loops 0/1/2, short / mid / long, both directions; point count exact, every point within
  0.01 px (456 points). `tests/test_devices_model.gd`: 10 methods (output layer note forms, anchors, pair labels,
  `dest_sub`, a fixture modelled on the box payload: host-channel skip, slot order, GPU slotOrder sort + labels,
  DeckLink by index, PRV cable from `#prv`, cable labels, gpu_out fallback, empty payload).
  Godot `--test` 1842/1842; `--check` boot OK; line limits OK.
- Box, Godot GUI `--tab=4` against the live `/api/device-view`: both cards (Operator GUI `OPG · 1920x1080@50`;
  Main LED `PGM/PRV` with PGM/PRV dots), GPU `DP 0/1`, `DP 2/3 · DP-2`, `DP 4/5`, `DP 6/7 · DP-6` (unconnected muted),
  DeckLink 1–4 + REF, empty Stream / Virtual cam / Record / Audio; two cables, pink Operator GUI → DP 2/3 and green
  Main LED PGM → DP 6/7 — the same colours and sag as the web view of the same payload. Cable loops 2 draws coils;
  hovering a Cables row thickens its cable; dragging the Sources splitter moves the tab and the cables stay on their
  sockets (warp while moving, rebuild after 150 ms still). No SCRIPT ERROR.
- Measured: a GDScript `build()` costs 36 ms (74 points, loops 0) / 72 ms (144 points, loops 2) — why rebuilds wait
  for the layout to settle and run one cable per frame.
- Not verified live: the WS `gpu_topology_changed` refresh (needs a DRM hotplug); owner QA.
