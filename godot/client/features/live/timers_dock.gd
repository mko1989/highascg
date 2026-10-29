extends VBoxContainer
## WO-806 — the Timers footer section (web timer-control-panel.js, the owner's "compact timer"), under Playlists at
## the bottom of the Inspector on every tab. Every screen timer from GET /api/timers/list (polled 1 s while open), its
## readout (ticks 4×/s on the server clock), ▶ ⏸ ⟲ (POST /api/timers/cmd), the standing Time / Target field
## (POST /api/timers/assign per assigned screen), one chip per screen whose eye fades it in / out (25 frames), and ⚙
## with the SHORT settings form (WO-567). A live controller only (WO-381): no create, assign or remove — those stay in
## the screen-timer Inspector page (a deck column's ⏱). Open / closed is remembered for this session (owner 29.10).

const M := preload("res://features/live/timers_dock_model.gd")
const T := preload("res://features/live/screen_timer_model.gd")
const Form := preload("res://features/live/screen_timer_settings.gd")
const DeckModel := preload("res://features/live/deck_model.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const Icons := preload("res://app/ui_icons.gd")
const POLL_S := 1.0
const MAX_H := 280.0  # the section never pushes the Inspector pages off the column

static var session_open := false

var timers: Array = []
var _offset_ms := 0.0  # server clock − local clock
var _shape := ""
var _toggle: Button
var _count: Label
var _scroll: ScrollContainer
var _list: VBoxContainer
var _readouts := {}  # timerId → Label
var _forms_open := {}  # timerId → true: ⚙ forms kept open across a rebuild
var _poll: Timer
var _tick: Timer


func _ready() -> void:
	add_theme_constant_override("separation", 4)
	var head := HBoxContainer.new()
	_toggle = Button.new()
	_toggle.flat = true
	_toggle.alignment = HORIZONTAL_ALIGNMENT_LEFT
	_toggle.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_toggle.tooltip_text = "Screen timers — start / pause / reset, time, fade on each screen. Add or remove a timer with a deck column's timer button."
	_toggle.pressed.connect(func() -> void: set_open(not _scroll.visible))
	head.add_child(_toggle)
	_count = Label.new()
	_count.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	head.add_child(_count)
	add_child(head)
	_scroll = ScrollContainer.new()
	_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	add_child(_scroll)
	_list = VBoxContainer.new()
	_list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_list.add_theme_constant_override("separation", 4)
	_list.minimum_size_changed.connect(_fit)
	_scroll.add_child(_list)
	_poll = _timer(POLL_S, refresh)
	_tick = _timer(T.TICK_MS / 1000.0, tick_readouts)
	set_open(session_open)


func _timer(sec: float, cb: Callable) -> Timer:
	var tm := Timer.new()
	tm.wait_time = sec
	tm.timeout.connect(cb)
	add_child(tm)
	return tm


func set_open(open: bool) -> void:
	session_open = open
	_scroll.visible = open
	_toggle.text = ("▾ " if open else "▸ ") + "Timers"
	if open:
		_poll.start()
		_tick.start()
		refresh()
	else:
		_poll.stop()
		_tick.stop()


## The scroll takes the list's height up to MAX_H.
func _fit() -> void:
	_scroll.custom_minimum_size.y = minf(_list.get_combined_minimum_size().y, MAX_H)


func refresh() -> void:
	var res: Dictionary = await Api.get_json("/api/timers/list")
	if not (res.get("ok", false) and res.get("data") is Dictionary and res.data.get("timers") is Array):
		return
	if float(res.data.get("serverNowMs", 0)) > 0:
		_offset_ms = float(res.data.serverNowMs) - Time.get_unix_time_from_system() * 1000.0
	apply_list(res.data.timers)


## A fresh list: rows rebuild when their shape changed, never while a field down here has focus (WO-381 — the poll
## would wipe a time being typed); readouts tick off the new records either way.
func apply_list(list: Variant) -> void:
	timers = M.rows(list)
	_count.text = str(timers.size()) if not timers.is_empty() else ""
	var sh := M.shape(timers)
	if sh != _shape and not editing():
		_shape = sh
		_render()
	tick_readouts()


func editing() -> bool:
	var f := get_viewport().gui_get_focus_owner() if is_inside_tree() else null
	return f != null and is_ancestor_of(f) and (f is LineEdit or f is OptionButton or f is TextEdit)


func _render() -> void:
	for c in _list.get_children():
		_list.remove_child(c)
		c.queue_free()
	_readouts.clear()
	if timers.is_empty():
		var e := Label.new()
		e.text = "No screen timers — add one with a deck column's timer button."
		e.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		e.custom_minimum_size.x = 200
		e.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
		_list.add_child(e)
	for t in timers:
		_list.add_child(_row(t))


func tick_readouts() -> void:
	var now_ms := Time.get_unix_time_from_system() * 1000.0 + _offset_ms
	var d := Time.get_datetime_dict_from_system()  # clock mode counts to the local wall clock
	var sod := float(d.hour * 3600 + d.minute * 60 + d.second) + fmod(now_ms, 1000.0) / 1000.0
	for t in timers:
		var l: Label = _readouts.get(str(t.timerId))
		if l == null:
			continue
		var rem := T.display_time(t, now_ms, sod)
		l.text = T.format(rem)
		var st := T.state(t, rem)
		l.add_theme_color_override("font_color", ThemeBuilder.ERROR if st == "red" else (Color("#ffb300") if st == "amber" else ThemeBuilder.TEXT))


func _row(t: Dictionary) -> Control:
	var id := str(t.timerId)
	var card := PanelContainer.new()
	card.add_theme_stylebox_override("panel", ThemeBuilder.box(ThemeBuilder.BG_DARK, ThemeBuilder.BORDER, 1, 4))
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 3)
	card.add_child(v)
	var head := HBoxContainer.new()
	var nm := Label.new()
	nm.text = M.name_of(t)
	nm.tooltip_text = nm.text
	nm.clip_text = true
	nm.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	nm.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(nm)
	var ro := Label.new()
	ro.add_theme_font_size_override("font_size", 16)
	ro.tooltip_text = "Live readout — start / pause / reset go to every screen the timer is on"
	head.add_child(ro)
	_readouts[id] = ro
	var gear := Icons.button("cog", "Settings")
	gear.flat = true
	gear.toggle_mode = true
	head.add_child(gear)
	v.add_child(head)
	var ctl := HBoxContainer.new()
	for cmd in ["start", "pause", "reset"]:
		var b := Icons.button({"start": "play"}.get(cmd, cmd), cmd.capitalize())
		b.custom_minimum_size.x = 30
		b.pressed.connect(func() -> void: _post("/api/timers/cmd", M.cmd_body(id, cmd)))
		ctl.add_child(b)
	ctl.add_child(_time_field(t))
	v.add_child(ctl)
	var on := M.screens(t)
	if not on.is_empty():
		var chips := HFlowContainer.new()
		chips.add_theme_constant_override("h_separation", 6)
		var cm: Dictionary = Store.get_value("channelMap", {}) if Store.get_value("channelMap", {}) is Dictionary else {}
		for idx in on:
			chips.add_child(_chip(id, idx, DeckModel.screen_label(cm, idx), M.screen_visible(t, idx)))
		v.add_child(chips)
	var form := VBoxContainer.new()
	var g := GridContainer.new()
	g.columns = 2
	form.add_child(g)
	Form.build(g, form, _cfg(t), false, func(patch: Dictionary) -> void: _save(t, patch))
	form.visible = _forms_open.has(id)
	gear.set_pressed_no_signal(form.visible)
	gear.toggled.connect(func(open: bool) -> void:
		form.visible = open
		if open:
			_forms_open[id] = true
		else:
			_forms_open.erase(id))
	v.add_child(form)
	return card


