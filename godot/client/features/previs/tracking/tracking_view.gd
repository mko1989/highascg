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
## WO-1091: zoom goes below 1× (the ghost then renders around the frame, which is outlined); while the camera may be
## aimed by hand (`aim_on`: Calibrate mode, not solved or unlocked) drag = look around, shift+drag = move, shift+wheel =
## dolly, ctrl+wheel = lens (`aimed`); a click without a drag is still a calibration click.
## T9c: Detect mode draws the camera's ROI masks (filled while they filter, outline only while off); while one is
## being drawn a click is a picture corner (`clicked`) instead of a marker grab.

const O := preload("res://features/previs/tracking/tracking_overlay.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const D := preload("res://features/previs/tracking/detect_model.gd")
const L := preload("res://features/previs/tracking/view_layers.gd")  # WO-1091 split
const A := preload("res://features/previs/tracking/aim_model.gd")  # WO-1091

signal clicked(px: Vector2)          # raster pixels of the camera picture
signal picked(id: String)
signal source_size(size: Vector2i)   # the surface's real size (differs from the raster the camera was set up with)
signal grab(px: Vector2)             # Markers mode, raster px
signal drag(px: Vector2)
signal let_go
signal aimed(cam: Dictionary, done: bool)  # WO-1091 rough aim: a new pose (done = the drag / wheel step ended)

var markers_mode := false
var marks: Array = []  # marker_driver.marks()
var selected_marker := 0
var follow_mode := false
var calibrating := false  # WO-630 F1: Follow mode with a fixture calibration open — a floor click is the beam spot
var beams: Array = []  # follow_model.beams()
var zones_mode := false
var detect_mode := false
var zone_drawing := false
var zone_shapes: Array = []  # [{name, color, loop: [[x, y, z]…], occupied, selected, open}]
var walk_line := {}  # T10d: walk_section.line() {name, a, b, z} — drawn in Detect mode
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
var ghost_opacity := 0.6
var aim_on := false  # WO-1091 (previs_tab: pose_section.aim_on())
var _aim := {}  # the pose being dragged
var _press := Vector2.INF  # left press while aiming (a release without a drag is a click)
var _pic := false  # a live camera picture is drawn
var _wide := 1.0
var _black := false  # the picture is all black (no signal on the input) — checked every 2 s
var _black_t := 0.0
var _floor := 0.0  # the grid's floor z (rough aim: distances to the stage floor)
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
	_floor = float((t.get("grid", {}) as Dictionary).get("z_offset", 0.0))
	rms = float(ce.get("rms", -1.0))
	_hold()
	_sync_ghost()
	queue_redraw()


## T12: show / hide the 3D ghost (rendered only while shown).
func set_ghost(on: bool, opacity: float) -> void:
	ghost_on = on
	ghost_opacity = opacity
	if ghost != null:
		ghost.set_opacity(opacity if _pic else 1.0)  # WO-1091: no picture → the ghost is the picture
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


func _process(d: float) -> void:
	_black_t -= d
	# WO-1106 B28: only for a view somebody sees, and a sparse CPU sample of the uploaded bytes (no GPU readback)
	if _black_t <= 0.0 and ghost_on and is_visible_in_tree():  # WO-1091: a black input is no picture — the ghost then draws at full strength
		_black_t = 2.0
		_black = _role != "" and VideoSurfaces.is_black(_role)
	queue_redraw()  # the surface texture updates in place, but its size can arrive after the lease
	_back.queue_redraw()


## WO-624 E2: the detected person (pin key) under a raster point of this camera, "" for none.
func person_at(px: Vector2) -> String:
	return D.person_at(detections, str(entry.get("id", "")), _raster(), px)


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
	var tex: Texture2D = VideoSurfaces.texture(_role) if _role != "" else null
	var pic := tex != null and tex.get_width() > 1 and not _black
	if pic != _pic:
		_pic = pic
		if ghost != null:
			ghost.set_opacity(ghost_opacity if pic else 1.0)
	if ghost != null and _ghost.visible:  # WO-1091: zoomed out, the ghost fills the view around the frame
		ghost.set_wide(A.wide(size, img))
		_wide = ghost.wide_used
	else:
		_wide = 1.0
	_ghost.position = img.get_center() - img.size * _wide / 2.0
	_ghost.size = img.size * _wide
	if tex != null and tex.get_width() > 1:
		_back.draw_texture_rect(tex, img, false)
		var real := Vector2i(tex.get_width(), tex.get_height())
		if real != Vector2i(_raster()) and real != _told:
			_told = real
			source_size.emit.call_deferred(real)
	else:
		_back.draw_rect(img, ThemeBuilder.BG_ELEVATED)


func _draw() -> void:
	_back.queue_redraw()
	var font := get_theme_default_font()
	if entry.is_empty():
		draw_string(font, Vector2(16, 32), "No tracking camera — Add one in the Inspector.", HORIZONTAL_ALIGNMENT_LEFT, -1, 15, ThemeBuilder.TEXT_MUTED)
		return
	_draw_frame(font)
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
		L.zones(self, font)
	if markers_mode:
		L.beams(self, font)
	if detect_mode:
		L.masks(self)
		L.walk(self, font)
	L.boxes(self, font)
	L.marks(self, font)
	var head := "Active: %s — click where it is in the picture" % act.label if not act.is_empty() else "Pick a point in the Inspector list"
	var tail := " · ctrl+click: pick point · wheel: zoom · right-drag: pan · F: fit"
	if aim_on:
		tail = " · drag: look around · shift+drag: move · shift+wheel: dolly · ctrl+wheel: lens · wheel: zoom · right-drag: pan · F: fit"
	if markers_mode:
		head = "Markers — click the floor: the selected marker goes there · drag a circle · stick / arrows move it"
		if marks.any(func(m: Dictionary) -> bool: return int(m.id) == selected_marker and m.get("driven", false)):
			head = "Markers — the selected marker is steered by detection (replace pin): set Detect's pin to off or assist to place it"
		tail = " · LB/RB speed · D-pad ◀▶ marker · wheel: zoom · right-drag: pan"
	if follow_mode:
		head = ("Follow — calibrating: jog the beam onto a floor spot, then click the spot in the picture" if calibrating else
			"Follow — beams show where the server aims each fixture · drag / drive a marker to test")
	if detect_mode:
		head = ("Detect — click the mask's corners in the picture · Draw shape again to finish" if mask_drawing else
			"Detect — boxes = detected persons (pinned one in its marker's colour) · assist: drag the ring, the body follows the AI")
	if zones_mode:
		head = ("Zones — click the zone's corners on the floor · Draw shape again to finish" if zone_drawing else
			"Zones — filled = a marker is inside (server) · drag / drive a marker through a zone to test")
	var rs := " · RMS %.2f px" % rms if rms >= 0.0 else " · not calibrated"
	draw_rect(Rect2(0, size.y - 26, size.x, 26), Color(ThemeBuilder.BG_DARK, 0.75))
	draw_string(font, Vector2(10, size.y - 8), head + rs + tail, HORIZONTAL_ALIGNMENT_LEFT, size.x - 20, 13, ThemeBuilder.TEXT)


## WO-1091: the camera's frame outlined, the overlay around it veiled; "no picture" over the ghost.
func _draw_frame(font: Font) -> void:
	var img := Rect2(_origin(), _raster() * _scale())
	var c := img.intersection(Rect2(Vector2.ZERO, size))
	if _wide > 1.0 and c.has_area():
		var veil := Color(ThemeBuilder.BG_DARK, 0.45)
		for r in [Rect2(0, 0, size.x, c.position.y), Rect2(0, c.end.y, size.x, size.y - c.end.y),
				Rect2(0, c.position.y, c.position.x, c.size.y), Rect2(c.end.x, c.position.y, size.x - c.end.x, c.size.y)]:
			if (r as Rect2).has_area():
				draw_rect(r, veil)
	draw_rect(img, Color(ThemeBuilder.TEXT, 0.55), false, 1.5)
	if not _pic:
		var msg: String = ("no signal on %s (black) — the 3D stage shown in its place" if _black else "no picture from %s — the 3D stage shown in its place") % entry.role
		var at := c.position + Vector2(8, 8)
		draw_rect(Rect2(at, font.get_string_size(msg, HORIZONTAL_ALIGNMENT_LEFT, -1, 14) + Vector2(12, 8)), Color(ThemeBuilder.BG_DARK, 0.8))
		draw_string(font, at + Vector2(6, 18), msg, HORIZONTAL_ALIGNMENT_LEFT, -1, 14, ThemeBuilder.TEXT)


func set_walk_line(l: Dictionary) -> void:
	walk_line = l
	queue_redraw()


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
		elif mb.button_index == MOUSE_BUTTON_LEFT and aim_on:  # WO-1091: a drag aims, a click is still a click
			grab_focus()
			if mb.pressed:
				_press = mb.position
				_aim = {}
			elif not _aim.is_empty():
				aimed.emit(_aim, true)
				_aim = {}
			elif _press != Vector2.INF:
				_click(mb)
			if not mb.pressed:
				_press = Vector2.INF
			accept_event()
		elif mb.button_index == MOUSE_BUTTON_LEFT and mb.pressed:
			grab_focus()
			_click(mb)
			accept_event()
		elif mb.button_index == MOUSE_BUTTON_RIGHT:
			_drag = mb.pressed
			accept_event()
		elif mb.pressed and mb.button_index in [MOUSE_BUTTON_WHEEL_UP, MOUSE_BUTTON_WHEEL_DOWN]:
			var st := 1.0 if mb.button_index == MOUSE_BUTTON_WHEEL_UP else -1.0
			if aim_on and (mb.shift_pressed or mb.is_command_or_control_pressed()):  # WO-1091: lens / dolly
				var cam: Dictionary = entry.cam
				aimed.emit(A.zoom_fov(cam, st) if mb.is_command_or_control_pressed() else A.dolly(cam, st, A.focus_distance(cam, _floor)), true)
				accept_event()
				return
			var z := A.clamp_zoom(_zoom * pow(1.2, st))  # WO-1091: below 1× too — the frame inside a wider overlay
			var o2 := mb.position - (mb.position - _origin()) * (z / _zoom)
			_zoom = z
			_pan = Vector2.ZERO if z <= 1.0 else o2 - (size - _raster() * _scale()) / 2.0
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
	if mm != null and aim_on and _press != Vector2.INF and (mm.button_mask & MOUSE_BUTTON_MASK_LEFT) != 0:
		if _aim.is_empty() and mm.position.distance_to(_press) < 4.0:
			return  # not a drag yet
		var cam: Dictionary = _aim if not _aim.is_empty() else entry.cam
		var fw := _raster().x * _scale()
		_aim = A.move(cam, mm.relative, fw, A.focus_distance(cam, _floor)) if mm.shift_pressed else A.look(cam, mm.relative, fw)
		aimed.emit(_aim, false)
		accept_event()


## A calibration click: ctrl = make the nearest point active, else put the active point here.
func _click(mb: InputEventMouseButton) -> void:
	var px := to_raster(mb.position)
	if mb.is_command_or_control_pressed():
		var i := O.nearest(_pts, px, 16.0 / _scale())
		if i >= 0:
			picked.emit(str(_pts[i].id))
	elif Rect2(Vector2.ZERO, _raster()).has_point(px):
		clicked.emit(px)
