extends HFlowContainer
## WO-1039 — the selected layer's position / size bar under the screens, a port of Studio's public/layer-tools.js:
## X / Y / W / H (stream to the switcher while typing, Enter / leaving the field sends the final value), aspect
## presets + Lock, align to screen, fill screen / width / height / output, native 1:1, Front / Back, Duplicate,
## Mirror and Clear (asks first). A group member acts on the pair's combined rectangle. A locked PGM disables it all.
## No autoloads: `host` (programming_panel.gd) sends.

const M := preload("res://features/pixelhue/programming_model.gd")
const G := preload("res://features/pixelhue/programming_geometry.gd")
const NF := preload("res://core/numeric_field.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")

var host: Object
var _state: Dictionary = {}
var _layer: Dictionary = {}
var _screen: Dictionary = {}
var _fields := {}  # "x" / "y" / "width" / "height" → LineEdit


func _init() -> void:
	add_theme_constant_override("h_separation", 14)
	add_theme_constant_override("v_separation", 6)


func layer_id() -> Variant:
	return _layer.get("id")


func render(state: Dictionary, layer: Dictionary, locked: bool) -> void:
	_state = state
	_layer = layer
	_screen = M.screen_by_id(state, layer.get("screenId")) if not layer.is_empty() else {}
	_fields = {}
	for c in get_children():
		remove_child(c)
		c.queue_free()
	if layer.is_empty() or _screen.is_empty():
		add_child(_muted("Select a layer to position and size it."))
		return
	var layers := M.arr(state, "layers")
	var group := G.group_of(layers, layer)
	var win := G.target_window(layers, layer)
	var name_box := VBoxContainer.new()
	var n := Label.new()
	n.text = "Group %d" % int(group.group) if not group.is_empty() else str(layer.get("name", ""))
	name_box.add_child(n)
	name_box.add_child(_muted("%s · %s%s" % [str(_screen.get("name", "")), M.scene_name(layer.get("scene")), " · locked" if locked else ""]))
	add_child(name_box)
	var fields := _block("Position & size")
	for kv in [["x", "X"], ["y", "Y"], ["width", "W"], ["height", "H"]]:
		var key: String = kv[0]
		var le := LineEdit.new()
		NF.math_line(le, true, -500000 if key in ["x", "y"] else G.MIN, 500000 if key in ["x", "y"] else 131070)
		le.text = str(int(win[key]))
		le.custom_minimum_size.x = 64
		le.editable = not locked
		le.tooltip_text = "Layer %s (px, screen-local)" % kv[1]
		le.text_changed.connect(func(text: String) -> void: _typed(key, text))
		le.text_submitted.connect(func(_t: String) -> void: _commit(key, le))
		le.focus_exited.connect(func() -> void: _commit(key, le))
		fields.add_child(_muted(kv[1]))
		fields.add_child(le)
		_fields[key] = le
	var aspect := _block("Aspect")
	var asp := OptionButton.new()
	for i in M.ASPECTS.size():
		asp.add_item(str(M.ASPECTS[i][1]), int(M.ASPECTS[i][0]))
	asp.select(maxi(0, asp.get_item_index(int(layer.get("aspectMode", 5)))))
	asp.disabled = locked
	asp.item_selected.connect(func(i: int) -> void:
		var mode := asp.get_item_id(i)
		host.call("command", M.aspect_mode_body(_layer, mode), "Aspect ratio set to %s." % M.aspect_label(mode)))
	aspect.add_child(asp)
	var keep := CheckBox.new()
	keep.text = "Lock"
	keep.button_pressed = layer.get("aspectLocked") == true
	keep.disabled = locked
	keep.toggled.connect(func(on: bool) -> void:
		host.call("command", M.aspect_lock_body(_layer, on), "Aspect ratio locked to the source." if on else "Aspect ratio unlocked."))
	aspect.add_child(keep)
	var align := _block("Align to screen")
	for a in M.ALIGNS:
		var where: String = a[0]
		_button(align, str(a[1]), locked, func() -> void: _save(G.align_window(_current(), _screen, where), "Layer aligned %s." % str(a[1]).to_lower()))
	var fill := _block("Fill")
	var sr := G.win(0, 0, _screen.width, _screen.height)
	_button(fill, "Screen", locked, func() -> void:
		var r := _ratio()
		_save(G.fill_window(sr, r), "Layer fitted to the screen (aspect kept)." if r > 0.0 else "Layer fills the screen."))
	_button(fill, "Width", locked, func() -> void: _save(G.fill_axis(_current(), sr, "width", _ratio()), "Layer fills the screen width."))
	_button(fill, "Height", locked, func() -> void: _save(G.fill_axis(_current(), sr, "height", _ratio()), "Layer fills the screen height."))
	var out := _button(fill, "Output", locked or G.output_tile(win, _screen).is_empty(), func() -> void:
		var tile := G.output_tile(_current(), _screen)
		if not tile.is_empty():
			_save(G.fill_window(tile, _ratio()), "Layer fitted to its output (aspect kept)." if _ratio() > 0.0 else "Layer fills its output."))
	out.tooltip_text = "Fill the output tile under the layer's centre"
	var nat := _button(fill, "Native 1:1", locked or _native().is_empty(), func() -> void:
		var w := _native()
		if not w.is_empty():
			_save(w, "Layer set to the source resolution."))
	nat.tooltip_text = "Set the layer to the source resolution" if not _native().is_empty() else "The source has no signal resolution."
	var order := _block("Layer")
	_button(order, "Front", locked, func() -> void: host.call("command", M.zorder_body(_layer, 3), "Layer brought to front."))
	_button(order, "Back", locked, func() -> void: host.call("command", M.zorder_body(_layer, 4), "Layer sent to back."))
	_button(order, "Duplicate", locked, func() -> void: host.call("command", M.copy_body(_layer, false), "Layer duplicated."))
	var mir := _button(order, "Mirror", locked, func() -> void: host.call("command", M.copy_body(_layer, true), "Mirrored copy created."))
	mir.tooltip_text = "A flipped copy on the opposite side of the screen"
	var clr := _button(order, "Clear", locked, func() -> void: host.call("clear_layer", _layer))
	clr.add_theme_color_override("font_color", ThemeBuilder.ERROR)


