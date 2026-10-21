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


## WO-615 T10 — MVR mounts: pitch / roll on top of yaw (YXZ). The numbers are gdtf-ik.js poseXf's, so the previs and
## the server's IK place a tilted head the same way.
func test_pose_pitch_roll_match_the_server() -> void:
	var cases := [
		[{"yaw": 90, "pitch": 0, "roll": 90}, Vector3(0, 0, 1), "Midsize LEDBeam on its side: rest beam downstage"],
		[{"yaw": 30, "pitch": 60, "roll": 0}, Vector3(0.433, -0.5, -0.75), "pitched 60°"],
		[{"yaw": -45, "pitch": 40, "roll": 0, "hang": "floor"}, Vector3(0.455, 0.766, 0.455), "standing, pitched"],
		[{"yaw": 10, "pitch": 20, "roll": -30}, Vector3(-0.441, -0.814, -0.379), "all three"],
	]
	for c in cases:
		t.eq(_beam(c[0], 0, 0), c[1], c[2])
	var p := {"yaw": 10, "pitch": 20, "roll": -30}
	var x := F.pose_xform(p).basis.x
	t.eq(Vector3(snappedf(x.x, 0.001), snappedf(x.y, 0.001), snappedf(x.z, 0.001)), Vector3(0.883, -0.47, -0.018), "x axis too")


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
