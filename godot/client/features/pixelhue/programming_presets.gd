extends VBoxContainer
## WO-1039 — the device preset bank (Studio public/presets-ui.js) in the inspector's Presets tab. Load to PVW | PGM |
## Auto-take (load to PVW, confirm PVW matches, Take its screens with the toolbar's duration / swap); PGM loads may
## run the transition and keyframes. Save from PVW… / Save from PGM… open a form: slot 1–128 (an occupied slot asks
## before overwriting), name, Absolute (all layers of the shown screens) or Relative (chosen layers + settings).
## Edit shows Rename / Delete (asks first).

const P := preload("res://features/pixelhue/programming_presets_model.gd")
const M := preload("res://features/pixelhue/programming_model.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")

var host: Object
var target := M.PVW  # 4 PVW, 2 PGM, P.AUTO
var effect := false
var keyframes := false
var saving := 0  # 0 = no form, else the scene saved from
var editing := false
var _state: Dictionary = {}


func _init() -> void:
	add_theme_constant_override("separation", 6)


func render(state: Dictionary) -> void:
	_state = state
	for c in get_children():
		remove_child(c)
		c.queue_free()
	var title := Label.new()
	title.text = "Presets"
	title.add_theme_color_override("font_color", ThemeBuilder.ACCENT)
	add_child(title)
	if not (state.get("presets") is Array):
		add_child(_muted("Presets are unavailable on this device."))
		return
	var presets: Array = state.presets
	var seg := HBoxContainer.new()
	seg.add_child(_muted("Load to"))
	for v in [M.PVW, M.PGM, P.AUTO]:
		var b := Button.new()
		b.text = P.target_name(v)
		b.toggle_mode = true
		b.button_pressed = target == v
		if v == P.AUTO:
			b.tooltip_text = "Load to PVW, confirm PVW matches the preset, then Take its screens with the transition time above."
		b.pressed.connect(func() -> void:
			target = v
			render(_state))
		seg.add_child(b)
	add_child(seg)
	var opts := HBoxContainer.new()
	if target == M.PGM:
		opts.add_child(_check("Transition on load", effect, func(on: bool) -> void: effect = on))
	if target != M.PVW:
		opts.add_child(_check("Run keyframes", keyframes, func(on: bool) -> void: keyframes = on))
	add_child(opts)
	var acts := HBoxContainer.new()
	for sc in [M.PVW, M.PGM]:
		var b := Button.new()
		b.text = "Save from %s…" % M.scene_name(sc)
		b.pressed.connect(func() -> void:
			saving = 0 if saving == sc else sc
			render(_state))
		acts.add_child(b)
	var ed := Button.new()
	ed.text = "Done" if editing else "Edit"
	ed.pressed.connect(func() -> void:
		editing = not editing
		render(_state))
	acts.add_child(ed)
	add_child(acts)
	if saving != 0:
		add_child(_save_form(presets))
	if presets.is_empty():
		add_child(_muted("No presets yet. Build a look and use Save from PVW or Save from PGM."))
	for p in presets:
		var row := HBoxContainer.new()
		var lb := Button.new()
		lb.text = P.preset_title(p)
		lb.alignment = HORIZONTAL_ALIGNMENT_LEFT
		lb.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		lb.clip_text = true
		lb.tooltip_text = P.preset_tooltip(p, target)
		lb.pressed.connect(func() -> void:
			var tr: Dictionary = host.call("transition")
			var r := P.load_request(p, target, effect, keyframes, int(tr.time), tr.swap == true)
			host.call("command", r.body, r.message))
		row.add_child(lb)
		if editing:
			var ren := Button.new()
			ren.text = "Rename"
			ren.pressed.connect(func() -> void:
				host.call("prompt", "Rename preset", str(p.get("name", "")), func(text: String) -> void:
					var r := P.rename_request(p, text)
					if not r.is_empty():
						host.call("command", r.body, r.message)))
			row.add_child(ren)
			var del := Button.new()
			del.text = "Delete"
			del.add_theme_color_override("font_color", ThemeBuilder.ERROR)
			del.pressed.connect(func() -> void:
				host.call("confirm", "Delete preset %s?" % str(p.get("name", "")), func() -> void:
					host.call("command", P.delete_body(p), "Preset deleted.")))
			row.add_child(del)
		add_child(row)


