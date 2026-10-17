extends Control
## WO-617 — lightweight 2D previs: the stage drawn with plain canvas calls, no 3D renderer.
##   front = elevation (x → right, height ↑), objects at their projected width (yaw applied)
##   plan  = top-down footprints (x → right, audience/downstage +z ↓), curved walls, projector + frustum
## Click selects, drag moves (front: X/height, plan: X/Z; 0.05 m snap). "Live pictures" holds the
## objects' video surfaces only while on AND visible — off = layout only, zero surfaces read.

signal selected(id: String)
signal moved(id: String, position: Array)
signal rotated(id: String, yaw_deg: float)

const S := preload("res://features/previs/stage_objects.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const SNAP := 0.05
const TYPE_COLOR := {"led_wall": Color("#58a6ff"), "tv": Color("#2ecc71"), "projection": Color("#e3b341")}

var view := "front"            # "front" | "plan"
var live_pictures := false
var objects: Array = []
var selected_id := ""
var _scale := 40.0             # px per metre
var _origin := Vector2.ZERO    # screen px of world (0, 0)
var _fitted := false
var _drag := {}                # {id, start_mouse, start_pos}
var _pan := false
var _held := {}                # role -> true (surfaces this view holds)
var _t := 0.0


func _ready() -> void:
	clip_contents = true
	mouse_filter = Control.MOUSE_FILTER_STOP
	resized.connect(fit)
	visibility_changed.connect(_sync_holds)


func set_objects(list: Array) -> void:
	objects = list
	if not _fitted:
		fit()
	_sync_holds()
	queue_redraw()


func set_view(v: String) -> void:
	view = v
	fit()


func set_live_pictures(on: bool) -> void:
	live_pictures = on
	_sync_holds()
	queue_redraw()


func select(id: String) -> void:
	selected_id = id
	queue_redraw()


func fit() -> void:
	if size.x < 8.0 or size.y < 8.0:
		return  # not laid out yet; resized → fit() again
	var box := Rect2()
	var first := true
	for o in objects:
		for p in _shape(o):
			box = Rect2(p, Vector2.ZERO) if first else box.expand(p)
			first = false
	if first:
		box = Rect2(-5, -1, 10, 6) if view == "front" else Rect2(-5, -5, 10, 10)
	box = box.grow(maxf(box.size.x, box.size.y) * 0.12 + 0.5)
	_scale = minf(size.x / maxf(box.size.x, 0.1), size.y / maxf(box.size.y, 0.1))
	var c := box.get_center()
	_origin = size / 2.0 - Vector2(c.x, _sy(c.y)) * _scale
	_fitted = size.x > 0
	queue_redraw()


func _process(delta: float) -> void:
	if not live_pictures or not is_visible_in_tree():
		return
	_t += delta
	if _t >= 0.04:  # pictures at 25 Hz; the layout alone is redrawn only on change
		_t = 0.0
		queue_redraw()


func _draw() -> void:
	draw_rect(Rect2(Vector2.ZERO, size), ThemeBuilder.BG_DARK)
	_draw_grid()
	var font := get_theme_default_font()
	for o in objects:
		if not o.get("visible", true):
			continue
		var col: Color = TYPE_COLOR.get(str(o.type), Color.WHITE)
		var sel: bool = str(o.id) == selected_id
		if view == "front":
			var r := _front_px(o)
			draw_rect(r, Color(0.04, 0.04, 0.05))
			var tex := _texture(o)
			if tex != null and tex.get_width() > 0 and r.size.x > 2.0:
				var uv := S.uv_rect(o, Vector2i(tex.get_width(), tex.get_height()))
				draw_texture_rect_region(tex, r, Rect2(uv.x * tex.get_width(), uv.y * tex.get_height(), uv.z * tex.get_width(), uv.w * tex.get_height()))
			draw_rect(r, ThemeBuilder.ACCENT if sel else col, false, 3.0 if sel else 1.5)
			draw_string(font, r.position + Vector2(4, -6), _label(o), HORIZONTAL_ALIGNMENT_LEFT, -1, 13, ThemeBuilder.TEXT if sel else ThemeBuilder.TEXT_MUTED)
		else:
			var pts := PackedVector2Array()
			for p in S.footprint(o):
				pts.append(_px(p))
			draw_polyline(pts, ThemeBuilder.ACCENT if sel else col, 5.0 if sel else 3.0)
			if str(o.type) == "projection":
				var pj := _px(S.projector_world_xz(o))
				draw_circle(pj, 5.0, col)
				draw_line(pj, pts[0], Color(col, 0.4), 1.0)
				draw_line(pj, pts[pts.size() - 1], Color(col, 0.4), 1.0)
			draw_string(font, pts[0] + Vector2(0, -8), _label(o), HORIZONTAL_ALIGNMENT_LEFT, -1, 13, ThemeBuilder.TEXT if sel else ThemeBuilder.TEXT_MUTED)
	var hint := "FRONT — drag: move X / height" if view == "front" else "PLAN (audience ↓) — drag: move X / Z · shift-drag: rotate"
	draw_string(font, Vector2(10, size.y - 10), hint + " · wheel: zoom · right-drag: pan", HORIZONTAL_ALIGNMENT_LEFT, -1, 12, ThemeBuilder.TEXT_MUTED)


func _gui_input(event: InputEvent) -> void:
	var mb := event as InputEventMouseButton
	if mb != null:
		if mb.button_index == MOUSE_BUTTON_LEFT and mb.pressed:
			var id := _hit(mb.position)
			selected_id = id
			selected.emit(id)
			if id != "":
				var o: Dictionary = objects[_index(id)]
				_drag = {"id": id, "start": mb.position, "pos": (o.position as Array).duplicate(), "moved": false,
					"rotate": view == "plan" and mb.shift_pressed, "yaw": float(o.rotation[1])}
			queue_redraw()
		elif mb.button_index == MOUSE_BUTTON_LEFT and not mb.pressed:
			if not _drag.is_empty() and _drag.moved:
				if _drag.rotate:
					rotated.emit(_drag.id, float(objects[_index(_drag.id)].rotation[1]))
				else:
					moved.emit(_drag.id, objects[_index(_drag.id)].position)
			_drag = {}
		elif mb.button_index == MOUSE_BUTTON_RIGHT:
			_pan = mb.pressed
		elif mb.pressed and mb.button_index in [MOUSE_BUTTON_WHEEL_UP, MOUSE_BUTTON_WHEEL_DOWN]:
			var f := 1.15 if mb.button_index == MOUSE_BUTTON_WHEEL_UP else 1.0 / 1.15
			_origin = mb.position + (_origin - mb.position) * f
			_scale = clampf(_scale * f, 1.0, 5000.0)
			queue_redraw()
	var mm := event as InputEventMouseMotion
	if mm != null:
		if _pan:
			_origin += mm.relative
			queue_redraw()
		elif not _drag.is_empty() and _drag.rotate:
			# plan: screen angle grows clockwise (z down); a positive yaw turns the object counter-clockwise
			var o: Dictionary = objects[_index(_drag.id)]
			var c := _px(Vector2(float(o.position[0]), float(o.position[2])))
			var start: Vector2 = _drag.start
			var a0: float = (start - c).angle()
			var a1: float = (mm.position - c).angle()
			var r: Array = (o.rotation as Array).duplicate()
			r[1] = wrapf(snappedf(float(_drag.yaw) - rad_to_deg(a1 - a0), 5.0), -180.0, 180.0)
			o.rotation = r
			_drag.moved = true
			queue_redraw()
		elif not _drag.is_empty():
			var d: Vector2 = (mm.position - _drag.start) / _scale
			var p: Array = (_drag.pos as Array).duplicate()
			p[0] = snappedf(float(p[0]) + d.x, SNAP)
			if view == "front":
				p[1] = maxf(-50.0, snappedf(float(p[1]) - d.y, SNAP))
			else:
				p[2] = snappedf(float(p[2]) + d.y, SNAP)
			objects[_index(_drag.id)].position = p
			_drag.moved = true
			queue_redraw()


## Screen geometry -------------------------------------------------------------------------------

func _sy(y: float) -> float:
	return -y if view == "front" else y  # front: height grows up the screen; plan: +z (audience) down


func _px(w: Vector2) -> Vector2:
	return _origin + Vector2(w.x, _sy(w.y)) * _scale


func _front_px(o: Dictionary) -> Rect2:
	var r := S.front_rect(o)
	var a := _px(Vector2(r.position.x, r.position.y + r.size.y))
	return Rect2(a, r.size * _scale)


func _shape(o: Dictionary) -> Array:
	if view == "front":
		var r := S.front_rect(o)
		return [r.position, r.end]
	var pts: Array = Array(S.footprint(o))
	if str(o.type) == "projection":
		pts.append(S.projector_world_xz(o))
	return pts


func _hit(at: Vector2) -> String:
	for i in range(objects.size() - 1, -1, -1):
		var o: Dictionary = objects[i]
		if view == "front":
			if _front_px(o).grow(4.0).has_point(at):
				return str(o.id)
		else:
			var fp := S.footprint(o)
			for j in fp.size() - 1:
				if Geometry2D.get_closest_point_to_segment(at, _px(fp[j]), _px(fp[j + 1])).distance_to(at) < 8.0:
					return str(o.id)
	return ""


func _index(id: String) -> int:
	for i in objects.size():
		if str(objects[i].id) == id:
			return i
	return -1


func _label(o: Dictionary) -> String:
	var s := S.size_m(o)
	return "%s  %.2f×%.2f m" % [o.name, s.x, s.y]


func _draw_grid() -> void:
	if _scale <= 0.5 or not is_finite(_scale):
		return
	var step := 1.0 if _scale > 12.0 else (5.0 if _scale > 2.0 else 25.0)
	var lo := (Vector2.ZERO - _origin) / _scale
	var hi := (size - _origin) / _scale
	var c := Color(1, 1, 1, 0.05)
	var x := floorf(lo.x / step) * step
	while x <= hi.x and x - lo.x < step * 400.0:
		draw_line(Vector2(_origin.x + x * _scale, 0), Vector2(_origin.x + x * _scale, size.y), c)
		x += step
	var y := floorf(lo.y / step) * step
	while y <= hi.y and y - lo.y < step * 400.0:
		draw_line(Vector2(0, _origin.y + y * _scale), Vector2(size.x, _origin.y + y * _scale), c)
		y += step
	var axis := Color(1, 1, 1, 0.18)
	draw_line(Vector2(0, _origin.y), Vector2(size.x, _origin.y), axis, 1.5)  # floor (front) / stage line z = 0 (plan)


## Surfaces: held only while live pictures are on and the view is visible -----------------------

func _texture(o: Dictionary) -> Texture2D:
	if not live_pictures:
		return null
	var vs := get_node_or_null("/root/VideoSurfaces")
	return vs.texture(str(o.source.role)) if vs != null else null


func _sync_holds() -> void:
	var vs := get_node_or_null("/root/VideoSurfaces")
	if vs == null:
		return
	var want := {}
	if live_pictures and is_visible_in_tree():
		for o in objects:
			want[str(o.source.role)] = true
	for role in _held.keys():
		if not want.has(role):
			vs.release(role, self)
			_held.erase(role)
	for role in want.keys():
		if not _held.has(role):
			vs.acquire(role, self)
			_held[role] = true
