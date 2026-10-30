extends RefCounted
## WO-869 — the slice canvases' gesture math (pure, unit-tested in test_devices_mapping_slices.gd): fitting a raster
## into the canvas, the 8 px snap, moving / resizing a src rect inside the input, the output canvas's move, edge scale
## (in the slice's rotated frame, opposite edge fixed), rotate knob and convex-clamped corner warp.

const SM := preload("res://features/devices/slice_model.gd")
const SNAP := 8.0
const MIN := 8
const NONE := Vector2i(9, 9)  # handle_at: no handle


## {scale, off}: `raster` px → canvas px, centred, `pad` px margin.
static func fit(area: Vector2, raster: Vector2, pad := 12.0) -> Dictionary:
	var avail := (area - Vector2(pad, pad) * 2.0).max(Vector2(1, 1))
	var s := minf(avail.x / maxf(raster.x, 1.0), avail.y / maxf(raster.y, 1.0))
	return {"scale": s, "off": (area - raster * s) / 2.0}


static func snap(v: float, on := true) -> int:
	return int(roundf(v / SNAP) * SNAP) if on else roundi(v)


static func _rect(r: Dictionary) -> Rect2:
	return Rect2(float(r.x), float(r.y), float(r.w), float(r.h))


static func _dict(r: Rect2) -> Dictionary:
	return {"x": roundi(r.position.x), "y": roundi(r.position.y), "w": maxi(1, roundi(r.size.x)), "h": maxi(1, roundi(r.size.y))}


## A src rect moved by `d` (input px), snapped, kept inside the input raster.
static func moved_src(start: Dictionary, d: Vector2, input: Vector2, snapping := true) -> Dictionary:
	var w := float(start.w)
	var h := float(start.h)
	var x := clampf(snap(float(start.x) + d.x, snapping), 0.0, maxf(0.0, input.x - w))
	var y := clampf(snap(float(start.y) + d.y, snapping), 0.0, maxf(0.0, input.y - h))
	return {"x": roundi(x), "y": roundi(y), "w": int(start.w), "h": int(start.h)}


## A rect resized by dragging `handle` (-1 / 0 / 1 per axis: the edge that moves) by `d`; the opposite edge stays.
## `bounds` (size) clamps inside 0..bounds when given (the src rect); MIN px at least.
static func resized(start: Dictionary, handle: Vector2i, d: Vector2, bounds := Vector2.ZERO, snapping := true) -> Dictionary:
	var r := _rect(start)
	var x0 := r.position.x
	var y0 := r.position.y
	var x1 := r.end.x
	var y1 := r.end.y
	var lim := bounds != Vector2.ZERO
	if handle.x < 0:
		x0 = minf(snap(x0 + d.x, snapping), x1 - MIN)
		x0 = maxf(x0, 0.0) if lim else x0
	elif handle.x > 0:
		x1 = maxf(snap(x1 + d.x, snapping), x0 + MIN)
		x1 = minf(x1, bounds.x) if lim else x1
	if handle.y < 0:
		y0 = minf(snap(y0 + d.y, snapping), y1 - MIN)
		y0 = maxf(y0, 0.0) if lim else y0
	elif handle.y > 0:
		y1 = maxf(snap(y1 + d.y, snapping), y0 + MIN)
		y1 = minf(y1, bounds.y) if lim else y1
	return _dict(Rect2(x0, y0, x1 - x0, y1 - y0))


## The rect between two points (a drawn new src rect), snapped and clamped to the input.
static func drawn(a: Vector2, b: Vector2, input: Vector2, snapping := true) -> Dictionary:
	var p0 := Vector2(clampf(snap(minf(a.x, b.x), snapping), 0, input.x), clampf(snap(minf(a.y, b.y), snapping), 0, input.y))
	var p1 := Vector2(clampf(snap(maxf(a.x, b.x), snapping), 0, input.x), clampf(snap(maxf(a.y, b.y), snapping), 0, input.y))
	return _dict(Rect2(p0, p1 - p0))


## Which of a rect's 8 handles (corner / edge mid) is within `zone` of `p` (canvas px), else NONE.
static func handle_at(r: Rect2, p: Vector2, zone: float) -> Vector2i:
	for hy in [-1, 0, 1]:
		for hx in [-1, 0, 1]:
			if hx == 0 and hy == 0:
				continue
			var hp := r.get_center() + Vector2(hx * r.size.x / 2.0, hy * r.size.y / 2.0)
			if p.distance_to(hp) <= zone:
				return Vector2i(hx, hy)
	return NONE


## Output canvas: the dst rect moved by `d` (output px, snapped; slices may hang over the output's edge).
static func moved_dst(rect: Dictionary, d: Vector2, snapping := true) -> Dictionary:
	return {"x": snap(float(rect.x) + d.x, snapping), "y": snap(float(rect.y) + d.y, snapping), "w": int(rect.w), "h": int(rect.h)}


## Output canvas: an edge / corner scale handle of a ROTATED dst rect. `d` is the pointer delta in output px; it is
## taken into the slice's own frame, the moved edges follow it, the opposite edges stay where they are on screen.
static func scaled_dst(rect: Dictionary, rotation: float, handle: Vector2i, d: Vector2) -> Dictionary:
	var local := d.rotated(-deg_to_rad(rotation))
	var w := float(rect.w)
	var h := float(rect.h)
	var nw := maxf(MIN, w + handle.x * local.x) if handle.x != 0 else w
	var nh := maxf(MIN, h + handle.y * local.y) if handle.y != 0 else h
	nw = roundf(nw)
	nh = roundf(nh)
	var shift := Vector2(handle.x * (nw - w) / 2.0, handle.y * (nh - h) / 2.0).rotated(deg_to_rad(rotation))
	var c := Vector2(float(rect.x) + w / 2.0, float(rect.y) + h / 2.0) + shift
	return {"x": roundi(c.x - nw / 2.0), "y": roundi(c.y - nh / 2.0), "w": int(nw), "h": int(nh)}


## The rotate knob sits above the top edge: the angle that points the slice's "up" at `p`. `step` snaps (0 = free).
static func rotation_to(center: Vector2, p: Vector2, step := 0.0) -> float:
	var deg := rad_to_deg((p - center).angle()) + 90.0
	if step > 0.0:
		deg = roundf(deg / step) * step
	else:
		deg = snappedf(deg, 0.1)
	return SM.norm_rotation(deg)


## Screen corner `i` warped to start + d; {} when the quad would stop being convex (the edit is refused, the last
## valid shape stays).
static func warped(dst: Dictionary, i: int, start: Array, d: Vector2) -> Dictionary:
	var n: Dictionary = dst.duplicate(true)
	n.warp[i] = [roundf(float(start[0]) + d.x), roundf(float(start[1]) + d.y)]
	return n if SM.is_convex(SM.dst_quad(n)) else {}


## Point in a convex quad (either winding).
static func in_quad(q: Array, p: Vector2) -> bool:
	if q.size() != 4:
		return false
	var sign := 0.0
	for i in 4:
		var a: Vector2 = q[i]
		var b: Vector2 = q[(i + 1) % 4]
		var c := (b - a).cross(p - a)
		if c == 0.0:
			continue
		if sign == 0.0:
			sign = signf(c)
		elif signf(c) != sign:
			return false
	return true
