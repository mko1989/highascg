extends VBoxContainer
## WO-602 — Timeline tab, slice 1 (web timeline-editor.js + timeline-transport.js + -playback.js): pick / create a
## timeline, the canvas (timeline_view.gd), transport (play from the playhead / pause / stop / seek), PRV / PGM send-to,
## SMPTE readout and a playhead that follows the server (`timeline.tick` extrapolated with the web's 80 / 35 ms rules,
## `timeline.playback` for play state). Timelines live in `project.timelines` (autosave, same JSON as the web) and are
## pushed to the engine before transport (PUT /api/timelines/:id, POST when missing) like the web's syncToServer.
## Slice 2: clip select / move / resize / delete on the canvas, Sources drops (add, or replace the clip under the drop),
## the clip page in the global Inspector; every committed edit autosaves and re-syncs the timeline to the engine.
## Slice 3: the clip transform. Slice 4: keyframes (canvas, Inspector groups, the web's i / o / p / s / v / t keys).
## Slice 5: flags — the Flag button adds one at the playhead; select / drag / Delete on the canvas, the flag page in
## the Inspector. Slice 6: layers — header select / drag-reorder / divider resize (Shift: all), double-click adds one,
## right-click menu, the layer page in the Inspector (rename, add below, remove). Slice 7: the transport bar moved to
## timeline_transport.gd (and gained rename, to start / end, loop, the time + duration fields, trim, zoom); the
## keyboard (timeline_keys.gd): copy / paste, Space, arrows, Enter. Slice 8: the Dest row (timeline_dest.gd): screen,
## PRV / PGM posted at once, Take with a transition. Slice 9: effects — Sources' EFFECTS dropped on a clip, the
## clip page's Mixer Effects group.

const TM := preload("res://features/timeline/timeline_math.gd")
const TimelineView := preload("res://features/timeline/timeline_view.gd")
const TimelineTransport := preload("res://features/timeline/timeline_transport.gd")
const TimelineDest := preload("res://features/timeline/timeline_dest.gd")
const TimelineKeys := preload("res://features/timeline/timeline_keys.gd")
const TE := preload("res://features/timeline/timeline_edit.gd")
const ClipInspector := preload("res://features/timeline/timeline_clip_inspector.gd")
const FlagInspector := preload("res://features/timeline/timeline_flag_inspector.gd")
const LayerInspector := preload("res://features/timeline/timeline_layer_inspector.gd")
const TimelineMedia := preload("res://features/timeline/timeline_media.gd")
const F := preload("res://features/timeline/timeline_flags.gd")
const InspectorPanel := preload("res://app/inspector_panel.gd")
const EffectsModel := preload("res://features/live/effects_model.gd")
const Monitor := preload("res://features/timeline/timeline_monitor.gd")
const UI_CFG := "user://ui.cfg"

var view: TimelineView
var monitor: Monitor  # WO-788: the live picture of the channel the timeline plays to, above the canvas
var transport: TimelineTransport
var dest: TimelineDest
var _keys := TimelineKeys.new()
var _page: ClipInspector
var _throttle: Timer
var _media := TimelineMedia.new()
var _flag_page: FlagInspector
var _layer_page: LayerInspector
var _geo_seek := false  # the pending throttled sync also re-seeks (geometry / mixer / trim edits)


func _ready() -> void:
	add_theme_constant_override("separation", 6)
	transport = TimelineTransport.new()
	transport.tab = self
	dest = TimelineDest.new()
	dest.tab = self
	transport.edited.connect(_layers_commit)
	transport.flag_requested.connect(_add_flag)
	add_child(transport)
	add_child(dest)
	_keys.tab = self
	view = TimelineView.new()
	view.size_flags_vertical = Control.SIZE_EXPAND_FILL
	view.seek_requested.connect(func(ms: float) -> void: transport.seek(ms))
	view.clip_selected.connect(_on_clip_selected)
	view.edited.connect(_commit)
	view.source_dropped.connect(_on_drop)
	view.keyframes_edited.connect(kf_commit)
	view.flag_selected.connect(_on_flag_selected)
	view.flags_edited.connect(_commit)
	view.layer_selected.connect(_on_layer_selected)
	view.layers_edited.connect(_layers_commit)
	view.layer_menu.connect(func(_li: int) -> void: _layer_page.menu())
	var split := VSplitContainer.new()
	split.size_flags_vertical = Control.SIZE_EXPAND_FILL
	monitor = Monitor.new()
	split.add_child(monitor)
	split.add_child(view)
	var cfg := ConfigFile.new()
	cfg.load(UI_CFG)
	split.split_offset = int(cfg.get_value("timeline", "monitor_h", 260))
	split.dragged.connect(func(at: int) -> void:
		cfg.set_value("timeline", "monitor_h", at)
		cfg.save(UI_CFG))
	add_child(split)
	_page = ClipInspector.new()
	_page.patch.connect(_on_patch)
	_page.remove_requested.connect(_remove_selected)
	_flag_page = FlagInspector.new()
	_flag_page.changed.connect(_commit)
	_flag_page.remove_requested.connect(func() -> void:
		F.remove(active(), view.sel_flag)
		view.select_flag("")
		_commit())
	_layer_page = LayerInspector.new()
	_layer_page.changed.connect(_layers_commit)
	_layer_page.selected.connect(func(li: int) -> void: view.select_layer(li))
	_throttle = Timer.new()
	_throttle.one_shot = true
	_throttle.wait_time = 0.08  # the web's 80 ms trailing geometry sync
	_throttle.timeout.connect(func() -> void: _commit())
	add_child(_throttle)
	Store.project_changed.connect(func(_p: Dictionary) -> void: refresh())
	refresh()


