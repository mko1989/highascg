extends Control
## WO-600 M — the multiview editor canvas (web client/components/multiview-editor.js + -canvas-draw.js): cells in
## multiview-canvas px fitted into the control (never upscaled), the composited multiview channel live behind them,
## drag a cell to move it (edges snap to the canvas and other cells), drag its edge / corner to resize (aspect-locked
## live cells keep the source aspect incl. the label chrome), click = audio focus, right-click = cell menu, Delete
## removes the selected cell, Sources rows dropped on a cell replace its source / on empty canvas add a cell.
## The geometry is mv_geometry.gd / mv_layout.gd (golden-tested against the web modules).

signal edited(apply_now: bool)  # cells changed (drag end, drop, menu) — persist + apply
signal audio_focus(id: String)
signal notice(text: String)

const G := preload("res://features/multiview/mv_geometry.gd")
const L := preload("res://features/multiview/mv_layout.gd")
const D := preload("res://features/multiview/mv_doc.gd")
const CELL := {"pgm": Color("#e63946"), "prv": Color("#2a9d8f"), "decklink": Color("#457b9d"), "ndi": Color("#457b9d")}
const BAR := {"pgm": Color("#c92a2a"), "prv": Color("#0d9488"), "decklink": Color("#2563eb"), "ndi": Color("#2563eb")}
const OTHER := Color("#8b949e")
const OTHER_BAR := Color("#2563eb")
const SELECT := Color("#58a6ff")
const BG := Color("#0a0e13")
const EMPTY := Color("#131a22")
const HOVER := Color("#1a2535")
const CLICK_SLOP := 4.0

var st: Dictionary = {}  # editor state (mv_doc.gd shape) — owned by multiview_tab.gd, edited in place here
var cm: Dictionary = {}
var mv_ch: Variant = null  # this multiview's Caspar channel (null = no multiview destination)
var selected_id := ""
var _hover := ""  # drop hover: a cell id or "__canvas__"
var _drag := {}  # {id, mode: "move"|"resize-<h>", start: cell copy, at: canvas px, moved: bool}
var _video: TextureRect
var _role := ""


func _ready() -> void:
	focus_mode = Control.FOCUS_ALL
	mouse_filter = Control.MOUSE_FILTER_STOP
	clip_contents = true
	_video = TextureRect.new()
	_video.show_behind_parent = true
	_video.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_video.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	_video.stretch_mode = TextureRect.STRETCH_SCALE
	add_child(_video)
	resized.connect(_layout_video)
	visibility_changed.connect(hold_video)


func _exit_tree() -> void:
	VideoSurfaces.release_all(self)


## Lease the multiview channel's picture while this canvas is on screen (WO-617 holders).
func hold_video() -> void:
	var want := "ch%d" % int(mv_ch) if mv_ch != null and is_visible_in_tree() else ""
	if want != _role:
		if _role != "":
			VideoSurfaces.release(_role, self)
		_role = want
		_video.texture = VideoSurfaces.acquire(want, self) if want != "" else null
	set_process(_role != "")
	_layout_video()


func _process(_d: float) -> void:
	_video.queue_redraw()


func cw() -> float:
	return float(st.get("canvasWidth", L.DEFAULT_W))


func ch() -> float:
	return float(st.get("canvasHeight", L.DEFAULT_H))


func view_scale() -> float:
	return minf(minf(size.x / cw(), size.y / ch()), 1.0)


func origin() -> Vector2:
	return (size - Vector2(cw(), ch()) * view_scale()) / 2.0


func to_canvas(p: Vector2) -> Vector2:
	return (p - origin()) / view_scale()


func _layout_video() -> void:
	_video.position = origin()
	_video.size = Vector2(cw(), ch()) * view_scale()
	_video.visible = _role != ""


func cells() -> Array:
	return st.get("cells", [])


func cell(id: String) -> Variant:
	for c in cells():
		if str(c.get("id")) == id:
			return c
	return null


func _draw() -> void:
	var k := view_scale()
	var o := origin()
	var box := Rect2(o, Vector2(cw(), ch()) * k)
	draw_rect(Rect2(Vector2.ZERO, size), BG)
	if _role == "":
		draw_rect(box, HOVER if _hover == "__canvas__" else EMPTY)
	draw_dashed_line(box.position, Vector2(box.end.x, box.position.y), Color(1, 1, 1, 0.45), 1.5, 8.0)
	draw_dashed_line(Vector2(box.end.x, box.position.y), box.end, Color(1, 1, 1, 0.45), 1.5, 8.0)
	draw_dashed_line(box.end, Vector2(box.position.x, box.end.y), Color(1, 1, 1, 0.45), 1.5, 8.0)
	draw_dashed_line(Vector2(box.position.x, box.end.y), box.position, Color(1, 1, 1, 0.45), 1.5, 8.0)
	var font := get_theme_default_font()
	var dims := "%d×%d" % [int(cw()), int(ch())]
	var fs := int(maxf(10.0, 12.0 * k))
	draw_string(font, Vector2(box.end.x - font.get_string_size(dims, 0, -1, fs).x - 6.0, box.end.y - 5.0), dims, 0, -1, fs, Color(1, 1, 1, 0.3))
	var tf := Transform2D(0.0, Vector2(k, k), 0.0, o)
	var timers: bool = st.get("showTimersUnderLabels", false)
	for c in cells():
		_draw_cell(c, tf, k, font, timers)
	if cells().is_empty():
		var t := "Drag sources here, or right-click → Default layout"
		draw_string(font, Vector2(box.position.x, box.get_center().y), t, HORIZONTAL_ALIGNMENT_CENTER, box.size.x, 14, Color(1, 1, 1, 0.18))
	if mv_ch == null:
		draw_rect(box, Color(0, 0, 0, 0.45))
		draw_string(font, box.get_center() - Vector2(box.size.x / 2.0, 6.0), "No Multiview Channel", HORIZONTAL_ALIGNMENT_CENTER, box.size.x, 18)
		draw_string(font, box.get_center() + Vector2(-box.size.x / 2.0, 18.0), "Add a Multiview destination in Devices to enable.",
			HORIZONTAL_ALIGNMENT_CENTER, box.size.x, 13, Color(1, 1, 1, 0.7))


