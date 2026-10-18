extends VBoxContainer
## WO-601 — "HTML template" group (web inspector-html-template.js): "Reload page" (server-resolved CALL RELOAD,
## POST /api/scene/layer-reload) and, for playback_timers.html, the Timers Config written to
## `source.timersConfig` (the template reads it from scene.live, which every preview push re-registers).

signal patch(p: Dictionary)

const LT := preload("res://features/live/lower_third_model.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
## web defaults when the source has no timersConfig yet
const TIMERS_DEFAULTS := {"showLayers": true, "showScreens": true, "columns": 2, "compact": false, "titleFontSize": 28,
	"clipFontSize": 20, "timeFontSize": 28, "elapsedFontSize": 20, "showLabels": true, "showProgress": true, "showElapsed": true}
const SIZES := [["titleFontSize", "Title size", 28], ["clipFontSize", "Clip size", 20], ["timeFontSize", "Timer size", 28], ["elapsedFontSize", "Elapsed size", 20]]
const TOGGLES := [["showScreens", "Show program screens"], ["showLayers", "Show active layers"], ["showLabels", "Show clip labels"],
	["showProgress", "Show progress bars"], ["showElapsed", "Show elapsed/total time"], ["compact", "Compact mode"]]

var _scene_id := ""
var _main := 0
var _layer: Dictionary = {}
var _key := ""
var _status: Label


## Shown for template/html sources that are not lower thirds; rebuilt only when the layer/source changes.
static func applies(layer: Dictionary) -> bool:
	var src: Variant = layer.get("source")
	return src is Dictionary and str(src.get("value", "")) != "" and str(src.get("type", "")) in ["template", "html"] and not LT.is_lower_third(src)


func show_layer(scene_id: String, main_idx: int, layer: Dictionary) -> void:
	_scene_id = scene_id
	_main = main_idx
	_layer = layer
	visible = applies(layer)
	var key := "%s|%s|%s" % [scene_id, layer.get("layerNumber", ""), (layer.get("source", {}) as Dictionary).get("value", "") if visible else ""]
	if key == _key:
		return
	_key = key
	for c in get_children():
		c.queue_free()
	if visible:
		_build()


func _build() -> void:
	var src: Dictionary = _layer.source
	add_child(_muted("HTML template — %s" % str(src.get("label", src.value))))
	var row := HBoxContainer.new()
	var reload := Button.new()
	reload.text = "Reload page"
	reload.tooltip_text = "CALL RELOAD on preview (and program if this look is on air)"
	reload.pressed.connect(_reload)
	row.add_child(reload)
	_status = _muted("")
	row.add_child(_status)
	add_child(row)
	if str(src.value).contains("playback_timers.html"):
		_build_timers(src.get("timersConfig") if src.get("timersConfig") is Dictionary else TIMERS_DEFAULTS)


func _reload() -> void:
	var res: Dictionary = await Api.post_json("/api/scene/layer-reload", {"sceneId": _scene_id, "layerNumber": int(_layer.get("layerNumber", 0)), "mainIdx": _main})
	var n: int = (res.data.get("lines", []) as Array).size() if res.ok and res.data is Dictionary else -1
	_status.text = "reloaded on %d channel%s" % [n, "" if n == 1 else "s"] if n > 0 else ("look not on PRV/PGM" if n == 0 else "reload failed")


func _build_timers(cfg: Dictionary) -> void:
	add_child(_muted("Timers config"))
	var g := GridContainer.new()
	g.columns = 2
	add_child(g)
	var w := {}
	g.add_child(_muted("Columns"))
	var cols := OptionButton.new()
	for n in 4:
		cols.add_item("%d column%s" % [n + 1, "" if n == 0 else "s"])
	cols.select(clampi(int(cfg.get("columns", 2)), 1, 4) - 1)
	g.add_child(cols)
	w["columns"] = cols
	for s in SIZES:
		g.add_child(_muted(s[1]))
		var sl := HSlider.new()
		sl.min_value = 12
		sl.max_value = 64
		sl.step = 1
		sl.custom_minimum_size.x = 140
		sl.value = float(cfg.get(s[0], s[2]))
		sl.tooltip_text = "%d px" % int(sl.value)
		g.add_child(sl)
		w[s[0]] = sl
	for tg in TOGGLES:
		var c := CheckBox.new()
		c.text = tg[1]
		c.button_pressed = cfg.get("compact") == true if tg[0] == "compact" else cfg.get(tg[0]) != false  # web: `!== false`
		add_child(c)
		w[tg[0]] = c
	# web updateConfig: rebuild the whole config from the controls on any change
	var emit := func() -> void:
		var out := {"columns": (w.columns as OptionButton).selected + 1}
		for tg in TOGGLES:
			out[tg[0]] = (w[tg[0]] as CheckBox).button_pressed
		for s in SIZES:
			out[s[0]] = int((w[s[0]] as HSlider).value)
			(w[s[0]] as HSlider).tooltip_text = "%d px" % out[s[0]]
		var src: Dictionary = (_layer.source as Dictionary).duplicate(true)
		src["timersConfig"] = out
		patch.emit({"source": src})
	cols.item_selected.connect(func(_i: int) -> void: emit.call())
	for s in SIZES:
		(w[s[0]] as HSlider).value_changed.connect(func(_v: float) -> void: emit.call())
	for tg in TOGGLES:
		(w[tg[0]] as CheckBox).toggled.connect(func(_on: bool) -> void: emit.call())


func _muted(text: String) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	return l
