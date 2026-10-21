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
