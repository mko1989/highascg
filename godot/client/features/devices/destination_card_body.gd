extends RefCounted
## WO-1029 (owner 10.11) — the inside of a screen-destination card, split from destinations_panel.gd so a headless
## test can build it (the panel needs the DevicesTarget autoload). Title + subtitle on the left; a multi-dot card
## (PGM/PRV, Operator GUI 1 / 2) stacks its dots on the right, starting at the card's top, so the card is only as
## tall as the text block. A one-dot card keeps its dot on the title row.

const ThemeBuilder := preload("res://app/theme_builder.gd")
const Model := preload("res://features/devices/devices_model.gd")
const PortIcon := preload("res://features/devices/port_icon.gd")
const PGM := Color("#e74c3c")
const PRV := Color("#2ecc71")
## One dot row: two rows ~ the title + subtitle block (~41 px at scale 1); the dot itself stays 14 px.
const ROW_H := 20


## `anchors` gets every output dot (id / id#pgm / id#prv) for the cable layer, as before.
static func build(d: Dictionary, anchors: Dictionary) -> HBoxContainer:
	var h := HBoxContainer.new()
	h.add_theme_constant_override("separation", 6)
	h.mouse_filter = Control.MOUSE_FILTER_PASS
	var v := VBoxContainer.new()
	v.name = "text"
	v.add_theme_constant_override("separation", 2)
	v.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	v.mouse_filter = Control.MOUSE_FILTER_PASS
	h.add_child(v)
	var title := HBoxContainer.new()
	title.mouse_filter = Control.MOUSE_FILTER_PASS
	v.add_child(title)
	var t := label(str(d.label), ThemeBuilder.TEXT, 15)
	t.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	title.add_child(t)
	if d.halves.is_empty():
		title.add_child(dot(anchors, d.connector, "%s output" % d.label))
	v.add_child(label(str(d.sub), ThemeBuilder.TEXT_MUTED, 12))
	var dots := VBoxContainer.new()
	dots.name = "dots"
	dots.add_theme_constant_override("separation", 0)
	dots.mouse_filter = Control.MOUSE_FILTER_PASS
	h.add_child(dots)
	for i in d.halves.size():
		var half: String = d.halves[i]
		var tag_text: String = d.half_tags[i]
		var row := HBoxContainer.new()
		row.mouse_filter = Control.MOUSE_FILTER_PASS
		row.custom_minimum_size.y = ROW_H
		var gui: bool = d.mode == "operator_gui"
		var tag := label(tag_text, ThemeBuilder.TEXT if gui else (PGM if half == "pgm" else PRV), 11)
		tag.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		row.add_child(tag)
		if half == "pgm" or d.get("prv_dot", true):
			var tip := "%s %s output" % [d.label, tag_text]
			if gui:
				tip = "%s — monitor %s (%s window)" % [d.label, tag_text, "second operator" if half == "prv" else "main"]
			row.add_child(dot(anchors, Model.anchor_key(d.connector, half), tip))
		dots.add_child(row)
	return h


static func dot(anchors: Dictionary, key: String, tip: String) -> Control:
	var p := PortIcon.make("", Vector2(14, 14), tip)
	p.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	anchors[key] = p
	return p


static func label(text: String, color: Color, size: int) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	return l
