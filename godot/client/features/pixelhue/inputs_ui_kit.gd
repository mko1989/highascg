extends RefCounted
## WO-1039 — Inputs sub-tab: the few widget builders both views share.

const ThemeBuilder := preload("res://app/theme_builder.gd")
const NF := preload("res://core/numeric_field.gd")


## OptionButton over [[value, label], …]; the value of an entry is kept as item metadata.
static func option(options: Array, value: Variant, tip: String, on_pick: Callable) -> OptionButton:
	var ob := OptionButton.new()
	ob.tooltip_text = tip
	ob.fit_to_longest_item = false
	ob.clip_text = true
	var chosen := 0
	for i in options.size():
		ob.add_item(str(options[i][1]), i)
		ob.set_item_metadata(i, options[i][0])
		if str(options[i][0]) == str(value) or (_num(options[i][0]) and _num(value) and float(options[i][0]) == float(value)):
			chosen = i
	if not options.is_empty():
		ob.select(chosen)
	ob.item_selected.connect(func(i: int) -> void: on_pick.call(ob.get_item_metadata(i)))
	return ob


static func _num(v: Variant) -> bool:
	return v is int or v is float


static func selected_value(ob: OptionButton) -> Variant:
	return ob.get_item_metadata(ob.selected) if ob.selected >= 0 else null


## A number field with NF maths; `on_set(float)` runs on every edit and after the maths rewrote it.
static func number(value: Variant, tip: String, as_int: bool, lo: float, hi: float, on_set: Callable, width := 70) -> LineEdit:
	var le := LineEdit.new()
	le.text = "" if value == null else NF.fmt(float(value), as_int)
	le.tooltip_text = tip
	le.custom_minimum_size.x = width
	var push := func(t: String) -> void:
		if t.is_valid_float():
			on_set.call(float(t))
	NF.math_line(le, as_int, lo, hi, push)
	le.text_changed.connect(push)
	return le


static func muted(text: String, parent: Node = null) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	l.add_theme_font_size_override("font_size", 12)
	if parent != null:
		parent.add_child(l)
	return l


static func labelled(label: String, control: Control) -> VBoxContainer:
	var v := VBoxContainer.new()
	muted(label, v)
	v.add_child(control)
	return v


static func heading(text: String, parent: Node) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_color_override("font_color", ThemeBuilder.ACCENT)
	parent.add_child(l)
	return l


static func button(text: String, cb: Callable, parent: Node = null) -> Button:
	var b := Button.new()
	b.text = text
	b.pressed.connect(cb)
	if parent != null:
		parent.add_child(b)
	return b


static func clear(node: Node) -> void:
	for c in node.get_children():
		node.remove_child(c)
		c.queue_free()
