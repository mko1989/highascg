extends RefCounted
## WO-616 T5b — operator marker input maths (pure): stick shaping, camera-relative stage directions, speed steps,
## the mouse-grab glide, and the floor point under a click in a calibrated camera picture.
##
## Ported from OpenFollow (github.com/openfollowapp/openfollow @ 2f8aa257, AGPL-3.0-or-later,
## Copyright (C) 2026 The OpenFollow Project – Paul Hermann, Michel Honold, Vinzenz Schultz):
## openfollow/input/shaping.py (apply_curve, shape_axis), openfollow/input/control_frame.py (orient: same magnitude
## out as in), docs/architecture/input.md (speed steps 0.1 m/s ≤ 4, 0.5 above, 0.1–3.0 m/s; grab glide
## alpha = 1 − smoothing, floored; a grab never yanks the marker to the click).
## Changes: GDScript; "camera" frame from this repo's camera_model rotation (the camera's right axis flattened onto
## the floor, forward = right turned 90° left; stage axes when the camera looks straight along its roll); no
## "screen" / "heading" frames; floor point via camera_model unproject at the floor plane.

const C := preload("res://features/previs/tracking/camera_model.gd")
const O := preload("res://features/previs/tracking/tracking_overlay.gd")

const CURVES := ["linear", "logarithmic", "quadratic", "s-law"]
const DEADZONE := 0.15  # OpenFollow GamepadHandler default
const SPEED_MIN := 0.1
const SPEED_MAX := 3.0
const SPEED_DEFAULT := 1.0
const GLIDE_FLOOR := 0.05  # the highest smoothing still moves 5 % of the way per frame
const STAGE_AXES := [Vector2(1, 0), Vector2(0, 1)]  # right = stage left (+X), forward = upstage (+Y)


## Response curve for a magnitude in [0, 1]; unknown names are linear.
static func apply_curve(v: float, curve: String) -> float:
	match curve:
		"logarithmic":
			return log(1.0 + 9.0 * v) / log(10.0)
		"quadratic":
			return v * v
		"s-law":
			return 3.0 * v * v - 2.0 * v * v * v
	return v


## Deadzone (rescaled so the band's edge is 0 and full deflection 1) + curve, for a raw axis in [-1, 1].
static func shape_axis(v: float, deadzone: float, curve: String) -> float:
	if deadzone >= 1.0 or absf(v) < deadzone:
		return 0.0
	var s := (absf(v) - deadzone) / (1.0 - deadzone)
	return signf(v) * apply_curve(minf(s, 1.0), curve)


## Stage directions for "right" and "forward" input as seen by camera `cam`: [right: Vector2, forward: Vector2]
## (PSN XY, unit length).
static func ground_axes(cam: Dictionary) -> Array:
	if cam.is_empty():
		return STAGE_AXES
	var r := C.rotation(cam.pitch, cam.yaw, cam.roll)
	var right := Vector2(r[0], -float(r[6]))  # camera +X in Godot (r0, r3, r6) → PSN (x, -z)
	if right.length() < 1e-3:
		return STAGE_AXES
	right = right.normalized()
	return [right, Vector2(-right.y, right.x)]


## Input (right, forward) → stage XY of the same magnitude, through latched `axes`.
static func orient(axes: Array, v: Vector2) -> Vector2:
	if v == Vector2.ZERO:
		return Vector2.ZERO
	var o: Vector2 = axes[0] * v.x + axes[1] * v.y
	return o * (v.length() / o.length()) if o.length() > 0.0 else Vector2.ZERO


## One speed step up (+1) or down (-1), m/s.
static func step_speed(speed: float, dir: int) -> float:
	var step := 0.1 if speed <= 4.0 else 0.5
	return clampf(snappedf(speed + step * signi(dir), 0.01), SPEED_MIN, SPEED_MAX)


## One frame of the grab glide toward `target` (smoothing 0 = jump, → 1 = slow).
static func glide(cur: Vector2, target: Vector2, smoothing: float) -> Vector2:
	return cur.lerp(target, maxf(1.0 - clampf(smoothing, 0.0, 1.0), GLIDE_FLOOR))


## The PSN point on the plane z = `z` under raster pixel `px` of tracking camera entry `ce` (lens undone), else null.
static func floor_point(ce: Dictionary, px: Vector2, z: float) -> Variant:
	if ce.is_empty():
		return null
	var w := float(ce.raster[0])
	var h := float(ce.raster[1])
	var cam: Dictionary = ce.cam
	var flat := C.invert_distortion([[px.x, px.y]], w, h, float(cam.lens_k1), float(cam.lens_k2))
	if flat.is_empty() or flat[0] == null:
		return null
	var hit := C.unproject(cam, flat, w, h, z)
	return hit[0] if not hit.is_empty() else null


## A marker's ground circle (radius `r` m around [x, y] at height z) in lens pixels — the overlay shape and the
## grab target. Empty when any of it is behind the camera.
static func ground_ring(ce: Dictionary, pos: Array, r: float, n := 24) -> PackedVector2Array:
	var world := []
	for i in n + 1:
		var a := TAU * i / n
		world.append([float(pos[0]) + r * cos(a), float(pos[1]) + r * sin(a), float(pos[2])])
	var out := PackedVector2Array()
	for p in O.shown(ce, world):
		if p == null:
			return PackedVector2Array()
		out.append(Vector2(p[0], p[1]))
	return out


## Id of the marker whose ground circle contains raster `at` (else whose centre is within `radius` px; nearest
## centre wins), or 0. `marks` = [{id, centre: Vector2 | null, ring: PackedVector2Array}].
static func grab_target(marks: Array, at: Vector2, radius: float) -> int:
	var best := 0
	var bd := INF
	for m in marks:
		if m.centre == null:
			continue
		var d := (m.centre as Vector2).distance_to(at)
		var inside := (m.ring as PackedVector2Array).size() >= 3 and Geometry2D.is_point_in_polygon(at, m.ring)
		if (inside or d <= radius) and d < bd:
			bd = d
			best = int(m.id)
	return best
