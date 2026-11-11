extends VBoxContainer
## WO-1039 — the Programming inspector (right column), Studio's renderInspector + public/layer-inspector.js: tabs
## Layer | Presets. Layer: the selected layer's name, screen and band, group info + Ungroup, Source routing, KeyFrame
## (animate on Take, curve, start / duration as % of the take), layer presets, effects, and the active screen's layer
## list (click selects). Presets: the device preset bank (programming_presets.gd). A locked PGM shows but disables.

const M := preload("res://features/pixelhue/programming_model.gd")
const G := preload("res://features/pixelhue/programming_geometry.gd")
const NF := preload("res://core/numeric_field.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const Effects := preload("res://features/pixelhue/programming_effects.gd")
const LayerPresets := preload("res://features/pixelhue/programming_layer_presets.gd")
const Presets := preload("res://features/pixelhue/programming_presets.gd")

var host: Object
var tab := "layer"
var presets: VBoxContainer
var _effects: VBoxContainer
var _layer_presets: VBoxContainer
var _tabs: HBoxContainer
var _body: VBoxContainer


func _init() -> void:
	add_theme_constant_override("separation", 8)
	custom_minimum_size.x = 300
	_tabs = HBoxContainer.new()
	add_child(_tabs)
	_body = VBoxContainer.new()
	_body.add_theme_constant_override("separation", 8)
	add_child(_body)
	presets = Presets.new()
	_effects = Effects.new()
	_layer_presets = LayerPresets.new()


func _notification(what: int) -> void:
	if what == NOTIFICATION_PREDELETE:
		for n in [presets, _effects, _layer_presets]:
			if is_instance_valid(n) and n.get_parent() == null:
				n.free()


func render(state: Dictionary, layer: Dictionary, active: Dictionary, selected_id: Variant) -> void:
	presets.host = host
	_effects.host = host
	_layer_presets.host = host
	for c in _tabs.get_children():
		c.queue_free()
	for x in [["layer", "Layer"], ["presets", "Presets"]]:
		var b := Button.new()
		b.text = str(x[1])
		b.toggle_mode = true
		b.button_pressed = tab == x[0]
		var id: String = x[0]
		b.pressed.connect(func() -> void:
			tab = id
			host.call("render_inspector"))
		_tabs.add_child(b)
	for c in _body.get_children():
		_body.remove_child(c)
		if c != presets and c != _effects and c != _layer_presets:
			c.queue_free()
	if tab == "presets":
		presets.render(state)
		_body.add_child(presets)
		return
	if layer.is_empty():
		_body.add_child(_muted("Click a layer, or drag a source onto PGM or PVW."))
	else:
		_layer_panel(state, layer)
	if not active.is_empty():
		_body.add_child(_list(state, active, selected_id))


func _layer_panel(state: Dictionary, l: Dictionary) -> void:
	var locked := M.locked(state, l)
	var name_l := Label.new()
	name_l.text = str(l.get("name", ""))
	name_l.add_theme_font_size_override("font_size", 16)
	_body.add_child(name_l)
	_body.add_child(_muted("%s · %s" % [M.screen_name_of(state, l), M.scene_name(l.get("scene"))]))
	if locked:
		var note := _muted("PGM is locked: unlock it above the PGM view to edit this layer.")
		note.add_theme_color_override("font_color", ThemeBuilder.ERROR)
		_body.add_child(note)
	var group := G.group_of(M.arr(state, "layers"), l)
	if not group.is_empty():
		var h: bool = group.orient == "H"
		var info := VBoxContainer.new()
		info.add_child(_heading("Group %d · %s" % [int(group.group), "side by side" if h else "top / bottom"]))
		info.add_child(_muted("%s: %s · %s: %s" % ["Left" if h else "Top", _member(group.a), "Right" if h else "Bottom", _member(group.b)]))
		info.add_child(_muted("Position, size, align, fill and Clear act on both layers. Source and keyframe here apply to the selected member."))
		var ug := Button.new()
		ug.text = "Ungroup"
		ug.disabled = locked
		ug.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
		ug.pressed.connect(func() -> void: host.call("command", M.ungroup_body(l), "Layers ungrouped."))
		info.add_child(ug)
		_body.add_child(info)
	_body.add_child(_muted("Source"))
	var route := OptionButton.new()
	route.clip_text = true
	route.disabled = locked
	var opts := M.routing_options(state, l)
	var current := M.source_key(l.get("sourceType", 0), l.get("sourceId", 0))
	for i in opts.size():
		route.add_item(str(opts[i][1]), i)
		route.set_item_metadata(i, opts[i][0])
		if opts[i][0] == current:
			route.select(i)
	route.item_selected.connect(func(i: int) -> void:
		var d := M.parse_key(str(route.get_item_metadata(i)))
		host.call("command", M.source_body(l, int(d.type), int(d.id)), "Layer source saved."))
	_body.add_child(route)
	_keyframe(l, locked)
	_layer_presets.render(state, l, locked)
	_body.add_child(_layer_presets)
	_effects.render(state, l, locked)
	_body.add_child(_effects)


func _keyframe(l: Dictionary, locked: bool) -> void:
	var kf: Dictionary = l.get("keyFrame") if l.get("keyFrame") is Dictionary else {"enable": 0, "speedType": 3, "startTime": 0, "animationTime": 1000}
	_body.add_child(_heading("KeyFrame"))
	var en := CheckBox.new()
	en.text = "Animate on Take"
	en.button_pressed = int(kf.get("enable", 0)) == 1
	en.disabled = locked
	en.toggled.connect(func(on: bool) -> void:
		host.call("command", M.keyframe_body(l, {"enable": 1 if on else 0}), "KeyFrame on: the layer animates on Take." if on else "KeyFrame off."))
	_body.add_child(en)
	var grid := GridContainer.new()
	grid.columns = 2
	grid.add_child(_muted("Curve"))
	var curve := OptionButton.new()
	for c in M.CURVES:
		curve.add_item(str(c[1]), int(c[0]))
	curve.select(maxi(0, curve.get_item_index(int(kf.get("speedType", 3)))))
	curve.disabled = locked
	curve.item_selected.connect(func(i: int) -> void: host.call("command", M.keyframe_body(l, {"speedType": curve.get_item_id(i)}), "KeyFrame curve saved."))
	grid.add_child(curve)
	for spec in [["Start % of take", "startTime", 0.0, 99.9, 0, 999, "KeyFrame start saved."], ["Duration % of take", "animationTime", 0.1, 100.0, 1, 1000, "KeyFrame duration saved."]]:
		grid.add_child(_muted(str(spec[0])))
		var le := LineEdit.new()
		NF.math_line(le, false, float(spec[2]), float(spec[3]))
		var was := int(kf.get(spec[1], 0))
		le.text = NF.fmt(was / 10.0)
		le.editable = not locked
		le.custom_minimum_size.x = 70
		var key: String = spec[1]
		var commit := func() -> void:
			var v: Variant = NF.evaluate(le.text)
			if v == null or not le.is_inside_tree():
				return
			var tenths := M.percent_to_tenths(float(v), int(spec[4]), int(spec[5]))
			if tenths != was:
				host.call("command", M.keyframe_body(l, {key: tenths}), str(spec[6]))
		le.text_submitted.connect(func(_t: String) -> void: commit.call())
		le.focus_exited.connect(commit)
		grid.add_child(le)
	_body.add_child(grid)
	_body.add_child(_muted("Presets store keyframes when they include KF (absolute presets always do)."))


func _list(state: Dictionary, s: Dictionary, selected_id: Variant) -> Control:
	var box := VBoxContainer.new()
	box.add_child(_heading("%s layers" % str(s.get("name", ""))))
	for item in M.layer_list(state, s.id):
		var b := Button.new()
		b.text = M.layer_title(item)
		b.toggle_mode = true
		b.button_pressed = item.get("id") == selected_id
		b.alignment = HORIZONTAL_ALIGNMENT_LEFT
		b.clip_text = true
		var id := int(item.id)
		b.pressed.connect(func() -> void: host.call("select", id))
		box.add_child(b)
	return box


static func _member(l: Dictionary) -> String:
	return str(l.get("sourceName", "")) if str(l.get("sourceName", "")) != "" else str(l.get("name", ""))


static func _heading(text: String) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_color_override("font_color", ThemeBuilder.ACCENT)
	return l


static func _muted(text: String) -> Label:
	var l := Label.new()
	l.text = text
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	l.add_theme_font_size_override("font_size", 11)
	l.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	return l
