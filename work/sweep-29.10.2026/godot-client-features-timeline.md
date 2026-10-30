# godot/client/features/timeline — sweep 29.10.2026 (batch 038)

Files: 21 · lines: 3998 · findings: 0 BUG-HIGH, 6 BUG, 4 DEAD, 6 RISK, 10 QUALITY

Notes on method: every file read in full. All cross-file APIs the timeline code calls (Api, Ws, Store, ProjectSync, Settings, InspectorPanel, LivePreview, px_rect_math, mixer_math, transitions, deck_model, look_thumb, effects_*, transition_row, align_row, ThemeBuilder) were checked to exist with the used signatures. Server endpoints used (`/api/timelines*`, `/api/media/cinf`, `/api/local-media/<f>/probe`, `/api/scene/layer-options`, `/api/scene/effect-registry`, `/api/companion/button-preview/*`) exist in `src/api`. Server `PUT /api/timelines/:id` creates when missing and `POST /api/timelines` updates on an existing id (src/api/routes-timeline.js:32-45, 70-76), so the double push on "new timeline" (`_read_state` + `_new_timeline` both call `sync_to_server`) is harmless. Behaviour that is a deliberate 1:1 port of the web (e.g. right-resize resetting `inPoint`, `apply_tick` rules) is not reported as a bug.

## godot/client/features/timeline/timeline_clip_inspector.gd
- `BUG` godot/client/features/timeline/timeline_clip_inspector.gd:135-140 — `show_clip` sets `_main = main` before the route fetch finishes and never resets it on failure. Failing case 1: select clip A on screen 0 (`_main` -1 → 0, fetch starts), click clip B on the same screen before the response → `main == _main` so no fetch, `refresh()` runs with `_routes == []` (Route dropdown empty, `select(-1)`); when A's fetch lands `_routes` is filled but `is_same(_clip, clip)` is false → early `return` without `refresh()`, so B's page keeps an empty Route dropdown until the next selection. Failing case 2: `/api/scene/layer-options` fails once (server busy) → `_routes = []`, `_main` stays equal → every later selection on that screen skips the fetch, no routes until the screen changes. Fix: set `_main` only after a successful fetch (and refresh the current clip when the fetch lands).
- `RISK` godot/client/features/timeline/timeline_clip_inspector.gd:174 — when the clip's `audioRoute` is not in the fetched list, `maxi(0, find(cur))` selects entry 0, so the dropdown shows a route the clip does not have (nothing is written, but it misreports; a clip with route "1+2" and a list without it shows the first route). Select -1 / add a "(custom) cur" item instead.
- `OK` otherwise: signals, lambdas, `_syncing` guards, registry loading and `fx` hookup verified against effects_section.gd / px_rect_math.gd.

## godot/client/features/timeline/timeline_dest.gd
- `OK` — send_to / adopt / take paths read through; the `Store.changed` lambda is bound to self (auto-disconnects); `Api.post_json` results carry `.error` (core/api.gd).

## godot/client/features/timeline/timeline_edit.gd
- `BUG` godot/client/features/timeline/timeline_edit.gd:255-262 — `snapped_start` treats "the edge is exactly on a candidate" (distance 0) as "no candidate found" (`ds_snap = INF` when `s == raw`), so an exact alignment on one edge loses against a 1-80 ms snap on the other edge. Failing case: `snapped_start(5000, 2003, [0, 5000, 7000], 80, null)` → `s = 5000` (== raw → INF), `e = snap(7003) - 2003 = 4997` (de_snap 3) → returns 4997; expected 5000 (the start is already exactly aligned). At the default 0.1 px/ms the raw ms are multiples of 10, so exact hits happen. Fix: track "found a candidate within thr" separately from `s != raw` (e.g. have `snap_value` return the distance, or use `absf(s - raw) < thr` with INF only when `snap_value` found nothing).
- `OK` otherwise (resize / fit / contain / media-row / layer-name helpers match the web ports and their tests).

