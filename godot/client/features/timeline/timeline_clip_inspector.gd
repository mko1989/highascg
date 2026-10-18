extends VBoxContainer
## WO-602 slice 2 — timeline clip page for the global Inspector (web inspector-panel-timeline-clip.js, same order):
## "<label> · Layer N", Position (SMPTE / ++500 / plain ms, inspector-panel-timeline-shared.js), Clip → Loop always,
## Audio → route / mute / volume (routes from /api/scene/layer-options for the timeline's screen), Mixer → Opacity %,
## Trim → In-point (frames). Transform + keyframes come in a later slice. Emits patches; the tab applies and syncs:
## kind "commit" syncs now, "throttle" is the web's 80 ms trailing geometry sync, "route" syncs then re-seeks so the
## engine re-applies the route on the playing timeline.

signal patch(changes: Dictionary, kind: String)
signal remove_requested

const TM := preload("res://features/timeline/timeline_math.gd")
const X := preload("res://features/live/mixer_math.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")

var _clip: Dictionary = {}
var _fps := 25
var _max_ms := 999999.0
var _main := -1
var _routes: Array = []
var _syncing := false
var _title: Label
var _pos: LineEdit
var _pos_ms: Label
var _loop: CheckBox
var _route: OptionButton
var _mute: CheckBox
var _vol: HSlider
var _vol_db: Label
var _op: SpinBox
var _in: SpinBox


func _ready() -> void:
	add_theme_constant_override("separation", 4)
	_title = Label.new()
	_title.add_theme_font_size_override("font_size", 15)
	_title.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	add_child(_title)
	var g := _group("")
	_pos = LineEdit.new()
	_pos.tooltip_text = "SMPTE (HH:MM:SS:FF), ++500 / --500 offset, or plain ms"
	_pos.custom_minimum_size.x = 130
	_pos.text_submitted.connect(func(_t: String) -> void: _commit_pos())
	_pos.focus_exited.connect(_commit_pos)
	var pr := HBoxContainer.new()
	pr.add_child(_pos)
	_pos_ms = Label.new()
	_pos_ms.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	pr.add_child(_pos_ms)
	_row(g, "Position", pr)
	g = _group("Clip")
	_loop = CheckBox.new()
	_loop.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	_loop.tooltip_text = "Loop this clip on the layer while the playhead is on it, including when the timeline is paused (Caspar LOOP)."
	_loop.toggled.connect(func(on: bool) -> void: _emit({"loopAlways": on, "loop": false}, "commit"))
	_row(g, "Loop always", _loop)
	g = _group("Audio")
	_route = OptionButton.new()
	_route.item_selected.connect(func(i: int) -> void:
		if i >= 0 and i < _routes.size():
			_emit({"audioRoute": str(_routes[i].value)}, "route"))
	_row(g, "Route", _route)
	_mute = CheckBox.new()
	_mute.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	_mute.toggled.connect(func(on: bool) -> void: _emit({"muted": on}, "commit"))
	_row(g, "Mute", _mute)
	var vr := HBoxContainer.new()
	_vol = HSlider.new()
	_vol.max_value = 100
	_vol.custom_minimum_size.x = 160
	_vol.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	_vol.value_changed.connect(func(p: float) -> void:
		_vol_db.text = X.format_db(X.fader_to_gain(p))
		_emit({"volume": X.fader_to_gain(p)}, "throttle"))
	vr.add_child(_vol)
	_vol_db = Label.new()
	_vol_db.custom_minimum_size.x = 70
	vr.add_child(_vol_db)
	_row(g, "Volume", vr)
	g = _group("Mixer")
	_op = _spin(0, 100, func(v: float) -> void: _emit({"opacity": clampf(v / 100.0, 0.0, 1.0)}, "throttle"))
	_row(g, "Opacity %", _op)
	g = _group("Trim")
	_in = _spin(0, 999999, func(v: float) -> void: _emit({"inPoint": maxi(0, roundi(v))}, "throttle"))
	_in.tooltip_text = "Frames skipped from the start of the media on take/seek."
	_row(g, "In-point (frames)", _in)
	var del := Button.new()
	del.text = "Remove clip"
	del.tooltip_text = "Remove this clip from the timeline (Delete)"
	del.pressed.connect(func() -> void: remove_requested.emit())
	add_child(HSeparator.new())
	add_child(del)


