extends Control
## WO-869 — the slice editor's OUTPUT canvas: one output's raster (the editor's output tab) with the slices placed on
## it, each drawn as the feed picture cut by its src and mapped onto its compiled quad (a grid through the slice's
## homography, so keystone looks as Caspar draws it). The selected slice gets handles: drag the body to move; in
## Transform mode the edge / corner squares scale (in the slice's own rotated frame) and the knob above the top
## rotates (Shift: 15° steps); in Warp mode the corner diamonds keystone (refused when the quad would stop being
## convex). Snap 8 px (Alt: free).

const SM := preload("res://features/devices/slice_model.gd")
const CM := preload("res://features/devices/slice_canvas_math.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const HANDLE := 7.0
const KNOB := 26.0  # rotate knob distance above the top edge (canvas px)
const GRID := 8

var flow: RefCounted
var out_id := ""
var mode := "transform"  # "transform": move / scale / rotate handles; "warp": the four corner diamonds (keystone)
var _role := ""
var _tex: Texture2D
var _drag := {}  # {mode: move|scale|rotate|warp, i, start (slice copy), at (output px), handle | corner}


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


func raster() -> Vector2:
	var o: Dictionary = flow.output(out_id)
	return Vector2(maxf(1, float(o.w)), maxf(1, float(o.h)))


func _fit() -> Dictionary:
	return CM.fit(size, raster(), 28.0)


func _cv(p: Vector2, f: Dictionary) -> Vector2:
	return f.off + p * f.scale


func _out(p: Vector2, f: Dictionary) -> Vector2:
	return (p - f.off) / f.scale


## The slices on this output, bottom first.
func _here() -> Array:
	return SM.draw_order(flow.slices).filter(func(i: int) -> bool: return str(flow.slices[i].outputId) == out_id)


func _draw() -> void:
	draw_rect(Rect2(Vector2.ZERO, size), Color(0.07, 0.07, 0.08))
	if flow == null:
		return
	var f := _fit()
	var frame := Rect2(f.off, raster() * f.scale)
	draw_rect(frame, Color.BLACK)
	draw_set_transform(Vector2.ZERO)
	for i in _here():
		_draw_slice(i, f)
	draw_rect(frame, Color(1, 1, 1, 0.5), false, 1.0)
	var s: Dictionary = flow.selected()
	if not s.is_empty() and str(s.outputId) == out_id:
		_draw_handles(s, f)


func _draw_slice(i: int, f: Dictionary) -> void:
	var s: Dictionary = flow.slices[i]
	var quad := SM.dst_quad(s.dst)
	var alpha := float(s.opacity) * (1.0 if s.enabled else 0.25)
	var c := Color.from_hsv(fmod(0.08 + i * 0.13, 1.0), 0.65, 1.0)
	if not SM.is_convex(quad):
		draw_polyline(PackedVector2Array((quad + [quad[0]]).map(func(p: Vector2) -> Vector2: return _cv(p, f))), Color.RED, 2.0)
		return
	var src := Rect2(s.src.x, s.src.y, s.src.w, s.src.h)
	var h := SM.homography(SM.rect_corners(s.src), quad)
	if h.is_empty():
		return
	var tex := _picture()
	for gy in GRID:
		for gx in GRID:
			var pts := PackedVector2Array()
			var uvs := PackedVector2Array()
			for k in [Vector2(gx, gy), Vector2(gx + 1, gy), Vector2(gx + 1, gy + 1), Vector2(gx, gy + 1)]:
				var sp: Vector2 = src.position + src.size * k / float(GRID)
				pts.append(_cv(SM.apply_h(h, sp), f))
				uvs.append(sp / flow.input)
			if tex != null:
				draw_polygon(pts, PackedColorArray([Color(1, 1, 1, alpha)]), uvs, tex)
			else:
				var shade := 0.55 + 0.25 * float((gx + gy) % 2)
				draw_polygon(pts, PackedColorArray([Color(c * shade, alpha)]))
	var outline := PackedVector2Array((quad + [quad[0]]).map(func(p: Vector2) -> Vector2: return _cv(p, f)))
	draw_polyline(outline, Color(c, 0.9), 2.0 if i == flow.sel else 1.0)
	# the source's top-left corner marker shows flips / rotation at a glance
	draw_circle(_cv(quad[0], f), 4.0, Color(c, 1.0))
	draw_string(get_theme_default_font(), _cv(SM.screen_corners(s.dst)[0], f) + Vector2(6, 16), str(s.name),
		HORIZONTAL_ALIGNMENT_LEFT, -1, 12, Color.WHITE)


## Screen-space handles of slice `s`: {scale: [[Vector2i edge, canvas pt]…], warp: [canvas pt ×4], knob, top}.
func _handles(s: Dictionary, f: Dictionary) -> Dictionary:
	var sc := SM.screen_corners(s.dst)
	var rect_pts := SM.rotate_about(SM.rect_corners(s.dst.rect),
		Vector2(s.dst.rect.x + s.dst.rect.w / 2.0, s.dst.rect.y + s.dst.rect.h / 2.0), float(s.dst.rotation))
	var scale := []
	var edges := [[Vector2i(-1, -1), 0], [Vector2i(1, -1), 1], [Vector2i(1, 1), 2], [Vector2i(-1, 1), 3]]
	for e in edges:
		scale.append([e[0], _cv(rect_pts[e[1]], f)])
	for m in [[Vector2i(0, -1), 0, 1], [Vector2i(1, 0), 1, 2], [Vector2i(0, 1), 2, 3], [Vector2i(-1, 0), 3, 0]]:
		scale.append([m[0], _cv((rect_pts[m[1]] + rect_pts[m[2]]) / 2.0, f)])
	var top := _cv((rect_pts[0] + rect_pts[1]) / 2.0, f)
	var up := Vector2(0, -1).rotated(deg_to_rad(float(s.dst.rotation)))
	return {"scale": scale, "warp": sc.map(func(p: Vector2) -> Vector2: return _cv(p, f)), "knob": top + up * KNOB, "top": top}


func _draw_handles(s: Dictionary, f: Dictionary) -> void:
	var hs := _handles(s, f)
	if mode == "warp":
		for p in hs.warp:
			var d := HANDLE * 1.1
			draw_colored_polygon(PackedVector2Array([p + Vector2(0, -d), p + Vector2(d, 0), p + Vector2(0, d), p + Vector2(-d, 0)]), Color(1, 0.8, 0.2))
		return
	draw_line(hs.top, hs.knob, Color.WHITE, 1.0)
	draw_circle(hs.knob, HANDLE * 0.8, Color.WHITE)
	for e in hs.scale:
		draw_rect(Rect2(e[1] - Vector2(HANDLE, HANDLE) / 2.0, Vector2(HANDLE, HANDLE)), Color.WHITE)


func _gui_input(event: InputEvent) -> void:
	if flow == null:
		return
	var f := _fit()
	if event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT:
		accept_event()
		if event.pressed:
			_press(event.position, f)
		else:
			var moved: bool = _drag.get("moved", false)
			_drag = {}
			if moved:
				flow.save()
	elif event is InputEventMouseMotion and not _drag.is_empty():
		accept_event()
		_move(event.position, f, not event.alt_pressed, event.shift_pressed)


func _press(cp: Vector2, f: Dictionary) -> void:
	grab_focus()
	var p := _out(cp, f)
	var s: Dictionary = flow.selected()
	if not s.is_empty() and str(s.outputId) == out_id:
		var hs := _handles(s, f)
		var base := {"i": flow.sel, "start": s.duplicate(true), "at": p}
		if mode == "warp":
			for k in 4:
				if cp.distance_to(hs.warp[k]) <= HANDLE + 3.0:
					_drag = base.merged({"mode": "warp", "corner": k})
					return
		else:
			if cp.distance_to(hs.knob) <= HANDLE + 3.0:
				_drag = base.merged({"mode": "rotate"})
				return
			for e in hs.scale:
				if cp.distance_to(e[1]) <= HANDLE + 2.0:
					_drag = base.merged({"mode": "scale", "handle": e[0]})
					return
	var order := _here()
	order.reverse()
	for i in order:
		if CM.in_quad(SM.dst_quad(flow.slices[i].dst), p):
			flow.select(i)
			_drag = {"mode": "move", "i": i, "start": flow.slices[i].duplicate(true), "at": p}
			return
	flow.select(-1)


func _move(cp: Vector2, f: Dictionary, snapping: bool, shift: bool) -> void:
	var p := _out(cp, f)
	var d: Vector2 = p - _drag.at
	var s: Dictionary = _drag.start.duplicate(true)
	match _drag.mode:
		"move":
			s.dst.rect = CM.moved_dst(s.dst.rect, d, snapping)
		"scale":
			s.dst.rect = CM.scaled_dst(s.dst.rect, float(s.dst.rotation), _drag.handle, d)
		"rotate":
			var c := Vector2(s.dst.rect.x + s.dst.rect.w / 2.0, s.dst.rect.y + s.dst.rect.h / 2.0)
			s.dst.rotation = CM.rotation_to(c, p, 15.0 if shift else (1.0 if snapping else 0.0))
		"warp":
			var n := CM.warped(s.dst, _drag.corner, _drag.start.dst.warp[_drag.corner], d)
			if n.is_empty():
				return
			s.dst = n
	flow.put(_drag.i, s, false)
	_drag.moved = true