## godot/client/features/timeline/timeline_flag_draw.gd
- `QUALITY` godot/client/features/timeline/timeline_flag_draw.gd:95-100 — `invalidate(k := "")` clears-all branch (`k == ""`) is never used: only caller is `_wire()` with a concrete key. grep: `grep -rn "invalidate(" godot/client` → definition + the one call in this file. Drop the default or keep as documented API.
- `OK` otherwise (retry/pending bookkeeping correct; `_thumbs[k] = null` caches "none" until Companion reports the button changed, as documented).

## godot/client/features/timeline/timeline_flag_inspector.gd
- `QUALITY` godot/client/features/timeline/timeline_flag_inspector.gd:116-123 — the Row / Column spin boxes accept down to `-MAX_COORD` but are labelled "Row (0+)" / "Column (0+)". Either the label or the minimum is wrong (the server route and web parser accept negatives; label is the odd one).
- `OK` otherwise (focus guards, `_syncing` use, status text paths verified).

## godot/client/features/timeline/timeline_flags.gd
- `BUG` godot/client/features/timeline/timeline_flags.gd:224-247 — `parse_hms` (Jump-to time in the flag page) accepts only `HH:MM:SS:mmm`, `++/--N` or an integer. RULES.md "Input fields" rule 2: every number field evaluates `+ - * /` and parentheses on commit; the sibling timecode parsers already do for colon-less input (`clip_trim_model.gd:118-124` `parse_tc`, `timers_dock_model.gd:19-29` "RULES.md input rule 2"). Failing case: type `1000+500` into "Jump to time" → `is_valid_int` fails → returns null → the field reverts. Fix: for text without ":" run it through `NumericField.evaluate` (same as the siblings). Same gap in `timeline_math.gd parse_tc`.
- `RISK` godot/client/features/timeline/timeline_flags.gd:157-166 — `_sort` calls `a[j].get(...)` / `f.get(...)` on every entry, while every other flag accessor guards `f is Dictionary`. A non-Dictionary element in `tl.flags` (hand-edited project) crashes add/update/drag. No such input is produced by the app itself.
- `QUALITY` godot/client/features/timeline/timeline_flags.gd:260 — `parse_location` splits on `[\s/,-]+`, so a `-` is always a separator: negative row/column (allowed by the `absi(c.y) > MAX_COORD` check, the spin boxes and the server route) can never be typed into the Location field. Inherited from the web parser (client/lib/companion-location-parse.js:13 has the same split) — report only.

## godot/client/features/timeline/timeline_keyframes.gd
- `QUALITY` godot/client/features/timeline/timeline_keyframes.gd:219-226 — `marker_y` repeats `value_y` for the opacity / volume branch (`row_h - ROW_PAD - clampf(value,0,1) * ...`); `marker_y` could call `value_y(float(kf.get("value", 0)), row_h)`.
- `OK` otherwise (ease curves, in-place edits by identity, drag clamp verified).

## godot/client/features/timeline/timeline_keys.gd
- `DEAD` godot/client/features/timeline/timeline_keys.gd:10 `const TM` — unused. grep: `grep -nw TM godot/client/features/timeline/timeline_keys.gd` → only the preload line.
- `RISK` godot/client/features/timeline/timeline_keys.gd:325,342-343 — the "field has focus" bail-out covers only LineEdit / TextEdit. If another focusable control in the Inspector holds focus (e.g. the Volume HSlider after a click, a CheckBox, an OptionButton), Left / Right go to `_arrow` and move the selected clip one frame (and Space toggles playback) instead of reaching that control, because `Tab._input` runs ahead of the GUI. Documented as intended for buttons (header comment) but the slider case is surprising: dragging Volume then pressing Left shifts the clip's start time.
- `OK` otherwise.

## godot/client/features/timeline/timeline_kf_draw.gd
- `QUALITY` godot/client/features/timeline/timeline_kf_draw.gd:101-107 — the curve sampler calls `K.eased` per 3 px sample, and `K.eased` rebuilds the property's key list (`K.of`: closure filter + insertion sort) on every call. The canvas redraws every frame while a timeline plays (`set_playhead` → `queue_redraw`), so a 1500 px keyed clip costs ~500 filter+sort passes per property per frame. Compute `K.of(clip, prop)` once per property and sample from that array.
- `OK` otherwise.

