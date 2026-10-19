extends RefCounted
## WO-616 T3b — Camera view overlay geometry (tracking_overlay.gd): lens-bent edges, the split where an edge goes
## behind the camera, per-point shown / clicked / error, nearest-point picking.

const O := preload("res://features/previs/tracking/tracking_overlay.gd")
const T := preload("res://features/previs/tracking/tracking_model.gd")
const C := preload("res://features/previs/tracking/camera_model.gd")
const SO := preload("res://features/previs/stage_objects.gd")
var t


func _entry(k1 := 0.0) -> Dictionary:
	var ce := T.new_camera([])
	ce.cam = C.camera(0.0, -10.0, 5.0, -20.0, 0.0, 0.0, 60.0)
	ce.cam["lens_k1"] = k1
	return ce


func test_edges_bend_with_the_lens_and_split_behind_the_camera() -> void:
	var a := [-4.0, 0.0, 0.0]
	var b := [4.0, 0.0, 0.0]
	var flat: PackedVector2Array = O.edge(_entry(), a, b)[0]
	var bent: PackedVector2Array = O.edge(_entry(-0.25), a, b)[0]
	t.eq(flat.size(), O.SEGMENTS + 1)
	var mid := O.SEGMENTS / 2
	var straight := (flat[0] + flat[O.SEGMENTS]) / 2.0
	t.ok(flat[mid].distance_to(straight) < 1e-3, "no lens: the floor line stays straight")
	var chord := (bent[0] + bent[O.SEGMENTS]) / 2.0
	t.ok(bent[mid].distance_to(chord) > 2.0, "barrel lens: the same line bows (%s px)" % bent[mid].distance_to(chord))
	var through := O.edge(_entry(), [0.0, 0.0, 0.0], [0.0, -30.0, 0.0])  # runs past the camera (y = -10) and behind it
	t.eq(through.size(), 1, "one visible piece")
	t.ok((through[0] as PackedVector2Array).size() < O.SEGMENTS + 1, "the part behind the lens is dropped")


func test_lines_and_points() -> void:
	var tr := T.normalize({"grid": {"width": 4, "depth": 2, "spacing": 2}})
	var ce := _entry()
	var tv: Dictionary = SO.normalize({"id": "tv", "name": "TV", "type": "tv", "position": [0.0, 1.0, 0.0]})
	var off: Dictionary = SO.normalize({"id": "off", "type": "tv", "position": [0.0, 1.0, 0.0]})
	off["visible"] = false
	var ls := O.lines(tr, ce, [tv, off])
	t.eq(ls.grid.size(), 3 + 2, "3 lines across, 2 deep")
	t.eq(ls.objects.size(), 1, "hidden objects are not drawn")
	t.eq(ls.objects[0].lines.size(), 4)
	var corner: Array = T.grid_corners(tr.grid)[0]
	var at: Array = O.shown(ce, [corner])[0]
	ce = T.set_point(ce, "grid:DSR", "Grid corner DSR", corner, [at[0] + 3.0, at[1] + 4.0])
	ce = T.set_point(ce, "obj:gone:0", "Old wall bottom L", [1.0, 2.0, 0.0], [10.0, 10.0])
	var pts := O.points(tr, ce, [tv])
	t.eq(pts.size(), 4 + 6 + 4 + 1, "corners + crossings + TV corners + a clicked point whose object is gone")
	t.ok(absf(pts[0].err - 5.0) < 1e-3, "error = click distance (3-4-5)")
	t.eq(pts[1].click, null)
	t.eq(pts[1].err, -1.0)
	t.ok(str(pts[pts.size() - 1].label).ends_with("(gone)"))
	t.eq(O.nearest(pts, pts[0].shown + Vector2(1, 1), 8.0), 0, "the corner wins the tie with crossing X0/Y0")
	t.eq(O.nearest(pts, Vector2(-500, -500), 8.0), -1)
