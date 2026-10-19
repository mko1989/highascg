extends Control
## WO-616 T3b — previs "Camera" mode: the selected tracking camera's live surface (WO-597 role, letterboxed to the
## camera raster) with the stage drawn over it through the solved camera + lens: floor grid, stage-object outlines,
## calibration points (dot = where the camera shows it, ring = clicked; a red line joins the two = the error).
## Click = put the active point here · ctrl+click = make the nearest point active · wheel zoom · right-drag pan.
## Holds its surface only while shown (VideoSurfaces refcount, WO-617).
## T5b Markers mode: markers drawn on the floor (ground circle + body line + name; stale = dimmed); press on a
## marker's circle grabs it, drag moves it, release lets go (marker_driver); calibration clicks are off.
## T11 Follow mode: the same, plus each follow fixture's beam as the server aims it (dimmed while holding).
## T7: trigger zones are drawn on the floor in Markers / Follow / Zones mode (filled while the server says a marker
## is inside; the selected one thicker). Zones mode drags markers like Markers mode, except while drawing a shape:
## then a click is a floor corner (`clicked`).
## T12: optional 3D ghost (camera_overlay.gd: the previs stage rendered through the solved camera, lens applied in
## its shader) between the picture and the 2D lines — the picture and ghost are children drawn behind this node.
## T9b: detected persons of this camera are boxed (the one a marker is pinned to in that marker's colour, thicker);
## an assisted marker's ring is the operator's anchor, a thin line joins it to the body at the AI-corrected output.
## T9c: Detect mode draws the camera's ROI masks (filled while they filter, outline only while off); while one is
## being drawn a click is a picture corner (`clicked`) instead of a marker grab.

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
var follow_mode := false
var beams: Array = []  # follow_model.beams()
var zones_mode := false
var detect_mode := false
var zone_drawing := false
var zone_shapes: Array = []  # [{name, color, loop: [[x, y, z]…], occupied, selected, open}]
var mask_shapes: Array = []  # mask_section.shapes(): [{vertices: [[x, y] 0–1…], enabled, selected}]
var mask_drawing := false
var masks_on := false  # the set filters (detect_model.masks_active)
var _held := false
var detections := {}  # marker_driver.detections (tracking:detections)

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
var ghost: SubViewport  # camera_overlay.gd (previs_tab), or null
var ghost_on := false
var _back: Control
var _ghost: TextureRect


func _ready() -> void:
	clip_contents = true
	mouse_filter = Control.MOUSE_FILTER_STOP
	focus_mode = Control.FOCUS_CLICK  # arrows drive the selected marker while the view has focus
	visibility_changed.connect(_hold)
	_back = Control.new()
	_back.show_behind_parent = true
	_back.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_back.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_back.draw.connect(_draw_back)
	add_child(_back)
	_ghost = TextureRect.new()
	_ghost.show_behind_parent = true
	_ghost.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_ghost.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	_ghost.stretch_mode = TextureRect.STRETCH_SCALE
	_ghost.visible = false
	add_child(_ghost)
	resized.connect(queue_redraw)


func set_state(t: Dictionary, ce: Dictionary, objects: Array, active_id: String) -> void:
	entry = ce
	active = active_id
	_lines = O.lines(t, ce, objects) if not ce.is_empty() else {}
	_pts = O.points(t, ce, objects) if not ce.is_empty() else []
	rms = float(ce.get("rms", -1.0))
	_hold()
	_sync_ghost()
	queue_redraw()


## T12: show / hide the 3D ghost (rendered only while shown).
func set_ghost(on: bool, opacity: float) -> void:
	ghost_on = on
	if ghost != null:
		ghost.set_opacity(opacity)
	_sync_ghost()


func _sync_ghost() -> void:
	var on: bool = ghost != null and ghost_on and _on and is_visible_in_tree() and ghost.set_camera(entry)
	if ghost != null:
		ghost.set_active(on)
		_ghost.texture = ghost.get_texture()
		_ghost.material = ghost.material
	_ghost.visible = on


func set_beams(b: Array) -> void:
	beams = b
	if markers_mode:
		queue_redraw()


func set_zones(shapes: Array, drawing: bool) -> void:
	zone_shapes = shapes
	zone_drawing = drawing
	queue_redraw()


func set_masks(shapes: Array, on: bool, drawing: bool) -> void:
	mask_shapes = shapes
	masks_on = on
	mask_drawing = drawing
	queue_redraw()


func set_marks(m: Array, sel: int) -> void:
	marks = m
	selected_marker = sel
	queue_redraw()


func set_detections(d: Dictionary) -> void:
	detections = d
	queue_redraw()


func set_on(on: bool) -> void:
	_on = on
	_hold()
	_sync_ghost()


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
	_back.queue_redraw()


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


