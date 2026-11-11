extends VBoxContainer
## WO-1039 — "Layer presets" in the Layer inspector (Studio public/layer-presets-ui.js): one click applies a stored
## look to the selected layer; ✎ renames, × deletes (asks first); "Save this layer as a preset" stores the chosen parts
## (position, size, border, … — not the source unless ticked) under a device label colour. Only when the device
## advertises layer presets.

const P := preload("res://features/pixelhue/programming_presets_model.gd")
const M := preload("res://features/pixelhue/programming_model.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")

static var _chosen: Array = []  # the parts last ticked (kept for the session, like Studio's localStorage)

var host: Object


func _init() -> void:
	add_theme_constant_override("separation", 4)


func render(state: Dictionary, layer: Dictionary, locked: bool) -> void:
	for c in get_children():
		remove_child(c)
		c.queue_free()
	var info: Dictionary = state.get("layerPresets") if state.get("layerPresets") is Dictionary else {}
	if info.get("supported") != true or layer.is_empty():
		return
	var title := Label.new()
	title.text = "Layer presets"
	title.add_theme_color_override("font_color", ThemeBuilder.ACCENT)
	add_child(title)
	var list := M.arr(info, "list")
	if list.is_empty():
		add_child(_muted("None stored. Save the selected layer's look to reuse it."))
	for p in list:
		var row := HBoxContainer.new()
		var apply := Button.new()
		apply.text = str(p.get("name", ""))
		apply.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		apply.alignment = HORIZONTAL_ALIGNMENT_LEFT
		apply.disabled = locked
		var sb := ThemeBuilder.box(ThemeBuilder.BG_ELEVATED, Color.from_string(str(p.get("color", "#257cff")), ThemeBuilder.ACCENT), 0)
		sb.border_width_left = 6
		sb.content_margin_left = 10
		apply.add_theme_stylebox_override("normal", sb)
		var parts: Array = M.arr(p, "parts").map(func(k: Variant) -> String: return P.part_label(info, str(k)))
		apply.tooltip_text = "Applies: %s" % (", ".join(PackedStringArray(parts)) if not parts.is_empty() else "nothing")
		apply.pressed.connect(func() -> void:
			var r := P.layer_preset_apply(layer, p)
			host.call("command", r.body, r.message))
		row.add_child(apply)
		var ren := Button.new()
		ren.text = "✎"
		ren.flat = true
		ren.tooltip_text = "Rename %s" % str(p.get("name", ""))
		ren.pressed.connect(func() -> void:
			host.call("prompt", "Layer preset name", str(p.get("name", "")), func(text: String) -> void:
				var r := P.layer_preset_rename(p, text)
				if not r.is_empty():
					host.call("command", r.body, r.message)))
		row.add_child(ren)
		var del := Button.new()
		del.text = "×"
		del.flat = true
		del.tooltip_text = "Delete %s" % str(p.get("name", ""))
		del.pressed.connect(func() -> void:
			host.call("confirm", "Delete layer preset %s?" % str(p.get("name", "")), func() -> void:
				host.call("command", P.layer_preset_delete(p), "Layer preset deleted.")))
		row.add_child(del)
		add_child(row)
	var toggle := Button.new()
	toggle.text = "▸ Save this layer as a preset"
	toggle.flat = true
	toggle.alignment = HORIZONTAL_ALIGNMENT_LEFT
	toggle.disabled = locked
	add_child(toggle)
	var form := VBoxContainer.new()
	form.visible = false
	add_child(form)
	toggle.pressed.connect(func() -> void:
		form.visible = not form.visible
		toggle.text = ("▾" if form.visible else "▸") + " Save this layer as a preset")
	var name_e := LineEdit.new()
	name_e.max_length = 32
	name_e.placeholder_text = "Layer preset %d" % (list.size() + 1)
	form.add_child(_muted("Name"))
	form.add_child(name_e)
	var color := OptionButton.new()
	var colors := M.arr(info, "colors")
	for i in colors.size():
		color.add_item("Colour %d" % (i + 1), i)
		color.set_item_metadata(i, str(colors[i]))
		var img := Image.create(14, 14, false, Image.FORMAT_RGB8)
		img.fill(Color.from_string(str(colors[i]), Color.WHITE))
		color.set_item_icon(i, ImageTexture.create_from_image(img))
	form.add_child(_muted("Colour"))
	form.add_child(color)
	var checks := HFlowContainer.new()
	var boxes := {}
	for ch in P.part_choices(info, layer, _chosen):
		var cb := CheckBox.new()
		cb.text = str(ch[1])
		cb.button_pressed = ch[2] == true
		var key: String = ch[0]
		cb.toggled.connect(func(_on: bool) -> void:
			_chosen = []
			for k in boxes:
				if (boxes[k] as CheckBox).button_pressed:
					_chosen.append(k))
		boxes[key] = cb
		checks.add_child(cb)
	form.add_child(checks)
	var save := Button.new()
	save.text = "Save layer preset"
	save.pressed.connect(func() -> void:
		var parts: Array = []
		for k in boxes:
			if (boxes[k] as CheckBox).button_pressed:
				parts.append(k)
		var col := str(color.get_item_metadata(color.selected)) if color.selected >= 0 else ""
		var r := P.layer_preset_save(info, layer, name_e.text if name_e.text.strip_edges() != "" else name_e.placeholder_text, col, parts)
		if r.has("error"):
			host.call("notice", r.error)
		else:
			host.call("command", r.body, r.message))
	form.add_child(save)


static func _muted(text: String) -> Label:
	var l := Label.new()
	l.text = text
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	l.add_theme_font_size_override("font_size", 11)
	l.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	return l
