**Status: IN PROGRESS (2026-10-19) — slice 1 (read-only rear panel + cables) DONE (golden-tested against the web JS, box-verified in the GUI); slice 2 (patching + undo) DONE — 2a cable rules + 2b write planning golden-tested, 2c gesture + UI box-verified in the GUI against the live server; slice 3 (destinations + host-channel listing) DONE — 3a listing / inspector page / math input golden-tested, 3b panel add / edit / remove box-verified. Slice 3c (per-role host-channel inspector controls, WO-601 moved scope) DONE 2026-10-20 — request bodies / plans golden-tested against the web modules, webpage role box-verified end to end (update, reload, remove); NDI / browser / DeckLink / live-audio / V4L2 role pages golden-tested only (no such inputs on the dev box) — owner QA. Slice 4 (GPU-output connector page + video modeline) DONE 2026-10-20 — models golden-tested against the web inspector replayed edit by edit, page box-verified on P3 / P1 (save, OS save + live CVT/GTF preview, Reset, config restored byte-identical). Slice 5 (DeckLink connector page) DONE 2026-10-20 — page spec, SDI consumer / fill+key patches and the start / stop plans golden-tested against the web inspector + addDecklinkInputSlot, box-verified (fill+key, consumer saves, 2160p YUV warning, Start / Stop input; config restored byte-identical). Next: slice 6 stream / record / vcam / audio connector pages. Parent: [WO-593](./593_WO_godot_client_port_epic.md). Depends on: WO-599. Largest single area after the live core.**

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