## Behind everything (child `_back`): background + the camera picture. The ghost (child `_ghost`) sits on it.
func _draw_back() -> void:
	_back.draw_rect(Rect2(Vector2.ZERO, size), ThemeBuilder.BG_DARK)
	if entry.is_empty():
		return
	var img := Rect2(_origin(), _raster() * _scale())
	_ghost.position = img.position
	_ghost.size = img.size
	var tex: Texture2D = VideoSurfaces.texture(_role) if _role != "" else null
	if tex != null and tex.get_width() > 1:
		_back.draw_texture_rect(tex, img, false)
		var real := Vector2i(tex.get_width(), tex.get_height())
		if real != Vector2i(_raster()) and real != _told:
			_told = real
			source_size.emit.call_deferred(real)
	else:
		_back.draw_rect(img, ThemeBuilder.BG_ELEVATED)
		_back.draw_string(get_theme_default_font(), img.position + Vector2(16, 28), "no picture from %s" % entry.role, HORIZONTAL_ALIGNMENT_LEFT, -1, 15, ThemeBuilder.TEXT_MUTED)


func _draw() -> void:
	_back.queue_redraw()
	var font := get_theme_default_font()
	if entry.is_empty():
		draw_string(font, Vector2(16, 32), "No tracking camera — Add one in the Inspector.", HORIZONTAL_ALIGNMENT_LEFT, -1, 15, ThemeBuilder.TEXT_MUTED)
		return
	var gcol := Color(ThemeBuilder.ACCENT_GREEN, 0.6)
	for pl in _lines.get("grid", []):
		draw_polyline(_xf(pl), gcol, 1.5, true)
	for o in _lines.get("objects", []):
		for pl in o.lines:
			draw_polyline(_xf(pl), ThemeBuilder.WARN, 2.0, true)
		if not (o.lines as Array).is_empty() and (o.lines[0] as PackedVector2Array).size() > 0:
			draw_string(font, to_view(o.lines[0][0]) + Vector2(4, -6), o.name, HORIZONTAL_ALIGNMENT_LEFT, -1, 13, ThemeBuilder.WARN)
	var act: Dictionary = {}
	for p in _pts if not (markers_mode or zones_mode) else []:  # Markers mode: grid + objects only, the markers are the subject
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
		if at != null and not (markers_mode or zones_mode):
			draw_arc(to_view(at), 13.0, 0.0, TAU, 28, ThemeBuilder.ACCENT_HOVER, 2.5, true)
	if markers_mode or zones_mode:
		_draw_zones(font)
	if markers_mode:
		_draw_beams(font)
	if detect_mode:
		_draw_masks()
	_draw_boxes(font)
	_draw_marks(font)
	var head := "Active: %s — click where it is in the picture" % act.label if not act.is_empty() else "Pick a point in the Inspector list"
	var tail := " · ctrl+click: pick point · wheel: zoom · right-drag: pan · F: fit"
	if markers_mode:
		head = "Markers — drag a marker's circle · stick / arrows move the selected one (camera-relative)"
		tail = " · LB/RB speed · D-pad ◀▶ marker · wheel: zoom · right-drag: pan"
	if follow_mode:
		head = "Follow — beams show where the server aims each fixture · drag / drive a marker to test"
	if detect_mode:
		head = ("Detect — click the mask's corners in the picture · Draw shape again to finish" if mask_drawing else
			"Detect — boxes = detected persons (pinned one in its marker's colour) · assist: drag the ring, the body follows the AI")
	if zones_mode:
		head = ("Zones — click the zone's corners on the floor · Draw shape again to finish" if zone_drawing else
			"Zones — filled = a marker is inside (server) · drag / drive a marker through a zone to test")
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
		var foot := to_view(m.foot) if m.get("foot") != null else c
		var top := to_view(m.top) if m.top != null else foot
		if m.get("assisted", false) and foot.distance_to(c) > 1.0:
			draw_line(c, foot, Color(col, col.a * 0.6), 1.5, true)
			draw_arc(foot, 5.0, 0.0, TAU, 14, col, 2.0, true)
		draw_line(foot, top, col, 2.0, true)
		draw_circle(top, 5.0 if sel else 4.0, col)
		var label := "%s%s%s" % [m.name, " · stale" if m.stale else "", _pin_tag(m)]
		draw_string(font, top + Vector2(8, -4), label, HORIZONTAL_ALIGNMENT_LEFT, -1, 14 if sel else 13, col)
		if sel:
			draw_arc(c, 4.0, 0.0, TAU, 12, ThemeBuilder.TEXT, 2.0, true)


func _pin_tag(m: Dictionary) -> String:
	if m.get("assisted", false):
		return " · assist"
	if m.get("driven", false):
		return " · AI" if float(m.get("status", 1.0)) > 0.0 else " · AI lost"
	return ""