## godot/client/features/timeline/timeline_kf_section.gd
- `RISK` godot/client/features/timeline/timeline_kf_section.gd:366-376 — `_pos_row` shows a missing half of a fill_x / fill_y pair as 0 (`float(kx.value) if kx else 0.0`) and `apply` then writes both halves, so editing X on a row where only fill_y exists inserts `fill_x = 0` (clip jumps to the left edge) instead of the interpolated/base value. Pairs are always created together by this client and the web, so only reachable with a hand-edited or partially-removed pair.
- `OK` otherwise.

## godot/client/features/timeline/timeline_layer_inspector.gd
- `OK` — rename-on-focus-loss commits to the layer it was typed for (`show_layer` releases focus before switching); remove confirmation dialog freed on both outcomes.

## godot/client/features/timeline/timeline_layers.gd
- `OK` — reorder / insert / remove keep `layerHeights` index-aligned; `divider_heights` keeps the sum within bounds.

## godot/client/features/timeline/timeline_layout.gd
- `OK`.

## godot/client/features/timeline/timeline_math.gd
- `BUG` godot/client/features/timeline/timeline_math.gd:47-70 — `parse_tc` (current time, total duration, clip Position fields, flag Position) rejects any arithmetic. RULES.md "Input fields" rule 2 requires `+ - * /` evaluation on commit for number fields; other timecode parsers in the Godot client were given this for the colon-less form (see timeline_flags.gd finding). Failing case: type `1000+500` or `30*1000` into the "/" Total duration field → `is_valid_int` fails → null → the field reverts to the old value. Fix: when the text has no ":" and is not a `++/--` offset, evaluate via `NumericField.evaluate` and treat the result as ms.
- `DEAD` godot/client/features/timeline/timeline_math.gd:100 `total_height()` — only referenced by a test. grep: `grep -rn "total_height" godot` → definition + `tests/test_timeline_math.gd:28`. (The web uses it for the "+ drop here" row and scroll range; the Godot port has neither, see timeline_view.gd.)
- `QUALITY` godot/client/features/timeline/timeline_math.gd:164 — in `apply_tick` the first condition (`server_ms - extrapolated > TICK_AHEAD_SNAP_MS`) is implied by the second (`server_ms >= extrapolated - TICK_LATENCY_MS`), so `TICK_AHEAD_SNAP_MS` has no effect. Same shape as the web (client/components/timeline-editor-playback.js:70-76) — behaviour is right, the constant is decorative.
- `QUALITY` godot/client/features/timeline/timeline_math.gd:74-98 — `layer_h` / `track_top` / `layer_at_y` call `ensure_heights` (O(n) with allocation checks) per layer, and the draw loop calls `track_top` + `layer_h` several times per layer per frame: O(n^2)-O(n^3) per redraw. Harmless at 3-10 layers; hoist `ensure_heights` to `set_timeline`/edits if layer counts grow.

## godot/client/features/timeline/timeline_media.gd
- `OK`.

## godot/client/features/timeline/timeline_nav.gd
- `QUALITY` godot/client/features/timeline/timeline_nav.gd:133-148,175-180 — three near-identical snap-point collectors (`N.snap_points`, `TE.snap_candidates`, `K.snap_candidates`) and `N.clips_end` duplicates the clip loop of `TE.content_end` (which also counts flags). All are live and test-pinned (web ports), so only a consolidation note.
- `OK` otherwise.

## godot/client/features/timeline/timeline_send_to.gd
- `DEAD` godot/client/features/timeline/timeline_send_to.gd:267 `default_for()` — only used by a test. grep: `grep -rn "default_for" godot` → definition + `tests/test_timeline_send_to.gd:21`. New timelines get their routing through `TM.default_timeline` + `Dest.update_send_to` coerce.
- `OK` otherwise.

