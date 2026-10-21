extends RefCounted
## WO-615 T5 — fixtures_3d_model.gd: the GDTF rig placed by the patch pose and turned by its axes swings the beam
## the way follow-ik.js aims (yaw 0 = upstage, hung pan + = stage right), light budget, beam tint.

const F := preload("res://features/previs/fixtures/fixtures_3d_model.gd")
var t


## World beam direction (rig beam = local −Y) for a hung / standing head at pan / tilt.
func _beam(pose: Dictionary, pan: float, tilt: float) -> Vector3:
	var b := F.pose_xform(pose).basis * F.axis_basis("pan", pan) * F.axis_basis("tilt", tilt)
	var d := b * Vector3.DOWN
	return Vector3(snappedf(d.x, 0.001), snappedf(d.y, 0.001), snappedf(d.z, 0.001))


func test_pose_and_axes_match_the_ik_frame() -> void:
	var hung := {"x": 1, "y": 2, "z": 6, "hang": "truss", "yaw": 0}
	t.eq(F.pose_xform(hung).origin, Vector3(1, 6, -2), "PSN (x, y, z) → Godot (x, z, −y)")
	t.eq(_beam(hung, 0, 0), Vector3(0, -1, 0), "hung at rest: straight down")
	t.eq(_beam(hung, 0, 30), Vector3(0, -0.866, -0.5), "positive tilt swings upstage (PSN +y = Godot −z) at yaw 0")
	t.eq(_beam(hung, 90, 30), Vector3(-0.5, -0.866, 0), "hung positive pan → stage right (PSN −x)")
	var yawed := hung.duplicate()
	yawed.yaw = 90
	t.eq(_beam(yawed, 0, 30), Vector3(0.5, -0.866, 0), "yaw 90 → stage left")
	var floor := hung.duplicate()
	floor.hang = "floor"
	t.eq(_beam(floor, 0, 0), Vector3(0, 1, 0), "standing at rest: straight up")
	t.eq(_beam(floor, 0, 30), Vector3(0, 0.866, -0.5), "standing tilt still swings upstage")
	t.eq(_beam(floor, 90, 30), Vector3(0.5, 0.866, 0), "standing positive pan → stage left (mirrored)")


func test_typed_filter_cone_light_budget_tint() -> void:
	var slice := {"patch": [{"id": "a", "typeId": "0123456789ab", "mode": "Std"}, {"id": "g"},
		{"id": "b", "typeId": "0123456789ab", "mode": ""}, "junk"]}
	t.eq(F.typed(slice).map(func(f: Dictionary) -> String: return f.id), ["a"])
	t.eq(F.typed(null), [])
	t.eq(F.rig_key(slice.patch[0]), "0123456789ab|Std")
	var s := F.cone_scale(90.0, 10.0)
	t.eq([snappedf(s.x, 0.001), s.y], [10.0, 10.0], "90° full angle: radius = length")
	t.ok(F.wants_light({"beamType": "Spot"}, 0))
	t.ok(not F.wants_light({"beamType": "Glow"}, 0), "glow cells draw lens only")
	t.ok(not F.wants_light({"beamType": "Spot"}, F.MAX_LIGHTS), "budget")
	var bar := {"nodes": [{"kind": "Geometry"}]}
	for i in F.CELL_BEAMS + 1:
		bar.nodes.append({"kind": "Beam"})
	t.ok(F.is_cell_rig(bar), "5 beams: a pixel fixture")
	bar.nodes.pop_back()
	t.ok(not F.is_cell_rig(bar))
	t.eq(F.tint({"i": 0.5, "c": [1, 0, 0]}), Color(1, 0, 0, 0.5))
	t.eq(F.tint({"i": 3, "c": "x"}), Color(1, 1, 1, 1), "clamped, bad colour → white")