func root() -> Dictionary:
	if not (Store.project.get("timelines") is Dictionary):
		Store.project["timelines"] = {"activeId": null, "timelines": []}
	var r: Dictionary = Store.project.timelines
	if not (r.get("timelines") is Array):
		r["timelines"] = []
	return r


func active() -> Dictionary:
	var r := root()
	for t in r.timelines:
		if t is Dictionary and str(t.get("id", "")) == str(r.get("activeId", "")):
			return t
	return r.timelines[0] if not (r.timelines as Array).is_empty() and r.timelines[0] is Dictionary else {}


func refresh() -> void:
	view.set_timeline(active())
	transport.refresh()


func _exit_tree() -> void:
	for p in [_page, _flag_page, _layer_page]:
		if p != null and not p.is_inside_tree():  # never selected → never adopted by the Inspector
			p.free()


## ── editing ──

func _main_idx(tl: Dictionary) -> int:
	return int(tl.sendTo.get("screenIdx", 0)) if tl.get("sendTo") is Dictionary else 0


func _on_clip_selected(li: int, clip_id: String) -> void:
	var tl := active()
	var c := TE.find_clip(tl, li, clip_id) if clip_id != "" else {}
	if c.is_empty():
		if InspectorPanel.current != null:
			InspectorPanel.current.release(_page)
		return
	if InspectorPanel.current != null:
		InspectorPanel.current.present(_page)
	if _page.kf != null:  # built in the page's _ready, once the Inspector adopted it
		_page.kf.now = func() -> float: return view.playhead_ms
	_page.canvas = _program_res(_main_idx(tl))
	_page.center = Settings.get_setting("editorDefaults.coordinateOrigin", "") == "center"
	_page.content = Vector2.ZERO
	_page.show_clip(tl, li, c, _main_idx(tl))
	if c.get("source") is Dictionary:
		var mr := await _media.res(c.source)
		_page.set_content(c, Vector2(mr))


func _on_flag_selected(id: String) -> void:
	var f := F.find(active(), id) if id != "" else {}
	if InspectorPanel.current == null:
		return
	if f.is_empty():
		InspectorPanel.current.release(_flag_page)
		return
	InspectorPanel.current.present(_flag_page)
	_flag_page.show_flag(active(), f)


func _on_layer_selected(li: int) -> void:
	if InspectorPanel.current == null:
		return
	if li < 0:
		InspectorPanel.current.release(_layer_page)
		return
	InspectorPanel.current.present(_layer_page)
	_layer_page.show_layer(active(), li)


func _layers_commit() -> void:
	view.queue_redraw()
	transport.refresh_picker()
	_commit()


## web #tl-add-flag: a pause flag at the playhead, selected.
func _add_flag() -> void:
	var tl := active()
	if tl.is_empty():
		return
	var f := F.add(tl, roundf(view.playhead_ms))
	view.select_flag(str(f.id))
	_commit()


func commit() -> void:
	_commit()


## One committed edit: autosave, redraw, re-read the page, push the timeline to the engine — and when a geometry /
## mixer / trim edit is part of it, re-seek so the engine re-applies the layers at the playhead (web
## refreshTimelineClipGeometryOnServer, WO-522).
func _commit() -> void:
	var tl := active()
	if tl.is_empty():
		return
	_throttle.stop()
	var seek := _geo_seek
	_geo_seek = false
	ProjectSync.mark_dirty()
	view.queue_redraw()
	transport.sync()
	_page.refresh()
	_flag_page.refresh()
	if view.sel_layer >= 0:
		_layer_page.show_layer(tl, view.sel_layer)
	if not await transport.sync_to_server(tl):
		transport.status("Timeline sync to the server failed")
	elif seek and (transport.pb_last == "" or transport.pb_last == str(tl.id)):  # web: only the timeline the engine is on re-seeks
		await Api.post_json("/api/timelines/%s/seek" % str(tl.id).uri_encode(), {"ms": maxf(0.0, roundf(view.playhead_ms))})


