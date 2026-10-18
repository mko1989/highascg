extends HBoxContainer
## WO-602 — the timeline transport bar (web timeline-transport.js), split out of timeline_tab.gd in slice 7: timeline
## picker / rename / new, ⏮ ■ ▶ ⏭ and Loop, the current-time and duration fields (SMPTE, ++500 / --500), Trim, Flag,
## zoom − Fit +, Follow (Dest / PRV / PGM / Take: timeline_dest.gd, the row below), and the playback state per timeline: `timeline.tick` extrapolated with the web's
## 80 / 35 ms rules, `timeline.playback` for play / loop state, and the engine's /state read on a timeline switch
## (web syncPlaybackFromServer). Timelines are pushed to the engine before transport (PUT, POST when missing).

signal edited  # duration / name changed here — the tab saves and syncs
signal flag_requested

const TM := preload("res://features/timeline/timeline_math.gd")
const N := preload("res://features/timeline/timeline_nav.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")

var tab: Node  # timeline_tab.gd: active(), root(), view
var pb_last := ""  # timelineId of the latest timeline.playback (the web's state.timeline.playback)
var _pick: OptionButton
var _play: Button
var _loop: Button
var _cur: LineEdit
var _tot: LineEdit
var _ids: Array = []
var _pb := {}  # timelineId → {playing, loop, clock {pos, at}}
var _state_for := ""  # the timeline whose engine state was last read


func _ready() -> void:
	add_theme_constant_override("separation", 6)
	_pick = OptionButton.new()
	_pick.custom_minimum_size.x = 200
	_pick.item_selected.connect(func(i: int) -> void:
		if i >= 0 and i < _ids.size():
			tab.root()["activeId"] = _ids[i]
			ProjectSync.mark_dirty()
			tab.refresh()
			tab.dest.update_send_to())  # web: the next timeline's routing is posted on a switch
	add_child(_pick)
	add_child(_btn("✎", "Rename timeline", _rename))
	add_child(_btn("＋", "New timeline", _new_timeline))
	add_child(VSeparator.new())
	add_child(_btn("|◀", "To start", func() -> void: seek(0.0)))
	_play = _btn("▶", "Play / pause from the playhead (Space)", toggle_play)
	_play.custom_minimum_size.x = 40
	add_child(_play)
	add_child(_btn("■", "Stop (back to start)", stop))
	add_child(_btn("▶|", "To end", func() -> void: seek(float(tab.active().get("duration", 0)))))
	_loop = _btn("⟲", "Loop", _toggle_loop)
	_loop.toggle_mode = true
	add_child(_loop)
	_cur = _tc_field("Current time (Enter to focus). ++500 / --500 for jump", _commit_cur)
	add_child(_cur)
	var sep := Label.new()
	sep.text = "/"
	sep.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	add_child(sep)
	_tot = _tc_field("Total duration", _commit_tot)
	add_child(_tot)
	add_child(VSeparator.new())
	add_child(_btn("Trim", "Trim duration to last clip", _trim))
	add_child(_btn("Flag", "Add timeline flag at playhead (pause / play / jump)", func() -> void: flag_requested.emit()))
	add_child(_btn("−", "Zoom out", func() -> void: tab.view.zoom_step(-1)))
	add_child(_btn("Fit", "Fit to view", func() -> void: tab.view.fit()))
	add_child(_btn("+", "Zoom in", func() -> void: tab.view.zoom_step(1)))
	var fol := _btn("Follow", "Follow playhead", func() -> void: pass)
	fol.toggle_mode = true
	fol.button_pressed = true
	fol.toggled.connect(func(on: bool) -> void: tab.view.follow = on)
	add_child(fol)
	Ws.on("timeline.tick", _on_tick)
	Ws.on("timeline.playback", _on_playback)


## The picker, the Dest row, the fields; reads the engine state on a timeline switch.
func refresh() -> void:
	var tl: Dictionary = tab.active()
	_ids.clear()
	_pick.clear()
	for t in tab.root().timelines:
		if t is Dictionary:
			_ids.append(str(t.get("id", "")))
			_pick.add_item(_label(t))
	_pick.select(_ids.find(str(tl.get("id", ""))))
	_pick.disabled = _ids.is_empty()
	tab.dest.refresh()
	status("" if not tl.is_empty() else "No timeline in this project — ＋ creates one.")
	sync()
	if not tl.is_empty() and str(tl.id) != _state_for:
		_state_for = str(tl.id)
		_read_state(tl)


func refresh_picker() -> void:
	var tl: Dictionary = tab.active()
	var i := _ids.find(str(tl.get("id", "")))
	if i >= 0:
		_pick.set_item_text(i, _label(tl))


func status(text: String) -> void:
	tab.dest.status(text)


