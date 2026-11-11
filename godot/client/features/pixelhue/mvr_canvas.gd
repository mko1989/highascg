extends Control
## WO-1039 MVR — the layout canvas (Studio's #stage): the MVR output letterboxed, every window drawn with its number,
## name, source and UMD strip; the selected one with corner handles. Mouse: click selects, drag moves, a corner of the
## selected window resizes; right click / Esc during a drag cancels it. Keys (canvas focused): arrows nudge (Shift
## = 10 px), Ctrl+Z / Ctrl+Shift+Z undo / redo. Accepts sources dragged from the Add to MVR list ({"mvr_source": key}).
## Holds no state of its own beyond the drag gesture: mvr_panel.gd decides and calls show_layout().

signal picked(id: int)
signal drag_started(id: int, handle: String)
signal drag_moved(dx: float, dy: float)
signal drag_ended(cancelled: bool)
signal nudged(dir: Vector2i, shift: bool)
signal undo_requested(redo: bool)
signal source_dropped(key: String, layer_id: int, at: Vector2)

const V := preload("res://features/pixelhue/mvr_view.gd")
const M := preload("res://features/pixelhue/mvr_model.gd")

const BG := Color("#151515")
const OUTPUT := Color("#202020")
const FILL := Color("#293039")
const EDGE := Color("#858f99")
const EDGE_SEL := Color("#f0f0f0")
const TEXT := Color("#e7ebef")
const TEXT_DIM := Color("#bfc8d1")
const UMD := Color("#101010")
const UMD_EDGE := Color("#777777")
const BLOCKED := Color("#f85149")

var screen: Dictionary = {}
var windows: Array = []
var selected_id := -1
var busy := false
var blocked := false
var empty_text := "Connect to a P20 or Q8 to load its MVR layout."
var _press := Vector2.ZERO
var _dragging := false


func _init() -> void:
	focus_mode = Control.FOCUS_ALL
	clip_contents = true
	mouse_filter = Control.MOUSE_FILTER_STOP
	custom_minimum_size = Vector2(320, 200)
	resized.connect(queue_redraw)


func show_layout(scr: Dictionary, wins: Array, sel: int, is_busy: bool) -> void:
	screen = scr
	windows = wins
	selected_id = sel
	busy = is_busy
	queue_redraw()


func is_dragging() -> bool:
	return _dragging


func _frame() -> Rect2:
	return V.frame(size, int(screen.get("width", 0)), int(screen.get("height", 0)))


func _sw() -> int:
	return int(screen.get("width", 1))


func _draw() -> void:
	draw_rect(Rect2(Vector2.ZERO, size), BG)
	var font := get_theme_default_font()
	var fs := 13
	if screen.is_empty():
		_center_text(font, Rect2(Vector2.ZERO, size), empty_text, fs, TEXT_DIM)
		return
	var f := _frame()
	draw_rect(f, OUTPUT)
	draw_rect(f, EDGE.darkened(0.4), false, 1.0)
	if windows.is_empty():
		_center_text(font, f, "No MVR windows. Drag a screen or input from Add to MVR.", fs, TEXT_DIM)
	var selected_index := -1
	for i in windows.size():
		if int(windows[i].id) == selected_id:
			selected_index = i
			continue
		_draw_window(font, f, windows[i], i, false)
	if selected_index >= 0:
		_draw_window(font, f, windows[selected_index], selected_index, true)
	var bottom := "%d / %d PX" % [int(screen.width), int(screen.height)]
	draw_string(font, Vector2(f.end.x - font.get_string_size(bottom, HORIZONTAL_ALIGNMENT_LEFT, -1, 11).x, f.end.y + 7), bottom, HORIZONTAL_ALIGNMENT_LEFT, -1, 11, TEXT_DIM)


func _draw_window(font: Font, f: Rect2, layer: Dictionary, index: int, sel: bool) -> void:
	var r := V.window_rect(f, _sw(), layer.window)
	draw_rect(r, FILL)
	var umd: Variant = layer.get("umdHeight")
	if umd != null and int(umd) > 0:
		var uh := float(umd) * V.scale_of(f, _sw())
		var strip := Rect2(Vector2(r.position.x, r.end.y - uh), Vector2(r.size.x, uh))
		draw_rect(strip, UMD)
		draw_line(strip.position, Vector2(strip.end.x, strip.position.y), UMD_EDGE, 1.0)
	var edge := (BLOCKED if blocked and _dragging else EDGE_SEL) if sel else EDGE
	draw_rect(r, edge, false, 2.0 if sel else 1.0)
	var fs := clampi(int(r.size.y / 6.0), 9, 14)
	if r.size.x > 24 and r.size.y > 18:
		draw_string(font, r.position + Vector2(4, 3 + fs), "%02d" % (index + 1), HORIZONTAL_ALIGNMENT_LEFT, r.size.x - 6, fs - 1, TEXT_DIM)
	if r.size.y > 2.6 * fs:
		var mid := r.position.y + r.size.y / 2.0
		draw_string(font, Vector2(r.position.x + 3, mid), str(layer.get("name", "")), HORIZONTAL_ALIGNMENT_CENTER, r.size.x - 6, fs, TEXT)
		draw_string(font, Vector2(r.position.x + 3, mid + fs + 3), M.source_label(layer), HORIZONTAL_ALIGNMENT_CENTER, r.size.x - 6, fs - 1, TEXT_DIM)
	if sel:
		for c in [r.position, Vector2(r.end.x, r.position.y), Vector2(r.position.x, r.end.y), r.end]:
			var h := Rect2(c - Vector2(4, 4), Vector2(8, 8))
			draw_rect(h, EDGE_SEL)
			draw_rect(h, Color("#151515"), false, 1.0)