## Show `clip` of layer `li`; `main` is the timeline's sendTo screen (route list source).
func show_clip(tl: Dictionary, li: int, clip: Dictionary, main: int) -> void:
	_clip = clip
	_fps = int(tl.get("fps", 25))
	_max_ms = float(tl.get("duration", 999999))
	if main != _main:
		_main = main
		var res: Dictionary = await Api.get_json("/api/scene/layer-options?mainIdx=%d" % main)
		_routes = res.data.get("audioRoutes", []) if res.ok and res.data is Dictionary else []
		if not is_same(_clip, clip):
			return  # another clip was selected while the routes loaded
	var src: Dictionary = clip.get("source", {}) if clip.get("source") is Dictionary else {}
	_title.text = "%s  (Layer %d)" % [str(src.get("label", "")) if str(src.get("label", "")) != "" else str(src.get("value", "Clip")), li + 1]
	refresh()


## Re-read the clip (after a canvas drag) without emitting.
func refresh() -> void:
	if _clip.is_empty():
		return
	_syncing = true
	var st := float(_clip.get("startTime", 0))
	if not _pos.has_focus():
		_pos.text = TM.fmt_smpte(st, _fps)
	_pos_ms.text = "%d ms" % roundi(st)
	_loop.button_pressed = _clip.get("loopAlways") == true or _clip.get("loop") == true
	_route.clear()
	var cur := str(_clip.get("audioRoute", "1+2"))
	for r in _routes:
		_route.add_item(str(r.get("label", r.get("value"))))
	_route.select(maxi(0, _routes.map(func(r: Dictionary) -> String: return str(r.value)).find(cur)) if not _routes.is_empty() else -1)
	_mute.button_pressed = _clip.get("muted") == true
	var vol := float(_clip.get("volume", 1.0)) if _clip.get("volume") != null else 1.0
	_vol.value = X.gain_to_fader(vol)
	_vol_db.text = X.format_db(vol)
	_op.value = clampf(roundf(float(_clip.get("opacity", 1.0) if _clip.get("opacity") != null else 1.0) * 100.0), 0, 100)
	_in.value = maxi(0, roundi(float(_clip.get("inPoint", 0) if _clip.get("inPoint") != null else 0)))
	_syncing = false


func _commit_pos() -> void:
	if _clip.is_empty() or _syncing:
		return
	var st := float(_clip.get("startTime", 0))
	var v: Variant = TM.parse_tc(_pos.text, st, _max_ms, _fps)
	if v == null:
		_pos.text = TM.fmt_smpte(st, _fps)
		return
	var ms := clampf(float(v), 0.0, _max_ms)
	_pos.text = TM.fmt_smpte(ms, _fps)
	_pos_ms.text = "%d ms" % roundi(ms)
	if ms != st:
		_emit({"startTime": ms}, "commit")


func _emit(p: Dictionary, kind: String) -> void:
	if not _syncing and not _clip.is_empty():
		patch.emit(p, kind)


func _group(title: String) -> GridContainer:
	if title != "":
		var l := Label.new()
		l.text = title
		l.add_theme_color_override("font_color", ThemeBuilder.ACCENT)
		add_child(l)
	var g := GridContainer.new()
	g.columns = 2
	g.add_theme_constant_override("h_separation", 10)
	add_child(g)
	return g


func _row(g: GridContainer, label: String, c: Control) -> void:
	var l := Label.new()
	l.text = label
	l.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	g.add_child(l)
	g.add_child(c)


func _spin(lo: float, hi: float, cb: Callable) -> SpinBox:
	var s := SpinBox.new()
	s.min_value = lo
	s.max_value = hi
	s.step = 1
	s.value_changed.connect(func(v: float) -> void:
		if not _syncing:
			cb.call(v))
	return s
