extends PanelContainer
## WO-605 slice 1 — the Caspar host's rear panel (web device-view-caspar-render.js, read-only): the GPU and DeckLink
## sockets as labelled plates, then the Stream / Virtual cam / Record / Audio outputs. Every socket is a
## port_icon.gd registered in `anchors` (connector id → Control) for the cable layer.
## Slice 4/5: a GPU / DeckLink port's row label opens its connector page (web: the marker body opens the inspector, the dot
## cables). Cables hang over the labels, so the tab hit-tests them first (`label_at`) instead of a gui_input handler.
## Slice 6: the Stream / Virtual cam / Record / Audio labels open their pages too, and each of those headers has the
## web's "+" (`add_requested`).
## Slice 9a: the DeckLink header's pencil toggles DeckLink edit mode (decklink_order.gd `edit`): the port labels
## turn draggable — drop one on another and they trade places (saved per client, `order_changed`); a press without
## a drop still opens the page (`open_requested`). The Devices tab hands the press over through `begin_drag`.

signal add_requested(kind: String)
signal edit_toggled(on: bool)
signal order_changed
signal open_requested(id: String)

const ThemeBuilder := preload("res://app/theme_builder.gd")
const PortIcon := preload("res://features/devices/port_icon.gd")
const DO := preload("res://features/devices/decklink_order.gd")
const ROW_H := 44
const PLATE := Color("#2b3038")
const ICON := {"decklink": "bnc_female_axis", "stream_out": "ethernet-port-icon", "v4l2_out": "hdmi-port-icon",
	"record_out": "record-port-icon", "audio_out": "jack-svg"}

var anchors := {}
var _labels := {}  # connector id → its clickable row Label
var _deck_ids: Array = []  # the DeckLink ports in panel order
var _drag := ""  # the DeckLink port being dragged (edit mode)
var _over := ""


func _ready() -> void:
	add_theme_stylebox_override("panel", ThemeBuilder.box(ThemeBuilder.BG_PANEL, ThemeBuilder.BORDER, 1))


## slots = devices_model.gd build().slots.
func show_slots(slots: Array) -> void:
	for c in get_children():
		remove_child(c)
		c.queue_free()
	anchors = {}
	_labels = {}
	_drag = ""
	_deck_ids = []
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
	if s.kind == "decklink":
		var hb := HBoxContainer.new()
		hb.alignment = BoxContainer.ALIGNMENT_END
		hb.add_child(head)
		hb.add_child(_pencil())
		col.add_child(hb)
		_deck_ids = s.items.map(func(it: Dictionary) -> String: return str(it.id))
	else:
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
		if (s.kind == "gpu" or s.kind == "decklink") and it.id != "":
			l.mouse_filter = Control.MOUSE_FILTER_STOP
			l.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
			l.tooltip_text = "%s — open in the Inspector" % it.label
			if s.kind == "decklink" and DO.edit:
				l.tooltip_text = "%s — drag onto another port to swap" % it.label
				l.add_theme_color_override("font_color", ThemeBuilder.ACCENT)
				l.mouse_default_cursor_shape = Control.CURSOR_DRAG
			_labels[str(it.id)] = l
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
	var head := HBoxContainer.new()
	head.add_child(_small(str(s.title).to_upper(), ThemeBuilder.TEXT_MUTED))
	var plus := Button.new()
	plus.text = "+"
	plus.flat = true
	plus.tooltip_text = "Add new %s output" % str(s.title).to_lower()
	plus.add_theme_font_size_override("font_size", 12)
	plus.pressed.connect(func() -> void: add_requested.emit(str(s.kind)))
	head.add_child(plus)
	v.add_child(head)
	if s.items.is_empty():
		v.add_child(_small("—", ThemeBuilder.TEXT_MUTED))
	for it in s.items:
		var h := HBoxContainer.new()
		var p := PortIcon.make(ICON.get(s.kind, "jack-svg"), Vector2(30, 24), "%s (%s)" % [it.label, it.id])
		anchors[it.id] = p
		h.add_child(p)
		var l := _small(str(it.label), ThemeBuilder.TEXT)
		l.mouse_filter = Control.MOUSE_FILTER_STOP
		l.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
		l.tooltip_text = "%s — open in the Inspector" % it.label
		_labels[str(it.id)] = l
		h.add_child(l)
		v.add_child(h)
	return v


## The DeckLink edit-mode pencil (web: the slot title's edit button; blue while on).
func _pencil() -> Button:
	var b := Button.new()
	b.flat = true
	b.focus_mode = Control.FOCUS_NONE
	b.custom_minimum_size = Vector2(20, 18)
	b.tooltip_text = DO.EDIT_TIP
	b.pressed.connect(func() -> void:
		DO.edit = not DO.edit
		edit_toggled.emit(DO.edit))
	b.draw.connect(func() -> void:
		var col: Color = ThemeBuilder.ACCENT if DO.edit else ThemeBuilder.TEXT_MUTED
		var c := b.size / 2.0
		b.draw_polyline([c + Vector2(-1, -6), c + Vector2(-6, -6), c + Vector2(-6, 6), c + Vector2(6, 6), c + Vector2(6, 1)], col, 1.5, true)
		b.draw_line(c + Vector2(-2, 2), c + Vector2(6, -6), col, 2.0, true))
	return b


## Edit mode: a press on a DeckLink label starts a drag (true = taken).
func begin_drag(pos: Vector2) -> bool:
	if not DO.edit:
		return false
	var id := label_at(pos)
	if not _deck_ids.has(id):
		return false
	_drag = id
	_over = id
	return true


func _input(event: InputEvent) -> void:
	if _drag == "":
		return
	if event is InputEventMouseMotion:
		var id := label_at(event.global_position)
		id = id if _deck_ids.has(id) else ""
		if id != _over:
			_mark(_over, false)
			_over = id
			_mark(_over, true)
	elif event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT and not event.pressed:
		get_viewport().set_input_as_handled()
		var from := _drag
		var to := label_at(event.global_position)
		_mark(_over, false)
		_drag = ""
		if to == from:
			open_requested.emit(from)
		elif _deck_ids.has(to):
			DO.save(DO.swap(_deck_ids, from, to))
			order_changed.emit()


func _mark(id: String, on: bool) -> void:
	if id != "" and id != _drag and _labels.has(id) and is_instance_valid(_labels[id]):
		_labels[id].add_theme_color_override("font_outline_color", ThemeBuilder.ACCENT)
		_labels[id].add_theme_constant_override("outline_size", 3 if on else 0)


## The connector whose row label is under `pos` (global), else "".
func label_at(pos: Vector2) -> String:
	for id in _labels:
		var l: Label = _labels[id]
		if is_instance_valid(l) and l.is_visible_in_tree() and l.get_global_rect().has_point(pos):
			return id
	return ""


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
