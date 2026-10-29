extends VBoxContainer
## WO-601 — screen-timer inspector (web inspector-screen-timer.js + timer-control-panel-settings-form.js), opened
## from a deck column's ⏱. One section per timer on the screen: live readout (250 ms, server clock), Start / Pause /
## Reset, Show/Hide (cut), Fade In/Out (25 fr), opacity, the full settings form (position + px apply at once, the
## rest on Save — to every screen the timer is on), Remove from screen; "+ Add timer". All state is the server's
## (/api/timers/*); the list reloads after every action and every 5 s while no field has focus.

signal closed

const T := preload("res://features/live/screen_timer_model.gd")
const SettingsForm := preload("res://features/live/screen_timer_settings.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const Icons := preload("res://app/ui_icons.gd")

var screen_idx := 0
var screen_label := ""
var _records: Array = []
var _offset_ms := 0.0  # server clock − local clock
var _title: Label
var _list: VBoxContainer
var _readouts := {}  # timerId → Label
var _tick: Timer
var _poll: Timer


func _ready() -> void:
	add_theme_constant_override("separation", 6)
	var head := HBoxContainer.new()
	_title = Label.new()
	_title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(_title)
	var x := Button.new()
	x.text = "✕"
	x.pressed.connect(func() -> void:
		visible = false
		closed.emit())
	head.add_child(x)
	add_child(head)
	_list = VBoxContainer.new()  # no own scroll: the page lives in the Inspector column, which scrolls (WO-608 R2)
	_list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	add_child(_list)
	var add := Button.new()
	add.text = "＋ Add timer"
	add.pressed.connect(_add_timer)
	add_child(add)
	_tick = _timer(T.TICK_MS / 1000.0, _update_readouts)
	_poll = _timer(5.0, func() -> void:
		if visible and get_viewport().gui_get_focus_owner() == null:
			reload())


func _timer(sec: float, cb: Callable) -> Timer:
	var tm := Timer.new()
	tm.wait_time = sec
	tm.timeout.connect(cb)
	add_child(tm)
	tm.start()
	return tm


func open(idx: int, label: String) -> void:
	screen_idx = idx
	screen_label = label
	_title.text = "Timers — %s" % label
	visible = true
	await reload()


func reload() -> void:
	var res: Dictionary = await Api.get_json("/api/timers/list")
	for c in _list.get_children():
		c.queue_free()
	_readouts.clear()
	if not (res.ok and res.data is Dictionary and res.data.get("timers") is Array):
		_list.add_child(_muted("Failed to load timers: %s" % res.get("error", "")))
		return
	if float(res.data.get("serverNowMs", 0)) > 0:
		_offset_ms = float(res.data.serverNowMs) - Time.get_unix_time_from_system() * 1000.0
	_records = T.on_screen(res.data.timers, screen_idx)
	if _records.is_empty():
		_list.add_child(_muted("No timer on this screen yet."))
	for rec in _records:
		_list.add_child(_section(rec))
	_update_readouts()


func _update_readouts() -> void:
	if not visible:
		return
	var now_ms := Time.get_unix_time_from_system() * 1000.0 + _offset_ms
	var d := Time.get_datetime_dict_from_system()  # local
	var sod := float(d.hour * 3600 + d.minute * 60 + d.second) + fmod(now_ms, 1000.0) / 1000.0
	for rec in _records:
		var l: Label = _readouts.get(str(rec.get("timerId", "")))
		if l == null:
			continue
		var rem := T.display_time(rec, now_ms, sod)
		l.text = T.format(rem)
		var st := T.state(rec, rem)
		l.add_theme_color_override("font_color", ThemeBuilder.ERROR if st == "red" else (Color("#ffb300") if st == "amber" else ThemeBuilder.TEXT))


func _section(rec: Dictionary) -> Control:
	var id := str(rec.get("timerId", ""))
	var entry: Dictionary = rec.screens[str(screen_idx)] if rec.screens[str(screen_idx)] is Dictionary else {}
	var cfg := T.DEFAULTS.duplicate()
	cfg.merge(rec.get("config", {}) if rec.get("config") is Dictionary else {}, true)
	var box := VBoxContainer.new()
	var head := HBoxContainer.new()
	var nm := Label.new()
	nm.text = str(rec.get("name", "")) if str(rec.get("name", "")) != "" else "Timer %s" % id.left(8)
	nm.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(nm)
	var ro := Label.new()
	ro.add_theme_font_size_override("font_size", 18)
	head.add_child(ro)
	_readouts[id] = ro
	box.add_child(head)
	var tr := HBoxContainer.new()
	for cmd in ["start", "pause", "reset"]:  # icons: the box has no ⏸ glyph (WO-621)
		var b := Icons.button({"start": "play"}.get(cmd, cmd), cmd.capitalize())
		b.pressed.connect(func() -> void: _post("/api/timers/cmd", {"timerId": id, "cmd": cmd}))
		tr.add_child(b)
	var vis: bool = entry.get("visible") == true
	tr.add_child(_btn("Hide" if vis else "Show", "Cut", func() -> void: _visible(id, not vis, 0)))
	tr.add_child(_btn("Fade In", "", func() -> void: _visible(id, true, T.FADE_FRAMES)))
	tr.add_child(_btn("Fade Out", "", func() -> void: _visible(id, false, T.FADE_FRAMES)))
	box.add_child(tr)
	var g := GridContainer.new()
	g.columns = 2
	box.add_child(g)
	g.add_child(_muted("Opacity"))
	var op := HSlider.new()
	op.max_value = 100
	op.custom_minimum_size.x = 160
	op.value = roundf((float(entry.get("opacity", 1.0)) if entry.get("opacity") is float or entry.get("opacity") is int else 1.0) * 100.0)
	op.tooltip_text = "%d%%" % int(op.value)
	op.drag_ended.connect(func(_c: bool) -> void:
		op.tooltip_text = "%d%%" % int(op.value)
		_visible(id, vis, 0, op.value / 100.0))
	g.add_child(op)
	SettingsForm.build(g, box, cfg, true, func(patch: Dictionary) -> void: _apply(rec, patch))  # WO-806: shared form, extended
	var rm := _btn("Remove from screen", "CG CLEAR on its layer", func() -> void: _confirm_remove(id))
	box.add_child(rm)
	box.add_child(HSeparator.new())
	return box


## saveTimerConfigPatch: the merged config, assigned again on every screen the timer is on.
func _apply(rec: Dictionary, patch: Dictionary) -> void:
	var cfg: Dictionary = (rec.get("config", {}) as Dictionary).duplicate() if rec.get("config") is Dictionary else {}
	cfg.merge(patch, true)
	rec["config"] = cfg
	for k in (rec.get("screens", {}) as Dictionary).keys():
		await Api.post_json("/api/timers/assign", {"timerId": rec.timerId, "screenIdx": int(k), "config": cfg})
	await reload()


func _visible(id: String, on: bool, fade: int, opacity := -1.0) -> void:
	var body := {"timerId": id, "screenIdx": screen_idx, "visible": on}
	if fade > 0:
		body["fadeFrames"] = fade
	if opacity >= 0.0:
		body["opacity"] = opacity
	await _post("/api/timers/visible", body)


func _post(path: String, body: Dictionary) -> void:
	await Api.post_json(path, body)
	await reload()


func _add_timer() -> void:
	var id := "timer-%d-%d" % [int(Time.get_unix_time_from_system() * 1000.0), randi() % 1000000]
	await _post("/api/timers/assign", {"timerId": id, "name": T.new_name(screen_label, _records.size()), "config": T.DEFAULTS.duplicate(), "screenIdx": screen_idx})


func _confirm_remove(id: String) -> void:
	var dlg := ConfirmationDialog.new()
	dlg.dialog_text = "Remove this timer from the screen?"
	dlg.confirmed.connect(func() -> void: _post("/api/timers/unassign", {"timerId": id, "screenIdx": screen_idx}))
	dlg.visibility_changed.connect(func() -> void:
		if not dlg.visible:
			dlg.queue_free())
	add_child(dlg)
	dlg.popup_centered()


func _btn(text: String, tip: String, cb: Callable) -> Button:
	var b := Button.new()
	b.text = text
	b.tooltip_text = tip
	b.pressed.connect(cb)
	return b


func _muted(text: String) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	return l