## Play / loop state and the time fields (a focused field is left alone while the operator types).
func sync() -> void:
	var tl: Dictionary = tab.active()
	var p := {} if tl.is_empty() else _pbk(str(tl.id))
	_play.text = "❚❚" if p.get("playing", false) else "▶"
	_loop.set_pressed_no_signal(p.get("loop", false))
	var fps := int(tl.get("fps", 25))
	if not _cur.has_focus():
		_cur.text = TM.fmt_smpte(tab.view.playhead_ms, fps) if not tl.is_empty() else "--:--:--:--"
	if not _tot.has_focus():
		_tot.text = TM.fmt_smpte(float(tl.get("duration", 0)), fps) if not tl.is_empty() else "--:--:--:--"


func is_playing(id: String) -> bool:
	return _pbk(id).playing


## Enter on the timeline (web): focus the current-time field with its text selected.
func focus_time() -> void:
	_cur.grab_focus()
	_cur.select_all()


func _label(t: Dictionary) -> String:
	return "%s (%d layers)" % [t.get("name", "Timeline"), (t.get("layers", []) as Array).size()]


func _pbk(id: String) -> Dictionary:
	if not _pb.has(id):
		_pb[id] = {"playing": false, "loop": false, "clock": {"pos": 0.0, "at": _now()}}
	return _pb[id]


static func _now() -> float:
	return Time.get_ticks_msec()


func _process(_d: float) -> void:
	var tl: Dictionary = tab.active()
	if tl.is_empty():
		return
	var p := _pbk(str(tl.id))
	if p.playing:
		tab.view.set_playhead(minf(TM.clock_ms(p.clock, _now()), float(tl.get("duration", 0))), true)
		if not _cur.has_focus():
			_cur.text = TM.fmt_smpte(tab.view.playhead_ms, int(tl.get("fps", 25)))


## web onTick: anchor the clock; an active timeline that ticks is playing
func _on_tick(data: Variant) -> void:
	if not (data is Dictionary) or str(data.get("timelineId", "")) == "":
		return
	var p := _pbk(str(data.timelineId))
	if data.get("position") is float or data.get("position") is int:
		p["clock"] = TM.apply_tick(p.clock, float(data.position), _now())
	if str(data.timelineId) == str(tab.active().get("id", "")) and not p.playing:
		p["playing"] = true
		sync()


## web onPlayback: play / loop state + anchored position
func _on_playback(pb: Variant) -> void:
	if not (pb is Dictionary) or str(pb.get("timelineId", "")) == "":
		return
	pb_last = str(pb.timelineId)
	if pb.get("sendTo") is Dictionary:
		tab.dest.adopt(pb_last, pb.sendTo)
	_adopt(pb, false)


func _adopt(pb: Dictionary, seek_view: bool) -> void:
	var p := _pbk(str(pb.timelineId))
	if pb.get("playing") is bool:
		p["playing"] = pb.playing
	if pb.get("loop") is bool:
		p["loop"] = pb.loop
	if pb.get("position") is float or pb.get("position") is int:
		p["clock"] = {"pos": float(pb.position), "at": _now()}
	if str(pb.timelineId) == str(tab.active().get("id", "")):
		if not p.playing or seek_view:
			tab.view.set_playhead(TM.clock_ms(p.clock, _now()), false)
		sync()


## web syncPlaybackFromServer: the engine's state for this timeline; a timeline the engine lacks is pushed.
func _read_state(tl: Dictionary) -> void:
	var r: Dictionary = await Api.get_json("/api/timelines/%s/state" % str(tl.id).uri_encode())
	if r.ok and r.data is Dictionary and str(r.data.get("timelineId", "")) == str(tl.id):
		if r.data.get("playing") == true and r.data.get("sendTo") is Dictionary:  # playing: the engine's routing wins
			tab.dest.adopt(str(tl.id), r.data.sendTo)
		_adopt(r.data, true)
	elif not r.ok:
		await sync_to_server(tl)


func sync_to_server(tl: Dictionary) -> bool:
	var r: Dictionary = await Api.put_json("/api/timelines/%s" % str(tl.id).uri_encode(), tl)
	if not r.ok:
		r = await Api.post_json("/api/timelines", tl)
	return r.ok


func toggle_play() -> void:
	var tl: Dictionary = tab.active()
	if tl.is_empty():
		return
	var id := str(tl.id)
	var p := _pbk(id)
	if p.playing:
		p["playing"] = false
		p["clock"] = {"pos": tab.view.playhead_ms, "at": _now()}
		sync()
		await Api.post_json("/api/timelines/%s/pause" % id.uri_encode(), {})
		return
	var from := maxf(0.0, roundf(tab.view.playhead_ms))
	tl["sendTo"] = tab.dest.send_to()
	if not await sync_to_server(tl):
		status("Timeline sync to the server failed")
		return
	await Api.post_json("/api/timelines/%s/seek" % id.uri_encode(), {"ms": from})
	await Api.post_json("/api/timelines/%s/sendto" % id.uri_encode(), tl.sendTo)
	var r: Dictionary = await Api.post_json("/api/timelines/%s/play" % id.uri_encode(), {"from": from, "sendTo": tl.sendTo})
	if not r.ok:
		status("Play failed: %s" % r.error)
		return
	p["clock"] = {"pos": from, "at": _now()}
	p["playing"] = true
	status("")
	sync()


