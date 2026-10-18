extends VBoxContainer
## WO-602 — Timeline tab, slice 1 (web timeline-editor.js + timeline-transport.js + -playback.js): pick / create a
## timeline, the canvas (timeline_view.gd), transport (play from the playhead / pause / stop / seek), PRV / PGM send-to,
## SMPTE readout and a playhead that follows the server (`timeline.tick` extrapolated with the web's 80 / 35 ms rules,
## `timeline.playback` for play state). Timelines live in `project.timelines` (autosave, same JSON as the web) and are
## pushed to the engine before transport (PUT /api/timelines/:id, POST when missing) like the web's syncToServer.
## Slice 2: clip select / move / resize / delete on the canvas, Sources drops (add, or replace the clip under the drop),
## the clip page in the global Inspector; every committed edit autosaves and re-syncs the timeline to the engine.
## Keyframes, flags editing, transform and layer ops come in later slices.

const TM := preload("res://features/timeline/timeline_math.gd")
const TimelineView := preload("res://features/timeline/timeline_view.gd")
const TE := preload("res://features/timeline/timeline_edit.gd")
const ClipInspector := preload("res://features/timeline/timeline_clip_inspector.gd")
const InspectorPanel := preload("res://app/inspector_panel.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")

var view: TimelineView
var _pick: OptionButton
var _play: Button
var _tc: Label
var _status: Label
var _prv: CheckBox
var _pgm: CheckBox
var _ids: Array = []
var _pb := {}  # timelineId → {playing, clock {pos, at}}
var _page: ClipInspector
var _throttle: Timer
var _media_rows: Array = []


func _ready() -> void:
	add_theme_constant_override("separation", 6)
	var bar := HBoxContainer.new()
	bar.add_theme_constant_override("separation", 8)
	_pick = OptionButton.new()
	_pick.custom_minimum_size.x = 200
	_pick.item_selected.connect(func(i: int) -> void:
		if i >= 0 and i < _ids.size():
			_root()["activeId"] = _ids[i]
			ProjectSync.mark_dirty()
			_refresh())
	bar.add_child(_pick)
	bar.add_child(_btn("＋ New", "New timeline", _new_timeline))
	bar.add_child(VSeparator.new())
	bar.add_child(_btn("■", "Stop (back to start)", _stop))
	_play = _btn("▶", "Play / pause from the playhead", _toggle_play)
	_play.custom_minimum_size.x = 44
	bar.add_child(_play)
	_tc = Label.new()
	_tc.add_theme_font_size_override("font_size", 20)
	_tc.custom_minimum_size.x = 150
	bar.add_child(_tc)
	bar.add_child(VSeparator.new())
	_prv = _check("PRV", "Play to the preview bus")
	_pgm = _check("PGM", "Play to program")
	bar.add_child(_prv)
	bar.add_child(_pgm)
	bar.add_child(VSeparator.new())
	bar.add_child(_btn("Fit", "Zoom to the whole timeline", func() -> void: view.fit()))
	var fol := CheckBox.new()
	fol.text = "Follow"
	fol.button_pressed = true
	fol.toggled.connect(func(on: bool) -> void: view.follow = on)
	bar.add_child(fol)
	_status = Label.new()
	_status.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	_status.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_status.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	bar.add_child(_status)
	add_child(bar)
	view = TimelineView.new()
	view.size_flags_vertical = Control.SIZE_EXPAND_FILL
	view.seek_requested.connect(_seek)
	view.clip_selected.connect(_on_clip_selected)
	view.edited.connect(_commit)
	view.source_dropped.connect(_on_drop)
	add_child(view)
	_page = ClipInspector.new()
	_page.patch.connect(_on_patch)
	_page.remove_requested.connect(_remove_selected)
	_throttle = Timer.new()
	_throttle.one_shot = true
	_throttle.wait_time = 0.08  # the web's 80 ms trailing geometry sync
	_throttle.timeout.connect(func() -> void: _commit())
	add_child(_throttle)
	Ws.on("timeline.tick", _on_tick)
	Ws.on("timeline.playback", _on_playback)
	Store.project_changed.connect(func(_p: Dictionary) -> void: _refresh())
	_refresh()


