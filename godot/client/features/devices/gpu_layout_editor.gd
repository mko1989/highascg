extends VBoxContainer
## WO-605 slice 9b-2 — the GPU page's layout editor in GPU edit mode (web device-view-inspector-gpu-layout-editor.js):
## one row per physical socket (Socket N (label), Port A / Port B, Hide connector) to drag into order — dropping on a
## row's lower half lands after it — the unmapped live displays to assign onto a socket, Show all / Hide disconnected /
## Hide all, then Save / Export / Load / Reset layout. The requests live in gpu_layout_flow.gd (golden-tested) and
## report through its `io` (make_io); the page keeps the flow so its rows survive the reloads every change asks for.

const ThemeBuilder := preload("res://app/theme_builder.gd")
const FLOW := preload("res://features/devices/gpu_layout_flow.gd")
const FilePick := preload("res://features/devices/file_pick.gd")

var flow: Variant
var _busy := false


## The flow's `io`: the server, this client's saved layout, and the page's confirm dialog / status line / reload.
class Io:
	extends RefCounted
	var confirm_fn: Callable  # (text) -> bool, awaited
	var status_fn: Callable  # (text, ok)
	var reload_fn: Callable

	func post_json(path: String, body: Variant) -> Dictionary:
		return await DevicesTarget.api.post_json(path, body)

	func confirm(text: String) -> bool:
		return await confirm_fn.call(text)

	func reload() -> void:
		reload_fn.call()

	func status(text: String, ok: bool) -> void:
		status_fn.call(text, ok)

	func prefs_save(items: Array) -> void:
		FLOW.GL.save(items)

	func prefs_clear() -> void:
		FLOW.GL.clear()


static func make_io(confirm_fn: Callable, status_fn: Callable, reload_fn: Callable) -> Io:
	var io := Io.new()
	io.confirm_fn = confirm_fn
	io.status_fn = status_fn
	io.reload_fn = reload_fn
	return io


func setup(flow_: Variant) -> void:
	flow = flow_
	add_theme_constant_override("separation", 4)
	var box := PanelContainer.new()
	box.add_theme_stylebox_override("panel", ThemeBuilder.box(ThemeBuilder.BG_PANEL, ThemeBuilder.BORDER, 1, 4))
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 4)
	box.add_child(v)
	add_child(box)
	var head := _text(FLOW.HEADING, ThemeBuilder.TEXT_MUTED, 11)
	head.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	head.custom_minimum_size.x = 200
	v.add_child(head)
	var rows: Array = flow.rows()
	for i in rows.size():
		v.add_child(_row(i, rows[i]))
	var unmapped: Array = flow.unmapped()
	if not unmapped.is_empty():
		v.add_child(_text(FLOW.UNMAPPED_HEADING, ThemeBuilder.WARN, 11))
		for u in unmapped:
			v.add_child(_unmapped_row(u))
	var bulk := HFlowContainer.new()
	for b in FLOW.BULK:
		var name: String = b[0]
		bulk.add_child(_button(name, func() -> void: _run(flow.bulk.bind(name)), b[1]))
	v.add_child(bulk)
	var acts := HBoxContainer.new()
	for b in [["Save", func() -> void: _run(flow.save)], ["Export", _export], ["Load", _load]]:
		acts.add_child(_button(b[0], b[1]))
	var fill := Control.new()
	fill.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	acts.add_child(fill)
	var reset := _button("Reset layout", func() -> void: _run(flow.reset), FLOW.RESET_TIP)
	reset.add_theme_color_override("font_color", ThemeBuilder.ERROR)
	acts.add_child(reset)
	v.add_child(acts)


## One flow call at a time (a second press while a save is out is dropped).
func _run(call: Callable) -> void:
	if _busy:
		return
	_busy = true
	await call.call()
	_busy = false


