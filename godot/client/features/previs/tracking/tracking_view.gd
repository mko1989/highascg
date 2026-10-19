extends Control
## WO-616 T3b — previs "Camera" mode: the selected tracking camera's live surface (WO-597 role, letterboxed to the
## camera raster) with the stage drawn over it through the solved camera + lens: floor grid, stage-object outlines,
## calibration points (dot = where the camera shows it, ring = clicked; a red line joins the two = the error).
## Click = put the active point here · ctrl+click = make the nearest point active · wheel zoom · right-drag pan.
## Holds its surface only while shown (VideoSurfaces refcount, WO-617).
## T5b Markers mode: markers drawn on the floor (ground circle + body line + name; stale = dimmed); press on a
## marker's circle grabs it, drag moves it, release lets go (marker_driver); calibration clicks are off.

const O := preload("res://features/previs/tracking/tracking_overlay.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")

signal clicked(px: Vector2)          # raster pixels of the camera picture
signal picked(id: String)
signal source_size(size: Vector2i)   # the surface's real size (differs from the raster the camera was set up with)
signal grab(px: Vector2)             # Markers mode, raster px
signal drag(px: Vector2)
signal let_go

var markers_mode := false
var marks: Array = []  # marker_driver.marks()
var selected_marker := 0
var _held := false

var entry := {}
var active := ""
var rms := -1.0
var _lines := {}
var _pts: Array = []
var _role := ""
var _on := false
var _zoom := 1.0
var _pan := Vector2.ZERO
var _drag := false
var _told := Vector2i.ZERO


func _ready() -> void:
	clip_contents = true
	mouse_filter = Control.MOUSE_FILTER_STOP
	focus_mode = Control.FOCUS_CLICK  # arrows drive the selected marker while the view has focus
	visibility_changed.connect(_hold)
	resized.connect(queue_redraw)


func set_state(t: Dictionary, ce: Dictionary, objects: Array, active_id: String) -> void:
	entry = ce
	active = active_id
	_lines = O.lines(t, ce, objects) if not ce.is_empty() else {}
	_pts = O.points(t, ce, objects) if not ce.is_empty() else []
	rms = float(ce.get("rms", -1.0))
	_hold()
	queue_redraw()


func set_marks(m: Array, sel: int) -> void:
	marks = m
	selected_marker = sel
	queue_redraw()


func set_on(on: bool) -> void:
	_on = on
	_hold()


func fit() -> void:
	_zoom = 1.0
	_pan = Vector2.ZERO
	queue_redraw()


func _hold() -> void:
	var want := str(entry.get("role", "")) if _on and is_visible_in_tree() and not entry.is_empty() else ""
	if want == _role:
		return
	if _role != "":
		VideoSurfaces.release(_role, self)
	_role = want
	_told = Vector2i.ZERO
	if want != "":
		VideoSurfaces.acquire(want, self)
	set_process(want != "")


func _exit_tree() -> void:
	VideoSurfaces.release_all(self)


func _process(_d: float) -> void:
	queue_redraw()  # the surface texture updates in place, but its size can arrive after the lease


func _raster() -> Vector2:
	return Vector2(entry.raster[0], entry.raster[1]) if not entry.is_empty() else Vector2(1920, 1080)


func _scale() -> float:
	var r := _raster()
	return minf(size.x / r.x, size.y / r.y) * _zoom


func _origin() -> Vector2:
	return (size - _raster() * _scale()) / 2.0 + _pan


func to_view(px: Vector2) -> Vector2:
	return _origin() + px * _scale()


func to_raster(p: Vector2) -> Vector2:
	return (p - _origin()) / _scale()