func _root() -> Dictionary:
	if not (Store.project.get("timelines") is Dictionary):
		Store.project["timelines"] = {"activeId": null, "timelines": []}
	var r: Dictionary = Store.project.timelines
	if not (r.get("timelines") is Array):
		r["timelines"] = []
	return r


func active() -> Dictionary:
	var r := _root()
	for t in r.timelines:
		if t is Dictionary and str(t.get("id", "")) == str(r.get("activeId", "")):
			return t
	return r.timelines[0] if not (r.timelines as Array).is_empty() and r.timelines[0] is Dictionary else {}


func _refresh() -> void:
	var r := _root()
	var tl := active()
	_ids.clear()
	_pick.clear()
	for t in r.timelines:
		if t is Dictionary:
			_ids.append(str(t.get("id", "")))
			_pick.add_item("%s (%d layers)" % [t.get("name", "Timeline"), (t.get("layers", []) as Array).size()])
	_pick.select(_ids.find(str(tl.get("id", ""))))
	_pick.disabled = _ids.is_empty()
	view.set_timeline(tl)
	var st: Dictionary = tl.get("sendTo", {}) if tl.get("sendTo") is Dictionary else {}
	_prv.set_pressed_no_signal(st.get("preview", true) != false)
	_pgm.set_pressed_no_signal(st.get("program", false) == true)
	_status.text = "" if not tl.is_empty() else "No timeline in this project — ＋ New creates one."
	_sync_transport()


func _pbk(id: String) -> Dictionary:
	if not _pb.has(id):
		_pb[id] = {"playing": false, "clock": {"pos": 0.0, "at": _now()}}
	return _pb[id]


static func _now() -> float:
	return Time.get_ticks_msec()


func _process(_d: float) -> void:
	var tl := active()
	if tl.is_empty():
		return
	var p := _pbk(str(tl.id))
	if p.playing:
		view.set_playhead(minf(TM.clock_ms(p.clock, _now()), float(tl.get("duration", 0))), true)
		_tc.text = TM.fmt_smpte(view.playhead_ms, int(tl.get("fps", 25)))


func _sync_transport() -> void:
	var tl := active()
	var playing: bool = not tl.is_empty() and _pbk(str(tl.id)).playing
	_play.text = "❚❚" if playing else "▶"
	_tc.text = TM.fmt_smpte(view.playhead_ms, int(tl.get("fps", 25))) if not tl.is_empty() else "--:--:--:--"


## web onTick: anchor the clock; an active timeline that ticks is playing
func _on_tick(data: Variant) -> void:
	if not (data is Dictionary) or str(data.get("timelineId", "")) == "":
		return
	var p := _pbk(str(data.timelineId))
	if data.get("position") is float or data.get("position") is int:
		p["clock"] = TM.apply_tick(p.clock, float(data.position), _now())
	if str(data.timelineId) == str(active().get("id", "")) and not p.playing:
		p["playing"] = true
		_sync_transport()


## web onPlayback: play state + anchored position
func _on_playback(pb: Variant) -> void:
	if not (pb is Dictionary) or str(pb.get("timelineId", "")) == "":
		return
	var p := _pbk(str(pb.timelineId))
	p["playing"] = pb.get("playing") == true
	if pb.get("position") is float or pb.get("position") is int:
		p["clock"] = {"pos": float(pb.position), "at": _now()}
	if str(pb.timelineId) == str(active().get("id", "")):
		if not p.playing:
			view.set_playhead(TM.clock_ms(p.clock, _now()), false)
		_sync_transport()


func _sync_to_server(tl: Dictionary) -> bool:
	var r: Dictionary = await Api.put_json("/api/timelines/%s" % str(tl.id).uri_encode(), tl)
	if not r.ok:
		r = await Api.post_json("/api/timelines", tl)
	return r.ok


