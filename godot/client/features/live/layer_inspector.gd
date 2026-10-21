extends VBoxContainer
## WO-601 — look-layer inspector, mixer/audio + content sizing + clip start (client/components/
## inspector-mixer.js, inspector-scene-layer.js, inspector-fill.js content sizing). Emits patches; the look
## editor applies them (deck sync → preview-push → autosave). Route choices + refits come from the server,
## computed with the web's own modules (/api/scene/layer-options, /api/scene/layer-fit).

signal patch(p: Dictionary)

const X := preload("res://features/live/mixer_math.gd")
const EffectsSection := preload("res://features/live/effects_section.gd")
const PipSection := preload("res://features/live/pip_section.gd")
const PipModel := preload("res://features/live/pip_model.gd")
const TemplateSection := preload("res://features/live/template_section.gd")
const LowerThirdSection := preload("res://features/live/lower_third_section.gd")
const CountdownSection := preload("res://features/live/countdown_section.gd")
const LayerStyleRow := preload("res://features/live/layer_style_row.gd")
const PlaylistSection := preload("res://features/live/playlist_section.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const FITS := [["native", "Native (1:1 px)"], ["fill-canvas", "Fit canvas"], ["horizontal", "Fill width"], ["vertical", "Fill height"], ["stretch", "Stretch"]]
const STARTS := [["beginning", "Start from beginning"], ["relativeToPrevious", "Relative to the clip playing on this layer"]]

var scene_id := ""
var main := 0
var _layer: Dictionary = {}
var _routes: Array = []        # [{value, label}]
var _src_sets: Array = []
var _w := {}
var _syncing := false
var _fx: EffectsSection
var _pip: PipSection
var _tpl: TemplateSection
var _lt: LowerThirdSection
var _cd: CountdownSection
var _style: LayerStyleRow
var _pl: PlaylistSection
signal status(text: String)
var _content_key := ""
var _content := Vector2i.ZERO
var content_known := Vector2.ZERO  # the server-reported media size only (no channel fallback): the aspect lock's ratio


func _ready() -> void:
	add_theme_constant_override("separation", 4)
	_style = LayerStyleRow.new()
	_style.patch.connect(func(p: Dictionary) -> void: patch.emit(p))
	_style.status.connect(func(t: String) -> void: status.emit(t))
	add_child(_style)
	var g := GridContainer.new()
	g.columns = 2
	add_child(g)
	_row(g, "Content sizing", _option("fit", FITS.map(func(o: Array) -> String: return o[1]), _on_fit))
	_row(g, "Clip start point", _option("start", STARTS.map(func(o: Array) -> String: return o[1]),
		func(i: int) -> void: _emit({"startBehaviour": STARTS[i][0]})))
	_row(g, "Loop", _check("loop", func(on: bool) -> void: _emit({"loop": on})))
	_row(g, "Straight alpha", _check("alpha", func(on: bool) -> void: _emit({"straightAlpha": on})))
	_row(g, "Rotation °", _spin("rot", -180, 180, 0.5, func(v: float) -> void: _emit({"rotation": v})))
	_row(g, "Audio", _option("route", [], func(i: int) -> void: _on_route(i)))
	_row(g, "Mute", _check("mute", func(on: bool) -> void: _emit({"muted": on})))
	var vol := HBoxContainer.new()
	var sl := HSlider.new()
	sl.min_value = 0
	sl.max_value = 100
	sl.step = 1
	sl.custom_minimum_size.x = 160
	sl.value_changed.connect(func(p: float) -> void:
		_w.vol_db.text = X.format_db(X.fader_to_gain(p))
		_emit({"volume": X.fader_to_gain(p)}))
	vol.add_child(sl)
	_w["vol"] = sl
	var db := Label.new()
	db.custom_minimum_size.x = 70
	vol.add_child(db)
	_w["vol_db"] = db
	_row(g, "Volume", vol)
	var fade := HBoxContainer.new()
	fade.add_child(_check("fade", func(on: bool) -> void: _emit({"fadeOnEnd": {"enabled": on}})))
	fade.add_child(_spin("fade_fr", 1, 250, 1, func(v: float) -> void: _emit({"fadeOnEnd": {"frames": int(v)}})))
	_row(g, "Fade on end (fr)", fade)
	_pl = PlaylistSection.new()  # web inspector-layer-playlist.js sits under the mixer
	_pl.patch.connect(func(p: Dictionary) -> void: patch.emit(p))
	add_child(_pl)
	_tpl = TemplateSection.new()  # web order: mixer → HTML template → lower third → countdown → effects
	_tpl.patch.connect(func(p: Dictionary) -> void: patch.emit(p))
	add_child(_tpl)
	_lt = LowerThirdSection.new()
	_lt.patch.connect(func(p: Dictionary) -> void: patch.emit(p))
	add_child(_lt)
	_cd = CountdownSection.new()
	_cd.patch.connect(func(p: Dictionary) -> void: patch.emit(p))
	add_child(_cd)
	add_child(HSeparator.new())
	_fx = EffectsSection.new()
	_fx.changed.connect(func(fx: Array) -> void: patch.emit({"effects": fx}))
	add_child(_fx)
	add_child(HSeparator.new())
	_pip = PipSection.new()
	_pip.changed.connect(func(list: Array) -> void:
		var p := {"pipOverlays": list}
		if _layer.get("pipOverlay") != null:
			p["pipOverlay"] = null  # legacy single overlay is superseded (web scene-state-helpers deletes it)
		patch.emit(p))
	add_child(_pip)
	_load_registry()


func show_layer(look_id: String, main_idx: int, layer: Dictionary, index := -1) -> void:
	var main_changed := main_idx != main or _routes.is_empty()
	scene_id = look_id
	main = main_idx
	_layer = layer
	visible = not layer.is_empty()
	if main_changed:
		await _load_options()
	_sync()
	if not layer.is_empty():
		_fx.show_effects(layer.get("effects", []) if layer.get("effects") is Array else [], _content)
		_pip.show_overlays(PipModel.from_layer(layer))
		_style.show_layer(layer)
		_pl.show_layer(look_id, layer)
		_tpl.show_layer(look_id, main_idx, layer)
		_lt.show_layer(look_id, main_idx, layer)
		_cd.show_layer(look_id, main_idx, layer, index)
		_refresh_content()


func _load_registry() -> void:
	var res: Dictionary = await Api.get_json("/api/scene/effect-registry")
	if res.ok and res.data is Dictionary:
		_fx.set_registry(res.data.get("effects", []) if res.data.get("effects") is Array else [])
		_pip.set_registry(res.data.get("pipOverlays", []) if res.data.get("pipOverlays") is Array else [], int(res.data.get("pipMaxStack", 4)))


## Crop px editing uses the layer's content resolution (web getContentResolution, fallback channel) —
## computed by the server's layer-fit (nothing stored), once per look/layer/source.
func _refresh_content() -> void:
	var src: Dictionary = _layer.get("source", {}) if _layer.get("source") is Dictionary else {}
	var key := "%s|%s|%s|%d" % [scene_id, _layer.get("layerNumber", ""), src.get("value", ""), main]
	if key == _content_key:
		return
	_content_key = key
	content_known = Vector2.ZERO
	var known := false
	var c := Vector2i(1920, 1080)
	var rl: Variant = (Store.get_value("channelMap", {}) as Dictionary).get("programResolutions", []) if Store.get_value("channelMap") is Dictionary else []
	if rl is Array and main < (rl as Array).size() and rl[main] is Dictionary:
		c = Vector2i(int(rl[main].get("w", 1920)), int(rl[main].get("h", 1080)))
	var res: Dictionary = await Api.post_json("/api/scene/layer-fit", {"sceneId": scene_id, "layerNumber": int(_layer.get("layerNumber", 0)), "contentFit": str(_layer.get("contentFit", "native")), "mainIdx": main})
	if res.ok and res.data is Dictionary and res.data.get("contentResolution") is Dictionary:
		var cr: Dictionary = res.data.contentResolution
		if float(cr.get("w", 0)) > 0 and float(cr.get("h", 0)) > 0:
			c = Vector2i(int(cr.w), int(cr.h))
			known = true
	if key != _content_key:
		return
	content_known = Vector2(c) if known else Vector2.ZERO
	_content = c
	_fx.show_effects(_layer.get("effects", []) if _layer.get("effects") is Array else [], _content)


func _load_options() -> void:
	var res: Dictionary = await Api.get_json("/api/scene/layer-options?mainIdx=%d" % main)
	if res.ok and res.data is Dictionary:
		_routes = res.data.get("audioRoutes", [])
		_src_sets = res.data.get("sourceChannelSets", [])


func _is_route_source() -> bool:
	var s: Variant = _layer.get("source")
	return s is Dictionary and (str(s.get("type", "")) == "route" or str(s.get("value", "")).begins_with("route://"))


func _sync() -> void:
	if _layer.is_empty():
		return
	_syncing = true
	var fit := str(_layer.get("contentFit", "native"))
	(_w.fit as OptionButton).select(maxi(0, FITS.map(func(o: Array) -> String: return o[0]).find(fit)))
	(_w.start as OptionButton).select(1 if str(_layer.get("startBehaviour", "")) == "relativeToPrevious" else 0)
	var src: Dictionary = _layer.get("source", {}) if _layer.get("source") is Dictionary else {}
	var can_loop := X.supports_loop(str(src.get("value", "")), str(src.get("type", "media")))
	(_w.loop as CheckBox).disabled = not can_loop
	(_w.loop as CheckBox).button_pressed = can_loop and _layer.get("loop", false) == true
	(_w.alpha as CheckBox).button_pressed = _layer.get("straightAlpha", false) == true
	(_w.rot as SpinBox).value = float(_layer.get("rotation", 0.0))
	var route := _w.route as OptionButton
	route.clear()
	if _is_route_source():  # route sources pick source channels (web inspector-mixer.js:53-81)
		for s in _src_sets:
			route.add_item("All" if s == "all" else str(s))
		route.select(maxi(0, _src_sets.find(str(_layer.get("routeSourceAudio", "all")))))
	else:
		var cur := str(_layer.get("audioRoute", "1+2"))
		for r in _routes:
			route.add_item(str(r.get("label", r.get("value"))))
		route.select(maxi(0, _routes.map(func(r: Dictionary) -> String: return str(r.value)).find(cur)))
	(_w.mute as CheckBox).button_pressed = _layer.get("muted", false) == true
	var vol := float(_layer.get("volume", 1.0))
	(_w.vol as HSlider).value = X.gain_to_fader(vol)
	(_w.vol_db as Label).text = X.format_db(vol)
	var fo: Dictionary = _layer.get("fadeOnEnd", {}) if _layer.get("fadeOnEnd") is Dictionary else {}
	(_w.fade as CheckBox).button_pressed = fo.get("enabled", false) == true
	(_w.fade_fr as SpinBox).value = float(fo.get("frames", 12))
	_syncing = false


func _emit(p: Dictionary) -> void:
	if _syncing:
		return
	if p.has("fadeOnEnd"):  # web patchLayer merges fadeOnEnd
		var fo: Dictionary = (_layer.get("fadeOnEnd", {"enabled": false, "frames": 12}) as Dictionary).duplicate()
		fo.merge(p.fadeOnEnd, true)
		p["fadeOnEnd"] = fo
	patch.emit(p)


func _on_route(i: int) -> void:
	if _is_route_source():
		if i >= 0 and i < _src_sets.size():
			_emit({"routeSourceAudio": _src_sets[i]})
	elif i >= 0 and i < _routes.size():
		_emit({"audioRoute": str(_routes[i].value)})


## Content sizing → set it and refit like the web (reapplyLayerFrameForContentFit), server-computed.
func _on_fit(i: int) -> void:
	if _syncing:
		return
	var fit: String = FITS[i][0]
	_emit({"contentFit": fit})
	var res: Dictionary = await Api.post_json("/api/scene/layer-fit", {"sceneId": scene_id, "layerNumber": int(_layer.get("layerNumber", 0)), "contentFit": fit, "mainIdx": main})
	if res.ok and res.data is Dictionary and res.data.get("fill") is Dictionary:
		patch.emit({"fill": res.data.fill})


func _row(g: GridContainer, label: String, c: Control) -> void:
	var l := Label.new()
	l.text = label
	l.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	g.add_child(l)
	g.add_child(c)


func _option(key: String, items: Array, cb: Callable) -> OptionButton:
	var o := OptionButton.new()
	for it in items:
		o.add_item(str(it))
	o.item_selected.connect(func(i: int) -> void:
		if not _syncing:
			cb.call(i))
	_w[key] = o
	return o


func _check(key: String, cb: Callable) -> CheckBox:
	var c := CheckBox.new()
	c.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN  # a toggle, not as wide as the dropdowns
	c.toggled.connect(func(on: bool) -> void:
		if not _syncing:
			cb.call(on))
	_w[key] = c
	return c


func _spin(key: String, lo: float, hi: float, step: float, cb: Callable) -> SpinBox:
	var s := SpinBox.new()
	s.min_value = lo
	s.max_value = hi
	s.step = step
	s.value_changed.connect(func(v: float) -> void:
		if not _syncing:
			cb.call(v))
	_w[key] = s
	return s