func _on_patch(changes: Dictionary, kind: String) -> void:
	var tl := active()
	if TE.update_clip(tl, view.sel_li, view.sel_id, changes).is_empty():
		return
	view.queue_redraw()
	if kind == "throttle" or kind == "geometry":
		ProjectSync.mark_dirty()
		_geo_seek = _geo_seek or kind == "geometry"
		_throttle.start()
		return
	await _commit()
	if kind == "route" and transport.is_playing(str(tl.id)):  # the engine re-applies the route on a seek
		await Api.post_json("/api/timelines/%s/seek" % str(tl.id).uri_encode(), {"ms": maxf(0.0, roundf(view.playhead_ms))})


## Keyframe edits sync and re-seek, so a paused preview shows the change at once (the web re-seeks only after a drag).
func kf_commit() -> void:
	_geo_seek = true
	_commit()


## The timeline keyboard (timeline_keys.gd) while this tab is visible — ahead of the GUI, so Space / arrows / Enter
## never reach a focused button or move the focus.
func _input(event: InputEvent) -> void:
	var k := event as InputEventKey
	if k != null and k.pressed and is_visible_in_tree() and _keys.handle(k):
		get_viewport().set_input_as_handled()


## For the i o p s v t keys: the selected clip's pixel rect and the program canvas.
func clip_rect() -> Dictionary:
	return _page.rect()


func clip_canvas() -> Vector2:
	return _page.canvas


func _remove_selected() -> void:
	if view.sel_id == "":
		return
	TE.remove_clip(active(), view.sel_li, view.sel_id)
	view.select(-1, "")
	_commit()


## onDropSource: add layers up to the drop row, replace the clip under the drop or add a new one and lay it out
## for its content fit on the timeline's program canvas (applyTimelineClipLayoutFromMedia).
func _on_drop(src: Dictionary, li: int, ms: float) -> void:
	var tl := active()
	if tl.is_empty():
		return
	if src.get("type") == "effect":
		_add_effect(tl, li, ms, str(src.value))
		return
	var dur := await _media.drop_duration(src)
	if not is_same(tl, active()):
		return
	while (tl.layers as Array).size() <= li:
		(tl.layers as Array).append({"id": TM.uid(), "name": TE.next_layer_name(tl), "clips": []})
		TM.ensure_heights(tl)
	var c := TM.hit_clip(tl, li, ms)
	if not c.is_empty():
		TE.replace_clip_source(tl, li, str(c.id), src, dur)
		var prev: Variant = c.get("fillPx")
		if prev is Dictionary and float(prev.get("w", 0)) > 0 and float(prev.get("h", 0)) > 0:
			var mr := await _media.res(src)
			if mr.x > 0:
				c["fillPx"] = TE.contain_rect(prev, mr.x, mr.y)
	else:
		if ms + dur > float(tl.get("duration", 0)):
			tl["duration"] = ms + dur + TE.CONTENT_END_PADDING_MS
		var dflt: Variant = Settings.get_setting("editorDefaults.timeline", {})
		c = TE.add_clip(tl, li, src, ms, dur, dflt if dflt is Dictionary else {})
		var cv := _program_res(_main_idx(tl))
		var mr := await _media.res(src)
		c["fillPx"] = TE.fit_rect(cv.x, cv.y, mr.x, mr.y, str(c.contentFit))
	view.set_timeline(tl)
	view.select(li, str(c.id))
	_on_clip_selected(li, str(c.id))
	transport.refresh_picker()
	_commit()


## web onDropSource, effect branch (WO-22): the effect (one per type, registry defaults) joins the clip under the
## drop, which is selected so its Effects group shows. Synced and re-seeked like a geometry edit — the engine sends a
## clip's effects whenever they change, on its next apply.
func _add_effect(tl: Dictionary, li: int, ms: float, type: String) -> void:
	var c := TM.hit_clip(tl, li, ms)
	if c.is_empty():
		return
	var cur: Array = c.get("effects", []) if c.get("effects") is Array else []
	var next := EffectsModel.add(cur, await _page.load_registry(), type)
	if next.size() == cur.size() or not is_same(tl, active()):
		return  # already on the clip, or an unknown type
	c["effects"] = next
	view.select(li, str(c.id))
	_on_clip_selected(li, str(c.id))
	kf_commit()


func _program_res(main: int) -> Vector2:
	var cm: Variant = Store.get_value("channelMap", {})
	var rl: Variant = cm.get("programResolutions", []) if cm is Dictionary else []
	if rl is Array and main < (rl as Array).size() and rl[main] is Dictionary:
		return Vector2(maxf(1.0, float(rl[main].get("w", 1920))), maxf(1.0, float(rl[main].get("h", 1080))))
	return Vector2(1920, 1080)