## Refresh X / Y / W / H from the layer's live window (fields being edited keep what the operator types).
func update_fields() -> void:
	if _layer.is_empty() or _fields.is_empty():
		return
	var w := _current()
	for key in _fields:
		var le: LineEdit = _fields[key]
		if is_instance_valid(le) and not le.has_focus():
			le.text = str(int(w[key]))


func _current() -> Dictionary:
	return G.target_window(M.arr(_state, "layers"), _layer)


func _ratio() -> float:
	return G.keep_ratio(M.arr(_state, "layers"), _layer)


func _native() -> Dictionary:
	var layers := M.arr(_state, "layers")
	var g := G.group_of(layers, _layer)
	if not g.is_empty():
		var size := G.group_size(_src(g.a), _src(g.b), str(g.orient))
		return G.native_window(_current(), size)
	return G.native_window(_current(), _src(_layer))


func _src(l: Dictionary) -> Dictionary:
	return M.source_for(_state, M.source_key(l.get("sourceType", 0), l.get("sourceId", 0)))


func _save(w: Dictionary, message: String, live := false) -> void:
	if _layer.is_empty() or host == null:
		return
	var change := M.window_change(_state, _layer, w)
	if change.action == "group-window":
		message = message.replace("Layer", "Group")
	if live:
		host.call("live_geometry", change)
	else:
		host.call("command", change, message)


func _typed(key: String, text: String) -> void:
	if not text.strip_edges().is_valid_int():
		return
	var next := G.field_edit(_current(), key, int(text.strip_edges()), _ratio())
	if G.window_ok(next) and not G.same(next, _current()):
		_save(next, "Layer position saved.", true)


func _commit(key: String, le: LineEdit) -> void:
	if not is_instance_valid(le) or not le.is_inside_tree() or _layer.is_empty() or not le.text.is_valid_int():
		return
	var next := G.field_edit(_current(), key, int(le.text), _ratio())
	if G.window_ok(next) and not G.same(next, _current()):
		_save(next, "Layer position saved.")
	elif host != null:
		host.call("finish_geometry")
	update_fields()


func _block(title: String) -> HBoxContainer:
	var box := VBoxContainer.new()
	box.add_child(_muted(title))
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 4)
	box.add_child(row)
	add_child(box)
	return row


func _button(parent: Node, text: String, disabled: bool, cb: Callable) -> Button:
	var b := Button.new()
	b.text = text
	b.disabled = disabled
	b.pressed.connect(cb)
	parent.add_child(b)
	return b


static func _muted(text: String) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", 11)
	l.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	return l
