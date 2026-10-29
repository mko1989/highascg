# WO-816 — Godot look editor: drop media ON a layer exchanges its media (frame box / layer-list row)

**Status: DONE (29.10, live e2e on the box) (29.10 — Godot tests 22718/0, new-layer smoke 14/0, boot check OK, 500-line check OK; live: the
extended route on an off-air look after a node restart; owner client relaunched + screenshot. Owner QA = a real drag
onto a layer box and onto a row.) · live e2e 29.10: box drop, row drop and blank drop PASS on the glass**

Owner, 29.10:
> in godot client i can't exchange media on a layer by drag and dropping it on the layer in the viewer or in the list.
> should be doable.

Related: WO-600 K (drop adds a layer), WO-622 (Live-tab route sources, WO-156 self-route rule), WO-762 (deck drops /
reorder), WO-766 (drop on the layer list adds layers). None of them exchanged a layer's media.

## Investigation

Drop targets in the look editor (`godot/client/features/live/look_editor.gd`, before this WO):

- `:78` `_frame.set_drag_forwarding(Callable(), _can_drop, _drop)` — the compose frame ("the viewer"). Its children
  `_video` (`:71`) and `_overlay` (`:74`) are `MOUSE_FILTER_IGNORE`, so nothing covers it; drops arrive.
- `:101` `_list.set_drag_forwarding(Callable(), _can_drop, _drop)` — the layer list (WO-766). Drops arrive.
- `:395` `_can_drop` = `scene_id != "" and not Ops.drop_sources(data).is_empty()`. The Sources media drag
  (`media_panel.gd:389` `_drag_data` → `media_ops.gd:136 drag_payload` = `{type, value, label}` or `{type:"multi", items}`)
  and the Live-tab drag (`live_sources_model.gd:319 drag_payload`) both pass `look_layer_ops.gd drop_sources`.
  So nothing was rejected: no type mismatch, no swallowing child, no missing forwarding.
- `:398` `_drop(_at, data)` **ignored the drop position** and called `add_layer_from_source` (`:403`) for every source:
  `POST /api/scene/new-layer` → the next free layer number ≥ 10 → appended. Dropping on L10 therefore added L11 (or was
  refused "look full"); there was no exchange code path at all. The Godot layer inspector has no media picker either
  (`layer_inspector.gd`: no source chooser), so the only write for a layer is the one every inspector field makes:
  `look_editor._apply_layer(patch)` (`:331`) = merge into the selected layer in `Store.project` + `pusher.schedule`
  (deck sync → `/api/scene/preview-push` → autosave).
- Web reference (`client/components/scene-layer-row.js:137-215`, `scenes-compose.js:388-440`): a drop on a layer row / box
  calls `setLayerSource` — an existing layer keeps its transform (todos19.07.26, `isLayerSourceExchange`), only an empty
  layer gets the content-fit fill; still images stop looping; `live_audio` → opacity 0; the WO-156 self-route rule is
  checked against **that** layer's number; a multi drop exchanges the first source and adds the rest.
- Server: `/api/scene/new-layer` (`src/api/routes-scene-new-layer.js`) always built for `nextLayerNumber`, so it could not
  check a route against the target layer and refused any build on a full look.

## What was done

- `godot/client/features/live/look_layer_drop.gd` (new, 85 lines): the drop flow over an injected editor + api
  (decklink_drop_flow pattern, tests headless). `drop(ed, api, target, sources)`: target ≥ 0 → the first source
  exchanges that layer, the rest `add` (the old WO-600 K body, moved here unchanged). `exchange`: `POST
  /api/scene/new-layer {sceneId, mainIdx, source, layerNumber}` (web rules + route check for this layer), then
  `_select(i)` + `_apply_layer(exchange_patch(...))` — the inspector's write. `exchange_patch` = `{source}` only (+
  `loop:false` for a still, `opacity:0` for live_audio, + the server's fill only on an EMPTY layer and only when the
  media size was known). Fill, rotation, crop, trim, start, loop, audio route stay. A refusal changes nothing and stops
  the rest; status line "L10: old.mov → new.mov" / "L11: logo.png added" / "Exchange refused: …".
- `godot/client/features/live/look_layer_ops.gd` (77 lines): `layer_at(layers, rect_of, at)` — the topmost layer with a
  source whose (rotated) box holds the point; shared by the frame click-select (`_begin_drag`, same logic as before) and
  the drop.
