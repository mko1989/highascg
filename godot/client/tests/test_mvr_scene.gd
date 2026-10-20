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
