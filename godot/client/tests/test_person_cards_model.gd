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


## WO-701: COCO joints of someone at (x, y) facing `dir` (plan, unit): shoulders / hips across their front.
func _joints(x: float, y: float, dir: Vector2) -> Array:
	var left := Vector2(-dir.y, dir.x)  # a quarter anticlockwise of the front
	var j := []
	j.resize(17)
	for pair in [[5, 6, 1.45], [11, 12, 0.95]]:
		j[pair[0]] = [x + 0.2 * left.x, y + 0.2 * left.y, pair[2]]
		j[pair[1]] = [x - 0.2 * left.x, y - 0.2 * left.y, pair[2]]
	return j


func test_facing_from_shoulders_and_hips() -> void:
	for d in [Vector2(0, -1), Vector2(1, 0), Vector2(-0.6, 0.8)]:
		t.ok(M.facing(_joints(1.0, 2.0, d)).distance_to(d) < 1e-6, "faces %s" % d)
	t.eq(M.facing(null), Vector2.ZERO, "no pose → ZERO")
	var half := _joints(0, 0, Vector2(0, -1))
	half[11] = null
	t.eq(M.facing(half), Vector2.ZERO, "a missing hip → ZERO")


func test_ranked_views_prefer_the_camera_they_face() -> void:
	var front := C.camera(0.0, -10.0, 5.0, -20.0)  # downstage, looking upstage
	var back := C.camera(0.0, 10.0, 5.0, -20.0, 180.0)  # upstage, looking downstage
	var by_id := {"f": _cam("f", "ch1", front), "b": _cam("b", "ch2", back)}
	var views := {"f:1": {"cam": {"id": "f"}, "person": {"box": [0.4, 0.3, 0.45, 0.6], "age_s": 0.0}},
		"b:1": {"cam": {"id": "b"}, "person": {"box": [0.4, 0.2, 0.47, 0.7], "age_s": 0.0}}}
	var wp := {"x": 0.0, "y": 0.0, "keys": ["f:1", "b:1"]}
	t.eq(str(M.best_view(wp, views, by_id).cam.id), "b", "no pose: the bigger picture")
	wp.joints = _joints(0, 0, Vector2(0, -1))
	t.eq(str(M.best_view(wp, views, by_id).cam.id), "f", "facing downstage: the camera in front, though smaller")
	wp.joints = _joints(0, 0, Vector2(0, 1))
	t.eq(str(M.best_view(wp, views, by_id).cam.id), "b", "turned round: the upstage camera")


func test_sticky_camera_waits_before_cutting() -> void:
	var st := {}
	t.eq(M.sticky(st, ["a", "b"], 0.0), "a", "first sight: the best at once")
	t.eq(M.sticky(st, ["b", "a"], 1.0), "a", "b better for a moment: stay")
	t.eq(M.sticky(st, ["a", "b"], 1.5), "a", "a back on top: b's run is broken")
	t.eq(M.sticky(st, ["b", "a"], 2.0), "a")
	t.eq(M.sticky(st, ["b", "a"], 2.0 + M.SWITCH_HOLD_S - 0.1), "a", "not yet %.1f s" % M.SWITCH_HOLD_S)
	t.eq(M.sticky(st, ["b", "a"], 2.0 + M.SWITCH_HOLD_S), "b", "b best for %.1f s without a break: cut" % M.SWITCH_HOLD_S)
	t.eq(M.sticky(st, ["c"], 6.0), "c", "the shown camera lost them: cut at once")
	t.eq(M.sticky(st, [], 7.0), "", "nobody sees them")


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
	# WO-701: with a clock the camera is sticky per world person
	var cam2 := C.camera(3.0, -9.0, 5.0, -20.0)
	snap.world.persons[0].height = null
	snap.cameras.append({"id": "b", "role": "ch2", "stale": false, "persons": [{"tid": 4, "box": [0.1, 0.0, 0.9, 1.0], "age_s": 0.0}]})
	snap.world.persons[0].keys = ["a:3"]
	var pick := {}
	var both := [_cam("a", "ch1", cam), _cam("b", "ch2", cam2)]
	t.eq(M.cards(snap, both, pick, 10.0)[0].cam_id, "a", "only a sees them")
	snap.world.persons[0].keys = ["a:3", "b:4"]
	t.eq(M.cards(snap, both, pick, 10.5)[0].cam_id, "a", "b's bigger picture has to wait")
	t.eq(M.cards(snap, both, pick, 10.5 + M.SWITCH_HOLD_S)[0].cam_id, "b", "… and then takes over")
	t.eq(M.cards(snap, both)[0].cam_id, "b", "no clock: this snapshot's best")


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