func _center_text(font: Font, r: Rect2, text: String, fs: int, col: Color) -> void:
	draw_string(font, Vector2(r.position.x + 8, r.position.y + r.size.y / 2.0), text, HORIZONTAL_ALIGNMENT_CENTER, maxf(r.size.x - 16, 1), fs, col)


func _gui_input(event: InputEvent) -> void:
	if event is InputEventMouseButton:
		var mb := event as InputEventMouseButton
		if mb.button_index == MOUSE_BUTTON_LEFT and mb.pressed:
			grab_focus()
			if busy or screen.is_empty():
				return
			var f := _frame()
			var id := V.hit(f, _sw(), windows, selected_id, mb.position)
			if id < 0:
				return
			var handle := ""
			if id == selected_id:
				for l in windows:
					if int(l.id) == id:
						handle = V.handle_at(V.window_rect(f, _sw(), l.window), mb.position)
			_press = mb.position
			_dragging = true
			blocked = false
			picked.emit(id)
			drag_started.emit(id, handle)
			accept_event()
		elif mb.button_index == MOUSE_BUTTON_LEFT and not mb.pressed and _dragging:
			_end(false)
			accept_event()
		elif mb.button_index == MOUSE_BUTTON_RIGHT and mb.pressed and _dragging:
			_end(true)
			accept_event()
	elif event is InputEventMouseMotion:
		var mm := event as InputEventMouseMotion
		if _dragging:
			var s := V.scale_of(_frame(), _sw())
			drag_moved.emit((mm.position.x - _press.x) / s, (mm.position.y - _press.y) / s)
			accept_event()
		else:
			mouse_default_cursor_shape = _cursor(mm.position)
	elif event is InputEventKey and event.pressed:
		var k := event as InputEventKey
		if _dragging and k.keycode == KEY_ESCAPE:
			_end(true)
			accept_event()
			return
		if busy or screen.is_empty():
			return
		if (k.ctrl_pressed or k.meta_pressed) and k.keycode == KEY_Z:
			undo_requested.emit(k.shift_pressed)
			accept_event()
			return
		var dirs := {KEY_LEFT: Vector2i(-1, 0), KEY_RIGHT: Vector2i(1, 0), KEY_UP: Vector2i(0, -1), KEY_DOWN: Vector2i(0, 1)}
		if dirs.has(k.keycode) and selected_id >= 0:
			nudged.emit(dirs[k.keycode], k.shift_pressed)
			accept_event()


func _notification(what: int) -> void:
	if what == NOTIFICATION_FOCUS_EXIT and _dragging:
		_end(true)


func _end(cancelled: bool) -> void:
	_dragging = false
	drag_ended.emit(cancelled)
	queue_redraw()


func _cursor(p: Vector2) -> CursorShape:
	if busy or screen.is_empty():
		return Control.CURSOR_ARROW
	var f := _frame()
	var id := V.hit(f, _sw(), windows, selected_id, p)
	if id < 0:
		return Control.CURSOR_ARROW
	if id == selected_id:
		for l in windows:
			if int(l.id) == id:
				var h := V.handle_at(V.window_rect(f, _sw(), l.window), p)
				if h == "nw" or h == "se":
					return Control.CURSOR_FDIAGSIZE
				if h == "ne" or h == "sw":
					return Control.CURSOR_BDIAGSIZE
	return Control.CURSOR_MOVE


func _can_drop_data(_at: Vector2, data: Variant) -> bool:
	return not busy and not screen.is_empty() and data is Dictionary and (data as Dictionary).has("mvr_source")


func _drop_data(at: Vector2, data: Variant) -> void:
	var f := _frame()
	var id := V.hit(f, _sw(), windows, selected_id, at)
	source_dropped.emit(str(data.mvr_source), id, V.to_output(f, _sw(), at))
