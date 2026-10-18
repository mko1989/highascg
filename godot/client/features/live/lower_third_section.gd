extends VBoxContainer
## WO-601 — "Lower Third" group (web inspector-lower-third.js): title / subtitle / font / position / sizes / scale /
## hold / colours. Every edit patches `source.lowerThirdConfig` + `cgData` at once (lower_third_model.gd, web
## persistLocalConfig) and queues one CG UPDATE 450 ms later; ▶ Play flushes it, then animates in — or out when
## already playing on this layer; Delete removes the CG. Config resolution + actions: POST /api/scene/lower-third.
## Roster (web inspector-lower-third-roster.js) is not ported yet.

signal patch(p: Dictionary)

const LT := preload("res://features/live/lower_third_model.gd")
const P := preload("res://features/live/pip_model.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const NUMS := [["titleFontSize", "Title px", 8, 200, 1], ["subtitleFontSize", "Sub px", 8, 120, 1],
	["renderScale", "Scale %", 25, 300, 5], ["displayDurationSec", "Hold s", 0, 3600, 0.5]]

var _scene_id := ""
var _main := 0
var _layer: Dictionary = {}
var _key := ""
var _cfg: Dictionary = {}
var _timer: Timer
var _status: Label
var _busy := false


func _ready() -> void:
	_timer = Timer.new()
	_timer.one_shot = true
	_timer.wait_time = LT.UPDATE_DEBOUNCE_MS / 1000.0
	_timer.timeout.connect(_flush)
	add_child(_timer)


static func applies(layer: Dictionary) -> bool:
	return LT.is_lower_third(layer.get("source"))


func show_layer(scene_id: String, main_idx: int, layer: Dictionary) -> void:
	_scene_id = scene_id
	_main = main_idx
	_layer = layer
	visible = applies(layer)
	var key := "%s|%s|%s" % [scene_id, layer.get("layerNumber", ""), (layer.get("source", {}) as Dictionary).get("value", "") if visible else ""]
	if key == _key:
		return  # echo of our own edit — keep the fields (and the caret) as they are
	if not _timer.is_stopped():
		_timer.stop()
		_flush()
	_key = key
	for c in get_children():
		if c != _timer:
			c.queue_free()
	if visible:
		await _build()


func _post(action: String) -> Dictionary:
	return await Api.post_json("/api/scene/lower-third", {"sceneId": _scene_id, "layerNumber": int(_layer.get("layerNumber", 0)), "mainIdx": _main, "action": action, "config": _cfg})


func _build() -> void:
	var key := _key
	var res: Dictionary = await Api.post_json("/api/scene/lower-third", {"sceneId": _scene_id, "layerNumber": int(_layer.get("layerNumber", 0)), "action": "resolve"})
	if key != _key:
		return
	var info: Dictionary = res.data if res.ok and res.data is Dictionary else {}
	_cfg = LT.DEFAULTS.duplicate()
	_cfg.merge(info.get("config", {}) if info.get("config") is Dictionary else {}, true)
	add_child(_muted("Lower third — %s" % str(info.get("templateName", LT.template_id(str(_layer.source.value))))))
	var g := GridContainer.new()
	g.columns = 2
	add_child(g)
	for k in [["title", "Title", "Primary line"], ["subtitle", "Subtitle", "Secondary line"]]:
		g.add_child(_muted(k[1]))
		var le := LineEdit.new()
		le.text = str(_cfg.get(k[0], ""))
		le.placeholder_text = k[2]
		le.custom_minimum_size.x = 200
		var field: String = k[0]
		le.text_changed.connect(func(t: String) -> void: _change({field: t}))
		g.add_child(le)
	var fonts: Array = info.get("fonts", []) if info.get("fonts") is Array else [{"id": "arial", "label": "Arial"}]
	g.add_child(_muted("Font"))
	g.add_child(_select(fonts.map(func(f: Dictionary) -> String: return str(f.label)), fonts.map(func(f: Dictionary) -> String: return str(f.id)).find(str(_cfg.fontFamily).to_lower()),
		func(i: int) -> void: _change({"fontFamily": fonts[i].id})))
	g.add_child(_muted("Position"))
	g.add_child(_select(["Left", "Center", "Right"], LT.POSITIONS.find(str(_cfg.position)), func(i: int) -> void: _change({"position": LT.POSITIONS[i]})))
	for n in NUMS:
		g.add_child(_muted(n[1]))
		var sp := SpinBox.new()
		sp.min_value = n[2]
		sp.max_value = n[3]
		sp.step = n[4]
		sp.value = float(_cfg.get(n[0], LT.DEFAULTS[n[0]]))
		var field: String = n[0]
		sp.value_changed.connect(func(v: float) -> void: _change({field: LT._jsv(v)}))
		g.add_child(sp)
	for c in [["textColor", "Text"], ["primaryColor", "Accent"]]:
		g.add_child(_muted(c[1]))
		var cp := ColorPickerButton.new()
		cp.edit_alpha = false
		cp.custom_minimum_size = Vector2(60, 24)
		cp.color = P.parse_css(str(_cfg.get(c[0], LT.DEFAULTS[c[0]])))
		var field: String = c[0]
		cp.color_changed.connect(func(col: Color) -> void: _change({field: P.to_css(col)}))
		g.add_child(cp)
	var row := HBoxContainer.new()
	var play := Button.new()
	play.text = "▶ Play"
	play.tooltip_text = "Animate in (or out if already playing on this layer)"
	play.pressed.connect(func() -> void: _act("play"))
	row.add_child(play)
	var del := Button.new()
	del.text = "Delete"
	del.tooltip_text = "Remove the CG from the output"
	del.pressed.connect(func() -> void: _act("clear"))
	row.add_child(del)
	_status = _muted("")
	row.add_child(_status)
	add_child(row)


func _change(partial: Dictionary) -> void:
	_cfg.merge(partial, true)
	patch.emit(LT.patch_for(_layer.get("source", {}), _cfg))
	_timer.start()


func _flush() -> void:
	await _post("update")


func _act(action: String) -> void:
	if _busy:
		return
	_busy = true
	if not _timer.is_stopped():
		_timer.stop()
		await _flush()
	var res := await _post(action)
	var sent: Array = res.data.get("sent", []) if res.ok and res.data is Dictionary and res.data.get("sent") is Array else []
	_status.text = " → ".join(sent) if res.ok and res.data.get("ok") == true else "failed: %s" % str(res.data.get("reason", res.get("error", "")) if res.data is Dictionary else res.get("error", ""))
	_busy = false


func _select(items: Array, sel: int, cb: Callable) -> OptionButton:
	var o := OptionButton.new()
	for it in items:
		o.add_item(str(it))
	o.select(maxi(0, sel))
	o.item_selected.connect(cb)
	return o


func _muted(text: String) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	return l
