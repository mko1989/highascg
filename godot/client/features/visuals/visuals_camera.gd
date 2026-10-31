extends RefCounted
## WO-896 — the Visuals camera, pure: the orbit pose {yaw, pitch, dist} (the 3D work-area view's orbit, visuals_workarea.gd) and
## how it becomes the output stage's camera transform (visuals_stage.gd). The camera sits `dist` from the world origin on the
## sphere the angles pick and looks at the origin; the pose {0, 0, 14} IS the old fixed stage camera (0, 0, 14 looking down −z).
## `project.visuals.camera` = {drive, yaw, pitch, dist}: `drive` = the 3D view's orbit drives the output; the pose is what the
## output uses (frozen while `drive` is off), per look (visuals_looks.gd KEYS). Flow adds offsets on top (cam_yaw / cam_pitch /
## cam_zoom, visuals_model.gd PARAMS: 0.5 = none), see offset().

const HOME := Vector3(0.0, 0.0, 14.0)  # yaw, pitch, dist — the stage camera as it was before WO-896
const PITCH_MAX := 1.4
const DIST_MIN := 2.0
const DIST_MAX := 80.0
const YAW_RANGE := 0.8  # rad of yaw one unit of cam_yaw moves each way (0.5 ± 0.5)
const PITCH_RANGE := 0.5
const ZOOM_OCTAVES := 1.0  # cam_zoom 0 / 1 = dist ÷ 2 / × 2


## {drive, yaw, pitch, dist} from a stored value: every field present and in range, junk → HOME.
static func normalize(v: Variant) -> Dictionary:
	var d: Dictionary = v if v is Dictionary else {}
	# scalars, not a Vector3: that would round the stored doubles to float32 (0.9 → 0.8999999761)
	return {"drive": d.get("drive") is bool and d.drive, "yaw": wrapf(_num(d.get("yaw", HOME.x)), -PI, PI),
		"pitch": clampf(_num(d.get("pitch", HOME.y)), -PITCH_MAX, PITCH_MAX), "dist": clampf(_num(d.get("dist", HOME.z)), DIST_MIN, DIST_MAX)}


## A pose Vector3(yaw, pitch, dist) inside the limits (yaw wraps to −π..π).
static func clamp_pose(p: Vector3) -> Vector3:
	return Vector3(wrapf(p.x, -PI, PI), clampf(p.y, -PITCH_MAX, PITCH_MAX), clampf(p.z, DIST_MIN, DIST_MAX))


static func pose_of(cam: Dictionary) -> Vector3:
	return Vector3(float(cam.get("yaw", HOME.x)), float(cam.get("pitch", HOME.y)), float(cam.get("dist", HOME.z)))


## `cam` (a stored camera) with `pose` in it, drive kept.
static func with_pose(cam: Dictionary, pose: Vector3) -> Dictionary:
	var p := clamp_pose(pose)
	return {"drive": cam.get("drive") == true, "yaw": p.x, "pitch": p.y, "dist": p.z}


## The camera transform for a pose: positive yaw swings the camera to the right (+x), positive pitch raises it. Identical to the 3D view's editor camera, so the two see the same picture.
static func transform_of(p: Vector3) -> Transform3D:
	var b := Basis.from_euler(Vector3(-p.y, p.x, 0.0))
	return Transform3D(b, b * Vector3(0.0, 0.0, p.z))


## The pose a transform (looking at the origin) came from — the inverse of transform_of.
static func pose_from(tf: Transform3D) -> Vector3:
	var e := tf.basis.get_euler()
	return Vector3(e.y, -e.x, tf.origin.length())


## The pose with Flow's offsets (the evaluated params cam_yaw / cam_pitch / cam_zoom, 0.5 = none), clamped.
static func offset(p: Vector3, params: Dictionary) -> Vector3:
	var y := (float(params.get("cam_yaw", 0.5)) - 0.5) * 2.0 * YAW_RANGE
	var pt := (float(params.get("cam_pitch", 0.5)) - 0.5) * 2.0 * PITCH_RANGE
	var z := pow(2.0, (float(params.get("cam_zoom", 0.5)) - 0.5) * 2.0 * ZOOM_OCTAVES)
	return clamp_pose(Vector3(p.x + y, p.y + pt, p.z * z))


## A backdrop quad `dist` in front of the camera `cam` (a screen-filling quad: the Shader and Game scenes), so it covers the
## frame at any camera angle. Unscaled — the scene scales it to the frustum at `dist`.
static func attach(cam: Transform3D, dist: float) -> Transform3D:
	return cam * Transform3D(Basis(), Vector3(0.0, 0.0, -dist))


## The height of the view frustum at `dist` for a vertical field of view of `fov` degrees.
static func frustum_h(dist: float, fov: float) -> float:
	return 2.0 * dist * tan(deg_to_rad(fov * 0.5))


static func same(a: Dictionary, b: Dictionary) -> bool:
	return pose_of(a).is_equal_approx(pose_of(b)) and (a.get("drive") == true) == (b.get("drive") == true)


static func _num(v: Variant) -> float:
	if v is float or v is int:
		return float(v)
	if v is String and (v as String).is_valid_float():
		return (v as String).to_float()
	return 0.0
