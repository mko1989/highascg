extends "res://features/devices/host_controls_base.gd"
## WO-869 — the slice section of the mapping node's Inspector page (owner Q1: the Inspector holds the slice list and
## the numeric fields; "Edit slices" opens the two canvases in the Devices tab centre). Built from
## slice_page_model.gd items into `box`, which mapping_controls.gd mounts on its page. Edits go through the shared
## slice_flow.gd; a canvas drag updates the numbers here in place (a focused field is left alone).
## Number fields are RULES.md math fields (NumericField.math_line: focus selects, + - * / evaluate, garbage reverts).

signal edit_requested()

const SP := preload("res://features/devices/slice_page_model.gd")
const SM := preload("res://features/devices/slice_model.gd")
const NF := preload("res://core/numeric_field.gd")

var box := VBoxContainer.new()
var flow: RefCounted
var _fields := {}  # key → LineEdit (the selected slice's numbers)
var _readouts: Array[Label] = []  # the per-output "drawn as" lines, in output order


func _init() -> void:
	box.add_theme_constant_override("separation", 4)
	box.name = "SliceSection"


func bind(f: RefCounted) -> void:
	if flow == f:
		return
	if flow != null and flow.changed.is_connected(_on_changed):
		flow.changed.disconnect(_on_changed)
	flow = f
	flow.changed.connect(_on_changed)
	render()


func _on_changed(kind: String) -> void:
	if kind == "geometry":
		_sync_numbers()
	elif kind == "plan":  # a save's answer: only the backend lines change (a rebuild would eat a half-typed field)
		var d: Array = flow.drawn()
		for i in mini(d.size(), _readouts.size()):
			if is_instance_valid(_readouts[i]):
				_readouts[i].text = "%s: %s" % [d[i][0], d[i][1]]
	else:
		render()


func render() -> void:
	if flow == null:
		return
	var focus: Variant = box.get_viewport().gui_get_focus_owner() if box.is_inside_tree() else null
	var refocus: Variant = focus.get_meta("key", null) if focus is Control and box.is_ancestor_of(focus) else null
	for c in box.get_children():
		box.remove_child(c)
		c.queue_free()
	_fields = {}
	_readouts = []
	for it in SP.items(flow.slices, flow.outputs, flow.sel, flow.drawn()):
		var n := _item(it)
		box.add_child(n)
	if refocus != null and _fields.has(refocus):
		_fields[refocus].grab_focus()


func _item(it: Dictionary) -> Control:
	match str(it.t):
		"heading":
			var h := _text(str(it.text).to_upper(), ThemeBuilder.TEXT_MUTED, 11)
			h.custom_minimum_size.y = 26
			h.vertical_alignment = VERTICAL_ALIGNMENT_BOTTOM
			return h
		"subtitle":
			return _text(str(it.text), ThemeBuilder.TEXT, 13)
		"caption":
			return _caption(str(it.text))
		"note":
			return _note(str(it.text))
		"readout":
			var r := _text(str(it.text), ThemeBuilder.TEXT, 12)
			r.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
			r.custom_minimum_size.x = 200
			_readouts.append(r)
			return r
		"button":
			var key := str(it.key)
			var b := _button(str(it.text), func() -> void: _press(key))
			b.name = key.replace(".", "_")
			return b
		"slice_row":
			return _slice_row(it)
		"input":
			var le := _line(str(it.value), "")
			le.set_meta("key", "name")
			var commit := func() -> void:
				if le.text.strip_edges() != "" and le.text != str(flow.selected().get("name", "")):
					flow.set_field(flow.sel, "name", le.text.strip_edges())
			le.text_submitted.connect(func(_t: String) -> void: commit.call())
			le.focus_exited.connect(commit)
			return le
		"select":
			var ob := _select(it.options, it.value)
			ob.item_selected.connect(func(i: int) -> void: flow.set_field(flow.sel, "outputId", str(ob.get_item_metadata(i))))
			return ob
		"check":
			var cb := _check(str(it.text), SM.is_true(it.value))
			var key := str(it.key)
			cb.toggled.connect(func(on: bool) -> void: flow.set_field(flow.sel, key, on))
			return cb
		"num":
			return _num(it)
		"row":
			var row := _row()
			if it.has("label"):
				var l := _caption(str(it.label))
				l.custom_minimum_size.x = 78
				row.add_child(l)
			for sub in it.items:
				var c := _item(sub)
				c.size_flags_horizontal = Control.SIZE_EXPAND_FILL
				row.add_child(c)
			return row
	return Control.new()


func _slice_row(it: Dictionary) -> Control:
	var b := Button.new()
	b.text = ("▸ " if it.selected else "   ") + str(it.text) + ("" if it.enabled else "  (off)")
	b.alignment = HORIZONTAL_ALIGNMENT_LEFT
	b.toggle_mode = true
	b.button_pressed = it.selected
	b.name = "SliceRow%d" % int(it.i)
	var i := int(it.i)
	b.pressed.connect(func() -> void: flow.select(-1 if flow.sel == i else i))
	return b


func _num(it: Dictionary) -> LineEdit:
	var le := LineEdit.new()
	le.text = str(it.value)
	le.tooltip_text = str(it.tip)
	le.placeholder_text = str(it.tip)
	le.custom_minimum_size.x = 48
	var key := str(it.key)
	var dec := int(it.dec)
	le.set_meta("key", key)
	le.name = "f_" + key.replace(".", "_")
	NF.math_line(le, dec == 0, float(it.lo), float(it.hi))
	var commit := func() -> void:
		var v := float(le.text)
		var cur := float(SM.get_at(flow.selected(), key)) if not flow.selected().is_empty() else NAN
		if is_nan(cur) or is_equal_approx(v, cur):
			return
		flow.set_field(flow.sel, key, roundi(v) if dec == 0 else snappedf(v, pow(10.0, -dec)))
	le.text_submitted.connect(func(_t: String) -> void: commit.call())
	le.focus_exited.connect(commit)
	_fields[key] = le
	return le


## A canvas moved something: refresh the numbers in place (never the field being typed in).
func _sync_numbers() -> void:
	var s: Dictionary = flow.selected()
	if s.is_empty():
		return
	var focus: Variant = box.get_viewport().gui_get_focus_owner() if box.is_inside_tree() else null
	for key in _fields:
		var le: LineEdit = _fields[key]
		if le == focus or not is_instance_valid(le):
			continue
		var v := float(SM.get_at(s, key))
		le.text = NF.fmt(v, is_equal_approx(v, roundf(v)))


func _press(key: String) -> void:
	match key:
		"slices.edit":
			edit_requested.emit()
		"slices.add":
			flow.add()
		"slice.raise":
			flow.move_z(1)
		"slice.lower":
			flow.move_z(-1)
		"slice.duplicate":
			flow.duplicate_sel()
		"slice.delete":
			if await _confirm('Delete slice "%s"?' % str(flow.selected().get("name", "")), "Delete"):
				flow.delete_sel()