func _draw_cell(c: Dictionary, tf: Transform2D, k: float, font: Font, timers: bool) -> void:
	var id := str(c.get("id"))
	var hot := id == selected_id or id == _hover
	var ov: Variant = G.overlay_type(c, cm)
	var outer := tf * Rect2(float(c.x), float(c.y), float(c.w), float(c.h))
	if ov == "timers":
		if hot:
			draw_rect(outer, SELECT, false, 1.5)
		return
	var r := G.contained_video_rect(c, cm, cw(), ch(), timers)
	var pic := tf * Rect2(r.x, r.y, r.w, r.h)
	if hot:
		draw_rect(outer, SELECT, false, 1.0)
	draw_rect(pic, SELECT if hot else CELL.get(ov, OTHER), false, maxf(1.0, 3.0 * k))
	var bar := tf * Rect2(r.lx - G.BORDER, r.ly, r.lw + G.BORDER * 2, r.lh)
	var screen: bool = timers and (ov == "pgm" or ov == "prv")
	if screen:
		var ts := float(st.get("timerScale", 100)) / 100.0
		var title := minf(34.0 * ts, maxf(22.0 * ts, floorf(r.lh * 0.36 * ts)))
		draw_rect(tf * Rect2(r.lx + 8.0, r.ly + title, maxf(80.0, r.lw - 16.0), r.lh - title), Color(0.04, 0.055, 0.08, 0.92))
		bar.size.y = title * k
	draw_rect(bar, BAR.get(ov, OTHER_BAR))
	draw_rect(bar, CELL.get(ov, OTHER), false, 2.0 * k)
	var fs := int(clampf(bar.size.y * 0.5, 9.0, 14.0))
	if bar.size.y >= 8.0:
		draw_string(font, Vector2(bar.position.x, bar.get_center().y + fs * 0.35), D.cell_label(c, cm), HORIZONTAL_ALIGNMENT_CENTER, bar.size.x, fs)
	if st.get("audioActiveCellId") == id:
		_speaker(Vector2(bar.end.x - 18.0, bar.get_center().y), minf(1.0, bar.size.y / 18.0))


## The audio-focus mark (web 🔊 — the default font has no emoji): a speaker cone + one wave.
func _speaker(at: Vector2, k: float) -> void:
	var w := Color.WHITE
	draw_rect(Rect2(at + Vector2(-5, -2.5) * k, Vector2(3, 5) * k), w)
	draw_colored_polygon(PackedVector2Array([at + Vector2(-2, -2.5) * k, at + Vector2(3, -6) * k, at + Vector2(3, 6) * k,
		at + Vector2(-2, 2.5) * k]), w)
	draw_arc(at + Vector2(3, 0) * k, 5.0 * k, -0.9, 0.9, 8, w, 1.5)


func _gui_input(e: InputEvent) -> void:
	var mb := e as InputEventMouseButton
	if mb != null and mb.pressed and mb.button_index == MOUSE_BUTTON_LEFT:
		grab_focus()
		var p := to_canvas(mb.position)
		var c: Variant = L.cell_at(cells(), p.x, p.y)
		if c == null:
			selected_id = ""
		else:
			selected_id = str(c.id)
			var h := G.resize_handle(c, p.x, p.y, view_scale())
			_drag = {"id": selected_id, "mode": "resize-" + h if h != "" else "move", "start": (c as Dictionary).duplicate(true), "at": p, "moved": false}
		queue_redraw()
		accept_event()
	elif mb != null and not mb.pressed and mb.button_index == MOUSE_BUTTON_LEFT and not _drag.is_empty():
		var d := _drag
		_drag = {}
		if d.moved:
			edited.emit(true)
		else:
			audio_focus.emit(str(d.id))
		accept_event()
	elif mb != null and mb.pressed and mb.button_index == MOUSE_BUTTON_RIGHT:
		var p := to_canvas(mb.position)
		var c: Variant = L.cell_at(cells(), p.x, p.y)
		_menu(str(c.id) if c != null else "", p)
		accept_event()
	var mm := e as InputEventMouseMotion
	if mm != null:
		_motion(to_canvas(mm.position))
	var kb := e as InputEventKey
	if kb != null and kb.pressed and kb.keycode in [KEY_DELETE, KEY_BACKSPACE] and selected_id != "":
		_remove(selected_id)
		accept_event()


