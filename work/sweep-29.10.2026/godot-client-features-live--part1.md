# godot/client/features/live — sweep 29.10.2026 (batch 029)

Files: 45 · lines: 6954 · findings: 0 BUG-HIGH, 3 BUG, 6 DEAD, 5 RISK, 12 QUALITY

Method: every file read in full. Dead-code claims grepped across `godot/client` (incl. `tests/`, `app/main.gd` probes, `.tscn`, `project.godot`), `tools/`, `scripts/`; signals also searched by string (`"closed"`, `.connect`). No `.tscn` or `project.godot` entry references any file in this batch (all are `preload`ed). Cross-checked server contracts: `src/api/routes-scene-countdown.js`, `src/api/routes-scene-global-border.js`, `src/engine/global-border-control.js`, `client/lib/scene-state.js`, `client/components/inspector-global-border-artnet.js`; and the global input rules in `godot/client/core/numeric_field.gd` (RULES.md 1 and 2).

## godot/client/features/live/align_row.gd
- `OK` (ALIGN_MODES in px_rect_math.gd has exactly the seven drawn modes; titles dict covers them.)

## godot/client/features/live/border_artnet_model.gd
- `OK`

## godot/client/features/live/border_artnet_section.gd
- `QUALITY` godot/client/features/live/border_artnet_section.gd:68 — the Universe SpinBox is hard-limited to `max_value = 16`. The web copies that number only as an `<input max>` hint, which a browser does not enforce on typed values (inspector-global-border-artnet.js:136 `uniInp.max = 16`), and the server accepts 0..32767 (global-border-control.js:147). Failing case: a desk on Art-Net universe 20 can be typed in the web client, but the Godot SpinBox clamps it to 16. Fix: `max_value = 32767` (or 32767 for Art-Net, 63999 for sACN if wanted).

## godot/client/features/live/clip_trim_model.gd
- `OK`

## godot/client/features/live/clip_trim_section.gd
- `OK`

## godot/client/features/live/compose_auto_layout.gd
- `OK`

## godot/client/features/live/compose_math.gd
- `OK`

## godot/client/features/live/compose_tile_math.gd
- `OK`

## godot/client/features/live/compose_tiles.gd
- `QUALITY` godot/client/features/live/compose_tiles.gd:241-243 — misplaced doc comment. The three lines "WO-652: text on the transparent preview under the label strip … outlined … the top running layer big." describe `_draw_times` (line 266), but sit above `_close_glyph` (WO-798 comment follows directly). `_draw_times` has no comment. Fix: move the WO-652 lines down to line 265.
- `QUALITY` godot/client/features/live/compose_tiles.gd:289-314 — `_time_rows()` runs per window on every OSC tick while Times is on (via `redraw_times` → `_draw_over` → `_draw_times`). Each call rebuilds the `looks` id→scene dict from `project.scenes.scenes`, calls `DeckModel.resolve_bus_look_ids`, `P.resolve_pgm` and `Store.get_value` 3×. WO-798 already measured this overlay at ~11 % of a core, so the per-call rebuild matters. Fix: build the looks dict once per `_draw_over` and pass it in (cells share it).

## godot/client/features/live/compose_times_model.gd
- `OK`

## godot/client/features/live/countdown_model.gd
- `OK`

