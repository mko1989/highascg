extends RefCounted
## WO-764 — one Inspector line for a head's calibrated_pose (the pose its marks solved, for the desk's MVR — WO-765;
## the previs keeps the patch pose, WO-700 R6): how far and how much turned it is from the patch, and the fit verdict.


## The rotation of a patch pose as the previs builds it (fixtures_3d_model.gd pose_xform: yaw about up, negated, then
## pitch, roll — Godot YXZ; floor = turned over about Z).
static func basis_of(p: Dictionary) -> Basis:
	var b := Basis.from_euler(Vector3(deg_to_rad(float(p.get("pitch", 0))), deg_to_rad(-float(p.get("yaw", 0))),
		deg_to_rad(float(p.get("roll", 0)))), EULER_ORDER_YXZ)
	return b * Basis(Vector3(0, 0, 1), PI) if p.get("hang") == "floor" else b


## Degrees between the two poses' rotations.
static func turned_deg(a: Dictionary, b: Dictionary) -> float:
	return rad_to_deg((basis_of(a).inverse() * basis_of(b)).get_rotation_quaternion().get_angle())


static func moved_m(a: Dictionary, b: Dictionary) -> float:
	return Vector3(float(a.get("x", 0)), float(a.get("y", 0)), float(a.get("z", 0))).distance_to(
		Vector3(float(b.get("x", 0)), float(b.get("y", 0)), float(b.get("z", 0))))


## "Desk pose (measured · 4 marks): 0.42 m from the patch, turned 7.1° — good: fit 0.12°, worst 2 cm (Mark 3)", or "".
static func desk_line(fx: Dictionary) -> String:
	var cp: Variant = fx.get("calibrated_pose")
	if not cp is Dictionary or not fx.get("pose") is Dictionary:
		return ""
	var c: Dictionary = cp
	var how := str(c.get("source", "measured"))
	if c.has("marks"):
		how += " · %d marks" % int(c.marks)
	var line := "Desk pose (%s): %.2f m from the patch, turned %.1f°" % [how, moved_m(fx.pose, c), turned_deg(fx.pose, c)]
	if c.get("note") is String:
		line += " — " + str(c.note)
	elif c.get("residual_m") != null and c.get("source") == "inferred":
		line += " — inferred, ±%.2f m" % float(c.residual_m)
	elif c.get("rms_deg") != null:
		line += " — fit %.2f°" % float(c.rms_deg)
	return line
