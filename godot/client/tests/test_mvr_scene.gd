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
