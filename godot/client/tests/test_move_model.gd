extends RefCounted
## WO-682 — move_model.gd: frames, a head's pose moved, the group move about a pivot, the stored MVR object transform
## (round trip, identity = nothing stored, junk = where the file put it), yaw, pivot and the drag planes.

const MM := preload("res://features/previs/move/move_model.gd")
var t


func test_frames_and_head_pose() -> void:
	t.eq(MM.psn_to_stage(1.0, 2.0, 3.0), Vector3(1, 3, -2), "PSN x / y upstage / z up → stage X / Y up / Z downstage")
	var pose := {"x": -2.5, "y": -6.0, "z": 2.0, "hang": "floor", "yaw": -170.0, "pitch": 0.0, "roll": 0.0}
	var p := MM.head_pose(pose, Vector3(1.0, 0.5, -2.0), 30.0)
	t.eq([p.x, p.y, p.z], [-1.5, -4.0, 2.5], "stage delta → PSN: Z −2 is 2 m upstage, Y is height")
	t.eq(p.yaw, 160.0, "a stage-sense turn subtracts from pose.yaw, wrapped to ±180")
	t.eq(p.hang, "floor", "other pose keys kept")
	t.eq(pose.x, -2.5, "the input pose is untouched")
	t.eq(MM.head_pose({}, Vector3.ZERO, 0.0).z, 6.0, "a pose-less head starts at the patch default height")


func test_group_delta_turns_about_the_pivot() -> void:
	var g := MM.group_delta(Vector3(1, 0, 0), Vector3.ZERO, 90.0)
	t.ok((g * Vector3(2, 0, 0)).is_equal_approx(Vector3(1, 0, -1)), "a point 1 m out swings round the pivot")
	t.ok((g * Vector3(1, 0, 0)).is_equal_approx(Vector3(1, 0, 0)), "the pivot stays")
	var m := MM.group_delta(Vector3(1, 0, 0), Vector3(0, 2, 3), 0.0)
	t.ok((m * Vector3(5, 0, 0)).is_equal_approx(Vector3(5, 2, 3)), "no turn = a plain shift")


func test_moved_local_keeps_the_scene_placement() -> void:
	var place := Transform3D(Basis(Vector3.UP, deg_to_rad(90.0)), Vector3(10, 0, 0))
	var old := Transform3D(Basis.IDENTITY, Vector3(0, 0, 1))
	var delta := Transform3D(Basis.IDENTITY, Vector3(1, 0, 0))
	var local := MM.moved_local(place, old, delta)
	t.ok((place * local).is_equal_approx(delta * place * old), "on stage it lands exactly delta from where it was")
	t.ok(MM.moved_local(place, old, Transform3D.IDENTITY).is_equal_approx(old), "no delta → unchanged")


func test_stored_transform() -> void:
	t.eq(MM.xf_to_array(Transform3D.IDENTITY), [], "where the file put it → nothing stored")
	var x := Transform3D(Basis(Vector3.UP, 0.5), Vector3(1, 2, 3))
	t.ok(MM.array_to_xf(MM.xf_to_array(x)).is_equal_approx(x), "round trip")
	t.eq(MM.xf_to_array(x).size(), 12)
	t.eq(MM.array_to_xf(null), Transform3D.IDENTITY, "nothing → identity")
	t.eq(MM.array_to_xf([1, 2, 3]), Transform3D.IDENTITY, "short → identity")
	t.eq(MM.array_to_xf([0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3]), Transform3D.IDENTITY, "flat basis → identity")
	t.eq(MM.array_to_xf(["a", 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]), Transform3D.IDENTITY, "junk → identity")


func test_yaw_and_base() -> void:
	t.eq(MM.yaw_of(Basis.IDENTITY), 0.0)
	t.eq(MM.yaw_of(Basis(Vector3.UP, deg_to_rad(30.0))), 30.0, "stage sense: counter-clockwise from above")
	t.eq(MM.yaw_of(Basis(Vector3.UP, deg_to_rad(-120.0))), -120.0)
	t.eq(MM.base_of(AABB(Vector3(0, 1, 2), Vector3(2, 4, 6))), Vector3(1, 1, 5), "bottom centre")


func test_planes() -> void:
	t.eq(MM.floor_at(Vector3(0, 10, 0), Vector3(0, -1, 0), 2.0), Vector3(0, 2, 0), "straight down onto 2 m")
	t.eq(MM.floor_at(Vector3(0, 10, 0), Vector3(1, 0, 0), 2.0), null, "parallel")
	t.eq(MM.floor_at(Vector3(0, 10, 0), Vector3(0, 1, 0), 2.0), null, "behind")
	t.eq(MM.wall_at(Vector3(1, 3, 10), Vector3(0, 0, -1), Vector3.ZERO, Vector3(0, -0.5, -1)), Vector3(1, 3, 0),
		"the upright plane through the pivot facing a camera that looks down")
	t.eq(MM.wall_at(Vector3(0, 3, 10), Vector3(0, 0, -1), Vector3.ZERO, Vector3(0, -1, 0)), null, "straight down: no wall")