func _send_to() -> Dictionary:
	return {"preview": _prv.button_pressed, "program": _pgm.button_pressed, "screenIdx": int((active().get("sendTo", {}) as Dictionary).get("screenIdx", 0)) if active().get("sendTo") is Dictionary else 0}


func _toggle_play() -> void:
	var tl := active()
	if tl.is_empty():
		return
	var id := str(tl.id)
	var p := _pbk(id)
	if p.playing:
		p["playing"] = false
		p["clock"] = {"pos": view.playhead_ms, "at": _now()}
		_sync_transport()
		await Api.post_json("/api/timelines/%s/pause" % id.uri_encode(), {})
		return
	var from := maxf(0.0, roundf(view.playhead_ms))
	tl["sendTo"] = _send_to()
	if not await _sync_to_server(tl):
		_status.text = "Timeline sync to the server failed"
		return
	await Api.post_json("/api/timelines/%s/seek" % id.uri_encode(), {"ms": from})
	await Api.post_json("/api/timelines/%s/sendto" % id.uri_encode(), tl.sendTo)
	var r: Dictionary = await Api.post_json("/api/timelines/%s/play" % id.uri_encode(), {"from": from, "sendTo": tl.sendTo})
	if not r.ok:
		_status.text = "Play failed: %s" % r.error
		return
	p["clock"] = {"pos": from, "at": _now()}
	p["playing"] = true
	_status.text = ""
	_sync_transport()


func _stop() -> void:
	var tl := active()
	if tl.is_empty():
		return
	var p := _pbk(str(tl.id))
	p["playing"] = false
	p["clock"] = {"pos": 0.0, "at": _now()}
	view.set_playhead(0.0, false)
	_sync_transport()
	await Api.post_json("/api/timelines/%s/stop" % str(tl.id).uri_encode(), {"force": true})  # the operator's explicit Stop (WO-552)


func _seek(ms: float) -> void:
	var tl := active()
	if tl.is_empty():
		return
	var p := _pbk(str(tl.id))
	p["clock"] = {"pos": ms, "at": _now()}
	_sync_transport()
	await Api.post_json("/api/timelines/%s/seek" % str(tl.id).uri_encode(), {"ms": ms})


func _new_timeline() -> void:
	var r := _root()
	var tl := TM.default_timeline("Timeline %d" % ((r.timelines as Array).size() + 1) if not (r.timelines as Array).is_empty() else "Timeline")
	(r.timelines as Array).append(tl)
	r["activeId"] = tl.id
	ProjectSync.mark_dirty()
	_refresh()
	await _sync_to_server(tl)


func _exit_tree() -> void:
	if _page != null and not _page.is_inside_tree():  # never selected → never adopted by the Inspector
		_page.free()


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
	_page.show_clip(tl, li, c, _main_idx(tl))


## One committed edit: autosave, redraw, re-read the page, push the timeline to the engine.
func _commit() -> void:
	var tl := active()
	if tl.is_empty():
		return
	_throttle.stop()
	ProjectSync.mark_dirty()
	view.queue_redraw()
	_page.refresh()
	if not await _sync_to_server(tl):
		_status.text = "Timeline sync to the server failed"


func _on_patch(changes: Dictionary, kind: String) -> void:
	var tl := active()
	if TE.update_clip(tl, view.sel_li, view.sel_id, changes).is_empty():
		return
	view.queue_redraw()
	if kind == "throttle":
		ProjectSync.mark_dirty()
		_throttle.start()
		return
	await _commit()
	if kind == "route" and _pbk(str(tl.id)).playing:  # the engine re-applies the route on a seek
		await Api.post_json("/api/timelines/%s/seek" % str(tl.id).uri_encode(), {"ms": maxf(0.0, roundf(view.playhead_ms))})


func _remove_selected() -> void:
	if view.sel_id == "":
		return
	TE.remove_clip(active(), view.sel_li, view.sel_id)
	view.select(-1, "")
	_commit()


