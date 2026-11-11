extends VBoxContainer
## WO-1039 — the selected layer's effect sections (Studio public/layer-effects-ui.js): Look (device lock, opacity,
## flip, mono, invert), Border, Mask, Shadow, Colour, Source crop, Keying and Cut & Fill — only the sections the
## device's layer XML supports for this layer (programming_fx_model.gd). Sections fold; an "on" mark shows which
## are active. Each control applies on change through `host.command` ({action:'effect', …}).

const M := preload("res://features/pixelhue/programming_model.gd")
const FX := preload("res://features/pixelhue/programming_fx_model.gd")
const NF := preload("res://core/numeric_field.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")

static var _open := {"look": true}  # section id → unfolded (kept across layers, like Studio)

var host: Object
var _layer: Dictionary = {}


func _init() -> void:
	add_theme_constant_override("separation", 4)


func render(state: Dictionary, layer: Dictionary, locked: bool) -> void:
	_layer = layer
	for c in get_children():
		remove_child(c)
		c.queue_free()
	for sec in FX.sections(state, layer):
		var id: String = sec.id
		var head := Button.new()
		head.text = "%s %s%s" % ["▾" if _open.get(id, false) else "▸", str(sec.title), "   on" if sec.on else ""]
		head.flat = true
		head.alignment = HORIZONTAL_ALIGNMENT_LEFT
		if sec.on:
			head.add_theme_color_override("font_color", ThemeBuilder.SUCCESS)
		add_child(head)
		var body := GridContainer.new()
		body.columns = 2
		body.add_theme_constant_override("h_separation", 8)
		body.visible = _open.get(id, false)
		add_child(body)
		head.pressed.connect(func() -> void:
			_open[id] = not _open.get(id, false)
			body.visible = _open[id]
			head.text = "%s %s%s" % ["▾" if _open[id] else "▸", str(sec.title), "   on" if sec.on else ""])
		for row in sec.rows:
			_row(body, row, locked)


func _send(row: Dictionary, value: Variant) -> void:
	var fx: Dictionary = _layer.get("fx") if _layer.get("fx") is Dictionary else {}
	var effect := FX.effect(row, value, fx)
	if not effect.is_empty() and host != null:
		host.call("command", M.effect_body(_layer, effect), str(row.get("msg", "Effect saved.")))


func _row(body: GridContainer, row: Dictionary, locked: bool) -> void:
	var kind := str(row.kind)
	var label := Label.new()
	label.text = "" if kind in ["check", "button", "note"] else str(row.label)
	label.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	label.add_theme_font_size_override("font_size", 11)
	body.add_child(label)
	var c: Control
	match kind:
		"note":
			var n := Label.new()
			n.text = str(row.label)
			n.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
			c = n
		"check":
			var cb := CheckBox.new()
			cb.text = str(row.label)
			cb.button_pressed = row.value == true
			cb.toggled.connect(func(on: bool) -> void: _send(row, on))
			c = cb
		"button":
			var b := Button.new()
			b.text = str(row.label)
			b.pressed.connect(func() -> void: _send(row, null))
			c = b
		"slider":
			var box := HBoxContainer.new()
			var s := HSlider.new()
			s.min_value = float(row.min)
			s.max_value = float(row.max)
			s.step = 1
			s.value = float(row.value)
			s.custom_minimum_size.x = 110
			s.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			var out := Label.new()
			out.text = "%d%%" % int(row.value)
			s.value_changed.connect(func(v: float) -> void: out.text = "%d%%" % int(v))
			s.drag_ended.connect(func(changed: bool) -> void:
				if changed:
					_send(row, s.value))
			box.add_child(s)
			box.add_child(out)
			c = box
		"number":
			var le := LineEdit.new()
			var as_int: bool = row.get("int", true) == true
			NF.math_line(le, as_int, float(row.min), float(row.max))
			le.text = NF.fmt(float(row.value), as_int)
			le.custom_minimum_size.x = 70
			var commit := func() -> void:
				var v: Variant = NF.evaluate(le.text)
				if v != null and not is_equal_approx(float(v), float(row.value)):
					_send(row, float(v))
			le.text_submitted.connect(func(_t: String) -> void: commit.call())
			le.focus_exited.connect(func() -> void:
				if le.is_inside_tree():
					commit.call())
			c = le
		"color":
			var cp := ColorPickerButton.new()
			cp.color = Color.from_string(str(row.value), Color.BLACK)
			cp.edit_alpha = false
			cp.custom_minimum_size = Vector2(60, 24)
			cp.popup_closed.connect(func() -> void:
				var hex := FX.color_hex(cp.color)
				if hex != str(row.value).to_lower():
					_send(row, hex))
			c = cp
		"select":
			var o := OptionButton.new()
			var opts: Array = row.get("options", [])
			for i in opts.size():
				o.add_item(str(opts[i][1]), i)
				o.set_item_metadata(i, opts[i][0])
				if str(opts[i][0]) == str(row.value):
					o.select(i)
			o.item_selected.connect(func(i: int) -> void: _send(row, o.get_item_metadata(i)))
			c = o
		_:
			c = Control.new()
	if locked:
		_disable(c)
	body.add_child(c)


static func _disable(c: Node) -> void:
	if c is BaseButton:
		(c as BaseButton).disabled = true
	elif c is LineEdit:
		(c as LineEdit).editable = false
	elif c is Range:
		(c as Range).editable = false
	for k in c.get_children():
		_disable(k)