static func _cfg(t: Dictionary) -> Dictionary:
	var cfg := T.DEFAULTS.duplicate()
	cfg.merge(t.get("config", {}) if t.get("config") is Dictionary else {}, true)
	return cfg


## WO-381: a standing Time / Target field — `90`, `5:00`, `01:30:00` (or maths, RULES.md); Enter or leaving commits,
## Escape and garbage put the stored value back; an unassigned timer's field is disabled (the save needs a screen).
func _time_field(t: Dictionary) -> Control:
	var h := HBoxContainer.new()
	h.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var l := Label.new()
	l.text = "Target" if M.is_clock(t) else "Time"
	l.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	h.add_child(l)
	var le := LineEdit.new()
	le.text = M.time_input_value(t)
	le.placeholder_text = "HH:MM:SS"
	le.select_all_on_focus = true  # RULES.md 1
	le.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	le.custom_minimum_size.x = 84
	le.tooltip_text = "Target time — HH:MM:SS" if M.is_clock(t) else "Duration — MM:SS or HH:MM:SS"
	if M.screens(t).is_empty():
		le.editable = false
		le.tooltip_text = "Assign this timer to a screen to set its time"
	var commit := func() -> void:
		var r := M.commit_time(t, le.text)
		le.text = r[0]
		if not (r[1] as Dictionary).is_empty():
			_save(t, r[1])
	le.text_submitted.connect(func(_s: String) -> void: le.release_focus())
	le.focus_exited.connect(commit)
	le.gui_input.connect(func(e: InputEvent) -> void:
		var k := e as InputEventKey
		if k and k.pressed and k.keycode == KEY_ESCAPE:
			le.text = M.time_input_value(t)
			le.accept_event()
			le.release_focus())
	h.add_child(le)
	return h


func _chip(id: String, idx: int, label: String, vis: bool) -> Control:
	var c := HBoxContainer.new()
	c.add_theme_constant_override("separation", 2)
	var l := Label.new()
	l.text = label
	c.add_child(l)
	var eye := Icons.button("eye" if vis else "eye_off", ("Fade out on %s" if vis else "Fade in on %s") % label)
	eye.flat = true
	eye.pressed.connect(func() -> void:
		await Api.post_json("/api/timers/visible", M.visible_body(id, idx, not vis))
		await get_tree().create_timer(M.FADE_REFRESH_S).timeout  # the eye flips on the settled state
		refresh())
	c.add_child(eye)
	return c


func _save(t: Dictionary, patch: Dictionary) -> void:
	for body in M.assign_bodies(t, patch):
		await Api.post_json("/api/timers/assign", body)
	_shape = ""  # show what the server stored
	refresh()


func _post(path: String, body: Dictionary) -> void:
	await Api.post_json(path, body)
	refresh()