func _media_row(value: String) -> Dictionary:
	var row := TE.find_media_row(_media_rows, value)
	if row.is_empty():
		var r: Dictionary = await Api.get_json("/api/media")
		if r.ok and r.data is Array:
			_media_rows = r.data
			row = TE.find_media_row(_media_rows, value)
	return row


## resolveDroppedSourceDurationMs: the payload, the media row, CINF, else 5 s.
func _drop_duration(src: Dictionary) -> float:
	if str(src.get("type", "")) != "media":
		return TE.DEFAULT_CLIP_MS
	if float(src.get("durationMs", 0)) > 0:
		return float(src.durationMs)
	var row := await _media_row(str(src.value))
	if float(row.get("durationMs", 0)) > 0:
		return float(row.durationMs)
	var r: Dictionary = await Api.post_json("/api/media/cinf", {"id": src.value})
	if r.ok and r.data is Dictionary and float(r.data.get("durationMs", 0)) > 0:
		return float(r.data.durationMs)
	return TE.DEFAULT_CLIP_MS


## fetchMediaContentResolution: the payload, the media row, then the ffprobe of a local file.
func _media_res(src: Dictionary) -> Vector2i:
	var res := TE.parse_resolution(str(src.get("resolution", "")))
	if res.x <= 0:
		res = TE.parse_resolution(str((await _media_row(str(src.value))).get("resolution", "")))
	if res.x <= 0 and str(src.get("type", "")) in ["media", "file"]:
		var r: Dictionary = await Api.get_json("/api/local-media/%s/probe" % str(src.value).uri_encode())
		if r.ok and r.data is Dictionary:
			res = TE.parse_resolution(str(r.data.get("resolution", "")))
	return res


## onDropSource: add layers up to the drop row, replace the clip under the drop or add a new one and lay it out
## for its content fit on the timeline's program canvas (applyTimelineClipLayoutFromMedia).
func _on_drop(src: Dictionary, li: int, ms: float) -> void:
	var tl := active()
	if tl.is_empty():
		return
	var dur := await _drop_duration(src)
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
			var mr := await _media_res(src)
			if mr.x > 0:
				c["fillPx"] = TE.contain_rect(prev, mr.x, mr.y)
	else:
		if ms + dur > float(tl.get("duration", 0)):
			tl["duration"] = ms + dur + TE.CONTENT_END_PADDING_MS
		var dflt: Variant = Settings.get_setting("editorDefaults.timeline", {})
		c = TE.add_clip(tl, li, src, ms, dur, dflt if dflt is Dictionary else {})
		var cv := _program_res(_main_idx(tl))
		var mr := await _media_res(src)
		c["fillPx"] = TE.fit_rect(cv.x, cv.y, mr.x, mr.y, str(c.contentFit))
	view.set_timeline(tl)
	view.select(li, str(c.id))
	_on_clip_selected(li, str(c.id))
	_refresh_picker()
	_commit()


func _program_res(main: int) -> Vector2:
	var cm: Variant = Store.get_value("channelMap", {})
	var rl: Variant = cm.get("programResolutions", []) if cm is Dictionary else []
	if rl is Array and main < (rl as Array).size() and rl[main] is Dictionary:
		return Vector2(maxf(1.0, float(rl[main].get("w", 1920))), maxf(1.0, float(rl[main].get("h", 1080))))
	return Vector2(1920, 1080)


func _refresh_picker() -> void:
	var tl := active()
	var i := _ids.find(str(tl.get("id", "")))
	if i >= 0:
		_pick.set_item_text(i, "%s (%d layers)" % [tl.get("name", "Timeline"), (tl.get("layers", []) as Array).size()])


func _btn(text: String, tip: String, cb: Callable) -> Button:
	var b := Button.new()
	b.text = text
	b.tooltip_text = tip
	b.pressed.connect(cb)
	return b


func _check(text: String, tip: String) -> CheckBox:
	var c := CheckBox.new()
	c.text = text
	c.tooltip_text = tip
	c.toggled.connect(func(_on: bool) -> void:
		var tl := active()
		if not tl.is_empty():
			tl["sendTo"] = _send_to()
			ProjectSync.mark_dirty())
	return c
