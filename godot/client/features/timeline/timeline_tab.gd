extends VBoxContainer
## WO-602 — Timeline tab, slice 1 (web timeline-editor.js + timeline-transport.js + -playback.js): pick / create a
## timeline, the canvas (timeline_view.gd), transport (play from the playhead / pause / stop / seek), PRV / PGM send-to,
## SMPTE readout and a playhead that follows the server (`timeline.tick` extrapolated with the web's 80 / 35 ms rules,
## `timeline.playback` for play state). Timelines live in `project.timelines` (autosave, same JSON as the web) and are
## pushed to the engine before transport (PUT /api/timelines/:id, POST when missing) like the web's syncToServer.
## Editing (clip move/resize, keyframes, flags, drops) comes in later slices.

const TM := preload("res://features/timeline/timeline_math.gd")
const TimelineView := preload("res://features/timeline/timeline_view.gd")
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
	add_child(view)
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
