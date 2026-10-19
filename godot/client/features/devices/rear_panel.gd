extends PanelContainer
## WO-605 slice 1 — the Caspar host's rear panel (web device-view-caspar-render.js, read-only): the GPU and DeckLink
## sockets as labelled plates, then the Stream / Virtual cam / Record / Audio outputs. Every socket is a
## port_icon.gd registered in `anchors` (connector id → Control) for the cable layer.

const ThemeBuilder := preload("res://app/theme_builder.gd")
const PortIcon := preload("res://features/devices/port_icon.gd")
const ROW_H := 44
const PLATE := Color("#2b3038")
const ICON := {"decklink": "bnc_female_axis", "stream_out": "ethernet-port-icon", "v4l2_out": "hdmi-port-icon",
	"record_out": "record-port-icon", "audio_out": "jack-svg"}

var anchors := {}


func _ready() -> void:
	add_theme_stylebox_override("panel", ThemeBuilder.box(ThemeBuilder.BG_PANEL, ThemeBuilder.BORDER, 1))


## slots = devices_model.gd build().slots.
func show_slots(slots: Array) -> void:
	for c in get_children():
		remove_child(c)
		c.queue_free()
	anchors = {}
	var v := VBoxContainer.new()
	add_child(v)
	v.add_child(_small("REAR PANEL", ThemeBuilder.TEXT_MUTED))
	var inner := PanelContainer.new()
	inner.add_theme_stylebox_override("panel", ThemeBuilder.box(ThemeBuilder.BG_DARK, ThemeBuilder.BORDER, 1))
	v.add_child(inner)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 32)
	row.alignment = BoxContainer.ALIGNMENT_CENTER
	inner.add_child(row)
	var extras := VBoxContainer.new()
	extras.add_theme_constant_override("separation", 10)
	for s in slots:
		if s.kind == "gpu" or s.kind == "decklink":
			row.add_child(_plate_column(s))
		else:
			extras.add_child(_extra_slot(s))
	row.add_child(extras)


## Header, then label | socket rows; the sockets sit on a plate like the hardware bracket.
func _plate_column(s: Dictionary) -> Control:
	var col := VBoxContainer.new()
	var head := _small(str(s.title).to_upper(), ThemeBuilder.TEXT_MUTED)
	head.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	col.add_child(head)
	var h := HBoxContainer.new()
	h.add_theme_constant_override("separation", 6)
	col.add_child(h)
	var labels := VBoxContainer.new()
	labels.add_theme_constant_override("separation", 0)
	h.add_child(labels)
	var plate := PanelContainer.new()
	plate.add_theme_stylebox_override("panel", ThemeBuilder.box(PLATE, ThemeBuilder.BORDER, 1, 4))
	h.add_child(plate)
	var icons := VBoxContainer.new()
	icons.add_theme_constant_override("separation", 0)
	plate.add_child(icons)
	var rows: Array = s.items.duplicate()
	if s.kind == "decklink":
		rows.append({"id": "", "label": "REF"})  # genlock input: drawn, never cabled
	if rows.is_empty():
		labels.add_child(_row_label("none"))
		icons.add_child(_spacer())
	for it in rows:
		var l := _row_label(str(it.label))
		if s.kind == "gpu" and not it.get("connected", false):
			l.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
		labels.add_child(l)
		var svg: String = ("hdmi-port-icon" if it.get("hdmi", false) else "display-port-icon") if s.kind == "gpu" \
			else ICON.decklink
		var size := Vector2(46, ROW_H) if s.kind == "gpu" else Vector2(34, ROW_H)
		var p := PortIcon.make(svg, size, "%s (%s)" % [it.label, it.id] if it.id != "" else str(it.label))
		if it.id == "":
			p.modulate.a = 0.4
		else:
			anchors[it.id] = p
		icons.add_child(p)
	return col


func _extra_slot(s: Dictionary) -> Control:
	var v := VBoxContainer.new()
	v.add_child(_small(str(s.title).to_upper(), ThemeBuilder.TEXT_MUTED))
	if s.items.is_empty():
		v.add_child(_small("—", ThemeBuilder.TEXT_MUTED))
	for it in s.items:
		var h := HBoxContainer.new()
		var p := PortIcon.make(ICON.get(s.kind, "jack-svg"), Vector2(30, 24), "%s (%s)" % [it.label, it.id])
		anchors[it.id] = p
		h.add_child(p)
		h.add_child(_small(str(it.label), ThemeBuilder.TEXT))
		v.add_child(h)
	return v


func _row_label(text: String) -> Label:
	var l := _small(text, ThemeBuilder.TEXT)
	l.custom_minimum_size.y = ROW_H
	l.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	return l


func _spacer() -> Control:
	var c := Control.new()
	c.custom_minimum_size = Vector2(34, ROW_H)
	return c


func _small(text: String, color: Color) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", 12)
	l.add_theme_color_override("font_color", color)
	return l
