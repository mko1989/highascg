**Status: OPEN (2026-10-17) — investigation + port plan written; nothing implemented. Parent: [WO-593](./593_WO_godot_client_port_epic.md). Depends on: WO-599. Largest single area after the live core.**

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

Nothing yet. Orphan-file claim verified by hand.

## Scope moved in from WO-601 (2026-10-18)
The inspector's "live sources + host channels" sub-feature belongs here, not in a Sources-tab inspector (owner rule
2026-07-26: per-input controls live in the device-view **host-channel inspector**,
`client/components/device-view-destinations-inspector-host-channel.js`, mounted per role). Web files to port with the
host-channel inspector: `inspector-browser-display.js` (URL/size/fps, operator-monitor interact, remove),
`inspector-webpage-host.js` (URL or template, reload — hard-coded `http://127.0.0.1:4200/template/` → client server
origin), `inspector-ndi-host.js` (`GET /api/ndi/list`), `inspector-decklink-host.js`, `inspector-v4l2-input.js`,
`inspector-live-audio-input.js` (device, shader-FFT source single-select, refresh, start/stop, remove),
`inspector-source-label.js` (`POST /api/sources/label`). Endpoints: see WO-601 inventory "Live sources and host channels".
