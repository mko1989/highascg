extends PanelContainer
## WO-605 slice 1 — the Caspar host's rear panel (web device-view-caspar-render.js, read-only): the GPU and DeckLink
## sockets as labelled plates, then the Stream / Virtual cam / Record / Audio outputs. Every socket has a small
## port_icon.gd dot in its middle, registered in `anchors` (connector id → Control) for the cable layer: cables start
## and finish only on the dots (web: .device-view__connector-dot), so a click on the rest of the socket opens its page.
## Slice 4/5: a GPU / DeckLink port's row label (or socket) opens its connector page (web: the marker body opens the inspector, the dot
## cables). Cables hang over the labels, so the tab hit-tests them first (`label_at`) instead of a gui_input handler.
## Slice 6: the Stream / Virtual cam / Record / Audio labels open their pages too, and each of those headers has the
## web's "+" (`add_requested`).
## Slice 9a: the DeckLink header's pencil toggles DeckLink edit mode (decklink_order.gd `edit`): the port labels
## turn draggable — drop one on another and they trade places (saved per client, `order_changed`); a press without
## a drop still opens the page (`open_requested`). The Devices tab hands the press over through `begin_drag`.
## Slice 9b-2: the GPU header's pencil toggles GPU edit mode (gpu_layout.gd `edit`): Show all / Clear layout join the
## header, hidden ports come back dimmed, and a GPU label dropped on another swaps the two sockets (`gpu_edit`,
## carried out by gpu_output_controls.gd). Turning either mode on hands the first port to open (`edit_toggled`).

signal add_requested(kind: String)
signal edit_toggled(first: String)
signal gpu_edit(what: String, a: String, b: String)  # "show_all" | "clear" | "swap" (slot a ↔ slot b)
signal order_changed
signal open_requested(id: String)

const ThemeBuilder := preload("res://app/theme_builder.gd")
const PortIcon := preload("res://features/devices/port_icon.gd")
const DO := preload("res://features/devices/decklink_order.gd")
const GL := preload("res://features/devices/gpu_layout.gd")
const H := preload("res://features/devices/host_channels.gd")
const ROW_H := 44
const DOT_TIP := "Start or complete cable at this connector"
const PLATE := Color("#2b3038")
const GPU_EDIT_TIP := "Edit GPU layout — reorder ports, Show all, or Reset Layout (xrandr)"
const ICON := {"decklink": "bnc_female_axis", "stream_out": "ethernet-port-icon", "v4l2_out": "hdmi-port-icon",
	"record_out": "record-port-icon", "audio_out": "jack-svg"}

static var folder_open := false  # the GPU "Disconnected" fold (web <details>, closed per page load)

var anchors := {}
var _labels := {}  # connector id → its clickable row Label
var _icons := {}  # connector id → its socket (clicks open the page like the label)
var _deck_ids: Array = []  # the DeckLink ports in panel order
var _gpu_slots := {}  # GPU connector id → its layout slot id (what the swap moves)
var _drag := ""  # the DeckLink / GPU port being dragged (edit mode)
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
	_icons = {}
	_drag = ""
	_deck_ids = []
	_gpu_slots = {}
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


