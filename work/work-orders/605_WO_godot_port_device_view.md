**Status: IN PROGRESS (2026-10-19) — slice 1 (read-only rear panel + cables) DONE (golden-tested against the web JS, box-verified in the GUI); slice 2 (patching + undo) DONE — 2a cable rules + 2b write planning golden-tested, 2c gesture + UI box-verified in the GUI against the live server; slice 3 (destinations + host-channel listing) DONE — 3a listing / inspector page / math input golden-tested, 3b panel add / edit / remove box-verified. Next: 3c per-role host-channel inspector controls (WO-601 moved scope), then slice 4 GPU / modeline. Parent: [WO-593](./593_WO_godot_client_port_epic.md). Depends on: WO-599. Largest single area after the live core.**

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
