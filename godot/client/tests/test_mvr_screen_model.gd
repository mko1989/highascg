extends RefCounted
## WO-634 T1 — mvr_screen_model.gd: a Capture wall = touching 0.5 m panel objects (cluster), its frame (normal towards
## the viewer, height = world up, extents + panel cell), the LED wall built on it, and the left → right canvas packing
## of a centre wall + two totems on one destination (the owner's Pabianice case).

const W := preload("res://features/previs/mvr_screen_model.gd")
const S := preload("res://features/previs/stage_objects.gd")
var t

## Capture's panel part transform: Y and Z flipped (xform [1,0,0, 0,-1,0, 0,0,-1, …]).
const FLIP := Basis(Vector3(1, 0, 0), Vector3(0, -1, 0), Vector3(0, 0, -1))
const PANEL := AABB(Vector3(-0.25, 0.0, -0.04), Vector3(0.5, 0.5, 0.08))


## cols × rows panels, bottom-left panel's left edge at x0, bottom at 0, centred on z (rotated by `rot` about the origin).
static func _wall(cols: int, rows: int, x0: float, z: float, rot := Basis.IDENTITY) -> Array:
	var out := []
	for i in cols:
		for j in rows:
			var xf := Transform3D(FLIP, Vector3(x0 + 0.25 + 0.5 * i, 0.5 * (j + 1), z))
			out.append([{"xf": Transform3D(rot, Vector3.ZERO) * xf, "aabb": PANEL}])
	return out


static func _items(objects: Array, prefix: String, key: String) -> Array:
	var out := []
	for i in objects.size():
		var b: Dictionary = objects[i][0]
		out.append({"uuid": "%s%d" % [prefix, i], "key": key, "box": (b.xf as Transform3D) * (b.aabb as AABB)})
	return out


func test_cluster_takes_the_touching_panels_of_one_wall() -> void:
	var items := _items(_wall(4, 2, 0.0, -9.2), "c", "panel")
	items.append_array(_items(_wall(1, 2, 2.75, -9.2), "t", "panel"))  # a totem 0.75 m to the right
	items.append_array(_items(_wall(1, 1, 2.0, -9.2), "x", "truss"))  # touching, another model
	var c := W.cluster(items, "c5")
	t.eq(c.size(), 8, "the 4 × 2 centre wall only")
	t.eq(c[0], "c5", "the clicked one first")
	t.eq(W.cluster(items, "t1"), ["t1", "t0"])


func test_wall_frame_flat_and_turned() -> void:
	var f := W.wall_frame(_wall(4, 2, 0.0, -9.2), Vector3(1, 1, 10))
	t.ok((f.basis as Basis).is_equal_approx(Basis.IDENTITY), "faces the viewer (+Z), Y up despite the flipped parts")
	t.ok((f.size as Vector2).is_equal_approx(Vector2(2.0, 1.0)), "2 × 1 m")
	t.ok((f.cell as Vector2).is_equal_approx(Vector2(0.5, 0.5)), "panel = the clicked object")
	t.ok((f.origin as Vector3).is_equal_approx(Vector3(1.0, 0.0, -9.16)), "front face, bottom centre: %s" % f.origin)
	var back := W.wall_frame(_wall(4, 2, 0.0, -9.2), Vector3(1, 1, -20))
	t.ok((back.basis as Basis).z.is_equal_approx(Vector3(0, 0, -1)), "seen from behind → faces −Z")
	var rot := Basis(Vector3.UP, PI / 2.0)
	var turned := W.wall_frame(_wall(4, 2, 0.0, -9.2, rot), rot * Vector3(1, 1, 10))
	var o := W.wall_object(turned, [192, 192], Vector2(500, 500), "pgm1", [])
	t.ok(absf(float(o.rotation[1]) - 90.0) < 0.01 and absf(float(o.rotation[0])) < 0.01, "yaw 90: %s" % [o.rotation])
	var p := rot * Vector3(1.0, 0.0, -9.16)
	t.ok(Vector3(o.position[0], o.position[1], o.position[2]).is_equal_approx(p.snapped(Vector3.ONE * 0.001)), "%s" % [o.position])


func test_wall_object_panels() -> void:
	var f := {"basis": Basis.IDENTITY, "origin": Vector3(12, -1.6, -9.13), "size": Vector2(10, 4), "cell": Vector2(0.5, 0.5)}
	var o := W.wall_object(f, [192, 192], W.panel_mm_for(f, true, [500, 1000]), "pgm1", [])
	t.eq([o.type, o.panels, o.panel_mm, o.position, o.rotation], ["led_wall", [20, 8], [500.0, 500.0], [12.0, -1.6, -9.13],
		[0.0, 0.0, 0.0]], "the MVR's own 0.5 m panels")
	t.eq(S.pixels(o), Vector2i(3840, 1536))
	t.eq(o.source, {"role": "pgm1", "rect": {"x": 0, "y": 0, "w": 3840, "h": 1536}})
	t.eq(W.wall_object(f, [128, 256], W.panel_mm_for(f, false, [500, 1000]), "pgm1", []).panels, [20, 4],
		"one object → the preset's panel")


func test_pack_centre_and_totems_on_one_canvas() -> void:
	var mk := func(x: float, cols: int) -> Dictionary:
		var f := {"basis": Basis.IDENTITY, "origin": Vector3(x, 0, 0), "size": Vector2(0.5 * cols, 4), "cell": Vector2(0.5, 0.5)}
		return W.wall_object(f, [192, 192], Vector2(500, 500), "pgm1", [])
	var r := W.pack([mk.call(12.0, 20), mk.call(5.75, 2), mk.call(18.4, 2)])
	t.eq(r.objects.map(func(o: Dictionary) -> Dictionary: return o.source.rect), [{"x": 384, "y": 0, "w": 3840, "h": 1536},
		{"x": 0, "y": 0, "w": 384, "h": 1536}, {"x": 4224, "y": 0, "w": 384, "h": 1536}], "L | centre | R, top-aligned")
	t.eq(r.canvas, Vector2i(4608, 1536))
	t.ok(W.fit_note(r.canvas, Vector2i(3840, 2160)).contains("4608 × 1536"), "too wide for UHD → said")
	t.eq(W.fit_note(r.canvas, Vector2i(4608, 2160)), "")