func stop() -> void:
	var tl: Dictionary = tab.active()
	if tl.is_empty():
		return
	var p := _pbk(str(tl.id))
	p["playing"] = false
	p["clock"] = {"pos": 0.0, "at": _now()}
	tab.view.set_playhead(0.0, false)
	sync()
	await Api.post_json("/api/timelines/%s/stop" % str(tl.id).uri_encode(), {"force": true})  # the operator's explicit Stop (WO-552)


## doSeek: playhead, clock, fields, then the engine.
func seek(ms: float) -> void:
	var tl: Dictionary = tab.active()
	if tl.is_empty():
		return
	tab.view.set_playhead(ms, true)
	_pbk(str(tl.id))["clock"] = {"pos": ms, "at": _now()}
	sync()
	await Api.post_json("/api/timelines/%s/seek" % str(tl.id).uri_encode(), {"ms": ms})


func _toggle_loop() -> void:
	var tl: Dictionary = tab.active()
	if tl.is_empty():
		return
	var p := _pbk(str(tl.id))
	p["loop"] = not p.loop
	sync()
	await Api.post_json("/api/timelines/%s/loop" % str(tl.id).uri_encode(), {"loop": p.loop})


func _commit_cur() -> void:
	var tl: Dictionary = tab.active()
	if tl.is_empty():
		return
	var v: Variant = TM.parse_tc(_cur.text, tab.view.playhead_ms, float(tl.get("duration", 0)), int(tl.get("fps", 25)))
	if v != null:
		seek(float(v))
	_cur.text = TM.fmt_smpte(tab.view.playhead_ms, int(tl.get("fps", 25)))


func _commit_tot() -> void:
	var tl: Dictionary = tab.active()
	if tl.is_empty():
		return
	var v: Variant = TM.parse_tc(_tot.text, 0.0, null, int(tl.get("fps", 25)))
	if v != null and float(v) >= 1000.0 and float(v) != float(tl.get("duration", 0)):
		tl["duration"] = float(v)
		edited.emit()
	_tot.text = TM.fmt_smpte(float(tl.get("duration", 0)), int(tl.get("fps", 25)))


func _trim() -> void:
	var tl: Dictionary = tab.active()
	var end := N.clips_end(tl)
	if end > 0:
		tl["duration"] = end
		edited.emit()


func _rename() -> void:
	var tl: Dictionary = tab.active()
	if tl.is_empty():
		return
	var dlg := ConfirmationDialog.new()
	dlg.title = "Rename timeline"
	var name_edit := LineEdit.new()
	name_edit.text = str(tl.get("name", ""))
	name_edit.custom_minimum_size.x = 280
	dlg.add_child(name_edit)
	dlg.register_text_enter(name_edit)
	dlg.confirmed.connect(func() -> void:
		if name_edit.text.strip_edges() != "":
			tl["name"] = name_edit.text.strip_edges()
			refresh_picker()
			edited.emit())
	dlg.visibility_changed.connect(func() -> void: if not dlg.visible: dlg.queue_free())
	add_child(dlg)
	dlg.popup_centered()
	name_edit.grab_focus()
	name_edit.select_all()


func _new_timeline() -> void:
	var r: Dictionary = tab.root()
	var tl := TM.default_timeline("Timeline %d" % ((r.timelines as Array).size() + 1) if not (r.timelines as Array).is_empty() else "Timeline")
	(r.timelines as Array).append(tl)
	r["activeId"] = tl.id
	ProjectSync.mark_dirty()
	tab.refresh()
	await sync_to_server(tl)
	tab.dest.update_send_to()  # web defaultTimelineSendTo: PRV-only, coerced for PGM-only screens


func _tc_field(tip: String, commit: Callable) -> LineEdit:
	var l := LineEdit.new()
	l.tooltip_text = tip
	l.custom_minimum_size.x = 118
	l.add_theme_font_size_override("font_size", 17)
	l.alignment = HORIZONTAL_ALIGNMENT_CENTER
	l.text_submitted.connect(func(_t: String) -> void: l.release_focus())  # web: Enter blurs, blur commits
	l.focus_exited.connect(commit)
	return l


func _btn(text: String, tip: String, cb: Callable) -> Button:
	var b := Button.new()
	b.text = text
	b.tooltip_text = tip
	b.focus_mode = Control.FOCUS_NONE  # Space is the play key, never a focused button's press
	b.pressed.connect(func() -> void:
		var fo := get_viewport().gui_get_focus_owner()
		if fo != null:
			fo.release_focus()  # a web button click blurs the field: a typed value commits, the keys work again
		cb.call())
	return b

