extends RefCounted
## WO-665 — cut-out cards: person_cards_model.gd picks the camera that shows a person best, measures their height
## from the box top, and decodes the sidecar's bit-packed seg mask.

const M := preload("res://features/previs/tracking/person_cards_model.gd")
const C := preload("res://features/previs/tracking/camera_model.gd")
var t

const W := 1920.0
const H := 1080.0


func _cam(id: String, role: String, cam: Dictionary) -> Dictionary:
	return {"id": id, "role": role, "raster": [W, H], "cam": cam}


## The box a camera would see for a person `height` tall standing at (x, y): top-centre at the head, 0.5 m wide.
func _box(cam: Dictionary, x: float, y: float, height: float) -> Array:
	var p := C.project(cam, [[x, y, height], [x, y, 0.0]], W, H)
	var hw := 0.25 * absf(p[1][1] - p[0][1]) / height / W  # 0.25 m half-width at the px-per-metre of that range
	var cx: float = p[0][0] / W
	return [cx - hw, p[0][1] / H, cx + hw, p[1][1] / H]


func test_estimate_height_recovers_a_known_height() -> void:
	var cam := C.camera(0.0, -10.0, 5.0, -20.0)
	for hgt in [1.6, 1.85]:
		var box := _box(cam, 0.5, 1.0, hgt)
		var got := M.estimate_height(_cam("a", "ch1", cam), box, [0.5, 1.0, 0.0])
		t.ok(absf(got - hgt) < 0.01, "height %.2f recovered (got %.3f)" % [hgt, got])
	var side := C.camera(-8.0, 0.0, 3.0, -10.0, 90.0)
	var g2 := M.estimate_height(_cam("b", "ch2", side), _box(side, 0.0, 0.0, 1.7), [0.0, 0.0, 0.0])
	t.ok(absf(g2 - 1.7) < 0.02, "a yawed camera measures too (got %.3f)" % g2)


func test_estimate_height_nan_without_a_view() -> void:
	var bad := {"pos_x": 0, "pos_y": 0, "pos_z": 0, "pitch": 0, "yaw": 0, "roll": 0, "fov": 0}
	t.ok(is_nan(M.estimate_height(_cam("a", "ch1", bad), [0.4, 0.2, 0.5, 0.8], [0, 0, 0])), "no valid view → NAN")


func test_best_view_largest_live_box_wins() -> void:
	var by_id := {"a": _cam("a", "ch1", C.camera()), "b": _cam("b", "ch2", C.camera())}
	var small := {"cam": {"id": "a"}, "person": {"box": [0.4, 0.4, 0.45, 0.5], "age_s": 0.0}}
	var big := {"cam": {"id": "b"}, "person": {"box": [0.2, 0.2, 0.4, 0.8], "age_s": 0.0}}
	var views := {"a:1": small, "b:7": big}
	t.eq(M.best_view({"keys": ["a:1", "b:7"]}, views, by_id), big, "the bigger picture wins")
	big.person.age_s = 0.5
	var coast := {"cam": {"id": "b"}, "person": {"box": [0.4, 0.4, 0.46, 0.5], "age_s": 0.5}}
	t.eq(M.best_view({"keys": ["a:1", "b:7"]}, {"a:1": small, "b:7": coast}, by_id), small,
		"a coasting view of similar size loses to a live one")
	t.eq(M.best_view({"keys": ["z:1"]}, views, by_id), {}, "no camera sees them → {}")


func test_cards_from_a_snapshot() -> void:
	var cam := C.camera(0.0, -10.0, 5.0, -20.0)
	var box := _box(cam, 0.5, 1.0, 1.8)
	var snap := {"cameras": [{"id": "a", "role": "ch1", "stale": false, "mask_size": [48, 96],
		"persons": [{"tid": 3, "box": box, "age_s": 0.0, "mask": "AAA="}]},
		{"id": "x", "role": "ch9", "stale": true, "persons": [{"tid": 1, "box": [0, 0, 1, 1], "age_s": 0.0}]}],
		"world": {"plane_z": 0.0, "persons": [{"id": 5, "x": 0.5, "y": 1.0, "height": null, "keys": ["a:3"]},
			{"id": 6, "x": 0, "y": 0, "height": null, "keys": ["x:1"]}]}}
	var cs := M.cards(snap, [_cam("a", "ch1", cam), _cam("x", "ch9", cam)])
	t.eq(cs.size(), 1, "one card: the person seen only by a stale camera gets none")
	var c: Dictionary = cs[0]
	t.eq([c.id, c.cam_id, c.role, c.mask, c.mask_size], [5, "a", "ch1", "AAA=", [48, 96]], "card fields")
	t.ok(absf(c.height - 1.8) < 0.01, "height measured from the box (%.3f)" % c.height)
	var aspect: float = (box[2] - box[0]) * W / ((box[3] - box[1]) * H)
	t.ok(absf(c.width / c.height - aspect) < 1e-4, "card keeps the box's pixel aspect")
	snap.world.persons[0].height = 9.0
	t.eq(M.cards(snap, [_cam("a", "ch1", cam)])[0].height, M.MAX_HEIGHT, "a fused height is used, clamped")
	t.eq(M.cards(null, []), [], "no snapshot → no cards")


func test_mask_image_decodes_bits_msb_first() -> void:
	# 4 × 2: rows 1010 / 0111 → bytes 0b10100111 = 0xA7
	var img := M.mask_image(Marshalls.raw_to_base64(PackedByteArray([0xA7])), [4, 2])
	t.ok(img != null, "decodes")
	var got := []
	for y in 2:
		for x in 4:
			got.append(int(img.get_pixel(x, y).r > 0.5))
	t.eq(got, [1, 0, 1, 0, 0, 1, 1, 1], "MSB first, row-major, row 0 = top")
	t.eq(img.get_format(), Image.FORMAT_L8, "L8")
	t.eq(M.mask_image("", [4, 2]), null, "no mask → null")
	t.eq(M.mask_image(Marshalls.raw_to_base64(PackedByteArray([0xA7])), [48, 96]), null, "too short → null")
	t.eq(M.mask_image("AAA=", null), null, "no size → null")