func _draw_boxes(font: Font) -> void:
	if entry.is_empty() or detections.get("enabled") != true or not (markers_mode or zones_mode):
		return
	var r := _raster()
	var cols := {}
	for m in marks:
		cols[int(m.id)] = m.color
	for cam in detections.get("cameras", []):
		if not (cam is Dictionary) or str(cam.get("id", "")) != str(entry.get("id", "")) or cam.get("stale") == true:
			continue
		for p in cam.get("persons", []):
			var b: Array = p.get("box", [])
			if b.size() < 4:
				continue
			var pinned: bool = p.has("marker")
			var col: Color = cols.get(int(p.get("marker", 0)), ThemeBuilder.ACCENT) if pinned else Color(ThemeBuilder.ACCENT, 0.7)
			if float(p.get("age_s", 0.0)) > 0.0:
				col.a *= 0.45  # coasting: the tracker predicts it, no box matched this step
			var a := to_view(Vector2(float(b[0]) * r.x, float(b[1]) * r.y))
			var z := to_view(Vector2(float(b[2]) * r.x, float(b[3]) * r.y))
			draw_rect(Rect2(a, z - a), col, false, 3.0 if pinned else 1.5)
			if detect_mode and masks_on:
				draw_circle(Vector2((a.x + z.x) / 2.0, z.y), 4.0, col)  # the feet point the masks test
			draw_string(font, a + Vector2(3, -4), "#%d %.0f%%" % [int(p.get("tid", 0)), float(p.get("score", 0.0)) * 100.0],
				HORIZONTAL_ALIGNMENT_LEFT, -1, 12, col)


func _draw_masks() -> void:
	var r := _raster()
	for m in mask_shapes:
		var poly := PackedVector2Array()
		for v in m.vertices:
			poly.append(to_view(Vector2(float(v[0]) * r.x, float(v[1]) * r.y)))
		var live: bool = masks_on and m.enabled
		var col := Color(ThemeBuilder.ACCENT_GREEN, 1.0 if live else 0.45)
		if live and poly.size() >= 3 and not Geometry2D.triangulate_polygon(poly).is_empty():
			draw_colored_polygon(poly, Color(col, 0.12))
		if poly.size() >= 2:
			var loop := poly.duplicate()
			if poly.size() >= 3:
				loop.append(poly[0])
			draw_polyline(loop, col, 3.0 if m.selected else 1.5, true)
		if m.selected and mask_drawing:
			for p in poly:
				draw_circle(p, 4.0, col)


func _draw_zones(font: Font) -> void:
	for z in zone_shapes:
		var col := Color(z.color)
		var loop: Array = z.loop
		if loop.size() < 2:
			continue
		var px := O.shown(entry, loop)
		if z.occupied and not px.has(null) and px.size() >= 4:
			var poly := PackedVector2Array()
			for i in px.size() - 1:
				poly.append(to_view(Vector2(px[i][0], px[i][1])))
			if not Geometry2D.triangulate_polygon(poly).is_empty():
				draw_colored_polygon(poly, Color(col, 0.3))
		for i in loop.size() - 1:
			for pl in O.edge(entry, loop[i], loop[i + 1]):
				draw_polyline(_xf(pl), col, 3.0 if z.selected else 1.5, true)
		if z.selected and zone_drawing:
			for p in px:
				if p != null:
					draw_circle(to_view(Vector2(p[0], p[1])), 4.0, col)
		var at: Variant = px[0]
		if at != null:
			draw_string(font, to_view(Vector2(at[0], at[1])) + Vector2(6, -6), z.name, HORIZONTAL_ALIGNMENT_LEFT, -1, 13, col)


func _draw_beams(font: Font) -> void:
	for b in beams:
		var col := Color(ThemeBuilder.WARN, 0.95 if b.live else 0.4)
		for pl in O.edge(entry, b.from, b.to):
			draw_polyline(_xf(pl), col, 2.5 if b.live else 1.5, true)
		var head: Variant = O.shown(entry, [b.from])[0]
		if head != null:
			var at := to_view(Vector2(head[0], head[1]))
			draw_rect(Rect2(at - Vector2(5, 5), Vector2(10, 10)), col)
			draw_string(font, at + Vector2(8, 14), b.name, HORIZONTAL_ALIGNMENT_LEFT, -1, 13, col)


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
		if mb.button_index == MOUSE_BUTTON_LEFT and (markers_mode or zones_mode) and not (zone_drawing or mask_drawing):
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
	if k != null and (markers_mode or zones_mode) and k.keycode in [KEY_LEFT, KEY_RIGHT, KEY_UP, KEY_DOWN]:
		accept_event()  # held arrows drive the marker (marker_driver polls them), not UI focus navigation
	var mm := event as InputEventMouseMotion
	if mm != null and _held and (markers_mode or zones_mode):
		drag.emit(to_raster(mm.position))
		accept_event()
	if mm != null and _drag:
		_pan += mm.relative
		queue_redraw()
		accept_event()