- `godot/client/features/live/look_editor.gd` (500 → 490 lines): `_drop(at, data, on_list)` picks the target —
  `_list.get_item_at_position(at, true)` for a row (the list is bound with `_drop.bind(true)`), `_layer_at(at)` for the
  frame — and hands it to the flow; `add_layer_from_source` (kept for the main.gd probes) delegates to the flow.
  Empty layers have no box in the frame, so an empty layer is reached through its "(empty)" row.
- `src/api/routes-scene-new-layer.js`: optional `layerNumber` = the exchanged layer (built for that number: WO-156 rule
  checks it, a full look is no refusal). Nothing stored, as before. Smoke: `tools/smoke/smoke-wo600-new-layer.test.js`
  +2 cases.
- Not changed: `layer_inspector.gd` / trim files (another agent), the web client.

Why not a new endpoint: the existing builder already applies the web rules; one optional field keeps one implementation.
Why keep the fill on an exchange (the web compose box does a contain-fit into the old rect): owner asked to keep
position; the row behaviour of the web (keep transform) is the simpler, predictable one.

## What was verified

- Godot suite: **22718 passed, 0 failed** (baseline 22685; +20 from `tests/test_look_layer_drop_wo816.gd`, the rest from
  parallel work). The test builds the drag data with `media_ops.gd drag_payload` / `live_sources_model.gd drag_payload`,
  checks `drop_sources` (the `_can_drop` predicate), and drives `drop()` with a fake editor + api: one new-layer call with
  `layerNumber`, one `_apply_layer` with the source only, trim/fill/start/audio route untouched, empty layer gets
  fill + `loop:false` for a png, unknown size keeps the box, multi = exchange + add, refusal = no write, `layer_at` hits.
- `node --test tools/smoke/smoke-wo600-new-layer.test.js`: 14/0. `node tools/ci/check-max-file-lines.js`: 0 over 500.
- `run-client.sh --check`: boot OK (no script errors).
- Live (node restarted with `kill -TERM`, look **"KV LOOP 2"** `7daf9777…`, not on PGM or PRV; the route stores nothing):
  `layerNumber:10` + BUMPER.mov → `ok, layerNumber 10, source BUMPER.mov`; without it → L11 (unchanged behaviour);
  `route://1` with `layerNumber:10` → refused "routes this screen's program channel (1) into itself". Project unchanged.
- Owner client relaunched (`--autostart --tab=0`), screenshot
  `/tmp/claude-1000/-home-casparcg/03d195b7-40ef-44d0-b117-27e2e6a3e0d1/scratchpad/drop_media/godot_after_relaunch.png`.

Not verified: a real mouse drag on the owner's screen (no pointer automation while the owner works), an exchange
written to a look (opening the editor stages the look on PRV — not done), anything on air. Owner QA: open a look not on
air, drag a clip onto a layer box and onto a row; expect the same layer number with the new clip in the same place.

## Live e2e (29.10, on the glass — real Godot client on :0, real PGM/PRV)

**PASS.** In the look editor of KV LOOP 2 (off-air, staged on PRV ch2):
- Dropping BUMPER.mov on the L10 box in the viewer exchanged L10's media. Fill 0,0,3840×1792 and loop were kept
  (q816_box_drop.png).
- Dropping KV LOOP 2.mov on the L10 list row exchanged it back (q816_row_drop.png).
- A drop on blank list space added L11 (q816_blank_drop.png), which was then removed (q816_removed.png).
- The autosave shows the original L10 restored. No ghost rectangle was left.
- Minor (not fixed): after Remove layer, the inspector still shows the removed L11's values.

Evidence: session scratchpad `live-e2e/` (screenshots were read before they went in here; `onair.log` has every click with its epoch).

## Follow-up 29.10 — stale Inspector after Remove layer (fixed)

**Investigation.** The e2e run above noted: "after Remove layer the inspector still showed the removed L11's values".
`look_editor.gd` `_remove_layer()` set `_sel = -1` and rebuilt the list, but never went through `_select(-1)`.
That is the only path that calls `InspectorPanel.release(_page)` and `_sync_fields()`, so the page and the geometry
handles kept the removed layer. `open()` had the same gap: opening another look left the previous look's layer page up.

**Done.** Both places now call `_select(-1)` after `_refresh_list()`.

**Verified.**
- A second client ran windowed on a private Xvfb with `--probe-edit=<KV LOOP 2>`:
  - L10 selected, then Mirror copy: L11 added, selected and shown in the Inspector;
  - Remove layer: L11 gone, handles cleared, the Inspector page released (no values).
- The server project's KV LOOP 2 is back to layers `[10]`.
- New `test_deselect_releases_the_inspector_page`. Godot suite: 22847 passed, 0 failed.