func _motion(p: Vector2) -> void:
	if _drag.is_empty():
		var c: Variant = L.cell_at(cells(), p.x, p.y)
		var h := G.resize_handle(c, p.x, p.y, view_scale()) if c != null else ""
		mouse_default_cursor_shape = CURSOR_ARROW if c == null else CURSOR_MOVE if h == "" else CURSOR_VSIZE if h in ["n", "s"] \
			else CURSOR_HSIZE if h in ["e", "w"] else CURSOR_FDIAGSIZE if h in ["nw", "se"] else CURSOR_BDIAGSIZE
		return
	var d: Vector2 = p - _drag.at
	if not _drag.moved and d.length() * view_scale() < CLICK_SLOP:
		return
	_drag.moved = true
	var c: Variant = cell(_drag.id)
	if c == null:
		return
	var mode: String = _drag.mode
	if mode == "move":
		c.merge(L.drag_move(_drag.start, d.x, d.y, cells(), cw(), ch(), view_scale()), true)
	else:
		c.merge(L.drag_resize(mode.trim_prefix("resize-"), _drag.start, d.x, d.y, cells(), cw(), ch(), view_scale(), cm,
			st.get("showTimersUnderLabels", false)), true)
	queue_redraw()


func _menu(id: String, at: Vector2) -> void:
	var pm := PopupMenu.new()
	var c: Variant = cell(id) if id != "" else null
	if c != null:
		pm.add_item("Audio focus", 0)
		if c.get("source"):
			pm.add_item("Clear source", 1)
		pm.add_check_item("Lock aspect", 2)
		pm.set_item_checked(pm.get_item_index(2), c.get("aspectLocked") != false)
		pm.add_separator()
		pm.add_item("Remove cell", 3)
		pm.add_separator()
	pm.add_item("Default layout", 4)
	pm.add_item("Clear all cells", 5)
	pm.id_pressed.connect(func(i: int) -> void: _on_menu(i, id))
	pm.popup_hide.connect(pm.queue_free)
	add_child(pm)
	var pos := Vector2i(get_viewport().get_mouse_position())
	if not get_viewport().gui_embed_subwindows:
		pos += get_window().position
	pm.popup(Rect2i(pos, Vector2i.ZERO))


func _on_menu(i: int, id: String) -> void:
	var c: Variant = cell(id)
	match i:
		0:
			audio_focus.emit(id)
		1:
			c.source = null
			edited.emit(true)
		2:
			c.aspectLocked = c.get("aspectLocked") == false
			edited.emit(true)
		3:
			_remove(id)
		4:
			st.cells = L.default_layout(cm, cw(), ch())
			selected_id = ""
			edited.emit(true)
		5:
			st.cells = []
			st.audioActiveCellId = null
			selected_id = ""
			edited.emit(true)
	queue_redraw()


func _remove(id: String) -> void:
	st.cells = cells().filter(func(c: Dictionary) -> bool: return str(c.get("id")) != id)
	if selected_id == id:
		selected_id = ""
	queue_redraw()
	edited.emit(true)


static func payload(data: Variant) -> Variant:
	if data is Dictionary and data.get("type") == "multi" and data.get("items") is Array and not data.items.is_empty():
		data = data.items[0]
	return data if data is Dictionary and str(data.get("value", "")) != "" else null


func _can_drop_data(at: Vector2, data: Variant) -> bool:
	var ok := payload(data) != null
	var p := to_canvas(at)
	var c: Variant = L.cell_at(cells(), p.x, p.y)
	var h := "" if not ok else str(c.id) if c != null else "__canvas__" if Rect2(0, 0, cw(), ch()).has_point(p) else ""
	if h != _hover:
		_hover = h
		queue_redraw()
	return ok


func _notification(what: int) -> void:
	if what == NOTIFICATION_DRAG_END and _hover != "":
		_hover = ""
		queue_redraw()


func _drop_data(at: Vector2, data: Variant) -> void:
	_hover = ""
	var d: Dictionary = payload(data)
	var why := D.self_route_message(d.value, mv_ch)
	if why != "":
		notice.emit(why)
		queue_redraw()
		return
	var p := to_canvas(at)
	var c: Variant = L.cell_at(cells(), p.x, p.y)
	var label: Variant = d.get("label") if d.get("label") else d.value
	var src := {"value": d.value, "type": d.get("type") if d.get("type") else "media", "label": label}
	if c != null:
		c.source = src
	else:
		var n: Variant = L.drop_cell(d, p.x, p.y, cw(), ch(), st.get("showTimersUnderLabels", false))
		if n == null:
			queue_redraw()
			return
		var added := L.add_cell(n, cw(), ch())
		st.cells.append(added)
		selected_id = str(added.id)
	queue_redraw()
	edited.emit(true)