func _row(i: int, r: Dictionary) -> Control:
	var p := PanelContainer.new()
	p.mouse_default_cursor_shape = Control.CURSOR_DRAG
	p.add_theme_stylebox_override("panel", _row_box(0, 0))
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 2)
	p.add_child(v)
	var h := HBoxContainer.new()
	var title := _text(r.head, ThemeBuilder.TEXT_MUTED, 10)
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	h.add_child(title)
	h.add_child(_text("≡", ThemeBuilder.TEXT_MUTED, 12))
	v.add_child(h)
	var ports := HBoxContainer.new()
	var a := _port_select(r.a)
	var b := _port_select(r.b)
	ports.add_child(a)
	ports.add_child(b)
	v.add_child(ports)
	var hide := CheckBox.new()
	hide.text = "Hide connector"
	hide.button_pressed = r.hidden
	hide.focus_mode = Control.FOCUS_NONE
	hide.add_theme_font_size_override("font_size", 10)
	v.add_child(hide)
	var edit := func(_x: Variant = null) -> void:
		_run(flow.edit.bind(i, str(a.get_item_metadata(a.selected)) if a.selected >= 0 else "",
			str(b.get_item_metadata(b.selected)) if b.selected >= 0 else "", hide.button_pressed))
	a.item_selected.connect(edit)
	b.item_selected.connect(edit)
	hide.toggled.connect(edit)
	p.set_drag_forwarding(func(_at: Vector2) -> Variant:
		p.set_drag_preview(_text(r.head, ThemeBuilder.TEXT, 12))
		return {"gpu_layout_row": i},
		func(at: Vector2, data: Variant) -> bool:
			var ok: bool = data is Dictionary and data.has("gpu_layout_row") and int(data.gpu_layout_row) != i
			if ok:
				var after := at.y > p.size.y / 2
				p.add_theme_stylebox_override("panel", _row_box(0 if after else 2, 2 if after else 0))
			return ok,
		func(at: Vector2, data: Variant) -> void:
			p.add_theme_stylebox_override("panel", _row_box(0, 0))
			_run(flow.move.bind(int(data.gpu_layout_row), i, at.y > p.size.y / 2)))
	p.mouse_exited.connect(func() -> void: p.add_theme_stylebox_override("panel", _row_box(0, 0)))
	return p


## Port A / B: None + every RandR name; a pair name the list lacks shows as None (the web's <select> does the same).
func _port_select(value: String) -> OptionButton:
	var ob := OptionButton.new()
	ob.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	ob.fit_to_longest_item = false
	ob.clip_text = true
	ob.focus_mode = Control.FOCUS_NONE
	ob.add_theme_font_size_override("font_size", 11)
	var opts: Array = [""] + flow.options
	for k in opts.size():
		ob.add_item("None" if opts[k] == "" else opts[k], k)
		ob.set_item_metadata(k, opts[k])
	ob.select(maxi(opts.find(value), 0))
	return ob


func _unmapped_row(u: Dictionary) -> Control:
	var h := HBoxContainer.new()
	var name := _text(u.name, ThemeBuilder.TEXT, 11)
	name.custom_minimum_size.x = 80
	h.add_child(name)
	var sel := OptionButton.new()
	sel.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	sel.focus_mode = Control.FOCUS_NONE
	sel.add_theme_font_size_override("font_size", 11)
	for s in u.sockets:
		sel.add_item(s)
	h.add_child(sel)
	h.add_child(_button("Assign", func() -> void:
		if sel.selected >= 0:
			_run(flow.assign.bind(u.name, sel.get_item_text(sel.selected))), FLOW.ASSIGN_TIP))
	return h


func _export() -> void:
	var path: String = await FilePick.save_path(self, "Export GPU layout", flow.export_name())
	if path == "":
		return
	var err := FilePick.write_text(path, flow.export_text())
	flow.io.status("Export failed: " + err if err != "" else "Exported " + path.get_file(), err == "")


func _load() -> void:
	var path: String = await FilePick.open_path(self, "Load GPU layout")
	if path != "":
		_run(flow.load_text.bind(FileAccess.get_file_as_string(path)))


static func _row_box(top: int, bottom: int) -> StyleBoxFlat:
	var b: StyleBoxFlat = ThemeBuilder.box(ThemeBuilder.BG_DARK, ThemeBuilder.BORDER, 1, 3)
	b.border_width_top = 1 if top == 0 else top
	b.border_width_bottom = 1 if bottom == 0 else bottom
	if top > 0 or bottom > 0:
		b.border_color = ThemeBuilder.ACCENT
	for side in ["left", "right", "top", "bottom"]:
		b.set("content_margin_" + side, 6 if side in ["left", "right"] else 4)
	return b


func _button(text: String, on_press: Callable, tip := "") -> Button:
	var b := Button.new()
	b.text = text
	b.tooltip_text = tip
	b.focus_mode = Control.FOCUS_NONE
	b.add_theme_font_size_override("font_size", 11)
	b.pressed.connect(on_press)
	return b


func _text(text: String, color: Color, size: int) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	return l