## Header, then label | socket rows; the sockets sit on a plate like the hardware bracket. GPU (slice 9b): rows the
## client's layout hides are left out ("(N hidden)" in the header) and sockets that are neither topology slots nor
## live go in a "Disconnected (N)" fold under the plate (web: a closed <details>).
func _plate_column(s: Dictionary) -> Control:
	var col := VBoxContainer.new()
	var head := _small(str(s.title).to_upper(), ThemeBuilder.TEXT_MUTED)
	head.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	var hb := HBoxContainer.new()
	hb.alignment = BoxContainer.ALIGNMENT_END
	hb.add_child(head)
	col.add_child(hb)
	var rows: Array = s.items.duplicate()
	if s.kind == "decklink":
		hb.add_child(_pencil(false))
		_deck_ids = s.items.map(func(it: Dictionary) -> String: return str(it.id))
		rows.append({"id": "", "label": "REF"})  # genlock input: drawn, never cabled
		col.add_child(_plate(rows, s.kind))
		return col
	var hidden := rows.filter(func(it: Dictionary) -> bool: return H.truthy(it.get("hidden"))).size()
	if hidden > 0:
		var hint := _small("(%d hidden)" % hidden, ThemeBuilder.TEXT_MUTED)
		hint.tooltip_text = "Open GPU layout editor (pencil) and click Show all"
		hint.mouse_filter = Control.MOUSE_FILTER_STOP
		hb.add_child(hint)
	hb.add_child(_pencil(true))
	if GL.edit:
		for b in [["Show all", "show_all", "Show every GPU port on the rear panel"],
				["Clear layout", "clear", "Discard saved GPU layout and rebuild from detected outputs"]]:
			var what: String = b[1]
			var btn := Button.new()
			btn.text = b[0]
			btn.tooltip_text = b[2]
			btn.flat = true
			btn.focus_mode = Control.FOCUS_NONE
			btn.add_theme_font_size_override("font_size", 10)
			if what == "clear":
				btn.add_theme_color_override("font_color", Color("#ff9f9f"))
			btn.pressed.connect(func() -> void: gpu_edit.emit(what, "", ""))
			hb.add_child(btn)
	for it in rows:
		_gpu_slots[str(it.id)] = str(it.get("layoutSlotId", it.id))
	var folder := rows.filter(func(it: Dictionary) -> bool: return it.get("folder", false))
	col.add_child(_plate(rows.filter(func(it: Dictionary) -> bool: return not it.get("folder", false)), s.kind))
	if not folder.is_empty():
		var fold := _plate(folder, s.kind)
		fold.visible = folder_open
		var b := Button.new()
		b.flat = true
		b.focus_mode = Control.FOCUS_NONE
		b.alignment = HORIZONTAL_ALIGNMENT_RIGHT
		b.add_theme_font_size_override("font_size", 11)
		b.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
		b.text = "%s Disconnected (%d)" % ["▾" if folder_open else "▸", folder.size()]
		b.pressed.connect(func() -> void:
			folder_open = not folder_open
			fold.visible = folder_open
			b.text = "%s Disconnected (%d)" % ["▾" if folder_open else "▸", folder.size()])
		col.add_child(b)
		col.add_child(fold)
	return col


func _plate(rows: Array, kind: String) -> Control:
	var h := HBoxContainer.new()
	h.add_theme_constant_override("separation", 6)
	var labels := VBoxContainer.new()
	labels.add_theme_constant_override("separation", 0)
	h.add_child(labels)
	var plate := PanelContainer.new()
	plate.add_theme_stylebox_override("panel", ThemeBuilder.box(PLATE, ThemeBuilder.BORDER, 1, 4))
	h.add_child(plate)
	var icons := VBoxContainer.new()
	icons.add_theme_constant_override("separation", 0)
	plate.add_child(icons)
	if kind == "gpu" and not GL.edit:  # edit mode shows the hidden ports dimmed (web: opacity 0.3)
		rows = rows.filter(func(it: Dictionary) -> bool: return not H.truthy(it.get("hidden")))
	if rows.is_empty():
		labels.add_child(_row_label("none"))
		icons.add_child(_spacer())
	for it in rows:
		var l := _row_label(str(it.label))
		if kind == "gpu" and not it.get("connected", false):
			l.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
		if (kind == "gpu" or kind == "decklink") and it.id != "":
			l.mouse_filter = Control.MOUSE_FILTER_STOP
			l.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
			l.tooltip_text = "%s — open in the Inspector" % it.label
			if kind == "decklink" and DO.edit:
				l.tooltip_text = "%s — drag onto another port to swap" % it.label
				l.add_theme_color_override("font_color", ThemeBuilder.ACCENT)
				l.mouse_default_cursor_shape = Control.CURSOR_DRAG
			if kind == "gpu" and GL.edit:
				l.tooltip_text = "%s — drag onto another GPU port to swap sockets" % it.label
				l.mouse_default_cursor_shape = Control.CURSOR_DRAG
			_labels[str(it.id)] = l
		labels.add_child(l)
		var svg: String = ("hdmi-port-icon" if it.get("hdmi", false) else "display-port-icon") if kind == "gpu" \
			else ICON.decklink
		var size := Vector2(46, ROW_H) if kind == "gpu" else Vector2(34, ROW_H)
		var p := PortIcon.make(svg, size, "%s (%s)" % [it.label, it.id] if it.id != "" else str(it.label))
		if kind == "gpu" and H.truthy(it.get("hidden")):
			l.modulate.a = 0.3
			p.modulate.a = 0.3
		if it.id == "":
			p.modulate.a = 0.4
		else:
			p.mouse_default_cursor_shape = l.mouse_default_cursor_shape
			_icons[str(it.id)] = p
			_dot(p, str(it.id))
		icons.add_child(p)
	return h


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
		var p := PortIcon.make(ICON.get(s.kind, "jack-svg"), Vector2(40, 40), "%s (%s)" % [it.label, it.id])
		p.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
		_icons[str(it.id)] = p
		_dot(p, str(it.id))
		h.add_child(p)
		var l := _small(str(it.label), ThemeBuilder.TEXT)
		l.mouse_filter = Control.MOUSE_FILTER_STOP
		l.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
		l.tooltip_text = "%s — open in the Inspector" % it.label
		_labels[str(it.id)] = l
		h.add_child(l)
		v.add_child(h)
	return v


