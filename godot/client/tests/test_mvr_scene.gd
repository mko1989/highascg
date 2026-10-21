extends RefCounted
## WO-612 — the server's MVR part transform (basis x, y, z columns + origin, Godot frame) → Transform3D, and the
## import status line.

const M := preload("res://features/previs/mvr_model.gd")
var t


func test_xform() -> void:
	var x := M.xform([1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 3, -2])
	t.eq(x.origin, Vector3(1, 3, -2))
	t.eq(x.basis, Basis.IDENTITY)
	var r := M.xform([0, 0, -1, 0, 1, 0, 1, 0, 0, 0, 0, 0])
	t.eq(r * Vector3(1, 0, 0), Vector3(0, 0, -1), "x column")
	t.eq(M.xform([1, 2]), Transform3D.IDENTITY, "malformed → identity")


func test_summary() -> void:
	t.eq(M.summary({}).begins_with("No MVR scene"), true)
	t.eq(M.summary({"error": "gone"}), "gone")
	var s := M.summary({"name": "Show", "objects": 3, "fixtures": 2, "parts": 7, "meshes": 4, "failed": ["x"],
		"report": {"missing_gdtf": ["A@B"], "missing_files": []}})
	t.eq(s, "Show — 3 objects (2 fixtures), 7 parts from 4 meshes.\nNo GDTF (shown as boxes): A@B\nMeshes that failed to load: 1")


func test_screen_binding_helpers() -> void:
	var uv := M.screen_uv({"role": "pgm1", "raster": {"w": 3840.0, "h": 2160.0}, "rect": {"x": 1920.0, "y": 0.0, "w": 1080.0, "h": 1920.0}})
	t.ok(uv.is_equal_approx(Vector4(0.5, 0.0, 0.28125, 1920.0 / 2160.0)), "crop against the mapping raster")
	t.eq(M.screen_uv({"role": "pgm1", "raster": null, "rect": null}), Vector4(0, 0, 1, 1), "no mapping → full picture")
	t.eq(M.screen_uv(null), Vector4(0, 0, 1, 1))
	t.eq(M.screen_role({"kind": "VideoScreen", "screen": {"role": "prv2"}}), "prv2")
	t.eq(M.screen_role({"kind": "VideoScreen"}), "", "foreign / unbound screen")
	t.ok(M.summary({"name": "x", "screens": 2}).contains("2 video screen(s)"))


## WO-615 T10 — MVR fixtures arrive patched: ids "mvr-<uuid>", a re-patch keeps the operator's edits, Unpatch.
func test_patch_merge_and_unpatch() -> void:
	var patch := [
		{"id": "fx1", "name": "Manual"},
		{"id": "mvr-aaa", "name": "Renamed", "address": 1, "follow": 3, "fixed": "6=255", "enabled": false},
	]
	t.eq(M.patched_uuids(patch), {"aaa": true})
	t.eq(M.patched_uuids(null), {})
	var incoming := [{"id": "mvr-aaa", "name": "Spot 101", "address": 40, "follow": 0, "pose": {"pitch": 60}},
		{"id": "mvr-bbb", "name": "Spot 102", "address": 80}]
	var merged := M.merge_patch(patch, incoming)
	t.eq(merged.map(func(f: Dictionary) -> String: return f.id), ["fx1", "mvr-aaa", "mvr-bbb"], "order kept, new ones appended")
	t.eq([merged[1].address, merged[1].pose.pitch], [40, 60], "address / pose come from the file")
	t.eq([merged[1].name, merged[1].follow, merged[1].fixed, merged[1].enabled], ["Renamed", 3, "6=255", false],
		"the operator's edits stay")
	t.eq(M.unpatch(merged, ["aaa", "bbb"]).map(func(f: Dictionary) -> String: return f.id), ["fx1"])
	var txt := M.patch_summary({"protocol": "sacn", "fixtures": [{}, {}], "types": [{}],
		"skipped": [{"reason": "no GDTFMode in the MVR file"}, {"reason": "no GDTFMode in the MVR file"}], "notes": ["n1"]})
	t.ok(txt.begins_with("Patched 2 fixtures (sACN, 1 type)."), txt)
	t.ok(txt.contains("Not patched: no GDTFMode in the MVR file ×2") and txt.contains("\nn1"), txt)


