extends VBoxContainer
## WO-869 / WO-944 — the mapping node's editor in the Devices tab centre (owner Q1), in place of the destinations /
## mapping / rear-panel body while it is open; the Inspector keeps the node page (slice list, numbers).
## Two views (toggle in the header):
## - Place outputs (WO-944, the default whenever the node allows it): ONE canvas — the screen destination cabled into
##   the node — with every output as a frame of its own resolution (output_place_canvas.gd). Drag a frame, or type
##   its X / Y; "Side by side" lines them up from x 0. Each output carries the canvas under its frame, 1:1.
## - Free slices (WO-869): the input with the src rects (slice_canvas_src.gd) and one output at a time with the placed
##   slices (slice_canvas_dst.gd); Transform / Warp handles, Flip H / V, Reset warp. For GPU heads that need scaling,
##   rotation, warp, feather or several slices on one output.
## Everything edits the shared slice_flow.gd.

signal closed()

const SrcCanvas := preload("res://features/devices/slice_canvas_src.gd")
const DstCanvas := preload("res://features/devices/slice_canvas_dst.gd")
const PlaceCanvas := preload("res://features/devices/output_place_canvas.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const SP := preload("res://features/devices/slice_page_model.gd")
const SM := preload("res://features/devices/slice_model.gd")
const OP := preload("res://features/devices/output_place.gd")
const NF := preload("res://core/numeric_field.gd")

const HINT_PLACE := "Drag an output to place it on the canvas (snaps to the edges and the other outputs; Alt: no snap), " \
	+ "or type its X / Y. Arrow keys nudge the selected output (Shift: 8 px). What an output covers off the canvas is black."
const HINT_FREE := "Input: drag on empty space to cut a new slice, drag a slice to move it, its handles to resize. " \
	+ "Output: drag to place; Transform handles scale / rotate (Shift: 15°), Warp handles keystone. Alt: no snap."

var flow: RefCounted
var src: SrcCanvas
var dst: DstCanvas
var place: PlaceCanvas
var view := "place"  # "place" | "free"
var _title := Label.new()
var _tabs := HBoxContainer.new()
var _src_cap := Label.new()
var _dst_cap := Label.new()
var _mode := {}  # "transform" / "warp" → Button
var _views := {}  # "place" / "free" → Button
var _sel_tools: Array[Button] = []
var _free_tools := HBoxContainer.new()
var _place_tools := HBoxContainer.new()
var _free_body := HBoxContainer.new()
var _place_body := VBoxContainer.new()
var _place_name := Label.new()
var _px := LineEdit.new()
var _py := LineEdit.new()
var _shows := VBoxContainer.new()
var _hint := Label.new()


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
	var vg := ButtonGroup.new()
	for v in [["place", "Place outputs"], ["free", "Free slices"]]:
		var b := _btn(head, v[1], func() -> void: set_view(v[0]))
		b.toggle_mode = true
		b.button_group = vg
		b.name = "View_" + v[0]
		_views[v[0]] = b
	head.add_child(VSeparator.new())
	_btn(head, "Done", func() -> void: closed.emit()).name = "Done"
	_build_place_tools()
	_build_free_tools()
	add_child(_place_tools)
	add_child(_free_tools)
	_build_bodies()
	_hint.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_hint.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	_hint.add_theme_font_size_override("font_size", 11)
	add_child(_hint)


func _build_place_tools() -> void:
	_place_tools.add_theme_constant_override("separation", 6)
	_place_name.add_theme_font_size_override("font_size", 13)
	_place_name.custom_minimum_size.x = 160
	_place_tools.add_child(_place_name)
	for pair in [["X", _px], ["Y", _py]]:
		var l := Label.new()
		l.text = pair[0]
		l.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
		_place_tools.add_child(l)
		var le: LineEdit = pair[1]
		le.custom_minimum_size.x = 90
		le.name = "Place" + pair[0]
		NF.math_line(le, true, 0.0, INF)  # RULES.md: focus selects, + - * / evaluate, garbage reverts
		le.text_submitted.connect(func(_t: String) -> void: _commit_xy())
		le.focus_exited.connect(_commit_xy)
		_place_tools.add_child(le)
	var gap := Control.new()
	gap.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_place_tools.add_child(gap)
	_btn(_place_tools, "Side by side", _side_by_side).tooltip_text = "Every output at its own width, left to right from x 0, y 0"


func _build_free_tools() -> void:
	_free_tools.add_theme_constant_override("separation", 6)
	_free_tools.add_child(_tabs)
	_free_tools.add_child(VSeparator.new())
	var group := ButtonGroup.new()
	for m in [["transform", "Transform"], ["warp", "Warp"]]:
		var b := _btn(_free_tools, m[1], func() -> void: _set_mode(m[0]))
		b.toggle_mode = true
		b.button_group = group
		b.button_pressed = m[0] == "transform"
		b.name = "Mode_" + m[0]
		_mode[m[0]] = b
	_free_tools.add_child(VSeparator.new())
	_sel_tools.append(_btn(_free_tools, "Flip H", func() -> void: _toggle("dst.flipH")))
	_sel_tools.append(_btn(_free_tools, "Flip V", func() -> void: _toggle("dst.flipV")))
	_sel_tools.append(_btn(_free_tools, "Reset warp", func() -> void:
		if flow.sel >= 0:
			flow.set_field(flow.sel, "dst.warp", [[0, 0], [0, 0], [0, 0], [0, 0]])))


func _build_bodies() -> void:
	place = PlaceCanvas.new()
	place.name = "PlaceOutputs"
	place.size_flags_vertical = Control.SIZE_EXPAND_FILL
	place.custom_minimum_size = Vector2(320, 240)
	place.picked.connect(func(_id: String) -> void: _refresh_place())
	_place_body.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_place_body.add_child(place)
	_shows.add_theme_constant_override("separation", 2)
	_place_body.add_child(_shows)
	add_child(_place_body)
	_free_body.add_theme_constant_override("separation", 12)
	_free_body.size_flags_vertical = Control.SIZE_EXPAND_FILL
	add_child(_free_body)
	src = SrcCanvas.new()
	dst = DstCanvas.new()
	for pair in [[_src_cap, src], [_dst_cap, dst]]:
		var col := VBoxContainer.new()
		col.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		col.size_flags_vertical = Control.SIZE_EXPAND_FILL
		_free_body.add_child(col)
		pair[0].add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
		pair[0].add_theme_font_size_override("font_size", 12)
		col.add_child(pair[0])
		pair[1].size_flags_vertical = Control.SIZE_EXPAND_FILL
		pair[1].custom_minimum_size = Vector2(320, 240)
		col.add_child(pair[1])
	src.name = "SliceInput"
	dst.name = "SliceOutput"


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
	place.bind(flow)
	var s: Dictionary = flow.selected()
	show_output(str(s.outputId) if not s.is_empty() else (str(flow.outputs[0].id) if not flow.outputs.is_empty() else ""))
	place.sel_id = str(s.outputId) if not s.is_empty() else ""
	set_view("place" if OP.all_placeable(flow.slices, flow.outputs, flow.input) else "free")


func close() -> void:
	if flow != null and flow.changed.is_connected(_on_changed):
		flow.changed.disconnect(_on_changed)
	VideoSurfaces.release_all(src)
	VideoSurfaces.release_all(dst)
	VideoSurfaces.release_all(place)


## "place" | "free": which tools and canvases are on screen (the hidden canvases drop their video lease).
func set_view(v: String) -> void:
	view = v if v in ["place", "free"] else "place"
	_views[view].button_pressed = true
	var p := view == "place"
	_place_tools.visible = p
	_place_body.visible = p
	_free_tools.visible = not p
	_free_body.visible = not p
	_hint.text = HINT_PLACE if p else HINT_FREE
	_refresh()


func show_output(id: String) -> void:
	dst.out_id = id
	src.out_id = id
	_refresh()


func _on_changed(kind: String) -> void:
	var s: Dictionary = flow.selected()
	if kind == "select" and not s.is_empty() and str(s.outputId) != dst.out_id:
		show_output(str(s.outputId))  # selecting a slice on the input shows the output it lands on
		return
	if kind == "geometry":
		_refresh_place()
	else:
		_refresh()


func _refresh() -> void:
	if flow == null:
		return
	_title.text = "Mapping — %s" % str(flow.label)
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
	_refresh_place()


## The Place view's header fields and the per-output "shows" lines (a focused field is left alone while typing).
func _refresh_place() -> void:
	if flow == null:
		return
	var fs := place.frames()
	var fr := {}
	for f in fs:
		if f.id == place.sel_id:
			fr = f
	var editable: bool = not fr.is_empty() and fr.kind != "free"
	_place_name.text = str(fr.label) if not fr.is_empty() else "Click an output"
	for pair in [[_px, "x"], [_py, "y"]]:
		var le: LineEdit = pair[0]
		le.editable = editable
		if not le.has_focus():
			le.text = str(int(fr[pair[1]])) if editable else ""
	for c in _shows.get_children():
		_shows.remove_child(c)
		c.queue_free()
	for f in fs:
		var l := Label.new()
		var row: Dictionary = flow.plan_row(f.id)
		var what: String = {"placed": OP.shows_text(f, flow.input), "unplaced": "not placed — black (drag it onto the canvas)",
			"free": "free slices — edit them in Free slices"}[f.kind]
		l.text = "%s (%d×%d, %s): %s" % [f.label, int(f.w), int(f.h), SP.backend_text(row), what]
		l.add_theme_font_size_override("font_size", 12)
		l.add_theme_color_override("font_color", ThemeBuilder.TEXT if f.id == place.sel_id else ThemeBuilder.TEXT_MUTED)
		_shows.add_child(l)
	place.queue_redraw()


func _commit_xy() -> void:
	if flow == null or place.sel_id == "" or not _px.editable:
		return
	var at := OP.clamp_pos(Vector2(_px.text.to_float(), _py.text.to_float()), flow.input)
	var fr := {}
	for f in place.frames():
		if f.id == place.sel_id:
			fr = f
	if not fr.is_empty() and (at.x != int(fr.x) or at.y != int(fr.y) or fr.kind == "unplaced"):
		place.place(place.sel_id, at.x, at.y)
	_refresh_place()


func _side_by_side() -> void:
	var list := OP.lined_up(flow.slices, flow.outputs, flow.input)  # free-slice outputs are skipped, not replaced
	flow.slices = list
	flow.changed.emit("list")
	flow.save()


func _set_mode(m: String) -> void:
	dst.mode = m
	dst.queue_redraw()


func _toggle(path: String) -> void:
	var s: Dictionary = flow.selected()
	if not s.is_empty():
		flow.set_field(flow.sel, path, not bool(SM.get_at(s, path)))
