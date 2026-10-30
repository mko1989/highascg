extends Control
## WO-869 — the slice editor's INPUT canvas: the node's feed (the live picture of the program channel cabled into the
## node, leased from VideoSurfaces like mv_canvas.gd) with every slice's src rect on it. Drag on empty space draws a
## new slice (it lands 1:1 on the output tab shown on the right), drag a rect to move it, its 8 handles to resize;
## everything snaps to 8 input px (hold Alt for 1 px) and stays inside the input raster. Edits go through
## slice_flow.gd (no save while dragging; one save on release).

const SM := preload("res://features/devices/slice_model.gd")
const CM := preload("res://features/devices/slice_canvas_math.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const HANDLE := 6.0

var flow: RefCounted
var out_id := ""  # the output a newly drawn slice goes to (the editor's output tab)
var _role := ""
var _tex: Texture2D
var _drag := {}  # {mode: "move"|"resize"|"draw", i, start (slice copy), at (input px), handle, cur}


func _ready() -> void:
	focus_mode = Control.FOCUS_CLICK
	mouse_filter = Control.MOUSE_FILTER_STOP
	clip_contents = true
	resized.connect(queue_redraw)
	visibility_changed.connect(hold_video)


func _exit_tree() -> void:
	VideoSurfaces.release_all(self)


func bind(f: RefCounted) -> void:
	if flow != null and flow.changed.is_connected(_on_changed):
		flow.changed.disconnect(_on_changed)
	flow = f
	flow.changed.connect(_on_changed)
	hold_video()
	queue_redraw()


func _on_changed(_kind: String) -> void:
	hold_video()
	queue_redraw()


## Lease the feed's program channel while this canvas is on screen.
func hold_video() -> void:
	var want: String = flow.video_role() if flow != null and is_visible_in_tree() else ""
	if want != _role:
		if _role != "":
			VideoSurfaces.release(_role, self)
		_role = want
		_tex = VideoSurfaces.acquire(want, self) if want != "" else null
	set_process(_role != "")


func _process(_d: float) -> void:
	queue_redraw()


## The leased picture once it has frames (a surface nobody writes yet is a 1×1 / empty texture).
func _picture() -> Texture2D:
	return _tex if _tex != null and _tex.get_width() > 1 and _tex.get_height() > 1 else null


func _fit() -> Dictionary:
	return CM.fit(size, flow.input)


func _to_canvas(p: Vector2, f: Dictionary) -> Vector2:
	return f.off + p * f.scale


func _to_input(p: Vector2, f: Dictionary) -> Vector2:
	return (p - f.off) / f.scale


func _rect_canvas(r: Dictionary, f: Dictionary) -> Rect2:
	return Rect2(_to_canvas(Vector2(r.x, r.y), f), Vector2(r.w, r.h) * f.scale)


func _draw() -> void:
	draw_rect(Rect2(Vector2.ZERO, size), Color(0.07, 0.07, 0.08))
	if flow == null:
		return
	var f := _fit()
	var frame := Rect2(f.off, flow.input * f.scale)
	var tex := _picture()
	if tex != null:
		draw_texture_rect(tex, frame, false)
	else:
		draw_rect(frame, Color(0.13, 0.13, 0.15))
		var msg := "No live picture — input not cabled to a screen" if flow.video_role() == "" else "No picture from %s yet" % flow.video_role()
		draw_string(get_theme_default_font(), frame.position + Vector2(10, 22), msg, HORIZONTAL_ALIGNMENT_LEFT, -1, 13, ThemeBuilder.TEXT_MUTED)
	draw_rect(frame, Color(1, 1, 1, 0.35), false, 1.0)
	for i in SM.draw_order(flow.slices):
		var s: Dictionary = flow.slices[i]
		var r := _rect_canvas(s.src, f)
		var on: bool = i == flow.sel
		var c := _color(i)
		draw_rect(r, Color(c, 0.18 if s.enabled else 0.05))
		draw_rect(r, Color(c, 1.0 if on else 0.75), false, 2.0 if on else 1.0)
		draw_string(get_theme_default_font(), r.position + Vector2(4, 15), str(s.name), HORIZONTAL_ALIGNMENT_LEFT, maxf(r.size.x - 8.0, 1.0), 12, Color(c, 1.0))
		if on:
			for hy in [-1, 0, 1]:
				for hx in [-1, 0, 1]:
					if hx != 0 or hy != 0:
						var hp := r.get_center() + Vector2(hx * r.size.x / 2.0, hy * r.size.y / 2.0)
						draw_rect(Rect2(hp - Vector2(HANDLE, HANDLE) / 2.0, Vector2(HANDLE, HANDLE)), Color.WHITE)
	if _drag.get("mode") == "draw" and _drag.has("cur"):
		draw_rect(_rect_canvas(_drag.cur, f), Color(1, 1, 1, 0.9), false, 1.5)


static func _color(i: int) -> Color:
	return Color.from_hsv(fmod(0.08 + i * 0.13, 1.0), 0.65, 1.0)


func _gui_input(event: InputEvent) -> void:
	if flow == null:
		return
	var f := _fit()
	if event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT:
		accept_event()
		if event.pressed:
			_press(_to_input(event.position, f), event.position, f)
		else:
			_release()
	elif event is InputEventMouseMotion and not _drag.is_empty():
		accept_event()
		_move(_to_input(event.position, f), not event.alt_pressed)


func _press(p: Vector2, cp: Vector2, f: Dictionary) -> void:
	grab_focus()
	var s: Dictionary = flow.selected()
	if not s.is_empty():
		var h := CM.handle_at(_rect_canvas(s.src, f), cp, HANDLE + 2.0)
		if h != CM.NONE:
			_drag = {"mode": "resize", "i": flow.sel, "start": s.duplicate(true), "at": p, "handle": h}
			return
	var order: Array = SM.draw_order(flow.slices)
	order.reverse()
	for i in order:
		if Rect2(Vector2(flow.slices[i].src.x, flow.slices[i].src.y), Vector2(flow.slices[i].src.w, flow.slices[i].src.h)).has_point(p):
			flow.select(i)
			_drag = {"mode": "move", "i": i, "start": flow.slices[i].duplicate(true), "at": p}
			return
	if Rect2(Vector2.ZERO, flow.input).has_point(p):
		flow.select(-1)
		_drag = {"mode": "draw", "at": p}


func _move(p: Vector2, snapping: bool) -> void:
	var d: Vector2 = p - _drag.at
	match _drag.mode:
		"draw":
			_drag.cur = CM.drawn(_drag.at, p, flow.input, snapping)
			queue_redraw()
		"move", "resize":
			var s: Dictionary = _drag.start.duplicate(true)
			var old: Dictionary = s.src.duplicate()
			s.src = CM.moved_src(s.src, d, flow.input, snapping) if _drag.mode == "move" else CM.resized(s.src, _drag.handle, d, flow.input, snapping)
			if SM.get_at(_drag.start, "dst.rect.w") == old.w and SM.get_at(_drag.start, "dst.rect.h") == old.h:
				s.dst.rect.w = s.src.w  # a 1:1 slice stays 1:1 while its source is resized
				s.dst.rect.h = s.src.h
			flow.put(_drag.i, s, false)
			_drag.moved = true


func _release() -> void:
	var d := _drag
	_drag = {}
	if d.get("mode") == "draw":
		var r: Dictionary = d.get("cur", {})
		if not r.is_empty() and r.w >= CM.MIN and r.h >= CM.MIN:
			flow.add(out_id, r)
		queue_redraw()
	elif d.get("moved", false):
		flow.save()