## Place: the scene's frame moved onto our stage; patched fixtures ride along exactly (stage frame: x left, y up-stage, z up).
func test_place_moves_scene_and_patched_fixtures() -> void:
	var p := M.place_of({"place": {"x": -12.9, "y": 0.4, "z": 2.37, "yaw": 90, "junk": 1}})
	t.eq(p, {"x": -12.9, "y": 0.4, "z": 2.37, "yaw": 90.0})
	t.eq(M.place_of({}), {"x": 0.0, "y": 0.0, "z": 0.0, "yaw": 0.0}, "no place = the file's own frame")
	t.eq(M.place_of({"place": {"x": "9", "z": -900}}).z, -50.0, "clamped, non-numbers → 0")
	var tr := M.placement({"x": 1, "y": 2, "z": 3, "yaw": 90})
	t.eq(tr.origin, Vector3(1, 3, -2), "stage (x, y, z) → Godot (x, z, −y)")
	var pose := {"x": 1.0, "y": 0.0, "z": 4.0, "hang": "truss", "yaw": 0.0, "pitch": 30.0, "roll": 0.0}
	var placed := M.place_pose(pose, {"x": 1, "y": 2, "z": 3, "yaw": 90})
	t.eq([placed.x, placed.y, placed.z, placed.yaw, placed.pitch, placed.hang], [1.0, 1.0, 7.0, 90.0, 30.0, "truss"],
		"yaw 90 turns up-stage into stage left (the pose's convention), so stage left (+x) into down-stage")
	# the placed pose's transform = placement × the file pose's transform
	const F := preload("res://features/previs/fixtures/fixtures_3d_model.gd")
	var want := tr * F.pose_xform(pose)
	var got := F.pose_xform(placed)
	t.ok(got.origin.distance_to(want.origin) < 1e-3 and (got.basis.x - want.basis.x).length() < 1e-3
		and (got.basis.y - want.basis.y).length() < 1e-3, "pose stays glued to the static model")
	t.eq(M.place_pose(placed, {"x": 1, "y": 2, "z": 3, "yaw": 90}, true), pose, "inverse")
	var patch := [{"id": "mvr-aa", "pose": pose}, {"id": "own", "pose": pose}]
	var moved := M.replace_patch(patch, ["aa"], M.place_of({}), {"x": 0, "y": 0, "z": 1, "yaw": 0})
	t.eq([moved[0].pose.z, moved[1].pose.z], [5.0, 4.0], "only this scene's fixtures move")


## Fit: centre the footprint, lowest point on the floor (Pabianice Final Patch: x 3.2…22.6, floor −2.37 m).
func test_fit() -> void:
	var b := AABB(Vector3(3.18, -2.37, -9.66), Vector3(19.38, 6.51, 20.68))
	t.ok(M.needs_fit(b), "footprint misses the origin")
	var f := M.fit_place(b, 0.0)
	t.ok(is_equal_approx(f.x, -12.87) and is_equal_approx(f.y, 0.68) and is_equal_approx(f.z, 2.37) and f.yaw == 0.0, str(f))
	var placed := M.placement(f) * b
	t.eq([snappedf(placed.position.y, 0.01), snappedf(placed.get_center().x, 0.01), snappedf(placed.get_center().z, 0.01)], [0.0, 0.0, 0.0])
	t.ok(not M.needs_fit(AABB(Vector3(-12, -0.02, -0.5), Vector3(24, 5, 8.2))), "WEKTORY 2025: already on the stage")
	t.ok(M.needs_fit(AABB(Vector3(-12, -2, -0.5), Vector3(24, 5, 8.2))), "floor 2 m low")
	var turned := M.placement(M.fit_place(b, 90.0)) * b
	t.eq([snappedf(turned.position.y, 0.01), snappedf(turned.get_center().x, 0.01), snappedf(turned.get_center().z, 0.01)], [0.0, 0.0, 0.0], "with a turn")
