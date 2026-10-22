extends RefCounted
## WO-682 — moving things on the previs stage, the pure part: frames, the group move (translate + turn about a pivot),
## the stored MVR object transform and the drag planes. Stage frame = the previs's Godot frame (X, Y up, Z downstage);
## PSN (patch poses) = X stage left, Y upstage, Z up. Yaw here is the stage sense (degrees about up, + = counter-clockwise
## seen from above); a head's pose.yaw is negated (fixtures_3d_model.gd pose_xform).

const SNAP := 0.001  ## m — positions are stored to the millimetre


static func psn_to_stage(x: float, y: float, z: float) -> Vector3:
	return Vector3(x, z, -y)


## A head's pose moved by `d` (stage frame) and turned by `dyaw` (stage sense). Other pose keys are kept.
static func head_pose(pose: Dictionary, d: Vector3, dyaw: float) -> Dictionary:
	var p := pose.duplicate()
	p["x"] = snappedf(float(pose.get("x", 0.0)) + d.x, SNAP)
	p["y"] = snappedf(float(pose.get("y", 0.0)) - d.z, SNAP)
	p["z"] = snappedf(float(pose.get("z", 6.0)) + d.y, SNAP)
	p["yaw"] = wrapf(snappedf(float(pose.get("yaw", 0.0)) - dyaw, 0.01), -180.0, 180.0)
	return p


## Translate by `d` and turn by `dyaw` about the vertical axis through `pivot` (all stage frame).
static func group_delta(pivot: Vector3, d: Vector3, dyaw: float) -> Transform3D:
	var turn := Transform3D(Basis(Vector3.UP, deg_to_rad(dyaw)), Vector3.ZERO)
	return Transform3D(Basis.IDENTITY, pivot + d) * turn * Transform3D(Basis.IDENTITY, -pivot)


## An MVR object's node transform after a stage-frame delta, the scene placed by `place` (its node transform).
static func moved_local(place: Transform3D, old: Transform3D, delta: Transform3D) -> Transform3D:
	return place.affine_inverse() * delta * place * old


## project.previs.mvr.moved entry: 12 floats (basis columns x, y, z, origin), or [] for "where the file put it".
static func xf_to_array(t: Transform3D) -> Array:
	if t.is_equal_approx(Transform3D.IDENTITY):
		return []
	var out := []
	for v: Vector3 in [t.basis.x, t.basis.y, t.basis.z, t.origin]:
		out.append_array([snappedf(v.x, 1e-6), snappedf(v.y, 1e-6), snappedf(v.z, 1e-6)])
	return out


static func array_to_xf(a: Variant) -> Transform3D:
	if not (a is Array) or (a as Array).size() != 12:
		return Transform3D.IDENTITY
	var f := (a as Array).map(func(v: Variant) -> float: return float(v) if (v is float or v is int) else 0.0)
	var t := Transform3D(Basis(Vector3(f[0], f[1], f[2]), Vector3(f[3], f[4], f[5]), Vector3(f[6], f[7], f[8])),
		Vector3(f[9], f[10], f[11]))
	return t if is_finite(t.basis.determinant()) and absf(t.basis.determinant()) > 1e-6 else Transform3D.IDENTITY


## Degrees about up of a basis (stage sense): where its local -Z (the front) points, seen from above.
static func yaw_of(b: Basis) -> float:
	var f := -b.z
	return snappedf(rad_to_deg(atan2(-f.x, -f.z)), 0.01) if Vector2(f.x, f.z).length() > 1e-6 else 0.0


## Bottom centre of a box — the pivot a group turns about and the point the card shows.
static func base_of(box: AABB) -> Vector3:
	return Vector3(box.get_center().x, box.position.y, box.get_center().z)


## Ray from → dir against the horizontal plane at `height`; null when parallel or behind.
static func floor_at(from: Vector3, dir: Vector3, height: float) -> Variant:
	if absf(dir.y) < 1e-6:
		return null
	var t := (height - from.y) / dir.y
	return from + dir * t if t > 0.0 else null


## Ray against the upright plane through `pivot` facing the camera (its forward flattened): the height drag.
static func wall_at(from: Vector3, dir: Vector3, pivot: Vector3, cam_forward: Vector3) -> Variant:
	var n := Vector3(cam_forward.x, 0.0, cam_forward.z)
	if n.length() < 1e-6:
		return null
	n = n.normalized()
	var den := n.dot(dir)
	if absf(den) < 1e-6:
		return null
	var t := n.dot(pivot - from) / den
	return from + dir * t if t > 0.0 else null