## The DeckLink / GPU edit-mode pencil (web: the slot title's edit button; blue while on).
func _pencil(gpu: bool) -> Button:
	var b := Button.new()
	b.flat = true
	b.focus_mode = Control.FOCUS_NONE
	b.custom_minimum_size = Vector2(20, 18)
	b.tooltip_text = GPU_EDIT_TIP if gpu else DO.EDIT_TIP
	b.pressed.connect(func() -> void:
		if gpu:
			GL.edit = not GL.edit
			edit_toggled.emit(_gpu_slots.keys().front() if GL.edit and not _gpu_slots.is_empty() else "")
		else:
			DO.edit = not DO.edit
			edit_toggled.emit(_deck_ids.front() if DO.edit and not _deck_ids.is_empty() else ""))
	b.draw.connect(func() -> void:
		var col: Color = ThemeBuilder.ACCENT if (GL.edit if gpu else DO.edit) else ThemeBuilder.TEXT_MUTED
		var c := b.size / 2.0
		b.draw_polyline([c + Vector2(-1, -6), c + Vector2(-6, -6), c + Vector2(-6, 6), c + Vector2(6, 6), c + Vector2(6, 1)], col, 1.5, true)
		b.draw_line(c + Vector2(-2, 2), c + Vector2(6, -6), col, 2.0, true))
	return b


## Edit mode: a press on a DeckLink / GPU label starts a drag (true = taken).
func begin_drag(pos: Vector2) -> bool:
	var id := label_at(pos)
	if not (DO.edit and _deck_ids.has(id)) and not (GL.edit and _gpu_slots.has(id)):
		return false
	_drag = id
	_over = id
	return true


func _input(event: InputEvent) -> void:
	if _drag == "":
		return
	if event is InputEventMouseMotion:
		var id := label_at(event.global_position)
		id = id if _same_kind(_drag, id) else ""
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
		elif _same_kind(from, to) and _gpu_slots.has(to):
			gpu_edit.emit("swap", _gpu_slots[from], _gpu_slots[to])
		elif _same_kind(from, to):
			DO.save(DO.swap(_deck_ids, from, to))
			order_changed.emit()


## A drag from port `a` can land on port `b` (DeckLink onto DeckLink, GPU onto GPU).
func _same_kind(a: String, b: String) -> bool:
	return (_deck_ids.has(a) and _deck_ids.has(b)) or (_gpu_slots.has(a) and _gpu_slots.has(b))


func _mark(id: String, on: bool) -> void:
	if id != "" and id != _drag and _labels.has(id) and is_instance_valid(_labels[id]):
		_labels[id].add_theme_color_override("font_outline_color", ThemeBuilder.ACCENT)
		_labels[id].add_theme_constant_override("outline_size", 3 if on else 0)


## The connector whose row label or socket is under `pos` (global), else "".
func label_at(pos: Vector2) -> String:
	for m in [_labels, _icons]:
		for id in m:
			var c: Control = m[id]
			if is_instance_valid(c) and c.is_visible_in_tree() and c.get_global_rect().has_point(pos):
				return id
	return ""


## The socket's cable dot (12 px, web .device-view__connector-dot), centred on it.
func _dot(socket: Control, id: String) -> void:
	var d := PortIcon.make("", Vector2(12, 12), DOT_TIP)
	d.mouse_default_cursor_shape = Control.CURSOR_CROSS
	d.set_anchors_preset(Control.PRESET_CENTER)
	d.offset_left = -6
	d.offset_top = -6
	d.offset_right = 6
	d.offset_bottom = 6
	socket.add_child(d)
	anchors[id] = d


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
