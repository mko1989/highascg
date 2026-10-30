extends VBoxContainer
## WO-601 — "Countdown / Timer" group (web inspector-countdown.js + -controller.js): binds the layer to a project
## timer instance (auto-created on first open), timer name, mode / duration / target time / format / thresholds /
## position (+ px override) / hide / sizes / colours / aux lines, ▶ Start ⏸ Pause ⟲ Reset. Each edit patches
## `source.countdownConfig` + `cgData` at once; 450 ms later one CG set goes out (POST /api/scene/countdown) and the
## config propagates to the timer and every other layer bound to it (other looks: deck sync + autosave).

signal patch(p: Dictionary)

const C := preload("res://features/live/countdown_model.gd")
const P := preload("res://features/live/pip_model.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const Icons := preload("res://app/ui_icons.gd")
const NumericField := preload("res://core/numeric_field.gd")

var _scene_id := ""
var _main := 0
var _layer: Dictionary = {}
var _index := -1
var _key := ""
var _cfg: Dictionary = {}
var _timer_id := ""
var _debounce: Timer
var _w := {}
var _status: Label


func _ready() -> void:
	_debounce = Timer.new()
	_debounce.one_shot = true
	_debounce.wait_time = C.UPDATE_DEBOUNCE_MS / 1000.0
	_debounce.timeout.connect(_flush)
	add_child(_debounce)


static func applies(layer: Dictionary) -> bool:
	return C.is_countdown(layer.get("source"))


func _root() -> Dictionary:
	if not (Store.project.get("scenes") is Dictionary):
		Store.project["scenes"] = {}
	return Store.project.scenes


func show_layer(scene_id: String, main_idx: int, layer: Dictionary, index: int) -> void:
	_scene_id = scene_id
	_main = main_idx
	_layer = layer
	_index = index
	visible = applies(layer)
	var key := "%s|%s|%s" % [scene_id, layer.get("layerNumber", ""), (layer.get("source", {}) as Dictionary).get("value", "") if visible else ""]
	if key == _key:
		return  # echo of our own edit
	if not _debounce.is_stopped():
		_debounce.stop()
		_flush()
	_key = key
	for c in get_children():
		if c != _debounce:
			c.queue_free()
	_w.clear()
	if visible:
		_bind_timer()
		_build()


## WO-208 T208.2: first use creates a timer instance and binds the layer (source.countdownTimerId + label).
func _bind_timer() -> void:
	_cfg = C.config_of(_layer)
	var src: Dictionary = _layer.source
	_timer_id = str(src.get("countdownTimerId", ""))
	if _timer_id != "" and not C.find_timer(_root(), _timer_id).is_empty():
		return
	var tm := C.new_timer(_layer, _main, int(Time.get_unix_time_from_system() * 1000.0), _rand7())
	C.timers(_root()).append(tm)
	_timer_id = tm.id
	var s2 := src.duplicate(true)
	s2["countdownTimerId"] = _timer_id
	s2["label"] = tm.name
	patch.emit({"source": s2})
	ProjectSync.mark_dirty()


static func _rand7() -> String:
	var chars := "0123456789abcdefghijklmnopqrstuvwxyz"
	var out := ""
	for i in 7:
		out += chars[randi() % chars.length()]
	return out


func _build() -> void:
	add_child(_muted("Countdown / Timer — identity = screen + layer number"))
	var g := GridContainer.new()
	g.columns = 2
	add_child(g)
	var name_edit := _line(g, "Timer name", str(C.find_timer(_root(), _timer_id).get("name", "")), "Timer name", Callable())
	name_edit.text_submitted.connect(func(t: String) -> void: _rename(t))
	name_edit.focus_exited.connect(func() -> void: _rename(name_edit.text))
	_option(g, "Mode", C.MODES, str(_cfg.mode), func(v: String) -> void:
		_change({"mode": v})
		_sync_mode())
	g.add_child(_muted("Duration"))
	var hms := HBoxContainer.new()
	var parts := C.secs_to_hms(float(_cfg.durationSec))
	for i in 3:
		var sp := SpinBox.new()
		sp.max_value = 99 if i == 0 else 59
		sp.value = parts[i]
		sp.suffix = ["h", "m", "s"][i]
		sp.value_changed.connect(func(_v: float) -> void: _change({"durationSec": C.hms_to_secs(_w.h.value, _w.m.value, _w.s.value)}))
		hms.add_child(sp)
		_w[["h", "m", "s"][i]] = sp
	g.add_child(hms)
	_w["dur_row"] = [g.get_child(g.get_child_count() - 2), hms]
	var target := _line(g, "Target time", str(_cfg.targetTime), "18:00:00", func(t: String) -> void: _change({"targetTime": t}))
	_w["target_row"] = [g.get_child(g.get_child_count() - 2), target]
	_option(g, "Display format", C.FORMATS, str(_cfg.format), func(v: String) -> void: _change({"format": v}))
	_spin(g, "Amber at (s)", "amberThresholdSec", 0, 86400, 1)
	_spin(g, "Red at (s)", "redThresholdSec", 0, 86400, 1)
	_option(g, "Position", C.POSITIONS, str(_cfg.position), func(v: String) -> void: _change({"position": v}))
	for axis in ["posX", "posY"]:
		var k: String = axis
		# WO-839: numbers only. The field commits on Enter / focus-out (math_line rewrites the text first: a number or a
		# complete expression, else the previous value; blank = back to the preset is a real state here).
		var le := _line(g, "Position px %s" % k.right(1), str(_cfg.get(k, "")), "empty = preset", Callable())
		NumericField.math_line(le, true, -INF, INF, Callable(), true)
		var commit_px := func(_t: Variant = null) -> void:
			var v: Variant = "" if le.text.strip_edges() == "" else roundi(le.text.to_float())
			var cur: Variant = _cfg.get(k, "")
			if (v is int and (cur is int or cur is float) and int(cur) == v) or (v is String and str(cur) == v):
				return
			_change({k: v})
		le.text_submitted.connect(commit_px)
		le.focus_exited.connect(commit_px)
	g.add_child(_muted("Hide timer"))
	var hide := CheckBox.new()
	hide.text = "show middle aux line instead"
	hide.button_pressed = _cfg.hideTimer == true
	hide.toggled.connect(func(on: bool) -> void: _change({"hideTimer": on}))
	g.add_child(hide)
	_spin(g, "Timer size (vw)", "timerFontSize", 1, 100, 0.1)
	_spin(g, "Aux size (vw)", "auxFontSize", 1, 50, 0.1)
	for c in [["timerColor", "Normal"], ["amberColor", "Amber"], ["redColor", "Red"], ["auxColor", "Aux text"]]:
		g.add_child(_muted(c[1]))
		var cp := ColorPickerButton.new()
		cp.edit_alpha = false
		cp.custom_minimum_size = Vector2(60, 24)
		cp.color = P.parse_css(str(_cfg.get(c[0], C.DEFAULTS[c[0]])))
		var k: String = c[0]
		cp.color_changed.connect(func(col: Color) -> void: _change({k: P.to_css(col)}))
		g.add_child(cp)
	for a in [["auxTop", "Aux line — top"], ["auxMiddle", "Aux line — middle"], ["auxBottom", "Aux line — bottom"]]:
		var k: String = a[0]
		_line(g, a[1], str(_cfg.get(k, "")), "", func(t: String) -> void: _change({k: t}))
	var row := HBoxContainer.new()
	for b in [["Start", "start", "play"], ["Pause", "pause", "pause"], ["Reset", "reset", "reset"]]:  # icons: no ⏸ glyph (WO-621)
		var btn := Icons.button(b[2], "")
		btn.text = b[0]
		var action: String = b[1]
		btn.pressed.connect(func() -> void: _transport(action))
		row.add_child(btn)
	_status = _muted("")
	row.add_child(_status)
	add_child(row)
	_sync_mode()


func _sync_mode() -> void:
	for c in _w.dur_row:
		c.visible = _cfg.mode == "duration"
	for c in _w.target_row:
		c.visible = _cfg.mode == "clock"


func _change(partial: Dictionary) -> void:
	_cfg.merge(partial, true)
	patch.emit(C.patch_for(_layer.get("source", {}), _cfg))
	_debounce.start()


## Debounced: CG set on the edit bus + timer config → every other bound layer.
func _flush() -> void:
	var changed := C.propagate(_root(), _timer_id, _cfg, _scene_id, _index)
	if not changed.is_empty():
		ProjectSync.deck_changed()
	ProjectSync.mark_dirty()
	await _post("set")


func _rename(t: String) -> void:
	var changed := C.rename(_root(), _timer_id, t)
	if changed.is_empty():
		return
	if changed.has(_scene_id):  # the edited layer's label rides the normal patch path
		var s2: Dictionary = (_layer.source as Dictionary).duplicate(true)
		s2["label"] = t.strip_edges()
		patch.emit({"source": s2})
	ProjectSync.deck_changed()
	ProjectSync.mark_dirty()


func _transport(action: String) -> void:
	if not _debounce.is_stopped():
		_debounce.stop()
		await _flush()
	var res := await _post(action)
	_status.text = action if res.ok and res.data is Dictionary and res.data.get("ok") == true else "%s failed" % action


func _post(action: String) -> Dictionary:
	return await Api.post_json("/api/scene/countdown", {"sceneId": _scene_id, "layerNumber": int(_layer.get("layerNumber", 0)), "mainIdx": _main, "action": action, "config": _cfg})


func _option(g: GridContainer, label: String, items: Array, cur: String, cb: Callable) -> void:
	g.add_child(_muted(label))
	var o := OptionButton.new()
	for it in items:
		o.add_item(str(it[1]))
	o.select(maxi(0, items.map(func(it: Array) -> String: return it[0]).find(cur)))
	o.item_selected.connect(func(i: int) -> void: cb.call(items[i][0]))
	g.add_child(o)


func _spin(g: GridContainer, label: String, key: String, lo: float, hi: float, step: float) -> void:
	g.add_child(_muted(label))
	var sp := SpinBox.new()
	sp.min_value = lo
	sp.max_value = hi
	sp.step = step
	sp.value = float(_cfg.get(key, C.DEFAULTS.get(key, 0)))
	sp.value_changed.connect(func(v: float) -> void: _change({key: int(v) if v == floorf(v) else v}))
	g.add_child(sp)


func _line(g: GridContainer, label: String, text: String, placeholder: String, cb: Callable) -> LineEdit:
	g.add_child(_muted(label))
	var le := LineEdit.new()
	le.text = text
	le.placeholder_text = placeholder
	le.custom_minimum_size.x = 180
	if cb.is_valid():
		le.text_changed.connect(cb)
	g.add_child(le)
	return le


func _muted(text: String) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	return l