## godot/client/features/timeline/timeline_tab.gd
- `BUG` godot/client/features/timeline/timeline_tab.gd:77-82 — the splitter handler keeps one `ConfigFile` loaded once in `_ready` and calls `cfg.save(UI_CFG)` on every drag. Every other ui.cfg writer re-loads before saving (haze.gd:30-33, fold_section.gd:40-42, previs_tab.gd:333-338, …), and the Shell builds the Timeline tab at startup (app/shell.gd:82). So any ui.cfg key written after startup (haze level, previs folds, per-origin API password, window prefs) is overwritten with the stale startup snapshot the next time the timeline divider is dragged. Failing case: start client, set Previs haze to 0.5 (written to ui.cfg), drag the Timeline preview divider → ui.cfg is saved from the timeline's old in-memory copy → haze (and anything else changed since start) is back to its startup value on next launch. Fix: `var c := ConfigFile.new(); c.load(UI_CFG); c.set_value(...); c.save(UI_CFG)` inside the handler.
- `RISK` godot/client/features/timeline/timeline_tab.gd:152-159 — `_on_clip_selected` guards `InspectorPanel.current != null` for `present`, but then calls `_page.show_clip(...)` unconditionally; with no Inspector the page was never built (`_ready` not run) and `show_clip` dereferences `_title` (null). Flag / layer handlers return early in that case; the clip handler should too.
- `RISK` godot/client/features/timeline/timeline_tab.gd:284-305 — `_on_drop` re-checks `is_same(tl, active())` after the duration lookup but not after the later `await _media.res(src)` calls; if the operator switches timeline / deletes the clip during the resolution probe, `c["fillPx"]` is written to a detached clip and `view.set_timeline(tl)` / `select` run against the stale `tl`. Narrow window (HTTP probe), no data corruption of the new active timeline.
- `OK` otherwise.

## godot/client/features/timeline/timeline_transport.gd
- `QUALITY` godot/client/features/timeline/timeline_transport.gd:142-151 — `_process` runs every frame even while the Timeline tab is hidden (it only exits when no timeline exists): `tab.active()`, `_pbk`, `set_playhead(..., true)` (which also moves the scroll when Follow is on) and `_cur.text` formatting while a timeline plays on another tab. Cheap, but gate with `is_visible_in_tree()` (and refresh once on show).
- `OK` otherwise (seek coalescing, tick/playback adoption, play/pause/stop sequencing consistent with routes-timeline.js).

## godot/client/features/timeline/timeline_view.gd
- `BUG` godot/client/features/timeline/timeline_view.gd:46,125-133 — vertical scrolling does not exist: `scroll_y` is declared and passed to every hit test / draw but is never assigned anywhere (`grep -rn "scroll_y *=" godot/client/features/timeline` → only `var scroll_y := 0.0`), and the wheel handler maps Shift **and** Alt to horizontal pan. The web has it (client/components/timeline-canvas-wheel.js:27-41: Alt+wheel scrolls Y, Shift+wheel pans X, clamped by `maxScrollY`). Failing case: a timeline with more layers than fit the canvas (10 layers x 54 px = 540 px + 30 px ruler in a ~350-450 px pane) → layers 7-10 are drawn off-canvas and cannot be clicked, selected, dropped onto (`layer_at_y` never lands there) or reordered, except by shrinking layer heights to 28 px or enlarging the pane. Fix: port `maxScrollY` + Alt+wheel Y scroll (clamp `scroll_y` in `set_timeline`/resize).
- `DEAD` godot/client/features/timeline/timeline_view.gd:35,37,40 `const KD`, `const FD`, `const ThemeBuilder` — unused here (drawing moved to timeline_view_draw.gd). grep: `grep -nw "KD\|FD\|ThemeBuilder" godot/client/features/timeline/timeline_view.gd` → only the three const lines.
- `OK` otherwise (selection mutual exclusion, drag state machine, layer reorder, flag / keyframe drags verified).

## godot/client/features/timeline/timeline_view_draw.gd
- `QUALITY` godot/client/features/timeline/timeline_view_draw.gd:363,411 — header name uses `layers[i].get("name", "Layer N")` and the clip label uses `c.source.get("label", c.source.value)`; both defaults only apply when the key is absent, so an empty-string name / label (project imported from the web with `name: ""`) draws blank, while the Inspector (`L.display_name`, `show_clip` label fallback) falls back to "Layer N" / the source value.
- `OK` otherwise (rect math matches `_row()` in timeline_view.gd, so keyframe hit-testing and drawing agree).