func _draw() -> void:
	draw_rect(Rect2(Vector2.ZERO, size), ThemeBuilder.BG_DARK)
	var font := get_theme_default_font()
	if entry.is_empty():
		draw_string(font, Vector2(16, 32), "No tracking camera — Add one in the Inspector.", HORIZONTAL_ALIGNMENT_LEFT, -1, 15, ThemeBuilder.TEXT_MUTED)
		return
	var img := Rect2(_origin(), _raster() * _scale())
	var tex: Texture2D = VideoSurfaces.texture(_role) if _role != "" else null
	if tex != null and tex.get_width() > 1:
		draw_texture_rect(tex, img, false)
		var real := Vector2i(tex.get_width(), tex.get_height())
		if real != Vector2i(_raster()) and real != _told:
			_told = real
			source_size.emit.call_deferred(real)
	else:
		draw_rect(img, ThemeBuilder.BG_ELEVATED)
		draw_string(font, img.position + Vector2(16, 28), "no picture from %s" % entry.role, HORIZONTAL_ALIGNMENT_LEFT, -1, 15, ThemeBuilder.TEXT_MUTED)
	var gcol := Color(ThemeBuilder.ACCENT_GREEN, 0.6)
	for pl in _lines.get("grid", []):
		draw_polyline(_xf(pl), gcol, 1.5, true)
	for o in _lines.get("objects", []):
		for pl in o.lines:
			draw_polyline(_xf(pl), ThemeBuilder.WARN, 2.0, true)
		if not (o.lines as Array).is_empty() and (o.lines[0] as PackedVector2Array).size() > 0:
			draw_string(font, to_view(o.lines[0][0]) + Vector2(4, -6), o.name, HORIZONTAL_ALIGNMENT_LEFT, -1, 13, ThemeBuilder.WARN)
	var act: Dictionary = {}
	for p in _pts if not markers_mode else []:  # Markers mode: grid + objects only, the markers are the subject
		if p.id == active:
			act = p
		var s: Variant = p.shown
		var k: Variant = p.click
		if s != null and k != null:
			draw_line(to_view(s), to_view(k), ThemeBuilder.ERROR, 2.0, true)
		if s != null:
			draw_circle(to_view(s), 3.0, ThemeBuilder.TEXT if k != null else Color(ThemeBuilder.TEXT_MUTED, 0.8))
		if k != null:
			draw_arc(to_view(k), 6.0, 0.0, TAU, 20, ThemeBuilder.ACCENT, 2.0, true)
	if not act.is_empty():
		var at: Variant = act.click if act.click != null else act.shown
		if at != null and not markers_mode:
			draw_arc(to_view(at), 13.0, 0.0, TAU, 28, ThemeBuilder.ACCENT_HOVER, 2.5, true)
	_draw_marks(font)
	var head := "Active: %s — click where it is in the picture" % act.label if not act.is_empty() else "Pick a point in the Inspector list"
	var tail := " · ctrl+click: pick point · wheel: zoom · right-drag: pan · F: fit"
	if markers_mode:
		head = "Markers — drag a marker's circle · stick / arrows move the selected one (camera-relative)"
		tail = " · LB/RB speed · D-pad ◀▶ marker · wheel: zoom · right-drag: pan"
	var rs := " · RMS %.2f px" % rms if rms >= 0.0 else " · not calibrated"
	draw_rect(Rect2(0, size.y - 26, size.x, 26), Color(ThemeBuilder.BG_DARK, 0.75))
	draw_string(font, Vector2(10, size.y - 8), head + rs + tail, HORIZONTAL_ALIGNMENT_LEFT, size.x - 20, 13, ThemeBuilder.TEXT)


func _draw_marks(font: Font) -> void:
	for m in marks:
		if m.centre == null:
			continue
		var col: Color = m.color
		if m.stale:
			col.a = 0.35
		var sel: bool = m.id == selected_marker and m.own
		if (m.ring as PackedVector2Array).size() >= 2:
			draw_polyline(_xf(m.ring), col, 3.0 if sel else 2.0, true)
		var c := to_view(m.centre)
		var top := to_view(m.top) if m.top != null else c
		draw_line(c, top, col, 2.0, true)
		draw_circle(top, 5.0 if sel else 4.0, col)
		var label := "%s%s" % [m.name, " · stale" if m.stale else ""]
		draw_string(font, top + Vector2(8, -4), label, HORIZONTAL_ALIGNMENT_LEFT, -1, 14 if sel else 13, col)
		if sel:
			draw_arc(c, 4.0, 0.0, TAU, 12, ThemeBuilder.TEXT, 2.0, true)


func _xf(pl: PackedVector2Array) -> PackedVector2Array:
	var o := _origin()
	var s := _scale()
	var out := PackedVector2Array()
	out.resize(pl.size())
	for i in pl.size():
		out[i] = o + pl[i] * s
	return out


func _gui_input(event: InputEvent) -> void:
	if entry.is_empty():
		return
	var mb := event as InputEventMouseButton
	if mb != null:
		if mb.button_index == MOUSE_BUTTON_LEFT and markers_mode:
			grab_focus()
			if mb.pressed:
				grab.emit(to_raster(mb.position))
				_held = true
			elif _held:
				_held = false
				let_go.emit()
			accept_event()
		elif mb.button_index == MOUSE_BUTTON_LEFT and mb.pressed:
			grab_focus()
			var px := to_raster(mb.position)
			if mb.ctrl_pressed:
				var i := O.nearest(_pts, px, 16.0 / _scale())
				if i >= 0:
					picked.emit(str(_pts[i].id))
			elif Rect2(Vector2.ZERO, _raster()).has_point(px):
				clicked.emit(px)
			accept_event()
		elif mb.button_index == MOUSE_BUTTON_RIGHT:
			_drag = mb.pressed
			accept_event()
		elif mb.pressed and mb.button_index in [MOUSE_BUTTON_WHEEL_UP, MOUSE_BUTTON_WHEEL_DOWN]:
			var f := 1.2 if mb.button_index == MOUSE_BUTTON_WHEEL_UP else 1.0 / 1.2
			var z := clampf(_zoom * f, 1.0, 40.0)
			var o2 := mb.position - (mb.position - _origin()) * (z / _zoom)
			_zoom = z
			_pan = Vector2.ZERO if z == 1.0 else o2 - (size - _raster() * _scale()) / 2.0
			queue_redraw()
			accept_event()
	var k := event as InputEventKey
	if k != null and markers_mode and k.keycode in [KEY_LEFT, KEY_RIGHT, KEY_UP, KEY_DOWN]:
		accept_event()  # held arrows drive the marker (marker_driver polls them), not UI focus navigation
	var mm := event as InputEventMouseMotion
	if mm != null and _held and markers_mode:
		drag.emit(to_raster(mm.position))
		accept_event()
	if mm != null and _drag:
		_pan += mm.relative
		queue_redraw()
		accept_event()
