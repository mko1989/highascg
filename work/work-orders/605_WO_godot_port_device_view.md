**Status: IN PROGRESS (2026-10-19) — slice 1 (read-only rear panel + cables) DONE (golden-tested against the web JS, box-verified in the GUI); slice 2 (patching + undo) DONE — 2a cable rules + 2b write planning golden-tested, 2c gesture + UI box-verified in the GUI against the live server; slice 3 (destinations + host-channel listing) DONE — 3a listing / inspector page / math input golden-tested, 3b panel add / edit / remove box-verified. Slice 3c (per-role host-channel inspector controls, WO-601 moved scope) DONE 2026-10-20 — request bodies / plans golden-tested against the web modules, webpage role box-verified end to end (update, reload, remove); NDI / browser / DeckLink / live-audio / V4L2 role pages golden-tested only (no such inputs on the dev box) — owner QA. Slice 4 (GPU-output connector page + video modeline) DONE 2026-10-20 — models golden-tested against the web inspector replayed edit by edit, page box-verified on P3 / P1 (save, OS save + live CVT/GTF preview, Reset, config restored byte-identical). Slice 5 (DeckLink connector page) DONE 2026-10-20 — page spec, SDI consumer / fill+key patches and the start / stop plans golden-tested against the web inspector + addDecklinkInputSlot, box-verified (fill+key, consumer saves, 2160p YUV warning, Start / Stop input; config restored byte-identical). Slice 6 (stream / record / virtual cam / audio connector pages) DONE 2026-10-20 — pages, add / remove and every edit golden-replayed against the web inspectors, box-verified add / edit / auto-save / remove for all four kinds (config restored byte-identical; Start / Stop golden-only). Slice 7a/b (Caspar server page + hot backup) DONE 2026-10-20 — page and every action golden-replayed against the web inspector, box-verified fps / CEF / scan / leader on-off / poll / follower picker (config restored byte-identical; peer connect + network apply golden-only). Slice 7c (mapping nodes) DONE 2026-10-20 — column, node page and every edit golden-replayed against the web band / inspector / mapping-node-service, box-verified add / cable / propose / mode / math size / rect / rename / add + remove output / duplicate / delete (config restored byte-identical). Slice 8 (device snapshots) DONE 2026-10-20 — save / load flows golden-replayed against the web modals (file text byte-identical), box-verified save with / without the rear-panel PNG, load preview + apply (config restored byte-identical). Slice 9a (DeckLink edit mode) DONE 2026-10-20 — order / editor golden-replayed against the web lib + inspector, box-verified pencil / rear swap / editor drag / Export (byte-identical) / Load / Reset (only per-client prefs written; web escapeHtml crash fixed). Slice 9b-1 (GPU column = the web's GPU port model: topology order, client hidden / labels, Disconnected fold) DONE 2026-10-20 — golden vs the web lib on 10 payload variants, box-verified. Slice 9b-2/3 (GPU edit mode + layout editor) DONE 2026-10-20 — flow golden-replayed against the web editor (5 cases, mutation-checked), box-verified pencil / edit / editor + rear drag / Export (byte-identical) / Load / Hide disconnected / Reset / Show all / Clear layout (config restored byte-identical; 5 web gaps logged, 2 fixed in Godot). Slice 10a (Matrix view) DONE 2026-10-20 — rows / crosspoints golden-replayed against the web matrix (mutation-checked), box-verified route / disconnect / undo / headers / adds (config restored; web "+ Stream"/"+ Record" list wipe fixed in Godot). Slice 10b (Node view) DONE 2026-10-20 — sections / cards / Bézier cables golden-replayed against the web simple band (mutation-checked), box-verified card pages / cabling / undo / server page / add / toggles (config restored; web GPU subtitle gap fixed in Godot). Slice 11 ("Add live input" dialog + Devices band + Matrix "+ Live input") DONE 2026-10-20 — golden replay of the web modal (14 cases / 52 steps) and band rows, box-verified NDI discover + add → host-channel card (config restored). Slice 11b (rear-panel cable dots: a socket click opens its page, cables only from the dot in its centre; toolbar status no longer shifts the panels) DONE 2026-10-20, box-verified. Next: slice 12, DeckLink connector drag onto a destination / the Sources panel (unported in both rear views). Parent: [WO-593](./593_WO_godot_client_port_epic.md). Depends on: WO-599. Largest single area after the live core.**

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
- Web oddities not copied: the DeckLink column order comes from a per-browser localStorage order (box shows 4,2,3,1 — *corrected in slice 9a: 4,2,3,1 is the markers' no-saved-order default*);
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

## Slice 2 — patching + undo (2026-10-19, DONE)

### Investigation
Web gesture = `client/components/device-view-cable.js` (455) + `device-view-cable-outputs.js` (removeEdge,
resetCabling, updateDestinationOutputLayer) + key/click handlers in `device-view-events.js:194-245`:
- **Arm**: click a connector whose role is `destination_out` / `caspar_out` / `pixel_mapping_out`; a pgm_prv card
  remembers the half (PRV → after `addEdge` the new edge gets note `{"outputLayer":2}` via a `deviceGraph` save).
  While armed: every other connector is tinted valid/invalid by `orderEdgeForDeviceView`; a dashed STRAIGHT ghost
  line runs from the armed anchor to the pointer (no physics per move). Click empty space or Esc = cancel (client
  only — nothing persisted). `GET /api/device-view/snapshot` is polled during the gesture to warm the server cache.
- **Complete** (`tryAddCable`): order → canonical ids (`gpu_p0__DP_1` / `DP-2` → `gpu_pN`) → one-cable-per-socket
  check (status + abort) → pushUndo → preflight: write missing `gpu_pN` / `dst_in_*` rows into the saved graph
  (`device-view-cable-preflight.js`) → `POST /api/device-view {addEdge}`; on `unknown_source|sink` save topology,
  re-preflight, retry once → PRV note → **gpu_out sink only**: settings seeding (`screen-consumer-defaults.js`:
  windowed/borderless/vsync defaults for an unseeded screen_N, multiview always-on-top default;
  `device-view-gpu-source-inherit.js`: screen_N mode + custom size/fps inherited from the source feed, skipped for a
  PRV head) via `POST /api/settings`, then `updateConnector {caspar:{mode, outputBinding}}` → restart-dirty unless
  the sink is record / vcam / stream-in-attach-mode → forced reload.
- **Select / remove**: click a cable (or a Cables row) selects it; Delete/Backspace or the edge inspector's button
  → `removeEdge`; toolbar "reset cabling" (confirm) → `removeAllEdges`.
- **Re-grab** (WO-278): with a cable selected, clicking one of ITS ends lifts that end (held edge hidden, ghost from
  the far end); drop = `planCableRegrab` → retarget is remove-then-add with rollback, PRV note carried across.
- **Undo** (Ctrl+Z, 50 deep): snapshot `{graph, screenDestinations}` before every mutation; undo =
  `POST /api/settings {deviceGraph, screenDestinations}` + restart-dirty.
- Server rejections come back as `{error: reason}` (`device-view-crud.js:238`), e.g. `sink_already_connected`.

### Plan
- 2a pure decision logic → `cable_rules.gd` (golden-tested). **DONE, below.**
- 2b pure write planning → `cable_seed.gd`: preflight rows, GPU-sink settings/connector patches, PRV note,
  screen-index resolution, project-fps default mode (golden-tested the same way).
- 2c gesture controller + UI: port click → arm/complete, valid/invalid tint, dashed ghost, cable hit-test select,
  Esc / Delete / Ctrl+Z (tab-visible only), re-grab, remove-all (ConfirmationDialog), undo stack, restart-dirty
  + "Apply to Caspar" (`POST /api/caspar-config/apply {force:true}`), snapshot prewarm. Box-verify against the web.

### 2a — What was done
`features/devices/cable_rules.gd` (383 lines, pure): `connector_by_id` (graph → suggested → synthetic
`gpu_pN[__tag]` from physicalMap / topology, `DP|HDMI-N`, `dst_in_*`), `role` (DeckLink unassigned = output sink),
`order_edge`, `can_start`, `gpu_port_cable_id`, `canonical_id`, `sink_conflict`, `describe_rejection`,
`is_unknown_connector_error`, `endpoints_at` / `pick_regrab` / `plan_regrab` / `regrab_rollback` /
`describe_restore`, `dedicated_streaming`, `sink_needs_restart`, `friendly_label`, `topology`.
Deliberately not ported: the localStorage GPU layout prefs `canonicalCableConnectorId` consults first (no layout
editor in Godot yet) and auto host-channel destinations in `friendly_label` (destinations slice).

### 2a — What was VERIFIED
`tests/test_devices_cable_rules.gd` + `tests/golden/devices_cable_rules.json` (golden generated by importing the web
modules under Node on one payload: 24 connector ids × connector/role/label, 10 canonical ids incl. `dp-9` via
`card0-DP-9` xrandrName and `card1-HDMI-1`, 10 orderings both directions, 6 sink conflicts incl. split ids,
14 re-grab cases covering every plan outcome, rejection texts, restart matrix). Godot `--test` 2025/2025 (+183),
`--check` boot OK.

### 2b — What was done
`features/devices/cable_seed.gd` (408 lines, pure): `normalize_fps` / `default_mode_for_fps` / `project_fps` /
`default_video_mode` (project-fps.js), `mode_spec` (CASPAR_VIDEO_MODE_SPECS, derived from the mode id + the web's rate
sets instead of a copied 40-row table), `mode_resolution` (videoModeToResolution), `feed_source` (graph source →
live intent → saved destination), `output_binding` (multiview / screen N / WO-364 screen_prv N),
`screen_seed_caspar_patch` / `screen_seed_patch`, `inherited_patch`, `merge_patches`, `screen_number` /
`physical_screen_index` (gpu-resolve), `gpu_sink_writes` (tryAddCable's gpu_out block → `{settings, connector}`),
`with_output_layer` (PRV note), `preflight` (patchGraphWithMissingCableConnectors).
Contract found while testing: `gpu_sink_writes` must see the graph AFTER addEdge (the web assigns `res.graph`
first) — without the new edge `screen_number` falls back to the suggested-list position and inherits into the wrong
screen_N. Documented on the function and pinned by the test. Not ported: mapping-node output feeds (no mapping
nodes drawn in Godot yet).

### 2b — What was VERIFIED
`tests/test_devices_cable_seed.gd` + `tests/golden/devices_cable_seed.json` (Node run of the web modules: 12 fps
inputs, 4 settings shapes, all 39 standard mode ids + 7 off-table / custom ids through spec and resolution, 9 feed /
binding ids incl. a graph source, a custom `WxHpF` mode (web keeps fps 50 there — ported as is) and string numbers,
6 consumer-seed states × with/without settings, inherit, merge, 10 screen-number / physical-index connectors,
preflight with split ids, suggested rows, topology-only and unknown sockets, and from no graph). Plus hand cases for
`gpu_sink_writes` (PGM, PRV head writes no settings, multiview always-on-top, already-seeded screen, non-GPU sink).
Comparison normalises int/float (Godot's Dictionary `==` tells 720 from 720.0; JSON does not).
Godot `--test` 2232/2232 (+207), `--check` boot OK.

### 2c — What was done
- `features/devices/cable_gesture.gd` (new, Node child of the tab): gesture state (armed connector + half, re-grab,
  selected edge, busy, restart-dirty), the 2.5 s snapshot prewarm Timer (only alive between arm and commit/cancel),
  and every write in the web's order — `_complete` (= tryAddCable: order → canonical ids → socket conflict → undo
  push → preflight `deviceGraph` save → `addEdge`, one unknown-connector recovery that saves `gpuPhysicalTopology`,
  re-reads and re-preflights → PRV note → `gpu_sink_writes` on the post-addEdge payload → restart-dirty → reload),
  `_commit_regrab` (plan first, remove-then-add, rollback, PRV layer carried), `remove_edge`, `remove_all`,
  `undo` (50 deep; push skipped without `screenDestinations`, as the web), `apply_caspar` (`{force:true}`, WS
  `log_line` `[Full apply]` progress). Status texts are the web's. The web api client throws on 4xx, so an addEdge
  rejection shows only `describe_rejection(reason)` — the web's `res.error` "(src → sink)" branch is dead code there.
- `port_icon.gd`: `target` tint (armed amber / valid green / invalid red, the web CSS colours).
- `cable_layer.gd`: `selected_id` (thick like hover), `hidden_id` (held cable), dashed straight ghost from
  `ghost_from` to `pointer`, `hit()` (6 px from the drawn polyline — the web hits only the 2.8 px stroke), and a
  bare destination id now resolves to its `#pgm` dot (web anchorKeyFor).
- `devices_tab.gd`: clicks are taken in `_input` (anchor rects grown 3 px first, then cables; anything else cancels
  an armed gesture and passes through), guarded to clicks that land on the tab (`gui_get_hovered_control`) and not
  while the confirm dialog is up; cable hover highlight; Esc / Ctrl+Z / Delete+Backspace in
  `_unhandled_key_input` (tab visible, no text field focused); toolbar Cancel cable / Reset all cabling (confirm) /
  Apply Caspar config (restart) with the dirty highlight; Cables rows select and show Remove; settings loaded before
  the first payload; a reload asked for mid-flight re-runs after it; gesture prompts give way to "Updated …" on
  reload while results and errors stay (↻ always overwrites).
- Not testable in the unit runner (it never loads scripts that touch autoloads); the decisions it sequences are the
  golden-tested 2a/2b functions, so the gesture itself is proven on the box.

### 2c — What was VERIFIED
Box GUI (`run-client.sh --screen=0 --tab=4`, xdotool clicks, x11grab screenshots, `GET /api/device-view` /
`/api/settings` after each step; config/ backed up first and restored after — every `config/*.json` and the full
settings GET identical to the backup at the end):
- Arm on Main LED PRV dot → both its dots amber, Operator GUI dot red, GPU + DeckLink sockets green, dashed ghost
  from the PRV dot to the pointer; Esc → "Cable mode cancelled", nothing written.
- PRV → DP 4/5: edge `dst_in_dst_mvcvbk52_1 → gpu_p2` note `{"outputLayer":2}`, gpu_p2 `caspar` gained
  `mode 1080p5000` + `outputBinding {screen_prv, 1}`, settings untouched (PRV head seeds nothing), Apply turned amber.
- Cable click (on the stroke) and Cables-row click select: thick cable, ringed ends, Remove shown.
- Re-grab: click the selected cable's DP 4/5 end → cable hidden, ghost from the PRV dot, all targets tinted; drop on
  DP 0/1 → edge now `→ gpu_p0` still `{"outputLayer":2}`, "Cable moved to gpu_p0".
- Delete removed it; Ctrl+Z ×2 restored `gpu_p0` then `gpu_p2` (graph matches each step); a third → "Nothing to
  undo". PGM onto the occupied DP 4/5 → "gpu_p2 already has a cable from dst_ch1. Remove that cable first.", no
  write. Backspace removed the PRV cable; PGM → DP 4/5 then wrote `outputBinding {screen, 1}` (+ mode); casparServer
  unchanged since screen_3 already held the inherited values.
- Reset all cabling → confirm dialog → OK → edges `[]`, "All cabling removed"; Ctrl+Z → all three back.
- Apply: button "Applying…" + disabled, status streamed "Step 3 — applying live xrandr layout", "Step 4 — reload
  Caspar …", then "Config written; layout applied; Caspar restarted.", dirty highlight cleared; casparcg-server
  active on a new PID. GUI log free of script errors.
- Godot `--test` 2232/2232, `--check` boot OK, `check-max-file-lines` 0 over 500.
Owner-QA: the feel of the hit targets (6 px cable tolerance, 3 px port growth) next to the web.


## Slice 3 — destinations + host channels (2026-10-19, DONE)

### Investigation
Web: `device-view-destinations-ui.js` (cards, type select — `populateDestinationTypeSelect` lists only the five screen
types, no host entries), `device-view-events.js:117-176` (the "+" handler: `nextMainScreenIndex`, `addDestination` → the
action forwards only `type` + `mainScreenIndex`, so the `videoMode` the handler computes never reaches the server, which
picks the mode itself; then `shouldSeedScreenConsumerDefaults` → `screenConsumerSeedSettingsPatch` for a fresh physical
screen N, restart-dirty, forced reload), `device-view-destinations-inspector-form.js` (summary table, mapped outputs with
a focus-connector link, name / main index / mode / audio layout / video mode + size (size editable only under
"Custom") / pixel-map Art-Net / operator-GUI fields, Remove), `lib/device-view-host-channels.js` (pinned + auto host
channels, planned-vs-live channel map, "(planned)" badge), `lib/math-input.js` (number fields take expressions).
The mapped-output link's web target is the connector inspector (GPU / DeckLink pages) — not ported yet.

### What was done
- 3a (commit 78b4b97a): `host_channels.gd` (listing, golden over seven payloads; `devices_model.build` now emits host
  cards), `destinations_model.gd` + `destination_inspector.gd` (the Inspector page; emits only `patch` / `remove` /
  `focus_connector` / `launch_operator_gui`), `core/math_input.gd` (grammar, clamp, toFixed, restore last good).
- 3b: `destinations_panel.gd` (new, 232 lines) — the tab's left column: "Screen destinations" head with the type select
  and "+", the cards (host cards under "Input & host channels"), click = select → `InspectorPanel.current.present(page)`;
  "+" = `DM.add_request` → `POST /api/device-view {addDestination}` → `DM.seed_patch` → `POST /api/settings` when the new
  screen N is unseeded → `changed` (tab marks restart-dirty + reloads, the web's forced load); page edits →
  `updateDestination`; Remove → `removeDestination` + deselect; the page follows its destination across reloads and
  closes when it is gone. `devices_tab.gd`: the left column is now the panel in a ScrollContainer; a selected cable
  and a selected destination exclude each other; the page's mapped-output link selects that connector's cable (the web
  opens the connector inspector — later slices) or reports "<id> has no cable.".

### What was VERIFIED
- Godot `--test` 2736/2736, `--check` boot OK, headless boot straight into `--tab=4` clean, line limits 0 over 500.
- Box GUI (`run-client.sh --screen=0 --tab=4`, xdotool, x11grab; `config/*.json` backed up first): card click → Inspector
  page with the summary (PGM/PRV channels 1/2, mapped output `P3` = the connector's own label, as the web), fields and
  Remove. "+" (PGM/PRV) → `dst_mvfsgp2y_1` "PGM/PRV 2" at mainScreenIndex 1 appeared as a card with PGM/PRV dots, Apply
  turned amber; screen_2 was already seeded so no settings write (correct per `shouldSeedScreenConsumerDefaults`).
  Name "Side LED" + Enter → server label updated. Width "640*2" under 1080p5000 → no write (field read-only unless
  Custom, as the web). Mapped-output link on Main LED → its cable selected (Remove row shown, destination released).
  Remove destination → gone from the server and the cards, Inspector "Select an item". No SCRIPT ERROR in the GUI log.
  After the run every `config/*.json` is byte-identical to the backup.
- Not exercised live: Custom video mode + size patch, pixel-map / operator-GUI fields (golden-tested against the web
  form over 63 actions in 3a); host cards (no host channels configured on this box) — owner QA.

## Slice 3c — host-channel inspector controls (2026-10-20, DONE)

### Investigation
- The web host-channel page (`device-view-destinations-inspector-host-channel.js`) is a dispatcher: it renders the
  summary table, then mounts a per-role block from six modules — `inspector-host-webpage.js` (template / URL, reload vs
  update by target ≠ saved page), `inspector-host-ndi.js` (name, discover via `GET /api/ndi/list`), `inspector-host-browser.js`
  (URL / width / height / fps clamps, `browser/interact` toggle), `inspector-host-decklink.js` (device switcher, shared
  source label via `POST /api/sources/label`, the long remove that re-reads settings, re-fetches the device view, plans
  `decklink_remove_plan` and marks dirty when the DeckLink count shrank), `inspector-live-audio-input.js` (capture device,
  FFT slot, Refresh / Start / Stop, `live-audio-remove-input.js`), `v4l2-remove-input.js`. Every block ends in a plain
  request list (`POST` bodies, soft `/api/raw` STOP + MIXER CLEAR, a restart-dirty mark) — that is the golden surface.
- Role detection and the `inputChannels` row (layer / route) already exist in `destinations_model.gd` (`host_role`) and
  `host_channels.gd`; the page only needed the resolved `extraLiveSources` row (`find_live_source` by role + channel).
- Web `confirm()` → a `ConfirmationDialog`; it hides BEFORE `confirmed` fires, so awaiting `visibility_changed` reads the
  wrong order — the base awaits its own `_decided` signal instead.

### What was done
- `host_source_model.gd` (438 lines, pure RefCounted): slot resolvers, `find_live_source`, webpage / NDI / browser /
  DeckLink request builders + messages, template options, label state / hint, `remove_live_plan`,
  `decklink_remove_plan` / `_tail` / `decklink_count`. Requests are `["POST", path, body]` (+ `"soft"`) or `["DIRTY"]`.
- `input_slots_model.gd` (234 lines, pure): live-audio settings read / body, ALSA options, status message, FFT and
  device-change request lists, start body / error, `live_audio_remove_plan`, V4L2 read / body / remove plan.
- `host_controls_base.gd` (159): `_run` (posts a plan in order, soft failures ignored, stops on the first hard one),
  `_confirm`, widget helpers (`_select` sets `fit_to_longest_item = false` — 221 template names widened the Inspector).
- `host_live_controls.gd` (314): the webpage / NDI / browser / DeckLink blocks + "Remove … source" flows.
  `host_input_controls.gd` (159): live-audio block (deferred boot GETs `/api/audio/live-inputs`, `/api/audio/devices`)
  and the two slot removes. `host_channel_controls.gd` (39): facade dispatching by role; relays status / reload / removed.
- `destination_inspector.gd`: `_host_page` resolves role / channel / source row and places `top` controls under the
  summary, `bottom` after "Cabled to" (web order); `destinations_model.gd`: `host_entry`, Source ID row;
  `destinations_panel.gd`: owns the facade, relays status, `reload(dirty)` → `changed` / new `refresh_requested`
  (ternary over two `emit()` calls is a runtime error in GDScript — if/else), `removed` → deselect + `changed`;
  `devices_tab.gd` connects `refresh_requested` to `refresh`.
- Golden: `tests/golden/devices_host_source.json` generated by running the six web modules under Node with a DOM shim
  (scratchpad `host_source_golden.mjs`); `tests/test_devices_host_source.gd` (175 assertions) compares request bodies,
  messages, options, label state and all remove plans. The DeckLink "withSource" case uses a duplicate row with
  `decklinkDevice = 2` because the web apply case mutates the shared fixture after capture.
- Not ported (deliberate): the browser-stored live-audio PGM play-target restore on Start (localStorage; Start restarts the
  capture only), and the Sources-tab `refreshLiveAudioConfigured` / `refreshV4l2Configured` store nudges after a remove
  (the Godot panel reloads the device view instead).

### What was VERIFIED
- Godot `--test` 2911/2911 (2736 + 175 new), `--check` boot OK (no script errors), line limits 0 over 500.
- Box GUI (`GODOT=~/.local/opt/godot/godot ./run-client.sh --screen=0 --tab=4`, xdotool / x11grab at +1920,0;
  `config/*.json` md5-listed first): a webpage host created over `POST /api/device-view {addExtraLiveSource:{type:
  "browser", templateOrUrl:"http://127.0.0.1:4200/template/LOWER.html"}}` → card "HOST · ch 4 (planned)", page shows the
  summary with Source ID `webpage_127_0_0_1`, the Page block (Template ticked, select on the placeholder because no
  "LOWER" template exists among the box's 221 — same as the web), Reload, notes, "Remove webpage source". Untick
  Template + `https://example.org/` + Enter → server playArg / templateOrUrl / label updated, status "Webpage updated on
  ch 4 (route unchanged)". Reload → "Reloaded webpage on ch 4", card label follows. Remove → dialog `Remove
  "https://example.org/" from Live sources?` (Cancel / Remove) → `extraLiveSources []`, `inputChannels []`; journal shows
  the soft `STOP 4-1` / `MIXER 4-1 CLEAR` (rejected by Caspar because channel 4 was planned only — ignored, as the web).
  0 SCRIPT ERROR in the GUI log; every `config/*.json` byte-identical to the backup afterwards.
- Not exercised live: NDI, browser-source, DeckLink, live-audio and V4L2 role pages (no such inputs on the dev box) —
  golden-tested only; owner QA on the production box.

## Slice 4 — GPU outputs + video modeline (2026-10-20, DONE)

### Investigation
- The web opens a `gpu_out` connector in the Inspector through `device-view-selection.js` → `renderConnectorInspector`
  with `connectorById(lastPayload, id)` (graph connectors first, so no `gpuPhysical` — `cable_rules.connector_by_id`
  already ports that). The page is `buildGpuInspectorSummaryRows` + `renderGpuOutControls`
  (`device-view-inspector-gpu.js`, 474 lines) + `populateGpuVideoModelineSection` (`-video-modeline.js`, 475) with its
  `-os-settings.js` / `-preview.js` helpers, `-gpu-resolve.js`, `lib/edid-preferred-mode.js`, the mode tables in
  `device-view-destinations-inspector-modes.js` and `lib/screen-consumer-defaults.js`.
- Key routing: video-mode keys use the Caspar screen the jack is bound to (`screen_N_mode`, `_custom_*`); consumer and
  OS keys use the rear port (`gpu_pN` → N+1). A multiview-bound jack shares `multiview_always_on_top` /
  `multiview_interactive`. Opening a port whose consumer keys were never written fires a seed POST then `load()`.
- Golden surface: the generator (scratchpad `gpu_output_golden.mjs`, DOM shim from slice 3c plus `createTextNode`,
  CSS-string `style`, select value reset on `innerHTML`) renders the real web page for 9 cases (live P3 PGM, live P1
  operator GUI, disconnected P0, P2 multiview unseeded, EDID native not in the RandR list, saved OS EDID mode, saved
  bare OS mode, P9 with no display, P1 with top-level OS keys) and fires ~40 edits, recording every request, the status
  line, all control values and the preview text (fake preview reply; the timings are the server's).
- Findings in the WEB code, ported as-is (owner decision whether to fix):
  1. **EDID override is never saved** — `saveCasparSettings` has no `screen_N_edid_override` key (the field only reads it).
  2. **GET /api/settings omits `screen_N_os_timing_source` / `_os_mode_source`** (`src/api/settings-get.js:62`
     hand-lists the OS keys) although POST stores them in `config/general.json` — so the timing select and the Custom
     pick reopen as CVT / list mode in both clients after a save.
  3. **Reset leaves the OS keys** — it nulls `screen_N_os_*` / `system_id` under `casparServer`, but those are stored
     top-level (`settings-os.js`), so they survive. Reset also nulls the *shared* `screen_1_mode` when the jack is on
     Caspar screen 1 (by design in the web, but worth knowing: it touches the PGM screen's mode).
  4. Unticking Operator monitor / editing custom W/H/FPS posts the same body 2–3 times (two listeners); harmless, not ported.

### What was done
- `gpu_modeline_model.gd` (412, pure): JS-number helpers, mode aliases / normalisation / dimension matching,
  `os_mode_and_rate`, `screen_os_dims`, detected-mode options (`format_mode_option`, `unique_modes`, `display_options`),
  EDID preferred parse / selectability, `mode_from_display`, `resolve_video_mode`, sibling ports, cable-fed resolution,
  `state()` (everything the controls start as), `os_resolution` / `os_fields` / `per_port_os_patch`.
- `gpu_modeline_preview.gd` (85, pure): `preview_dims`, `preview_query`, `timing_label`, `preview_lines` (thousands
  separators, ≈ refresh). Timings stay server-side (`GET /api/hardware/modeline-preview`).
- `gpu_output_model.gd` (280, pure): `detected_display`, `is_multiview_bound`, `summary_rows` (NBSP like the web),
  `physical_mode`, `mode_options`, `consumer_state` (indices, seed patch, every toggle), `caspar_patch`, `os_patch`,
  `save_status`, `reset_patch`, `confine_patch`, `physical_line`.
- `gpu_output_ui.gd` (75, pure): the page's control values as one dict + `apply(ui, field, value)` → effects
  (`caspar` / `os` / `confine` / `preview`), Fullscreen ⇄ Windowed mirroring, Operator monitor ⇒ Interactive, Custom
  prefill from the last standard mode. The controller only mirrors widgets, so the replay test covers the page logic.
- `gpu_output_controls.gd` (363, Api / Settings — not under the unit runner): builds the page in web order (title,
  summary grid, toggle row + confine select, Video Mode + custom row, EDID headline / detected modes / OS custom row /
  Override, timing select + tier + preview debounced 280 ms with a stale-reply guard, advanced block, Reset with confirm).
  Saves are serialised per kind and built at send time (a burst ends with the newest body); success → status
  (caspar / confine), `dirty` → the tab's Apply button, then `Settings.load_from_server()`; seed and Reset reload the tab.
  Rebuilds on every tab reload keep the focused field and the advanced open state.
- `devices_tab.gd` / `rear_panel.gd`: a GPU port's row label opens the page (hit-tested in the tab's `_input` before the
  cables, which hang over the labels — a `gui_input` handler never saw the click); a destination's mapped-output link
  (`focus_connector`) opens it for `gpu_out`; the GPU page and a destination page exclude each other; the page follows
  reloads or closes when the connector is gone. The socket dot keeps its cable gesture (web: body = inspector, dot = cable).
- Not ported: the layout editor (web edit mode only — Godot has no edit mode yet).

### What was VERIFIED
- `tests/test_devices_gpu_output.gd` + `tests/golden/devices_gpu_output.json` (fixtures = live device-view / settings
  captures, per-case mutations as data ops): summary rows, every select's options, all starting control values / rows /
  notes, the seed + first preview GET, then each web edit replayed through `gpu_output_ui.apply` — effects, every POST
  body (consumer, OS, confine, reset), preview GET + preview text, status line, and all control values afterwards.
  Godot `--test` 5113 / 5113 (2911 + 2202 new), `--check` boot OK, 0 files over 500 lines.
- Box GUI (`./run-client.sh --screen=0 --tab=4`, `config/` copied + md5-listed first): label "DP 6/7 · DP-6" → page P3
  matches the web's start state (DP-6, P80 / 16843009, Windowed + Always on top, 1080p5000, 1920x1080 @ 50 Hz, CVT
  preview from the server 141.5 MHz, tier SL; notes "Caspar screen 1 — shared with gpu_p0, gpu_p1, gpu_p2" and the
  cable feed). V-sync on/off → `screen_4_vsync` true/false on the server, status "GPU port 4 (Caspar screen 1) saved",
  Apply button restart-dirty. Timing → GTF: preview re-fetched (141.45 MHz, −HSync +Vsync), `general.json` got
  `screen_4_os_timing_source: "gtf"`, `system_id: "DP-6"`. Screen name "Test" + Enter → `screen_4_name: "Test"`.
  Reset → dialog "Are you sure you want to reset all settings for GPU port 4?" → keys nulled, status "Settings for GPU
  port 4 cleared", page reloaded. P1 page: DP-2, Windowed + Operator monitor + Interactive, port 2 / screen 1. Main LED
  card → mapped output "P3" opens the GPU page. Afterwards `caspar_server.json` / `general.json` restored from the copy +
  node restart → every `config/*.json` byte-identical, server reads the original values; 0 SCRIPT ERROR in the GUI log.
- Not exercised live: multiview-bound jack (seed + shared keys), the EDID-native-unselectable and no-display paths, the
  NVIDIA backend — golden-tested only.

## Slice 5 — DeckLink connector page (2026-10-20, DONE)

### Investigation
- Web path: `device-view-inspectors.js` → for `decklink_io` / `decklink_out` no summary table, straight to
  `renderDeckLinkIoControls` (`device-view-inspector-decklink.js`): rear-order editor (only in the web's DeckLink edit
  mode — `document.querySelector('.device-view__band--caspar')` — not ported), then for `decklink_io` the Input section
  (`-decklink-input.js`), an hr, the Output heading + a note (input mode / cabled N / unassigned / program output, WO-479
  cable count), then — unless the port is an input — `renderDecklinkOutputInheritControls` (live.decklink.outputs row:
  upstream label + mode, 1:1 passthrough line, warn / reason / override notes), `renderDecklinkConsumerSettingsControls`
  (format, layout, latency, buffer depth, colour space, pixel format + WO-493 2160p YUV warning, embedded audio, low
  latency; any change posts the whole set) and `renderDecklinkKeyFillControls` (`lib/device-view-decklink-keyfill.js`
  `resolveDecklinkKeyFillState` + `collectDecklinkDeviceIndices`). `decklink_out` gets the last three only.
- Input section: `ioDirection == 'in'` → shared source label (WO-525), Stop input (`removeDecklinkInputSlot` — the same
  remove the slice-3c host page runs, `host_source_model.decklink_remove_plan`) and, when the channel map has the slot's
  host channel, `mountDecklinkHostSourceControls` with `includeLabel:false`; otherwise an optional "Set
  decklink_input_count ≥ N" note and Start an input (`addDecklinkInputSlot`, `lib/decklink-add-input.js:128`: settings +
  device-view read, `updateConnector {ioDirection:'in'}`, re-read, then one of four branches — count grew → live source
  only + restart-dirty; already input with tile and live channel → `/api/host-live/decklink` update or replay; no
  channel → live source + pending apply; else STOP / MIXER CLEAR / PLAY DECKLINK + live source).
- Web gaps found (ported as-is, owner to decide):
  1. `readDecklinkConsumerCaspar` (`-decklink-shared.js`) never reads `decklinkLowLatency`, so "Low-latency mode" always
     opens unchecked and every SDI save writes `decklinkLowLatency: false` — a saved true is lost on the next edit of any
     other field. One-line fix in the web reader (+ `consumer_state` here).
  2. The start status prints `Port N is input on ch null.` when no host channel is planned yet (template literal of null).
  3. Buffer depth "0" saves 3 (`parseInt(...) || 3`), not the clamp's 1.

### What was done
- `features/devices/decklink_port_model.gd` (pure): `page_spec` — the page as the flat item list the web renders
  (heading / note / small / warn / hr / caption / select / input / hint / check / button / label / host); output note +
  cable count, `output_status`, `inherited_mode_text`, `inherit_items`, `consumer_state` / `consumer_items` /
  `consumer_patch` (+ binding / key fields the connector carries), `needs_yuv` / `yuv_warning`, `keyfill_state`
  (multiview / screen binding, key-only-port rule), `device_indices`, `keyfill_items`, `key_after_toggle`,
  `keyfill_patch`.
- `features/devices/decklink_input_model.gd` (pure): `view` (direction, device, slot, channel map — live, else the
  settings one — and the slot's entry), `host_source`, `input_items`, `stop_args` / `stop_status`, and the start plan split
  where the web re-reads the server: `add_prepare` (validation errors, connector, tile, the ioDirection write) and
  `add_finish` (the four branches, live source body, PLAY), `add_status`.
- `features/devices/decklink_port_controls.gd`: builds widgets from the spec; selects / checks save through
  `updateConnector` (dropped while a save is in flight, like the web's `saving`), then restart-dirty + status + reload;
  the pixel warning and key-select enable stay live; buffer depth saves the raw text then math-commits (1–3); Start /
  Stop run the model plans with the same settings / device-view re-reads.
- `host_controls_base.gd`: the DeckLink device switcher and the shared source label moved here from
  `host_live_controls.gd` (both pages mount them); `_decklink(..., with_label, done)` for the port page's own label and
  "DeckLink updated on ch N." status.
- `devices_tab.gd`: `_open_port` / `_close_port` pick the GPU or DeckLink page by connector kind; row labels and a
  destination's mapped-output link open either. `rear_panel.gd`: DeckLink row labels are clickable too.
- Not ported: the rear-order editor (web edit mode), and the fill→key virtual cable on the overlay
  (`collectDecklinkKeyFillVirtualEdges`) — the cable layer's job, follow-up with the overlay work.

### What was VERIFIED
- `tests/test_devices_decklink_port.gd` + `tests/golden/devices_decklink_port.json` (generator runs the web inspector and
  `addDecklinkInputSlot` under Node on a DOM shim and a fake server that applies per-case `onUpdate` ops on the
  ioDirection write): 16 page cases — every spec item vs the flattened web DOM (host switcher by options), then each
  edit / press replayed: POST bodies, restart-dirty, status text + ok/err, yuv hint, key select state — and 8 direct
  start runs (3 validation errors, device-only, already-input same / other device, planned restart entry, shared inputs
  host). Godot `--test` 5745 / 5745 (5113 + 632 new), `--check` boot OK, 0 files over 500 lines.
- Box GUI (`config/` copied + md5-listed first): label "DeckLink 1" → page as the web (Start an input, unassigned note,
  "Upstream: Upstream feed — —", Select SDI format… disabled placeholder, Stereo / normal / 3 / bt709 / Auto, embedded
  audio on, key select disabled on 2). Fill + key → `device_graph.json` dlsdi_1 `{ioDirection:out, decklinkKeyFill:true,
  decklinkKeyDevice:2, decklinkKeyer:internal}`, status "Key on port 2.", Apply button restart-dirty, page reloaded with
  the server's outputs row ("Upstream: Program 1 — 1080p5000 (1920×1080 @ 50 Hz)", passthrough line, inherited
  1080p5000). Pixel → RGBA: full consumer patch saved, "SDI settings saved.". Format → 2160p5000: saved, the YUV warning
  shows. DeckLink 4 → Start an input: `decklink_input_count` 4, dlsdi_4 `in`, status "Port 4 is input on ch 4. Apply
  Caspar config and restart if the input does not appear.", host destination "DeckLink input 4 · ch 4 (planned)", page
  now label + Stop input + device switcher. Stop input: count 0, port unassigned, live source + host destination gone,
  "Port 4: unassigned.". Afterwards `caspar_server.json` / `device_graph.json` (+ the state file's timestamps) restored +
  node restart → every config file byte-identical; 0 SCRIPT ERROR in the GUI log.
- Not exercised live: the already-input / shared-inputs-host start branches, `decklink_out` kind, multiview key/fill —
  golden-tested only (no such config on the dev box).

## Slice 6 — Stream / Record / Virtual cam / Audio pages (2026-10-20, DONE)

### Investigation
- Web path: `device-view-inspectors.js` → `stream_out` / `record_out` / `v4l2_out` / `audio_out` get the summary table
  (Name / Device / Type + per-kind extras: record adds Output ID / Source / CRF, then Out / In cables) and their page:
  `device-view-inspector-stream.js` (type rtmp / srt / udp / ndi — URL / key / SRT mode+latency+passphrase /
  encoder / quality / audio pair rows shown by type; Save writes `streamOutputs[i]` then `/api/streaming-channel/
  credentials` for rtmp / srt; NDI → restart-dirty + "NDI output saved — Apply Caspar config…"; Start enables
  `streamingChannel` (+ dirty) and posts `/api/streaming-channel/rtmp`; log box = last 20 `rtmp.logs`),
  `-record.js` (name / CRF / codecs / bitrates / preset, Save → `recordOutputs[i]`, Start / Stop →
  `/api/streaming-channel/record`), `-virtual-cam.js` (`/api/virtual-camera/status` → status lines; Save / Start / Stop /
  config with `persist:true`), `-audio.js` (type portaudio / system-audio, device select from `live.audio` enumeration +
  manual name, monitor bus, layout limited by the device's max channels, host API / buffer / latency / FIFO; every edit
  auto-saves `audioOutputs[i]` + restart-dirty; an empty enumeration re-fires the device GETs once).
  Add / remove live in `device-view-cable-outputs.js` (`registerDeviceViewCableOutputs`): the band "+" adds
  `str_N`/`StrN`, `rec_N`/`RecN`, `audio_N`/`"Audio N"`, vcam config `{showInDeviceView:true, enabled:false}`; Remove
  (confirm) filters the settings row, prunes `deviceGraph` edges, marks dirty for audio and for a stream with
  `dedicatedOutputChannel`; vcam remove = stop (failure ignored) + config `{showInDeviceView:false, enabled:false}`.
  Numeric fields are `math-input` (focus → set → blur commit with per-kind clamps: CRF 18–51, bitrates ≥0 / ≥32 …).
- Web gaps found (ported as the web behaves unless noted; owner to decide):
  1. `startStreamingChannelRtmp` drops `type`, the SRT fields and `audioSourcePair` from the start body — only the
     saved settings row carries them.
  2. Virtual-cam success statuses ("Virtual camera settings saved." etc.) are painted with the error style. **Godot
     shows them as OK** (the golden's ok flag is not compared for vcam).
  3. Stream / record Save throws uncaught on a failed POST — no status at all. **Godot shows "Save failed: …".**
  4. Audio: picking a device after typing a manual name saves the stale manual value (the manual field is read
     first). Ported as-is (the manual field is cleared after the save, as in the web's re-render).
  5. Audio: ticking Monitor forces `system-audio` without rebuilding the device list, so a monitor row can keep a
     16-channel layout.
  6. Add ids are `count + 1` — removing a middle row then adding collides with the last id.
  7. Stream Save for rtmp / srt sets no status on success (only NDI does); record Save likewise.

### What was done
- `features/devices/output_ports_model.gd` (pure): JS-shaped coercion (`js`, `is_true` / `not_false` / `flag` — avoids
  GDScript's bool==String runtime error, `or_`, `int_or`, `pick`, `js_json`), the per-kind math clamps
  (`math_initial` / `math_commit`), summary table (`head_items`), log text, row lookup, and the add / remove plans
  (`add_plan`, `remove_confirm`, `remove_plan` with the graph prune + dirty rules).
- `features/devices/stream_record_model.gd` (pure): stream state / items (visibility by type, notes, NDI attribution),
  save (row + creds, NDI dirty + status), start / stop; record state / items / save / start / stop.
- `features/devices/vcam_audio_model.gd` (pure): vcam saved row, state, status lines from the live status, items,
  patch / body / start status; audio device + layout options (max channels, hint, disabled), the type / device /
  monitor transitions (each returns the row to auto-save), items, the enumeration-retry check, save.
- `features/devices/output_port_controls.gd`: one page class for the four kinds — builds widgets from the item lists,
  math inputs commit on submit / focus-out, selects / checks route through the model transitions, buttons run the
  plans via `host_controls_base._run` (settings re-read + reload after writes), Remove asks a confirm dialog; on open
  it fetches the stream / record logs, the vcam status, or re-enumerates audio devices once.
- `rear_panel.gd`: each extra band (Stream / Virtual cam / Record / Audio) gets a "+" (`add_requested(kind)`), and its
  item labels are clickable. `devices_tab.gd`: routes those kinds to the new page, "+" to `add_output`.
- Not ported: the live WebSocket streaming-status subscription — the page fetches logs / status on open and after each
  action instead.

### What was VERIFIED
- `tests/test_devices_output_ports.gd` + `tests/golden/devices_output_ports.json` (generator runs the four web pages
  and the real `registerDeviceViewCableOutputs` remove handlers under Node on a DOM shim with real `<select>` value
  semantics and math inputs driven focus → set → blur; streaming status seeded per case): 28 cases (13 stream, 4 record,
  4 vcam, 7 audio, not-found cases included) with 96 replayed steps (38 buttons, 33 inputs, 19 selects, 6 checks) — initial page,
  then after every step the request list, restart-dirty, status text, ok flag (except vcam, gap 2) and the re-rendered
  page; plus add plans and helpers. Godot `--test` 6200 / 6200 (5745 + 455 new), `--check` boot OK, 0 files over 500
  lines.
- Box GUI (`config/` copied + md5-listed first): Stream "+" → `streamOutputs` gains str_1, "Added stream output Str1";
  label opens the page; type → NDI rebuilds (URL / encoder / Start / Stop gone, NDI note + attribution shown); rename
  "Wall NDI" + Save → row `{type:ndi, name/label:"Wall NDI"}`, status "NDI output saved — Apply Caspar config to put it
  on air.", Apply restart-dirty. Record "+" → rec_1 / "Added record output Rec1"; CRF 99 + Enter clamps to 51 and Save
  writes `crf:51`. Audio "+" → audio_1; device select lists the box's PCH / HDMI 0–3 (16ch); picking HDMI 1 auto-saves
  `deviceName:"hw:1,7"`, status `Audio output "Audio 1" saved (stereo PortAudio)…`, layout hint "Device reports up to
  16 output channel(s)…". Virtual cam "+" → "Virtual camera output added", page shows the live status lines (Running:
  no, pipeline, mic device); Save → "Virtual camera settings saved.". Remove on each (confirm dialog text matches the
  web) → vcam `showInDeviceView:false`, `audioOutputs` / `recordOutputs` / `streamOutputs` empty, matching statuses,
  inspector cleared. Afterwards `general.json` (the persisted virtualCamera block) + the state file restored + node
  restart → every config file byte-identical; 0 SCRIPT ERROR in the GUI log.
- Not exercised live: Start / Stop stream and record, vcam Start (they would put outputs on air / need a cabled
  source) — golden-tested only.

## Slice 7a/b — Caspar server page + hot backup (2026-10-20, DONE)

### Investigation
- Web path: `device-view-caspar-render.js:457` — a click on the Caspar band that is not on a port / connector / marker
  calls `selectDevice(CASPAR_HOST)` → `device-view-inspector-caspar.js`: Server table (hostname / hardware id /
  platform / AMCP / host), Project (default frame rate select over the standard rates, value from
  `machineProfile.defaultProjectFps` else `channelMap.programResolutions[0].fps` else 50, normalised to the nearest
  standard rate; Save → POST `/api/settings {machineProfile:{defaultProjectFps}}` + restart-dirty + reload), Templates
  (CEF GPU check → `operatorTools.cefEnableGpu`, reverted on failure), Network (GET `/api/system/network` → interface
  select, DHCP / static radios, static fields; Apply → `/api/system/network/apply`), Factory reset, then
  `renderReplicationInspector` (`device-view-inspector-replication*.js` + `lib/hot-backup-project.js`): status line,
  pair line, connection panel (channel / Caspar parity, local / peer / transport tables, warnings), output warnings,
  wiring note, Mode select (standalone / leader / follower, remembered in sessionStorage
  `highascg.replication.inspectorMode`), leader picker (follower), buttons shown by role (Scan / Become / Stop
  offering / Connect / Disconnect / Refresh connection / Apply Device View → Caspar), 3 s status poll
  (`-replication-controls.js:353`).
- Web gaps found (ported as the web behaves unless noted):
  1. The parity line's tone flips on `classList.toggle(cls, cp.ok)` with `cp.ok` undefined — both `--ok` and `--warn`
     end up set (CSS shows warn). Godot shows warn.
  2. `device-view-inspector-caspar.js:197` drops the cleanup `renderReplicationInspector` returns, so every re-render
     (each `load()`) leaks another 3 s poll interval. **Godot runs one poll, stopped when the page closes.**
  3. Refresh connection with a `status` in the reply re-renders from it but skips the pair line, wiring note and mode
     sync that a normal status refresh does (ported as-is).
  4. Toasts: the web toasts alongside the status line. Godot has no toasts — a toast reaches the Devices tab's status
     line only when the action set no status itself.
  5. Not ported: Factory reset (needs the default-project builder New Project uses — WO-608) and the header badge's
     replication phase toasts (`replication-ui-state.js`, WO-608).

### What was done
- `features/devices/replication_format.gd` (pure): the shared formatters (fps fraction, age, drift, channel / Caspar
  parity, status line, local / peer / transport rows, pairing title / pair line, output warnings).
- `features/devices/server_page_model.gd` (pure): page state from settings + device view, network apply / body,
  replication status apply (full and reply-only), leaders, button visibility, and `items()` — the page spec.
- `features/devices/server_flow.gd`: every request sequence (start, poll, save fps, CEF, network, scan, mode change,
  become / stop leader, connect, disconnect with confirm, refresh connection, apply Device View → Caspar) over an
  injected io, so the golden replay and the page share it; `static var session_intent` stands in for sessionStorage.
- `features/devices/server_controls.gd`: renders the items into the Inspector, io adapter over Api (errors reshaped
  to the web's `HTTP <code>: <detail>`, settings re-read after `/api/settings`), 3 s poll Timer while open; it only
  rebuilds when the items changed and keeps a focused field's caret, so typing and open selects survive the poll.
- `devices_tab.gd`: a click on the rear panel's background (not a port, cable or "+") opens the server page; port /
  destination pages and the server page exclude each other; a reload re-renders it like the web.
- `host_controls_base.gd`: selects clip their label (the long "no leaders found" option widened the Inspector column
  by ~95 px on the box).

### What was VERIFIED
- `tests/test_devices_server_page.gd` + `tests/golden/devices_server_page.json` (scratchpad generator `sv_golden.mjs`
  runs the web page under Node on the DOM shim with live fixtures from GET `/api/device-view`, `/api/settings`,
  `/api/replication/status`, `/api/system/network` and a scripted server): 20 cases (fps sources, network variants,
  standalone / leader / follower / paired leader / paired follower / unavailable, intents) with 61 replayed steps —
  initial requests + page, then per step the request list (POSTs, confirms, dirty, reload, leader scans), status text,
  ok flag, toasts and the re-rendered page (Danger zone dropped). Godot `--test` 8746 / 8746 (2546 new), `--check`
  boot OK, 0 files over 500 lines.
- Box GUI (`config/` copied + md5-listed first): rear panel background click → Server page with live data
  (highascg7580, AMCP connected, eno1 — 192.168.50.64, "Role: standalone · not paired…"). Manual (static) shows the
  static fields, typed IP survives a poll, back to DHCP (network never applied). 25 fps + Save → status "Project frame
  rate saved (25 fps)", Apply turns restart-dirty, destination cards re-read @25, `general.json` 25. CEF on / off →
  both statuses, `cefEnableGpu` true / false in config. Scan → "Found 0 leader(s)". Mode Leader → Become leader →
  "This server is now available as leader", line "accepting followers", mode kept across the reload; Stop offering →
  "Leader availability stopped", `leaderAvailable:false`. Poll: become-leader / stop-leader posted with curl from
  outside → the page followed both within 4 s with no click. Mode Follower → its scan ("Found 0 leader(s)"), leader
  picker + Connect; Connect without a leader → red "Select a leader first (Scan for leaders)". GPU label click
  replaces the server page. Afterwards the 4 changed config files restored + node restart → every config file
  byte-identical.
- Not exercised live: connect / disconnect / refresh / apply Device View → Caspar against a real peer (single box) and
  Apply network — golden-tested only.

## Slice 7c — mapping nodes (2026-10-20, DONE)

### Investigation
- Web path: `device-view-toolbar.js:126` puts a `device-view__mappings-column` between the destinations and the rear
  panel; `device-view-mappings-render.js` fills it — "Mapping nodes" + "+" (`Actions.addMappingNode` → POST
  `/api/device-view {addMappingNode:true}`, the server builds the node), then one card per `role: pixel_mapping`
  device: label, the `pixel_map_in` dot (left), the `pixel_map_out` dots sorted by index with their 1-based number,
  and a "+" (`mappingPersist(addMappingOutput)`). A card click → `selectDevice(id)` →
  `device-view-inspector-render.js:109` → `renderMappingNodeInspector` (`device-view-inspector-mapping.js`): node
  label, input resolution (the cable into `pixel_map_in` resolved like a GPU feed), "Propose outputs from input",
  per output Label / Mode (Custom + the standard modes; W / H / FPS math inputs) / Src X·Y·W·H (the output's slice
  rect), Remove, then "+ Add Output", "Show Mapping Preview", Duplicate / Delete. Every node edit is
  `lib/mapping-node-service.js`: GET `/api/device-view?_ts=` (WO-436 cache bust) → edit the graph → POST
  `{deviceGraph}`. Mapping outputs also feed GPU / DeckLink ports: `cable_seed.feed_source` must resolve
  `pixel_map_out` sources to the output's own size (WO-437 precedence: stored dims, else the custom mode string,
  else the standard mode).
- Web gaps found (ported as the web behaves unless noted):
  1. The inspector-render call passes no `statusEl`, so rename / propose statuses never show on the web. **Godot shows
     them.**
  2. Label / mode / rect / add-output / duplicate / delete failures are dropped silently, and a failed rect save throws
     uncaught. **Godot puts them on the status line ("Mapping save failed: …").**
  3. Duplicate never marks restart-dirty (ported as-is).
  4. The `change` event fires before the math-input blur commit, so typing `1920/2` saves 1920. **Godot evaluates
     and clamps first, then saves.**
  5. A remove-output failure uses `alert()`. Godot shows it on the status line.
  6. `removeMappingOutput` re-points the removed output's slices at the first remaining output
     (`mapping-node-service.js:341`), so that output then carries two slices. Seen on the box; ported as-is.
  7. `duplicateMappingNode` renumbers the copy's outputs `out_1…` but keeps every slice's old `outputId`
     (`mapping-node-service.js:241-262`), so the copy's slices can point at the wrong or missing outputs. Ported as-is.
  8. Not ported: "Show Mapping Preview" (the pixel-map editor is outside WO-605) and the per-connector mapping page
     (`renderMappingConnectorControls`) — a mapping connector focused from a destination opens its node's page.

### What was done
- `features/devices/mapping_graph.gd` (pure): mapping-node-service's graph edits — rename, duplicate, add / remove
  output (connectors synced, cables to removed outputs pruned), field updates, propose layout, slice rect save,
  custom-mode parse / format, WO-437 output resolution.
- `features/devices/mapping_page_model.gd` (pure): the column cards, input resolution / readout, field state and
  `items()` — the page spec.
- `features/devices/mapping_flow.gd`: every request sequence (rename, propose, label, mode, custom size, rect, add /
  remove output, duplicate, delete, column add node / add output) over an injected io.
- `features/devices/mapping_controls.gd`: renders the items into the Inspector (W / H / FPS share a row), commits text
  fields like the web's `change` (Enter / leaving, only when changed; math evaluated first), keeps focus across the
  re-render a save's reload causes.
- `features/devices/mapping_panel.gd`: the column — "+", cards with in / out dots registered as cable anchors, card
  "+", the open node's card outlined.
- `devices_tab.gd`: the column between destinations and rear panel; a card or a `pixel_map_*` connector opens the node
  page; it excludes the destination / port / server pages; a reload re-renders it or closes it when the node is gone.
- `cable_seed.gd`: `feed_source` resolves a mapping output's feed (size and label), so GPU / DeckLink pages fed by a
  mapping output show its resolution. `devices_model.gd`: cables to and from mapping connectors are labelled
  "<node> in" / "<node> out N" (the web lists raw ids).
- Found on the box and fixed: duplicate drew one random tag for all slices, so the copy's slice ids collided. The web
  draws `Math.random()` per slice, and the golden pins `Math.random`, so it could not catch this. `duplicate_node` now
  takes a Callable drawn per slice, and a unit test pins it. (`G.duplicate` also clashed with `Resource.duplicate` on
  the script object, so it is named `duplicate_node`.)

### What was VERIFIED
- `tests/test_devices_mapping.gd` + `tests/golden/devices_mapping.json` (scratchpad generator `mp_golden.mjs` runs the
  web band, inspector and mapping-node-service under Node on the DOM shim against a scripted device-graph server, Date
  / Math.random pinned): 12 cases (rename, propose, propose without input, output fields, stale dims, rects, remove
  output and its failure, add / duplicate / delete, column adds, no nodes, failures) with 41 replayed steps. Per step
  the test compares the request list (GETs, POST bodies, confirms, alerts, dirty, reload), the status, the server graph
  afterwards, the re-rendered page ("Show Mapping Preview" dropped), the column cards and the mapping-output feed
  resolutions. Helper tables (parse / format / resolve / propose) are also checked. Godot `--test` 11362 / 11362,
  `--check` boot OK, 0 files over 500 lines.
- Box GUI (`config/` copied + md5-listed first):
  - Adding a node: column "+" → "Pixel Mapping 1" card with IN + 2 numbered dots, status "Added pixel mapping node",
    Apply goes restart-dirty.
  - Cabling: Main LED PRV → mapping IN (edge note `outputLayer:2`), mapping out 1 → DP 4/5; the cables list reads
    "Main LED (DP-7) → Pixel Mapping 1 in" / "Pixel Mapping 1 out 1 → DP 4/5".
  - Card click → page with "1920×1080 @ 50 Hz — Main LED (DP-7)".
  - Propose → "Proposed Out 1: 960×1080 @ x=0 · Out 2: 960×1080 @ x=960", server slices x 0 / 960.
  - Field edits:
    - Custom W `1920/2+100` → 1060, saved as `1060x1080p50`.
    - Src Y 20 saved in the slice rect, with focus kept in the field.
    - Mode 720p5000 saved as 1280×720@50; the W / H / FPS row shows it disabled.
    - Node rename "LED Wall" and output label "Left" are saved; the card and cable labels follow.
  - Outputs:
    - Card "+" → out_3, status "Mapping updated".
    - Remove on the cabled Output 1 → confirm → output, connector and cable gone (gap 6 seen).
  - Duplicate → "LED Wall Copy" with its own connectors and no cables. After the fix its slice ids are distinct
    (`map_mvglqyf0_tsnh0k` / `…_rur1pl`).
  - Delete on the copy → confirm → node and connectors gone, page closed.
  - Page exclusion and opening paths: the server page, a mapping page and a destination page replace each other, and
    the card outline follows. Main LED's "Input Feed (Layer 2)" mapped-output link opens the LED Wall page.
  - Afterwards `device_graph.json` + `.highascg-state.json` were restored and node restarted → every config file
    byte-identical.
- Not exercised live: the failure paths (golden-tested only) and Apply Caspar config with a mapping node cabled. The
  Caspar side of pixel mapping is outside this port.


## Slice 8 — device snapshots (2026-10-20, DONE)

### Investigation
- Save entry: the Devices header's download-arrow button (`device-view-toolbar.js:28-51`, re-wired by WO-445 /
  b96324a4 after WO-435 removed the old text buttons), title "Save device snapshot (cabling + GPU/DeckLink profile as
  JSON)". It calls `openSaveDeviceSnapshotModal` (`device-view-snapshot-modals.js:39`):
  - The modal has a device name (placeholder "e.g. OB truck Caspar 1"), a live "File: <slug>.json" line, an "Embed
    rear-panel image (PNG)" checkbox (on by default), the scope note, and Cancel / "Save…".
  - Save… runs these steps:
    1. An empty name gives "Enter a device name.".
    2. GET `/api/device-snapshot/build`. Anything but `{ok, kind: highascg-device-snapshot}` gives "Save failed: <error
       | 'Server did not return a device snapshot envelope'>".
    3. With the checkbox on, it captures the rear panel (`lib/device-snapshot-capture.js`: html-to-image `toPng` of the
       rear-panel element at pixelRatio 2, giving `{mimeType, encoding: base64, width, height, data}`). A failure gives
       "Saved without image (capture failed).".
    4. It builds the doc in key order kind, version, deviceName, slug, createdAt (build's or now), appVersion?, host?,
       visual?, payload.
    5. It downloads `<slug>.json` as `JSON.stringify(doc, null, 2)`, shows "Saved <slug>.json" and closes.
  - Slug rule: lowercase, runs of non-`[a-z0-9]` become "-", trimmed of "-", and "" becomes "device".
- Load: `openLoadDeviceSnapshotModal` (`:120`). It has no Devices entry since WO-435 ("snapshots ride in the project
  file"); only `project-hardware-reconcile-modal.js` opens it, and that modal is WO-608 scope.
  - Layout: the intro, a file input, mode Full / Graph only, a preview, and Cancel / Preview / Apply (Apply disabled).
  - Picking a file shows "No file selected." / "Click Preview to validate and list changes." / "Invalid JSON: …".
  - Preview POSTs `/api/device-snapshot/apply {snapshot, mode, dryRun: true}`, giving "Mode / Sections / Changed keys …
    Click Apply to write to config." or "Error: <msg | 'Validation failed'>". Apply is enabled only after a passing
    preview.
  - Apply asks to confirm, then POSTs with dryRun false. Success gives "Device snapshot applied.", fires
    `highascg-settings-applied` + onApplied, and closes. Failure gives "Apply failed: <msg | 'Apply failed'>".
- Server (`src/api/routes-device-snapshot.js`, `src/config/device-snapshot.js`) is unchanged. A rejected snapshot is 400
  `{ok: false, error: 'Invalid device snapshot', details: […]}`.
- Web gaps found (ported as the web behaves unless noted):
  1. "Saved without image (capture failed)." is overwritten by "Saved …" in the same tick (both show here too, in
     order).
  2. A failed apply reads "Apply failed: Apply failed" when the server gives no message (ported as-is).
  3. The dry run's 400 `details` list is dropped. **Godot lists them under the error.**
  4. The capture is html-to-image of the element at 2×. **Godot crops the window's pixels under the rear panel at 1×,
     grabbed when Save opens, with the cable layer hidden for that frame** (the web's element capture excludes the
     cable overlay too).
  5. The browser downloads silently to the default folder. **Godot opens a save-file dialog** (default
     `~/Downloads/<slug>.json`). Cancelling it leaves the Save dialog open; a write failure goes to the status line.
  6. The Load dialog keeps the web's lack of a Devices entry. It is reachable from WO-608's reconcile modal (to port)
     and from a dev flag `--probe-snapshot-load`.
  7. Observation, server side: applying a full snapshot rewrote `general.json` without its empty
     `"multiview_os_rate": ""` key. The web client calls the same endpoint, so it behaves the same; this was not chased
     here.

### What was done
- `features/devices/snapshot_model.gd` (pure):
  - the texts and the slug / file label;
  - `iso(ms)` (toISOString), the envelope check and the document (web key order);
  - `to_text`: integral floats are written as ints, so Godot's text equals `JSON.stringify(doc, null, 2)` byte for
    byte;
  - the file parse (line numbers from 1), the dry-run text and the confirm text.
- `features/devices/snapshot_flow.gd`: save / on_file / dry_run / apply over an injected io, shared by the dialogs and
  the golden replay.
- `features/devices/snapshot_dialogs.gd`:
  - the header button (the web's download-arrow icon drawn in `_draw`);
  - the Save dialog (fresh name / checkbox each open like the web's new modal, with an autowrapped note given a width
    so the dialog does not grow a line per word), the rear-panel capture and the save-file dialog;
  - the Load dialog (Choose file… / mode / preview, plus Cancel / Preview / Apply) and its confirm.
  - Apply re-reads Settings and emits `applied`, which reloads the Devices tab.
- `devices_tab.gd`: the button after "Apply Caspar config" (the web's order), dialog status lines to the tab status,
  and the tab's click capture stands down while a snapshot dialog is open. `app/main.gd`: `--probe-snapshot-load`.

### What was VERIFIED
- `tests/test_devices_snapshot.gd` + `tests/golden/devices_snapshot.json`: the scratchpad generator `sn_golden.mjs`
  runs the web modals + capture module under Node on the DOM shim against a scripted server, with Date pinned.
  - 22 cases and 51 replayed steps:
    - Save: name edits, empty name, with / without capture, a unicode slug, an odd payload (unicode, escapes, 29.97,
      1e21, -0), a bare envelope (createdAt from now), build failure / not ok / wrong kind, Cancel.
    - Load: no file, an invalid file, Preview before a file, dry run ok / not ok / thrown, mode switch, confirm
      declined, apply ok / not ok / thrown, Cancel.
  - Per step the test compares the requests (GET / POST mode·dryRun·kind / confirms / settings-applied), the status
    lines, open / closed, the downloaded file name and its exact text, the preview and whether Apply is enabled. JSON
    parse messages are compared by their "Invalid JSON: " prefix only.
  - Also checked: slug and ISO tables, document key order with a visual, the details list (gap 3), and parse error
    line numbers.
  - Godot `--test` 11714 / 11714, `--check` boot OK, 0 files over 500 lines.
- Box GUI (`config/` copied + md5-listed first):
  - The arrow button sits after Apply Caspar config.
  - Save with the image: "Shop Box Caspar 1" (File line followed: `shop-box-caspar-1.json`) → Save… → file dialog at
    `~/Downloads` with that name → Save → status "Saved shop-box-caspar-1.json".
    - The written file has keys `kind, version, deviceName, slug, createdAt, appVersion, host, visual, payload`.
    - Its text equals Node's `JSON.stringify(JSON.parse(text), null, 2)`.
    - payload and host equal a fresh GET `/api/device-snapshot/build`.
    - The visual decodes as a 616×308 PNG of the rear panel alone (no cables).
    - The server dry run accepts it: `sections` deviceGraph / screenDestinations / gpuPhysicalTopology / systemDisplay /
      casparServer, `changedKeys: []`.
  - Save edge paths:
    - An empty name gives "Enter a device name." and the dialog stays open.
    - The checkbox off, then a cancelled file dialog: the Save dialog stays open and nothing is written.
    - Saving again gives `no-image.json` without `visual`.
  - Load (via `--probe-snapshot-load`):
    - Preview without a file gives "Select a valid JSON file first.".
    - `broken-snap.json` gives "Invalid JSON: Expected key …".
    - A copy of the saved snapshot with one destination renamed, then Preview, gives "Mode: full / Sections: … /
      Changed keys: screenDestinations", and Apply is enabled.
    - Apply shows the confirm "Apply device snapshot (full)? This updates saved configuration." Pressing OK closes the
      dialog, shows "Device snapshot applied." and the card re-renders as "Main LED SNAP".
  - Afterwards `screen_destinations.json`, `general.json` and `.highascg-state.json` were restored and node restarted.
    Every config file was byte-identical, and the GUI was relaunched showing "Main LED (DP-7)". The test files were
    moved out of `~/Downloads` to the scratchpad.
- Not exercised live: graph-only mode apply and the server-error paths (golden-tested only).
- Still unported in the Device View: the GPU layout and DeckLink rear-order edit modes (the band headers' pencil
  buttons: drag markers, Show all, Clear layout, the inspector layout editors). That is slice 9. The Caspar config
  editor modal (Devices header icon) is in WO-608's inventory.

## Slice 9a — DeckLink edit mode (2026-10-20, DONE)

### Investigation
- Toggle: the DeckLink band header's pencil (`device-view-caspar-render.js:340-370`), title "Edit DeckLink port order —
  drag markers on the rear panel, or use Save / Export / Load in the inspector (same as GPU layout).".
  - It flips a module-level `decklinkEditMode` and the band class `device-view--edit-mode-decklink`, and makes the
    DeckLink markers draggable.
  - Turning it on opens the inspector on `decklinkRearOrderIds[0]`.
- Order: `lib/device-view-decklink-order.js`. localStorage `decklink_rear_panel_order` holds an id list.
  `orderDecklinkConnectors` puts saved ids first and appends the rest in payload order. The merged list is
  `suggested.connectors` decklink_io then decklink_out on caspar_host, deduped (`device-view-caspar-rear-data.js:66-85`).
- Panel default: `device-view-caspar-render-markers.js:14`. With ≥4 DeckLink items and **no saved order**, the panel
  shows 4,2,3,1 (an item matches n when its label contains n or its index is n-1). That is why the box shows 4,2,3,1.
  **Slice 1's note (line 92) that this order comes from localStorage was wrong.**
- Rear-panel drag (`-markers.js:~188-236`): dropping a marker on another swaps the two ids and saves.
- Inspector editor (`device-view-inspector-decklink-rear-order.js`). It renders only in edit mode and lists
  "Slot N" / label / id / "≡" rows.
  - Row drop splices the row out and inserts it at the target index (−1 when dragging down).
  - Save writes the list.
  - Export downloads `decklink_rear_panel_order.json` = `{version: 1, decklinkRearOrder}` (2-space JSON).
  - Load accepts an array, `{decklinkRearOrder}` or `{connectorIds}`. A bad file gives
    `alert('Invalid DeckLink order file: …')`.
  - Reset order asks "Clear saved DeckLink rear panel order?", then removes the key.
  - Every change re-renders the device view.
- Web gaps found:
  1. **Two orders.** With no saved order the panel shows 4,2,3,1, but the editor, Save, Export and the rear-panel swap
     all work on the unsorted order. Example: swapping the panel's top two markers actually swaps DeckLink 1 and 2.
     **Godot uses the shown order everywhere:** the editor lists what the panel shows, and Save / Export / swap start
     from it.
  2. Dragging a row onto the next row down is a no-op (the −1 lands it back in place). **Godot inserts by drop
     half:** the lower half of a row means "after it".
  3. In the 4,2,3,1 pick, a label like "Port 12" matches both 1 and 2, and the web lists it twice. **Godot dedupes.**
  4. Edit mode opens the first unsorted id. **Godot opens the first port shown.**
  5. **Bug (fixed here, web):** `device-view-inspector-decklink-rear-order.js` called `escapeHtml` without importing
     it. That threw a ReferenceError whenever edit mode rendered a DeckLink page, so the editor never appeared in the
     browser. The bug dates from the WO-479 split (cccb6939). The fix adds `import { escapeHtml } from
     '../lib/dom-escape.js'`.
  6. The web alert on a bad Load file becomes the Devices status line. **A successful Load reports
     "Loaded <file>" there** (otherwise an earlier error would survive the refresh).
- Storage: the order is per-browser in the web, so it is per-client here. It lives in `user://devices.cfg`
  (`[decklink] rear_order`) and is never sent to the server, like the previs `user://ui.cfg`.

### What was done
- `features/devices/decklink_order.gd` (pure + prefs):
  - `merged`, `order`, `display` (4,2,3,1 when not persisted, deduped) and `current` (the shown order);
  - `move` (half-based insert), `swap`, `parse_file` and `export_text` (byte-equal to `JSON.stringify(…, null, 2)`);
  - the texts, and `saved / save / clear` on `user://devices.cfg`;
  - `static var edit`, the per-session edit-mode flag, like the web's module variable.
- `devices_model.gd`: `build(…, deck_saved)` orders the DeckLink column with `DO.current`.
- `rear_panel.gd`:
  - the DeckLink header gets a pencil (ACCENT when on);
  - in edit mode the labels turn accent-coloured with a drag cursor and the tip "— drag onto another port to swap";
  - `begin_drag` plus `_input` run a manual drag that outlines the target. Dropping on another DeckLink label swaps
    and saves. Releasing on the same label opens its page.
  - The drag is manual because the tab's click capture owns label presses, so native Godot drag cannot start there.
- `decklink_order_editor.gd` (new): the inspector editor.
  - Native `set_drag_forwarding` rows show an accent edge on the drop half.
  - Save / Export (save-file dialog) / Load (open dialog) / Reset order (red, confirm).
  - Each change saves and asks for a reload.
- `decklink_port_controls.gd`: the editor goes under the title when edit mode is on.
- `devices_tab.gd`: passes the saved order to the model and starts rear drags before `label_at`. Its
  `order_changed`, `open_requested` and `edit_toggled` handlers do the following:
  - on: open the first shown port, then refresh;
  - off: refresh, which re-renders the open page without the editor.
- `file_pick.gd` (new): the shared save / open FileDialog wrapper (`~/Downloads`, `*.json`) and `write_text`.
  `snapshot_dialogs.gd` now uses it instead of its own dialog code.
- Web: the `escapeHtml` import (gap 5), rebuilt with `npm run build:client`.

### What was VERIFIED
- `tests/test_devices_decklink_order.gd` + `tests/golden/devices_decklink_order.json`. The scratchpad generator
  `dk_golden.mjs` runs the real web lib + editor + markers display code under Node on the DOM shim, with
  localStorage / confirm / alert / download stubbed. It covers:
  - 5 order cases and 8 display cases (including the duplicate pick);
  - 4 editor replays: no saved order, saved order, Load of each file shape plus bad files, and Reset with confirm
    on / off. Rows are compared in shown order (gap 1).
  - Also: move / swap tables, and no editor when not in edit mode.
  - Godot `--test` 11780 / 11780, `--check` boot OK, 0 files over 500 lines (devices_tab 496).
- Box GUI (only `user://devices.cfg` was written; no `config/` file changed in the run):
  - The fresh panel shows DeckLink 4, 2, 3, 1.
  - Pencil on: the labels turn accent-coloured, the inspector opens DeckLink 4 with the editor at Slot 1–4 = 4, 2, 3, 1,
    and the pencil turns accent.
  - Rear drag from DeckLink 4 to DeckLink 1: the target is outlined during the drag. On release the panel and editor
    show 1, 2, 3, 4 and `rear_order=["dlsdi_1","dlsdi_2","dlsdi_3","dlsdi_4"]`.
  - Editor drag of Slot 4 onto Slot 1's upper half gives 4, 1, 2, 3, saved, and the panel follows.
  - Export opens the "Export DeckLink rear order" dialog at `~/Downloads/decklink_rear_panel_order.json`. The file is
    byte-identical to Node's `JSON.stringify({version:1, decklinkRearOrder:[…]}, null, 2)`, and the status reads
    "Exported decklink_rear_panel_order.json".
  - Load `dk_bad.json` (`{nope`) gives "Invalid DeckLink order file: Expected key (line 1)" with the order unchanged.
    Load `dk_good.json` (an array) gives 3, 2, 1, 4, saved, with the status "Loaded dk_good.json".
  - After a GUI restart, 3, 2, 1, 4 is still shown and edit mode is off. Pencil on opens DeckLink 3, the first shown.
  - Reset order shows the confirm "Clear saved DeckLink rear panel order?". Cancel leaves the order alone. Reset
    empties the prefs and the panel and editor return to 4, 2, 3, 1.
  - A click (no drag) on DeckLink 2 in edit mode opens DeckLink 2. Pencil off: white labels, and the open page loses
    the editor.
  - The snapshot dialogs after the FilePick refactor:
    - Save "s9check" writes a file with the same keys as slice 8 and a 616×310 PNG `visual`.
    - Load via `--probe-snapshot-load`: Choose file… opens "Open a File", and Preview of s9check gives "Changed keys:
      (none)". Cancelled, nothing applied.
  - Cleanup: test files moved to the scratchpad (`s9a_files/`), `devices.cfg` removed (it did not exist before), and the
    GUI relaunched.
- The web fix was not clicked in a browser (no kiosk on the dev box). It is proven by the golden generator, which
  threw the ReferenceError before the import and renders the editor after it, and by the rebuilt bundle.
- Still unported in the Device View:
  - slice 9b, the GPU layout edit mode (pencil Show all / Clear layout, hidden markers, the inspector layout editor
    posting `gpuPhysicalTopology`, gpu-ports-reset);
  - the web cable row's "Node view" (simple wiring) and "Matrix view" toggles;
  - the GPU band's "Disconnected (N)" folder.

## Slice 9b-1 — GPU column = the web's GPU port model (2026-10-20, DONE)

### Investigation
- The web GPU column is not a plain `physicalMap.ports` read (slice 1 simplified it that way).
  `device-view-caspar-rear-data.js:52-64` runs `buildGpuSelectablePortEntries` (`lib/device-view-gpu-port-list.js:103`):
  1. Rows come from the topology (`resolveTopologyForDeviceView`): `physicalMap.effectiveTopology`, else the saved
     `gpuPhysicalTopology` (settings, then payload), else `physicalMap.suggestedTopology`.
     Each row goes through `entryFromTopologyRow` (`-entries.js:42`): its label is the pair label plus
     " · <active>", or " (no mode)" when the active output has no resolution.
  2. Raw live entries are added only when their id is **not** `gpu_pN`. `buildRawGpuPortEntriesFromLive` drops every
     non-`gpu_pN` id when the server has a DRM map. So on a DRM box the column is exactly the topology, and the raw
     pass only matters without one: suggested non-`gpu_pN` connectors, physical ports with odd ids, and display rows
     not already bound to a jack.
  3. `mergeGpuLayoutEntriesWithPrefs` (`-merge.js:34`):
     - localStorage `gpu_custom_layout` adds **hidden flags and labels only**.
     - Order follows the topology **array** order, not slotOrder.
     - Topology rows with no entry are appended, taking the pairs from the prefs.
  4. `entryToRearPanelGpuItem` builds each marker. A marker that is not a topology slot and is neither live nor
     connected goes in the "Disconnected (N)" `<details>` (`-markers.js:51`, `render.js:390-455`). Hidden markers are
     `display:none`, and the title shows " (N hidden)".
- Consequences:
  - With a DRM map but no topology, the web shows **no** GPU jacks. Slice 1 showed the ports.
  - Without a topology, `gpu_pN` suggested connectors make no jacks either. The server always publishes
    `effectiveTopology` with its map, so the box is unaffected.
- Not ported:
  - the one-time legacy localStorage → server migration (`-migrate.js`; Godot has no legacy prefs);
  - the debug tracer (`-layout-debug.js`);
  - the inferred `gpu_pN` padding in the raw pass and the localStorage port-count override behind it. Those entries
    are `gpu_pN`, so they never survive to the column.

### What was done
- `features/devices/gpu_entries.gd` (pure):
  - the norm / coercion helpers;
  - `topology`, `from_topology_row` / `from_topology`, `matching` (displaysMatchingPairs), `pair_label`, `is_primary`,
    `has_server_map`;
  - `raw_extra`: the raw pass reduced to what can reach the output, keeping the `gpu_pN` entries for the "already
    bound" checks.
- `features/devices/gpu_layout.gd`:
  - `prefs_of`, `merge`, `entries`, `inventory`, `rear_item(s)`, `in_folder`, `column` (the tab's payload →
    items with `hdmi` / `folder`);
  - `layout_items`, `items_from_live`, `to_topology` (gpuLayoutItemsToPhysicalTopology) and `port_options`;
  - the client prefs on `user://devices.cfg` `[gpu] layout`.
- `devices_model.gd`: `build(…, gpu_saved)` uses `GL.column`. The old `gpu_ports` / `gpu_pair_label` are removed
  (the test now calls `pair_label`).
- `rear_panel.gd`: the GPU plate skips hidden rows and adds the "(N hidden)" hint with the web's tooltip. Folder rows
  go under a "▸ Disconnected (N)" fold, closed like the web's `<details>` and kept open per session once opened.
- `devices_tab.gd` passes `GL.saved()`.

### What was VERIFIED
- `tests/test_devices_gpu_layout.gd` + `tests/golden/devices_gpu_layout.json`. The scratchpad generator
  `gl_golden.mjs` runs the web lib + the markers' folder test under Node on the box's GPU block and 9 variants:
  - box with and without prefs (hidden, label, an orphan pref, a bad id, a row without an id);
  - saved topology only (reordered, HDMI);
  - suggested topology only;
  - extra ports outside the topology;
  - no physical map (suggested + displays, including a covered one);
  - inventory only;
  - `totalPorts` only;
  - split ids + eDP + "no mode" + an unmapped port + prefs;
  - a topology row missing from the entries, with pref pairs.
- Per case the test compares every entry, every rear item, the folder flags, the layout items, the topology rows,
  `items_from_live` and the port options. It also covers odd topology rows and options with no GPU data.
- `test_devices_model.gd`: the fixture gained the server's `effectiveTopology` + a display. There are new cases for no
  topology (only `gpu_out_x` → the folder) and a saved layout.
- Godot `--test` 11972 / 11972, `--check` boot OK.
- Box GUI:
  - With no prefs the GPU column is unchanged (DP 0/1, DP 2/3 · DP-2, DP 4/5, DP 6/7 · DP-6, cables on P1 / P3).
  - With `[gpu] layout` = gpu_p0 hidden + gpu_p2 "Wall", the header reads "GPU (1 hidden)", DP 0/1 is gone, P2 reads
    "Wall", and cables still land.
- The folder is golden / model-tested only. The box has no non-topology GPU socket.

## Slice 9b-2/3 — GPU edit mode + layout editor (2026-10-20, DONE)

### Investigation
- **GPU edit mode** (`device-view-caspar-render.js:220-330`).
  - The GPU header's pencil toggles `gpuEditMode`, which sets the band class `device-view--edit-mode`. DeckLink has
    its own `-decklink` class, so the two modes are independent.
  - While edit mode is on:
    - **Show all** (`buildGpuLayoutItemsFromLive(live, gpuOuts)` with every row visible) writes localStorage only.
      Status "All GPU ports shown".
    - **Clear layout** confirms "Clear saved GPU layout and rebuild from detected outputs?", clears the prefs, POSTs
      `/api/system/gpu-ports-reset {}` (reply ignored), then shows "GPU layout cleared — refreshed from detected
      outputs".
    - Hidden markers come back at opacity 0.3.
    - Turning the mode on opens the first layout item's page.
- **Inspector editor** (`device-view-inspector-gpu-layout-editor.js`, appended after the GPU page summary).
  - Rows are `layoutItemsFromGpuEntries(buildGpuSelectablePortEntries({live, suggested gpu outs, savedTopology:
    payload.gpuPhysicalTopology}))`. The device-view payload carries no `gpuPhysicalTopology`, so the order comes from
    the live `effectiveTopology`. The server reconciles that from the saved config (`gpu-physical-map.js:253`).
  - Each row has Port A / Port B (None + `collectGpuPortNameOptions`) and Hide connector.
    - Any change recomputes the label: eDP pairs joined " · ", else `HDMI|DP` + the suffixes after the first `-`,
      joined "/".
    - It also recomputes the type (hdmi > edp > dp) and the hidden flag.
    - The web keeps duplicates, e.g. Port A = DP-1 on a DP-0/DP-1 row gives `[DP-1, DP-1]`, labelled "DP 1/1".
  - Rows can be dragged with half insert (`dropAfter`).
  - **Unmapped live displays**: `physicalMap.ports[].unmapped` rows. A socket select over the `gpu_pN` rows plus
    **Assign** fills pairs[0], else pairs[1], else replaces pairs[0].
  - **Bulk buttons**: Show all / Hide disconnected (pairs vs `live.gpu.displays[].connected`) / Hide all.
  - **Save** (`saveAndRefresh`) writes localStorage, then POSTs `/api/settings {gpuPhysicalTopology}` when there are
    `gpu_pN` rows, then shows "GPU layout saved (topology persisted)" and reloads.
  - **Export** writes `<MODEL>_<n>ports_layout.json`: the model upper-cased, default `NVIDIA_GPU`, whitespace → `_`.
  - **Load**:
    - a non-array alerts;
    - otherwise `mergeLoadedGpuLayout` runs: rows named in the file merge over theirs or are appended, and file
      order comes first;
    - then it saves, POSTs the topology and alerts.
  - **Reset layout**:
    - POSTs gpu-ports-reset `{}`.
    - With no pairs (or an error): confirm, clear the prefs, rebuild from live.
    - With pairs: confirm the current-vs-discovered diff, clear the prefs and merge the discovery. It then POSTs
      `{persist: true}` and, when that reply isn't `persisted`, the topology itself.
- **Rear marker drag** (`-markers.js:246-300`): in edit mode, dropping one GPU marker on another swaps the two layout
  items in localStorage.
- **Web gaps**:
  1. The rear GPU marker swap writes localStorage only. The column's order comes from the topology (slice 9b-1), so the
     swap is undone on the next load and never sticks.
  2. A failed topology POST (Save / an edit / Load / the Reset fallback) is only logged to the console. The status
     still says "GPU layout saved (topology persisted)" / "…saved to server.".
  3. The bulk buttons and Load don't re-render the rows. `load()` keeps the inspector DOM, so the ticks and order
     stay stale until the next edit re-renders.
  4. After Reset layout from discovery, the rows keep the old Hide ticks (merge over the current rows) although the
     saved layout they came from was just cleared. The rear panel shows everything; the editor disagrees.
  5. A pair name not among the options (e.g. HDMI-0 from discovery on a box without one) shows as None in its
     `<select>`, while the row still holds it.
  6. Still not ported (unchanged): the Node view / Matrix view toggles.

### What was done
- `features/devices/gpu_layout_flow.gd` (new): the editor's rows and every request, over an injected `io`
  (`post_json` / `confirm` / `reload` / `status` / `prefs_save` / `prefs_clear`).
  - Rows and options: `rows`, `unmapped`, `edit`, `move`, `bulk`, `assign`.
  - Requests: `save`, `export_name` / `export_text`, `load_text` + `merge_loaded`, `reset` with `layout_rows`.
  - Rear actions: `show_all`, `clear_layout`, `swap`.
  - Departures from the web, on purpose:
    - Gap 2: a failed POST is reported ("…topology not saved: <error>", red).
    - The web's alerts go to the status line.
    - Gap 4: after a Reset the flow is marked `stale`, so the page re-reads its rows.
    - Gap 1: the rear swap also saves the topology, so it sticks.
- `features/devices/gpu_layout_editor.gd` (new): the editor UI. It builds:
  - the heading;
  - socket rows (title + ≡, Port A/B OptionButtons, Hide connector), dragged via `set_drag_forwarding` with the
    half-insert highlight;
  - the unmapped section;
  - the bulk and action rows (Export / Load through FilePick).

  Its `Io` class wires the flow to Api / the client prefs / the page's confirm, status and reload. Gap 3 needs no
  handling: every change rebuilds the page from the flow.
- `gpu_layout.gd`:
  - `static var edit` (GPU edit mode);
  - `column_entries` split out of `column`, because the rear swap needs the column's layout items.
- `gpu_output_controls.gd`:
  - The editor goes between the summary and the toggles (web position) while `GL.edit` is on.
  - The page keeps the flow across reloads (web: the editor outlives `load()`) until it closes, edit mode goes off
    or a reset makes it stale.
  - `rear_action(what, a, b, payload)` carries out the rear Show all / Clear layout / swap. They live here, not in
    `devices_tab.gd`, to keep that file under 500 lines.
- `rear_panel.gd`:
  - The pencil is generic (`_pencil(gpu)`). The GPU one carries the web tooltip.
  - In GPU edit mode the header gains Show all / Clear layout, and hidden rows show at 0.3 alpha.
  - GPU labels drag onto GPU labels; the drop emits `gpu_edit("swap", slot, slot)`.
  - `edit_toggled(first)` now carries the first port to open. This replaces the tab's own DeckLink lookup and
    serves both modes.
  - **Bug found on the box and fixed**: the release handler cleared `_drag` before the kind check read it, so a GPU
    drop did nothing. `_same_kind(a, b)` now takes both ids.
- `devices_tab.gd`: the edit lambda opens `first`, and `gpu_edit` routes to `_gpu.rear_action`. Net +1 line (496).

### What was VERIFIED
- `tests/test_devices_gpu_editor.gd` + `tests/golden/devices_gpu_editor.json`.
  - The scratchpad generator `ge_golden.mjs` (`sv_shim.part` DOM + api stub + localStorage + confirm / alert /
    download capture) drives the real web editor through 5 cases:
    - box edits: ports, hide, 4 drops including two no-ops, the bulk buttons, Save, Export;
    - load + reset: a non-array file, bad JSON, a merge file, Reset with no discovery (cancel / OK), with discovery
      (cancel / OK / `persisted`), and with a 500;
    - Assign ×3;
    - eDP + HDMI labels and types, Assign onto a socket already holding that display, Hide disconnected, Export;
    - a GPU-model export name and a failed topology save.
  - For every step the test compares the localStorage writes / clears, POST bodies, confirms (exact text including
    the diff), reloads, the download (name + byte-identical text), status + ok, rows and the unmapped list.
  - The test maps three things on purpose:
    - alerts → status;
    - stale web rows → what it saved;
    - the failed POST → the Godot message.
  - Plus Show all vs the web's `buildGpuLayoutItemsFromLive`, `merge_loaded` and the `layout_rows` edge cases.
  - Mutation check: these single edits each fail the suite:
    - insert-after flipped;
    - persisted ignored;
    - eDP join changed;
    - hdmi/edp type order swapped;
    - the HDMI label dropped;
    - the Assign "already holds this display" branch.

    The last three were only caught after adding the eDP/HDMI case.
- Godot `--test` 12210 / 12210, `--check` boot OK, the file-line gate passes (0 over 500).
- Box GUI (config backed up first; the client's `devices.cfg` was the only other write):
  - **Pencil**: opens P0's page with the editor under the summary. The header gains Show all / Clear layout, and
    hidden DP 0/1 shows dimmed.
  - **Port B → None** on socket 2: `general.json` gpu_p1 `dpB ""`, prefs saved, status green. The rear label and
    cable list read "DP 2".
  - **Editor drag**, socket 4 onto socket 1's upper half: server topology p3,p0,p1,p2, and the rear plate follows.
  - **Rear label drag**: "DP 6/7 · DP-6" onto "Wall" swaps p3 ↔ p2 on the server. The cable follows its socket.
  - **Export**: `NVIDIA_GPU_4ports_layout.json`, byte-identical to Node's `JSON.stringify(items, null, 2)`.
  - **Load**: a non-array file gives a red status. A valid file merges (p3 first as "Main", p1 hidden), saves the
    topology and shows "GPU layout loaded from file."; the rear reads "(2 hidden)".
  - **Hide disconnected**: hides exactly the two sockets without a connected display (live DP-6 / DP-2).
  - **Reset layout**:
    - The diff confirm lists current vs discovered. Cancel leaves `general.json`'s md5 unchanged.
    - OK writes the discovered topology with `gpuPhysicalTopologyOperatorSaved: true`, clears the prefs, and shows
      "GPU layout reset from discovery and saved to server.".
    - The rows re-read after a relaunch.
  - **Hide all, then rear Show all**: prefs all visible, `general.json` md5 untouched (web: Show all saves no
    topology), status "All GPU ports shown", and the editor re-reads.
  - **Clear layout**: Cancel keeps the prefs. OK clears them and shows "GPU layout cleared — refreshed from detected
    outputs".
  - **Pencil off**: the editor and header buttons are gone.
  - Prefs + topology survived a GUI restart.
  - Cleanup:
    - `config/general.json` restored from the backup and node restarted; the md5 matches the backup after the
      restart. The run had changed only `gpuPhysicalTopologyOperatorSaved`; the topology itself came back to
      discovery = original.
    - `.highascg-state.json` differed only in look-layer transforms not touched by this slice, so it was left alone
      as live state.
    - The test files and the final `devices.cfg` moved to the scratchpad (`devices.cfg` did not exist before).
    - The GUI was relaunched.
- **Golden / model-tested only**:
  - Assign: the box has no unmapped display.
  - A failing topology POST: the server can't be made to fail it on demand.
  - Reset with no discovery.

## Slice 10a — Matrix view (2026-10-20, DONE)

### Investigation
- **Toggle** (`device-view-toolbar.js:86-107, 192-280`).
  - The "Matrix view" checkbox (tooltip "Dense Dante-style routing matrix.") persists in localStorage
    `device-view-matrix`.
  - It is mutually exclusive with "Node view": checking either one unchecks the other.
  - Matrix mode hides the destinations, mapping and rear panels, the cable overlay, the Node view checkbox and the
    cable-loops slider. It shows `matrixHost`; the inspector stays.
- **Rows / columns** (`client/lib/device-view-matrix-ports.js` `extractMatrixPorts`). Rows are sources, columns are
  sinks.
  - Rows, in this order:
    1. `listAllScreenDestinationsForDeviceView`. A non-host `pgm_prv` destination becomes two rows (`— PGM`, `— PRV`,
       WO-364) sharing one graph id. Host / virtual destinations are grouped as "Host channels".
    2. The remaining `listHostChannelDestinations`.
  - Pixel maps: the first `pixel_map_in` connector is a column ("<label> In"). The `pixel_map_out` connectors are
    rows ("<label> Out n"), stable-sorted by `Number(index) || 0`.
  - Suggested connectors:
    - These 8 kinds are columns: gpu_out, decklink_out, decklink_io, caspar_mv_out, stream_out, record_out,
      audio_out, v4l2_out.
    - audio_in and v4l2_in are rows.
    - Group names come from substring tests on the kind, applied in order: DeckLink, GPU, USB video,
      Streams/Records, otherwise "Outputs".
  - Edge ends not yet on screen become "Other Sources" / "Other Outputs". The dedupe uses bare ids (WO-365).
- **Crosspoint click** (`device-view-matrix.js:150-190`).
  - The edge test: same `sourceId` and `sinkId`, and on a half row the same `edgeOutputLayer` (WO-364).
  - An active cell disconnects only that half's edge.
  - An empty cell first drops every other edge into a single-input sink (`isSingleInputSinkId`, the same 8 kinds;
    WO-373: "a crosspoint REPLACES, like a router"). It then appends `edge_<Date.now()>_<rand 0..999>`. A PRV row
    adds the note `{"outputLayer":2}`.
  - `pushUndo()` runs first. The whole graph goes out as `POST /api/settings {deviceGraph}`. On success that is
    followed by restart-dirty and a reload; on failure there is only a `console.error`.
- **Header clicks**: a `dst_in_` id opens that destination (`selectDestinationById`); anything else runs
  `selectKey('conn:'+id)`.
- **Toolbar**:
  - "+ Destination": `addDestination({mode:'pgm_prv'})`. `addDestination` reads `.type`, so the type falls back to
    pgm_prv. There is no consumer seeding and no dirty flag.
  - "+ Live input" (`showLiveInputModal`), "+ Stream", "+ Record", "+ Virtual cam" (the same body as the rear "+")
    and "+ Pixel Map" (`addMappingNode`).
- **Web gaps**:
  1. "+ Stream" / "+ Record" read `payload.settings.streamOutputs` / `.recordOutputs`. The merged payload's
     `settings` block holds only `casparServer` + `channelMap`, so the list is always empty and the POST replaces
     every configured stream / record with one `str_1` / `rec_1`.
     - Reproduced under Node with `mergeSettingsIntoDeviceViewPayload` and two streams: the POST was
       `{"streamOutputs":[{"id":"str_1",…}]}`, so `str_2` was lost.
     - "+ Record" behaves the same, and its body (`type h264, quality medium`) differs from the rear "+" one
       (`source program_1, crf 26`).
  2. A failed route POST is silent: there is no status, only the console.
  3. If the graph has no `edges` array, a click on a single-input sink throws (`newGraph.edges.filter`).

### What was done
- `features/devices/matrix_model.gd` (new, pure):
  - `ports(payload, live_cm)` ports extractMatrixPorts on top of `host_channels.gd`'s `all_destinations` /
    `host_destinations`, and uses a decorated sort for the pixel-map outs.
  - `single_input_sink`, `is_edge` / `active`, `toggle(payload, src, sink, id)` → the whole new graph,
    `new_edge_id()`, `header_target(id)`.
- `features/devices/matrix_view.gd` (new):
  - The add buttons above a drawn grid (an inner `Grid` Control, not 1 000 Buttons): vertical sink labels, a
    crosshair hover, and a filled dot that turns red on hover ("a click disconnects").
  - Signals: `route(graph)`, `header(id)`, `add(what)`.
  - "+ Live input" is left out (the live-input modal is unported).
- `features/devices/devices_toolbar.gd` (new):
  - The tab's header row moved out of `devices_tab.gd`, which had 4 lines of headroom.
  - Adds the "Matrix view" CheckBox, a per-client pref in `user://devices.cfg [view] mode`. The loops slider hides
    while it is on.
- `devices_tab.gd`:
  - Matrix mode hides the body and the cable overlay and shows the matrix. `_input` steps aside so the grid gets
    its clicks.
  - `_open_header`: a destination calls `_dests.select`; a connector opens its page, or the status says it has
    none.
  - `_matrix_add`:
    - "+ Destination" → `_dests.add("pgm_prv")`. This is the panel's own add, with seeding and dirty, instead of the
      web's bare POST.
    - "+ Stream" / "+ Record" / "+ Virtual cam" → the rear panel's `add_output` plan. This appends to Settings, so
      it fixes gap 1.
    - "+ Pixel Map" → `mapping_controls.add_node`.
- `cable_gesture.gd` `route(graph)`: push undo, `POST /api/settings {deviceGraph}`, Settings reload, dirty and
  reload. A failure shows "Matrix route failed: …" (gap 2 fixed). Ctrl+Z undoes it like any cable edit.
- `destinations_panel.gd`: `_add()` → public `add(type)`.
- Gap 3 can't happen in the port: `toggle` treats a missing `edges` as `[]`.

### What was VERIFIED
- **Golden replay**: `tests/test_devices_matrix.gd` against `tests/golden/devices_matrix.json`. The generator runs
  the real `extractMatrixPorts` + `renderMatrix` under Node on a fake DOM, with `Date.now` / `Math.random` scripted.
  - Payloads:
    - the live box;
    - a rich one: split / pinned / virtual / pgm_only destinations; pixel maps with unsorted, string, missing and
      40-way tied indexes, plus a second `pixel_map_in`; every suggested kind, a connector with no id and a
      duplicate id; ghost / `DP-3` / `gpu_p9` edge ends; a text-note PRV edge;
    - no graph at all;
    - the 7 host-channel payloads.
  - Checked: rows and columns, the single-input flags, the header-click targets, the grid, and 15 crosspoint clicks.
    Each click checks the posted `deviceGraph`; a failed POST keeps the graph. Rows, columns and grid are compared
    again after each reload.
  - Suite: 12296 / 12296 passing (was 12210).
- **Mutation check**: 10 mutants. Killed: the single-input filter, the half-layer test, the PRV note, the
  consumed-id dedupe, the virtual flag, the Streams/Records group, the externalRef label fallback, the sort
  tie-break and the first-`In`-only rule. The last two survived until the 40-way tie and the second `pixel_map_in`
  were added to the payload.
  - One equivalent mutant: the host-channel `seen` check is redundant behind the `added` dedupe.
- **Box** (GUI on the Devices tab, live server; config backed up first):
  - Matrix view showed the box's 3 × 8 grid: Operator GUI→P1 and Main LED PGM→P3 active.
  - PRV→P0 wrote `{"id":"edge_1792501404550_628", …, "note":"{\"outputLayer\":2}"}` (GET /api/device-view). Apply
    turned restart-dirty, and the hovered dot showed red.
  - A second click removed the edge. Ctrl+Z put it back ("Undo successful"), and Ctrl+Z again removed it.
  - The P0 header opened the GPU page; the "Main LED — PGM" header opened the destination page.
  - "+ Pixel Map" added "Pixel Mapping 1 In" as a column and Out 1 / Out 2 as rows. "+ Stream" added Str1 ("Added
    stream output Str1", Streams/Records column).
  - Restore: `device_graph.json` and `stream_outputs.json` were copied back and node was restarted. The md5s match
    the backup except `.highascg-state.json` (unrelated look-state autosave, rev bump).
- Owner QA: the matrix's look on a big show file (50+ rows scroll) and whether "+ Live input" is wanted before the
  live-input modal is ported.

## Slice 10b — Node view (2026-10-20, DONE)

### Investigation
- **Toggle** (`device-view-toolbar.js:86-95, 192-275`).
  - "Node view" (tooltip "Compact node layout and straight cable lines on the rear panel.") persists in localStorage
    `highascg_device_view_simple_wiring` ('1' or removed, `lib/device-view-simple-wiring-prefs.js`).
  - The two view checkboxes are mutually exclusive (`:268-275`): checking one unchecks the other, and the sync
    writes both prefs. Unchecking Matrix therefore returns to the classic panel, not to Node view.
  - Node view hides the cable-loops slider. Matrix mode hides the Node view checkbox.
- **Cards** (`device-view-caspar-render-simple.js` `renderCasparBandSimple`).
  - Sections in a fixed order (`:108`): GPU, DeckLink, USB video, Virtual cam, Stream, Record, Audio.
    - Items come from `buildCasparRearPanelData().markerItems` minus hidden ones and `decklink_ref`.
    - Virtual cam / Stream / Record / Audio always show, with a "+" ("Add new x output") and "None yet — click + to
      add." when empty. The other sections show only when they have items.
  - A card holds: an icon (the item's own icon, else a per-kind one), the tag-stripped label, a status subtitle
    (`statusSubtitle`, `:30-60`) and one dot.
    - The dot sits on the left for inputs (`decklink_io` with direction "in", `audio_in`, `v4l2_in`) and on the
      right otherwise (`appendSimpleNodeDot`, CSS `09d-…:125-129`). GPU outputs get right-side dots, so a
      destination's cable crosses the card. The port keeps this.
    - The card is dim when it is virtual or a disconnected GPU port. It is outlined when its connector's page is
      open (`--selected`) or when it is the armed cable source (`--armed`).
  - A card click opens the port's page (`onPortClick`). A click on the band but not on a card or dot opens the
    Caspar server page (`:239-242`).
  - A `decklink_io` card is draggable (`:219-228`) with `application/x-highascg-connector`. The drop targets are a
    destination row (`setDecklinkAsDestinationOutput`) and the Sources panel (`sources-panel-decklink-drop.js`).
    The classic rear panel has the same drag (`device-view-caspar-render-markers.js:193`), and neither view's drag
    is ported to Godot yet → slice 11.
- **Cables** (`device-view-cables.js:190-215` `buildSmoothSimpleCable`).
  - A cubic Bézier with tension `max(80, |dx|·0.5)`.
  - Each port's edges fan out by π/10 per step around its mean (`buildSmoothSimpleMap`); the held edge is excluded.
  - The armed ghost uses the same curve, dashed.
- **Web gaps**:
  1. GPU subtitle: the marker items never carry `monitor` / `resolution` / `refreshHz`, so every connected GPU card
     reads "Connected". Godot shows the intended "P80 · 1920x1080 · 50 Hz" line, taken from the rear-panel slot
     data (`buildCasparRearPanelData` items matched by `gpuPhysicalPortCableId`).
  2. `resolveStatusClass` adds a per-card status class, but the simple-wiring CSS overrides its colours, so it has
     no visible effect. Not ported.
  3. The classic rear panel has no USB video slot, while Node view does (suggested `v4l2_in` connectors on
     `caspar_host`). Ported as the web has it.
  4. The GPU split-id cable mapping in the card builder is unreachable: GPU items never carry split ids.

### What was done
- `features/devices/node_view_model.gd` (new, pure): `sections(slots, payload)` → titled sections of
  `{id, label, sub, kind, icon, dim, input}`, `subtitle(item, live)`, `kind_title(kind)`. Built on
  `devices_model.gd`'s slots, so the GPU ids and labels are the classic panel's.
- `features/devices/node_panel.gd` (new): a "REAR PANEL" grid of section columns, which reflows on resize.
  - Card Buttons with a `port_icon.gd` dot registered in `anchors` (the cable overlay and gesture use the same
    anchor map as the classic panel).
  - `highlight(selected, armed)` sets the outline.
  - Signals: `add_requested(kind)`, `open_requested(id)`.
- `cable_model.gd`: `simple_fans(edges)`, `simple_curve(edge, a, b, fans)`, `bezier(pts)`.
  `cable_layer.gd`: `simple` + `edges`.
  - In simple mode the layer rebuilds the Bézier set on any anchor change. There is no Verlet settle.
  - The ghost is drawn dashed.
- `devices_toolbar.gd`: the "Node view" checkbox (pref `[view] simple`), mutually exclusive with Matrix like the
  web. `mode()` returns "", "simple" or "matrix".
- `devices_tab.gd`: Node mode swaps `_rear` for `_nodes` and feeds anchors from whichever is visible.
  - The rear-panel-only gestures (DeckLink edit drag, GPU row label) are skipped in Node mode.
  - The background → server page check uses the visible panel.
  - `_open_port` / `_close_port` re-run `_sync`, so the card outline follows the open page.
  - The cables list moved to `cables_list.gd` (the tab was at 496 / 500 lines; it is now 466).

### What was VERIFIED
- **Golden replay**: `tests/test_devices_node_view.gd` against `tests/golden/devices_node_view.json`. The
  generator runs the real `renderCasparBandSimple` and `buildSmoothSimpleCable` under Node on a fake DOM.
  - Payloads:
    - the live box;
    - a rich payload: a DeckLink IN in both the graph and suggested, a faulted / inherited DeckLink, USB video,
      active stream / record / virtual cam, audio, a `<b>` label;
    - saved DeckLink order;
    - empty;
    - the 10 GPU-topology fixtures;
    - a split connector id.
  - Checked: sections, cards (GPU subtitle against the intended slot line) and cable d-strings within 0.051 px,
    ghost included.
  - Suite: 12772 / 12772 passing (+476 over 10a). `--check` boots clean; no file is over 500 lines.
- **Mutation check**: every mutant was killed except the GPU split-id mapping (equivalent; gap 4).
- **Box** (GUI on the Devices tab, live server; config backed up first):
  - Node view showed GPU (DP 0/1 and DP 4/5 dim "Disconnected", DP 2/3 and DP 6/7 "P80 · 1920x1080 · 50 Hz"),
    DeckLink 1-4 and the empty Virtual cam / Stream / Record / Audio sections, with the two live cables as Béziers.
  - A DP 2/3 card click opened the GPU page (P1) with the card outlined.
  - Arming Main LED PRV tinted the targets and drew the dashed ghost. A click on the DP 4/5 dot wrote the `gpu_p2`
    edge (`config/device_graph.json`) and Apply turned restart-dirty. Ctrl+Z removed it ("Undo successful").
  - A click on the band background opened the Server page.
  - Stream "+" added Str1 as an Idle card ("Added stream output Str1").
  - A click on a cable selected it (thick line, blue ends, list row with Remove).
  - Toggles:
    - Node → Matrix unchecked Node (`simple=false mode="matrix"`) and hid it.
    - Matrix off → classic panel with the loops slider (`simple=false mode=""`).
  - Restore: `stream_outputs.json` was copied back and node restarted. The md5s match the backup except
    `.highascg-state.json` (the look-state autosave). The GUI was left running in the default view.
- Owner QA: Node view on a larger show file (many outputs → grid reflow).

## Slice 11 — "Add live input" dialog + band (2026-10-20, DONE)

Owner report: "i dont see a way to add an input host channel". The Godot Devices tab had no way to create an input
host channel (DeckLink, NDI, USB video, live audio or webpage). The web does this through the "Add live input" modal.
This slice ports that modal, ahead of the DeckLink connector drag, which moves to slice 12.

### Investigation
- **Entry points**:
  - the Devices "Add live input" band under the destinations (`device-view-live-sources-render.js`
    `renderLiveSourcesBand`; it sits in `destLiveHost` after the cards, `device-view-toolbar.js:122-124`);
  - Matrix "+ Live input" (`device-view-matrix.js:52-59`, second in the toolbar, `:85`);
  - the Sources panel's live "+" (`sources-panel.js:111`). There is no Godot Sources panel yet.
- **Modal** (`live-input-modal.js`, `-shell.js`, `-shell-v4l2.js`).
  - Six types: Decklink / NDI / Web Browser (system) / Web Browser (CG template) / Live Audio / USB Video (V4L2).
  - One section per type, plus an HTML hint per type. The DeckLink hint depends on the selected port's
    `decklinkInputForSlot` entry; the webpage hint depends on the CG checkbox.
  - The DeckLink port list comes from GET `/api/device-view` (graph and suggested `decklink_io` connectors, deduped
    and sorted by slot, with "· input" / "· output" tags). With no connectors it falls back to SDI 1-4.
  - The "Caspar host channel" row reads "planned" from `hostChannelPendingApply` (WO-381, configComparison).
  - The live-audio and USB slot hints read the channel map captured when the modal opened.
- **Submit** (`live-input-modal-submit.js`):
  - DeckLink runs `addDecklinkInputSlot` with no device. It is the same plan as `decklink_input_model.gd`, and the
    status reads `DeckLink input slot N . host channel X . route.` plus the apply / "(capture refreshed on existing
    host channel.)" suffixes.
  - NDI, system browser and webpage do one `addExtraLiveSource`. The status is "Added to Live Sources." plus the
    host-PLAY and apply suffixes. A CG webpage never marks restart-dirty.
  - Live audio and USB video run `addLiveAudioInputSlot` / `addV4l2InputSlot`:
    1. pick the first empty slot or append, max 8;
    2. POST `…/config`;
    3. reload settings; mark restart-dirty if the count grew;
    4. GET `/api/audio/live-inputs` or `/api/v4l2-inputs`;
    5. if the new slot already has a route and no restart is needed, POST `…/apply`.
  - A successful add calls onAdded (Devices reload) and closes the modal after 1.5 s.
- **Band rows** (`collectUnlistedLiveSourceRows`): extra live sources with no listed host destination, suggested
  `v4l2_in` connectors without one, and DeckLink inputs that are "in" but not shown. When there are no rows, a note
  says either "Configured live inputs appear above…" (host channels exist) or "No live inputs yet…".
- **Web gaps / quirks**:
  1. The DeckLink status uses " . " separators. Ported verbatim.
  2. The slot hints use the open-time channel map and only re-run on a field edit, so after an add they can name a
     stale slot. Ported as is.
  3. After Discover, the NDI select holds the first source, so Add right after Discover adds it. Same in Godot.
  4. The band highlights the selected port row (`selectedKey`). Not ported: a Godot row opens the connector's page,
     whose card already shows the selection.

### What was done
- `features/devices/live_input_model.gd` (new, pure):
  - the type list, the hint HTML and `bbcode()` for the RichTextLabel;
  - `decklink_ports`, `decklink_channel`, the NDI list and labels, the ALSA / V4L2 pickers;
  - `pick_slot` / `slot_hint`;
  - the NDI / system-browser / webpage items and the status texts;
  - the band: `band_rows`, `extra_host_id`, `reconcile_extra`, `extra_detail`.
- `features/devices/live_input_flow.gd` (new): the modal's state, with fields keyed by the web element ids, and its
  request sequences over an injected io (`get_json` / `post_json` / `load_settings` / `dirty` / `added` /
  `changed`), so the dialog and the golden replay share them. DeckLink reuses `decklink_input_model.gd`'s
  `add_prepare` / `add_finish`, which now also returns `already` for the refreshed-capture suffix.
- `features/devices/live_input_dialog.gd` (new): an AcceptDialog built fresh on each open. It has the type select,
  hint, sections, "Add live source" and a status line (red on error), and closes 1.5 s after an add.
- Wiring:
  - `destinations_panel.gd`: the band (title, "+", rows or note). A DeckLink / USB row opens its connector page.
  - `matrix_view.gd`: "+ Live input", second in the toolbar like the web.
  - `devices_tab.gd`: owns the dialog. `dirty` marks restart-dirty, `added` reloads, and the tab's click capture
    stands down while the dialog is open.

### What was VERIFIED
- **Golden replay**: `tests/test_devices_live_input.gd`.
  - `tests/golden/devices_live_input.json`: 14 cases and 52 steps. The real web modal runs under Node on a fake
    DOM against a scripted server. Cases:
    - DeckLink: new port with the count growing, already input on a planned channel and on a live channel with
      another device, no connectors, update failure;
    - NDI: pick / typed / host-PLAY error; discover empty / error / none;
    - system browser: clamps and failure;
    - webpage: URL / template / CG;
    - live audio: new slot, empty-slot reuse with apply success and failure, full;
    - USB video: options with disabled devices, extras, second slot with live apply and its failure.
  - Each step compares the POSTs, restart-dirty and onAdded counts, and the dialog (section, hint HTML, status +
    error, port list and host-channel row, pickers, statuses, slot hints).
  - `tests/golden/devices_live_band.json` (4 payloads, including a hosted DeckLink row being hidden): the row list
    and the host count.
  - Suite: 13012 / 13012 passing (+235). `--check` boots clean; no file is over 500 lines.
- **Mutation check**: changing the refreshed-capture suffix fails 3 assertions.
- **Box** (GUI on the Devices tab, live server; config backed up first):
  - the band shows "No live inputs yet…"; "+" opens the dialog;
  - DeckLink lists "4 port(s) from Device View" with "— (Apply Caspar config to allocate)";
  - Live Audio scanned 34 ALSA devices, hint "Will use slot 1…";
  - NDI Discover found the real "ndi_hx Avonic-4K" on the network;
  - Add gave "Added to Live Sources. Apply Caspar config and restart in Device View to start capture." The dialog
    closed, Apply went restart-dirty (orange), and a "ndi_hx Avonic-4K · HOST · ch 4 (planned)" host-channel card
    appeared, with the band switching to the host-channels note;
  - Matrix "+ Live input" opens the same dialog.
  - Afterwards `general.json` and `device_graph.json` were restored and md5-verified. The node restart's boot
    hardware sync had re-added `rec_1` / `audio_1`, so that file was put back too. Only `.highascg-state.json`, the
    look autosave, differs. The GUI was relaunched in the default view.
- **Owner QA**: actually adding DeckLink, live audio, USB video and webpage inputs on the box (each needs an Apply
  Caspar config restart to capture).

## Slice 11b — Rear-panel cable dots in the socket centre (2026-10-20, DONE)

Owner: "i cant choose a gpu connector to see its options because it always starts a cable. the cables should start
and finish only from the dots", then "the dots should be in the middle of the connector, not at a side".

### Investigation
- `rear_panel.gd` `_plate()` / `_extra_slot()` registered the socket PortIcon itself as the cable anchor
  (`anchors[it.id] = p`). `devices_tab.gd` `_input` tests anchors first (rect grown 3 px) → `_gesture.click`. So any
  click on a GPU / DeckLink / Record / Audio socket armed a cable. Only the small row label (`label_at`) opened the
  page.
- Web (`client/components/device-view-caspar-render-markers.js:302-323`): the marker body calls `onPortClick`
  (inspector), and a separate `.device-view__connector-dot` ("Start or complete cable at this connector") calls
  `onPortStartCable`. The Node view (`node_panel.gd`) and destinations (`destinations_panel.gd`) already use 14 px
  dots.
- On the box, arming a cable moved every rear-panel dot about 24 px sideways. The toolbar's status Label
  ("Cable armed: click another connector dot to connect") grew the HBox past its fill spacer, which narrowed the
  Inspector column and shifted the tab. With dots as the only targets, a moving target broke the second click: the
  first box run's "complete" click landed on the wrong dot ("These connectors cannot be cabled together").

### What was done
- `rear_panel.gd`: each socket gets a 12 px PortIcon dot as a child, centred on it (anchors at 0.5, offsets ±6;
  the preset helper ran before the socket had a size and put it bottom-right). The dot is the `anchors` entry, with
  tooltip "Start or complete cable at this connector" and a cross cursor. The socket goes into a new `_icons` map,
  and `label_at` hit-tests labels and sockets, so a click on the socket outside the dot opens its page. That also
  applies to edit-mode drags (`begin_drag` uses `label_at`). REF has no dot.
- `devices_tab.gd`: comment only. The anchor-first order already gives the dot priority over its socket.
- `devices_toolbar.gd`: the status Label replaces the fill spacer (expand-fill, right-aligned, trailing
  ellipsis, full text as tooltip), so a long prompt can no longer widen the row.

### What was VERIFIED
- Suite 13012 / 13012 passing, `--check` boots clean, no file over 500 lines. The rear panel has no golden; its
  web counterpart is DOM layout.
- Box (live server, GUI on the Devices tab; config md5 snapshot before, unchanged after):
  - dots drawn in the centre of every GPU / DeckLink / Record / Audio socket, with cables ending on them;
  - a click on the socket edge opened the GPU P3 page, the DeckLink 3 page and the Rec1 page;
  - a click on the DP 0/1 dot armed a cable: status "Cable armed…", valid / invalid tints on the other dots, the
    panels did not move. A background click cancelled it ("Cable mode cancelled").
- Not exercised: completing a cable dot-to-dot on the box. The gesture keys are unchanged, so this is the slice 2
  path, but it writes config, so it is left to owner QA.
- Follow-up (owner: "the audio, record etc icons needs to be bigger, because now its just the dot"): the
  Stream / Virtual cam / Record / Audio sockets went from 30×24 to 40×40, so the dot sits inside a visible socket.
  On the box a click on the Rec1 socket edge opened Rec1, a click on its centre armed a cable, and the config md5
  was unchanged.
- Noticed, not changed: right after arming, before the first mouse motion, the ghost line runs from the
  window's top-left (pre-existing).