func _save_form(presets: Array) -> Control:
	var scene := saving
	var form := VBoxContainer.new()
	var panel := PanelContainer.new()
	panel.add_theme_stylebox_override("panel", ThemeBuilder.box(ThemeBuilder.BG_PANEL, ThemeBuilder.BORDER, 1))
	panel.add_child(form)
	var head := Label.new()
	head.text = "Save from %s" % M.scene_name(scene)
	form.add_child(head)
	var slot := OptionButton.new()
	var first := P.first_free(presets)
	var options := P.slot_options(presets)
	for i in options.size():
		slot.add_item(str(options[i][1]), int(options[i][0]))
		if int(options[i][0]) == first:
			slot.select(i)
	var name_e := LineEdit.new()
	name_e.max_length = 64
	name_e.text = P.default_name(presets, first)
	slot.item_selected.connect(func(i: int) -> void: name_e.text = P.default_name(presets, slot.get_item_id(i)))
	var kind := OptionButton.new()
	kind.add_item("Absolute: all layers", 0)
	kind.add_item("Relative: chosen layers & settings", 1)
	for pair in [["Slot", slot], ["Name", name_e], ["Type", kind]]:
		form.add_child(_muted(str(pair[0])))
		form.add_child(pair[1])
	var rel := VBoxContainer.new()
	rel.visible = false
	kind.item_selected.connect(func(i: int) -> void: rel.visible = i == 1)
	rel.add_child(_muted("Settings"))
	var params := {}
	var pf := HFlowContainer.new()
	for pr in P.PARAMS:
		var cb := CheckBox.new()
		cb.text = str(pr[1])
		cb.button_pressed = pr[0] in P.PARAMS_DEFAULT
		params[pr[0]] = cb
		pf.add_child(cb)
	rel.add_child(pf)
	rel.add_child(_muted("%s layers" % M.scene_name(scene)))
	var layer_boxes := {}
	var shown: Array = host.call("shown_ids") if host != null else []
	var choices := P.scene_layers(_state, shown, scene)
	if choices.is_empty():
		rel.add_child(_muted("No layers on the shown screens."))
	for lc in choices:
		var cb := CheckBox.new()
		cb.text = str(lc[1])
		cb.button_pressed = true
		layer_boxes[lc[0]] = cb
		rel.add_child(cb)
	form.add_child(rel)
	var row := HBoxContainer.new()
	var save := Button.new()
	save.text = "Save"
	save.pressed.connect(func() -> void:
		var picked_params: Array = params.keys().filter(func(k: Variant) -> bool: return (params[k] as CheckBox).button_pressed)
		var picked_layers: Array = layer_boxes.keys().filter(func(k: Variant) -> bool: return (layer_boxes[k] as CheckBox).button_pressed)
		var r := P.save_request(presets, scene, slot.get_item_id(slot.selected), name_e.text, shown, kind.selected == 1, picked_params, picked_layers)
		if r.has("error"):
			host.call("notice", r.error)
			return
		var send := func() -> void:
			saving = 0
			host.call("command", r.body, r.message)
		if str(r.overwrite) != "":
			host.call("confirm", "Overwrite preset %d · %s with %s of the shown screens?" % [int(r.body.serial), str(r.overwrite), M.scene_name(scene)], send)
		else:
			send.call())
	row.add_child(save)
	var cancel := Button.new()
	cancel.text = "Cancel"
	cancel.pressed.connect(func() -> void:
		saving = 0
		render(_state))
	row.add_child(cancel)
	form.add_child(row)
	return panel


static func _check(text: String, on: bool, cb: Callable) -> CheckBox:
	var c := CheckBox.new()
	c.text = text
	c.button_pressed = on
	c.toggled.connect(cb)
	return c


static func _muted(text: String) -> Label:
	var l := Label.new()
	l.text = text
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	l.add_theme_font_size_override("font_size", 11)
	l.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	return l