## godot/client/features/live/countdown_section.gd
- `BUG` godot/client/features/live/countdown_section.gd:45-57 — switching layers with a pending debounce flushes the OLD layer's config against the NEW layer. `show_layer` overwrites `_scene_id`, `_main`, `_layer`, `_index` (46-49) BEFORE it stops the debounce and calls `_flush()` (54-56), but `_cfg` and `_timer_id` are still the old layer's. `_flush` then does `C.propagate(_root(), _timer_id, _cfg, _scene_id, _index)` and `_post("set")` with `layerNumber = int(_layer.layerNumber)` of the new layer. Server (routes-scene-countdown.js:34-44) sends the config as a CG update on the look's edit bus at that layer number. Failing case: edit "Duration" on countdown layer 10 of look A, then within 450 ms click layer 11 (a second countdown or a lower third) of the same look → `POST /api/scene/countdown {sceneId: A, layerNumber: 11, action: set, config: <layer 10's config>}` → layer 11's template on PRV gets layer 10's settings. In `propagate` the self-skip uses the new index, so layer 10 is re-merged too (harmless but marks it changed). Fix: `_flush()` before reassigning the four fields (or capture scene/layer/index when the debounce starts).
- `BUG` godot/client/features/live/countdown_section.gd:122-125 — the "Position px X/Y" fields are plain `LineEdit`s holding numbers, but are not wired through `NumericField.math_line()`, so RULES.md "Number fields accept maths" does not hold. The handler is `text_changed` + `t.to_float()` (every keystroke). Failing case: type `1920/2`, press Enter → the field keeps `1920/2`, and the stored value is `roundi("1920/2".to_float())` = 1920 (Godot's `to_float` stops at `/`), not 960. Fix: `NumericField.math_line(le, true, …, on_change)` as `screen_timer_settings.gd:60` does (blank must still clear; the `""` case is already handled by `resolve`), and commit on `text_submitted`/`focus_exited` instead of per keystroke.
- `QUALITY` godot/client/features/live/countdown_section.gd:98-99,181-190 — the timer-name `LineEdit` calls `_rename` on `text_submitted` AND on every `focus_exited`, with no "name changed" check. `C.rename` returns the bound look ids whenever the timer exists and the name is non-blank (even when equal), so every Tab/click-away emits `patch`, `ProjectSync.deck_changed()` and `mark_dirty()` (a deck sync plus an autosave) with nothing changed; Enter followed by blur does it twice. Fix: remember the name shown and return early when `t.strip_edges()` equals the stored name.

## godot/client/features/live/deck_blank_clear.gd
- `OK`

## godot/client/features/live/deck_head.gd
- `OK`

## godot/client/features/live/deck_model.gd
- `OK`

## godot/client/features/live/deck_reorder.gd
- `OK`

## godot/client/features/live/deck_view.gd
- `QUALITY` godot/client/features/live/deck_view.gd:391 — `duplicate_look` calls the private `_uuid()` of another class through an inline `preload("res://features/live/layer_style_row.gd")._uuid()` (not a header const). The same private helper is also called by `look_preset_page.gd:158`. A UUID generator lives in a UI row widget and is reached by underscore name from two unrelated features. Fix: move to a small shared util (e.g. `core/`), make it public.
- `QUALITY` godot/client/features/live/deck_view.gd:226-236 — `take_main()` re-implements the `cm` / `live` / `ps` / `known` set-up of `rebuild()` (60-74) line for line. Fix: a `_bus_for(main)` helper used by both.

## godot/client/features/live/destinations.gd
- `OK`

## godot/client/features/live/effects_model.gd
- `OK`

## godot/client/features/live/effects_section.gd
- `OK` (`set_registry` has no `is_node_ready()` guard unlike `show_effects`, but both callers — layer_inspector.gd:138 after an await, timeline_clip_inspector.gd:119 inside `_ready` — run after `_ready`, so no failing case.)

## godot/client/features/live/global_border_panel.gd
- `DEAD` godot/client/features/live/global_border_panel.gd:10 `signal closed` (emitted at line 44) — never connected. grep: `grep -rn "closed" godot/client --include=*.gd | grep -i "border\|connect"` → only the declaration and the emit; no `.closed.connect`, no `connect("closed"`. The Inspector hides the page through its own `visibility_changed` hook (inspector_panel.gd:105), so nothing needs the signal. Fix: drop the signal and the emit.
- `RISK` godot/client/features/live/global_border_panel.gd:147-170 (with 104-113) — the target screen is read late. `_flush` stamps `body["screen"] = screen_idx` when the debounce fires (110 ms after the edit), and the reply handler `_adopt(...)` (162) writes into `screen_idx` as it is when the response arrives. `open(idx, label)` changes `screen_idx` immediately and does not flush or wait. Scenario: edit a field on screen 0's border, press "Border" on screen 1 inside the 110 ms debounce or the request's round trip → the edit goes out as screen 1, or screen 0's returned slot is stored into `globalBorders[1]` (and later autosaved). Window is tiny for a human, so no concrete reproduction; fix: capture `screen_idx` into the `send()` call / `_flush()` local and use it for the `_adopt` and `_last_sync` lookup.
- `QUALITY` godot/client/features/live/global_border_panel.gd:61-63 — the desk-sync re-render is gated on `get_viewport().gui_get_focus_owner() == null`, but the comment/header say "never while a field has focus". Any focused control counts, including a CheckBox or Button that was just clicked (focus stays), so desk updates are skipped until focus is cleared; the timer is one-shot and only restarted by the next `global_border_sync`. Fix: test `focus_owner is LineEdit or SpinBox`-like inputs only, or re-arm the timer while blocked.

## godot/client/features/live/hap_status.gd
- `OK`

## godot/client/features/live/layer_fit_math.gd
- `OK`

## godot/client/features/live/layer_geometry_section.gd
- `OK`

## godot/client/features/live/layer_inspector.gd
- `RISK` godot/client/features/live/layer_inspector.gd:236-243 — `_on_fit` emits `{"fill": res.data.fill}` after `await Api.post_json("/api/scene/layer-fit", …)` without checking that the same layer is still shown (unlike `_refresh_content`, which guards with `_content_key`). `layer-fit` probes the media, which can take long for an uncached file. Scenario: change "Content sizing" on layer A, pick layer B in the list before the answer lands → the patch is applied by the look editor to the then-selected layer B (its fill is replaced with A's refit). No timed reproduction, hence RISK. Fix: capture `scene_id`/`layerNumber` before the await and drop the answer if they changed.

## godot/client/features/live/layer_rect_math.gd
- `QUALITY` godot/client/features/live/layer_rect_math.gd:56-57 — `display()` calls the private `P._jsround` of px_rect_math.gd four times. Fix: make `jsround` public there.

## godot/client/features/live/layer_style_model.gd
- `OK`

## godot/client/features/live/layer_style_row.gd
- `OK` (see deck_view.gd:391 for the cross-class use of `_uuid`.)

## godot/client/features/live/live_preview.gd
- `OK`

## godot/client/features/live/live_sources_model.gd
- `DEAD` godot/client/features/live/live_sources_model.gd:12-20,224-229 `HINTS` + `hint(rows)` — only a test calls it. grep: `grep -rn "M\.hint(\|\.hint(rows" godot/client --include=*.gd` → only `tests/test_live_sources.gd:31`; `live_sources_panel.gd` never shows the web's hint line (its header lists what is not ported). The same-named `HINTS` const in `features/devices/live_input_model.gd` is a different table. Fix: either surface the hint under the tab or delete both and the test case.

## godot/client/features/live/live_sources_panel.gd
- `BUG` godot/client/features/live/live_sources_panel.gd:161-169 (call at 134-135) — rows that share a thumbnail channel do not all get the picture. `_thumb` marks the channel as started (`_thumbs[ch] = null`) and only the FIRST caller's `rect` is assigned when the fetch ends (168-169); a second row asking while the fetch is in flight finds `_thumbs.has(ch)`, sets `rect.texture = null` and returns without waiting. Failing cases: (a) two rows with the same channel number, e.g. saved layer routes `route://5-1` and `route://5-2` (`thumb_channel` takes the digits before `-`, live_sources_model.gd:311-313); (b) any second `_rebuild()` (the `Store.changed` keys at line 22 fire often) while the first fetch is still running — the new rows get no texture and the old, freed rows get it. The thumbnail stays blank until the next key change or ↻. Fix: share `LookThumb._fetch`'s waiter list (`_waiters`) or keep a list of waiting rects per channel.

## godot/client/features/live/live_stage_3d.gd
- `OK`

## godot/client/features/live/live_tab.gd
- `RISK` godot/client/features/live/live_tab.gd:108-113 — `InspectorPanel.current.present(...)` is called without a validity check, while line 98 guards the same static with `is_instance_valid(InspectorPanel.current)` (so the code itself assumes it can be absent, e.g. in tests/headless). `deck.timers_requested` / `deck.border_requested` then crash with a null deref. No failing case in the shipped shell, where `current` is always set. Fix: same guard (or a helper) for both.

## godot/client/features/live/look_editor.gd
- `DEAD` godot/client/features/live/look_editor.gd:5 `signal closed` (emitted at 167 in `close_editor`) — never connected. grep: `grep -rn "editor.closed\|closed.connect\|connect(\"closed\"" godot/client` → nothing; `live_tab.gd` connects only `take_requested` and the visibility change. Fix: drop it, or use it in live_tab instead of the visibility hook.
- `RISK` godot/client/features/live/look_editor.gd:283-298 — in crop mode the full-rect resize handles are not drawn (`hr` = the crop rect, line 232) but `_begin_drag` still hit-tests them (294-298) when no crop handle is hit. Scenario: crop mode on, layer has a non-identity crop; pressing within 8 px of an undrawn fill-rect corner starts a resize of the layer instead of a crop, with nothing on screen to explain it. With an identity crop both sets coincide and the crop handle wins. Fix: `if _crop_mode: … return/skip` the normal-handle loop.
- `DEAD` godot/client/features/live/look_editor_fit.gd:5 `signal changed` (emitted at 28; see that file). `look_editor.gd:40` creates `_fit` but never connects `_fit.changed` (`grep -rn "_fit\.changed\|fit.changed" godot/client` → nothing). Consequence is small because `_draw_frame` re-reads `_shown()` every frame (the compose frame updates itself), but the X/Y/Width/Height boxes are set from `_shown()` only in `_sync_fields` (373): a layer added by drop (`look_layer_drop.gd` add → `_select`) asks the server for the clip size during that very `_sync_fields`, and the boxes keep the 16:9 fallback numbers until the next project_changed / edit. Fix: connect `_fit.changed` to `_sync_fields` (guarded by `_drag.is_empty()`).

## godot/client/features/live/look_editor_fit.gd
- `RISK` godot/client/features/live/look_editor_fit.gd:12-28 — a failed or empty answer is cached forever. `shown_fill` sets `_res[key] = Vector2.ZERO` before asking; `_ask` only writes on success, and `key` is never asked again for the life of the editor (`_fit` is created once, `look_editor.gd:40`, and survives across looks). Scenario: `/api/scene/layer-fit` fails once (server restarting, media not yet probed) → every layer with that source keeps the 16:9 fallback box until the Godot client restarts. A re-encoded file with the same name also keeps its old size. Fix: drop the key from `_res` on failure (retry after a few seconds) and clear the cache in `open()`.
- (also see the unconnected `changed` signal under look_editor.gd.)

## godot/client/features/live/look_editor_view.gd
- `OK`

## godot/client/features/live/look_edits.gd
- `QUALITY` godot/client/features/live/look_edits.gd:45-47 — stale doc comment: "placed right after the original", but line 55 (`scenes.append(dupe)`, WO-762, owner 25.10) puts the copy at the END of the deck. Fix: update the comment.

## godot/client/features/live/look_layer_audio.gd
- `OK`

## godot/client/features/live/look_layer_drop.gd
- `OK`

## godot/client/features/live/look_layer_ops.gd
- `OK`

## godot/client/features/live/look_preset_model.gd
- `DEAD` godot/client/features/live/look_preset_model.gd:125-132 `meta_line()` — only a test calls it. grep: `grep -rnw meta_line godot/client --include=*.gd` → `tests/test_look_presets.gd:35-36` only. The preset card (look_preset_strip.gd) builds its second line with `dest_line()` instead (WO-781/783 replaced the old card). Fix: delete it and the two test lines (`mains_of` stays, `look_preset_page.recall` uses it).
- `DEAD` godot/client/features/live/look_preset_model.gd:135-137 `loaded_on_prv()` — a thin wrapper over `loaded_on_bus(…, "prv")`, called only from `tests/test_look_presets.gd:41-43`; look_preset_strip.gd:49-50 calls `loaded_on_bus` directly. Fix: delete it, point the test at `loaded_on_bus`.
- `QUALITY` godot/client/features/live/look_preset_model.gd:8-22 — `unique_name` is the third near-identical "Name (2)" helper in the folder (`layer_style_model.gd:55`, `look_edits.gd:copy_name`:75). Fix: one `unique_name(taken, base, fmt)` in a shared util.

## godot/client/features/live/look_preset_page.gd
- `QUALITY` godot/client/features/live/look_preset_page.gd:109,158 — reaches into other classes' private statics: `DeckModel._live_scene_id` (also compose_tiles.gd:309) and `LayerStyleRow._uuid`. Fix: make them public (see deck_view.gd:391).

## godot/client/features/live/look_preset_strip.gd
- `OK` (it calls the page's private `_looks`, `_confirm_overwrite` — a documented page/strip pair, not worth a finding.)

## godot/client/features/live/look_thumb.gd
- `OK`

## godot/client/features/live/look_thumb_math.gd
- `QUALITY` godot/client/features/live/look_thumb_math.gd:93 (and 37) — `RegEx.create_from_string` compiles a pattern on every call; `fit_mode()` runs for each layer on each card redraw via `placement()`. Fix: hoist to a `static var` or const-built RegEx. `live_channel` (33-43) also duplicates `live_sources_model.gd thumb_channel` (305-315) with a slightly different fallback order; one helper would keep the card and the Sources row in agreement.
