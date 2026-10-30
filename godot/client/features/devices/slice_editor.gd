extends VBoxContainer
## WO-869 — "Edit slices": the mapping node's two canvases in the Devices tab centre (owner Q1), in place of the
## destinations / mapping / rear-panel body while it is open; the Inspector keeps the node page (slice list, numbers).
## Left: the input picture with the src rects (slice_canvas_src.gd). Right: one output at a time, picked by the
## output tabs, with the placed slices (slice_canvas_dst.gd). Header: Transform / Warp handle mode, Flip H / V,
## Reset warp for the selected slice, Done. Everything edits the shared slice_flow.gd.

signal closed()

const SrcCanvas := preload("res://features/devices/slice_canvas_src.gd")
const DstCanvas := preload("res://features/devices/slice_canvas_dst.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const SP := preload("res://features/devices/slice_page_model.gd")
const SM := preload("res://features/devices/slice_model.gd")

var flow: RefCounted
var src: SrcCanvas
var dst: DstCanvas
var _title := Label.new()
var _tabs := HBoxContainer.new()
var _src_cap := Label.new()
var _dst_cap := Label.new()
var _mode := {}  # "transform" / "warp" → Button
var _sel_tools: Array[Button] = []


func _init() -> void:
	name = "SliceEditor"
	add_theme_constant_override("separation", 8)
	size_flags_vertical = Control.SIZE_EXPAND_FILL
	var head := HBoxContainer.new()
	head.add_theme_constant_override("separation", 6)
	add_child(head)
	_title.add_theme_font_size_override("font_size", 15)
	head.add_child(_title)
	var gap := Control.new()
	gap.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(gap)
	head.add_child(_tabs)
	head.add_child(VSeparator.new())
	var group := ButtonGroup.new()
	for m in [["transform", "Transform"], ["warp", "Warp"]]:
		var b := _btn(head, m[1], func() -> void: _set_mode(m[0]))
		b.toggle_mode = true
		b.button_group = group
		b.button_pressed = m[0] == "transform"
		b.name = "Mode_" + m[0]
		_mode[m[0]] = b
	head.add_child(VSeparator.new())
	_sel_tools.append(_btn(head, "Flip H", func() -> void: _toggle("dst.flipH")))
	_sel_tools.append(_btn(head, "Flip V", func() -> void: _toggle("dst.flipV")))
	_sel_tools.append(_btn(head, "Reset warp", func() -> void:
		if flow.sel >= 0:
			flow.set_field(flow.sel, "dst.warp", [[0, 0], [0, 0], [0, 0], [0, 0]])))
	head.add_child(VSeparator.new())
	_btn(head, "Done", func() -> void: closed.emit()).name = "Done"
	var body := HBoxContainer.new()
	body.add_theme_constant_override("separation", 12)
	body.size_flags_vertical = Control.SIZE_EXPAND_FILL
	add_child(body)
	src = SrcCanvas.new()
	dst = DstCanvas.new()
	for pair in [[_src_cap, src], [_dst_cap, dst]]:
		var col := VBoxContainer.new()
		col.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		col.size_flags_vertical = Control.SIZE_EXPAND_FILL
		body.add_child(col)
		pair[0].add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
		pair[0].add_theme_font_size_override("font_size", 12)
		col.add_child(pair[0])
		pair[1].size_flags_vertical = Control.SIZE_EXPAND_FILL
		pair[1].custom_minimum_size = Vector2(320, 240)
		col.add_child(pair[1])
	src.name = "SliceInput"
	dst.name = "SliceOutput"
	var hint := Label.new()
	hint.text = "Input: drag on empty space to cut a new slice, drag a slice to move it, its handles to resize. " \
		+ "Output: drag to place; Transform handles scale / rotate (Shift: 15°), Warp handles keystone. Alt: no snap."
	hint.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	hint.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	hint.add_theme_font_size_override("font_size", 11)
	add_child(hint)


func _btn(parent: Control, text: String, cb: Callable) -> Button:
	var b := Button.new()
	b.text = text
	b.pressed.connect(cb)
	b.name = text.replace(" ", "")
	parent.add_child(b)
	return b


func open(f: RefCounted) -> void:
	if flow != null and flow.changed.is_connected(_on_changed):
		flow.changed.disconnect(_on_changed)
	flow = f
	flow.changed.connect(_on_changed)
	src.bind(flow)
	dst.bind(flow)
	var s: Dictionary = flow.selected()
	show_output(str(s.outputId) if not s.is_empty() else (str(flow.outputs[0].id) if not flow.outputs.is_empty() else ""))


func close() -> void:
	if flow != null and flow.changed.is_connected(_on_changed):
		flow.changed.disconnect(_on_changed)
	VideoSurfaces.release_all(src)
	VideoSurfaces.release_all(dst)


func show_output(id: String) -> void:
	dst.out_id = id
	src.out_id = id
	_refresh()


func _on_changed(kind: String) -> void:
	var s: Dictionary = flow.selected()
	if kind == "select" and not s.is_empty() and str(s.outputId) != dst.out_id:
		show_output(str(s.outputId))  # selecting a slice on the input shows the output it lands on
		return
	if kind != "geometry":
		_refresh()


func _refresh() -> void:
	if flow == null:
		return
	_title.text = "Edit slices — %s" % str(flow.label)
	for c in _tabs.get_children():
		_tabs.remove_child(c)
		c.queue_free()
	if not flow.outputs.any(func(o: Dictionary) -> bool: return o.id == dst.out_id) and not flow.outputs.is_empty():
		dst.out_id = str(flow.outputs[0].id)
		src.out_id = dst.out_id
	for o in flow.outputs:
		var b := Button.new()
		b.text = str(o.label)
		b.toggle_mode = true
		b.button_pressed = o.id == dst.out_id
		b.name = "Out_" + str(o.id)
		var id := str(o.id)
		b.pressed.connect(func() -> void: show_output(id))
		_tabs.add_child(b)
	var o: Dictionary = flow.output(dst.out_id)
	var row: Dictionary = flow.plan_row(dst.out_id)
	var feed := " · not cabled to a screen"
	if int(flow.screen) > 0:
		feed = " · PGM %d" % int(flow.screen) + (" (ch%d)" % int(flow.channel) if int(flow.channel) > 0 else "")
	_src_cap.text = "Input — %d×%d%s" % [int(flow.input.x), int(flow.input.y), feed]
	_dst_cap.text = "%s — %d×%d · %s" % [str(o.label), int(o.w), int(o.h), SP.backend_text(row)]
	for b in _sel_tools:
		b.disabled = flow.sel < 0
	dst.queue_redraw()
	src.queue_redraw()


func _set_mode(m: String) -> void:
	dst.mode = m
	dst.queue_redraw()


func _toggle(path: String) -> void:
	var s: Dictionary = flow.selected()
	if not s.is_empty():
		flow.set_field(flow.sel, path, not bool(SM.get_at(s, path)))
