extends RefCounted
## WO-1086 — avatars: the sidecar's traits → colours / hair, which camera's look a person wears, facing, posed limbs,
## the avatar node (no camera texture, height, smoothing) and the layer (held + adopted avatars, looks from cards()).

const AV := preload("res://features/previs/tracking/person_avatar_model.gd")
const Avatar := preload("res://features/previs/tracking/person_avatar.gd")
const Avatars := preload("res://features/previs/tracking/person_avatars.gd")
const M := preload("res://features/previs/tracking/person_cards_model.gd")
const C := preload("res://features/previs/tracking/camera_model.gd")
var t

const RED := [200, 40, 44]
const NAVY := [30, 40, 80]
const LOOK := {"top": RED, "bottom": NAVY, "skin": [234, 196, 166], "hair": [25, 22, 22], "hair_len": "long", "locked": true}


func _close(a: Color, b: Color, eps := 0.002) -> bool:
	return absf(a.r - b.r) < eps and absf(a.g - b.g) < eps and absf(a.b - b.b) < eps


func test_look_from_traits() -> void:
	var l := AV.look(LOOK)
	t.ok(_close(l.top, Color8(200, 40, 44)) and _close(l.bottom, Color8(30, 40, 80)), "top / bottom colours")
	t.ok(_close(l.skin, Color8(234, 196, 166)) and _close(l.hair, Color8(25, 22, 22)), "skin / hair colours")
	t.eq([l.hair_len, l.known], ["long", true], "hair length, known")
	t.ok(l.shoes.get_luminance() < l.bottom.get_luminance(), "shoes a darker bottom")
	var p := AV.look({"top": [10, 20, 30], "bottom": [300, 0, 0], "skin": [1, 2], "hair_len": "mohawk"})
	t.ok(_close(p.top, Color8(10, 20, 30)) and _close(p.bottom, AV.NEUTRAL.bottom) and _close(p.skin, AV.NEUTRAL.skin), "junk keys stay neutral")
	t.eq(p.hair_len, "short", "unknown hair length → short")
	var n := AV.look(null)
	t.eq([n.known, n.hair_len], [false, "short"], "no traits: the neutral clay figure")


func test_pick_is_sticky_prefers_locked_and_fills_gaps() -> void:
	var memo := {}
	var a := {"key": "a:1", "traits": {"top": RED, "locked": false}}
	var b := {"key": "b:2", "traits": {"top": NAVY, "hair": [25, 22, 22], "locked": true}}
	t.eq(AV.pick([], memo), null, "no looks → null")
	t.eq(AV.pick([a], memo).top, RED, "the only look")
	t.eq(memo.key, "a:1", "remembered")
	t.eq(AV.pick([a, b], memo).top, NAVY, "a settled (locked) look wins over a settling one")
	var a2 := {"key": "a:1", "traits": {"top": RED, "bottom": [1, 2, 3], "locked": true}}
	t.eq(AV.pick([a2, b], memo).top, NAVY, "once shown, b stays though a is first and locked too")
	var got: Dictionary = AV.pick([b, a2], {})
	t.eq([got.top, got.hair, got.bottom], [NAVY, [25, 22, 22], [1, 2, 3]], "missing keys filled from the next view")


## A person facing PSN `f` (unit, x / y) standing at the origin: COCO joints with the person's left = f turned a
## quarter counter-clockwise… i.e. facing −y has the left at +x.
func _joints(f: Vector2) -> Array:
	var left := Vector2(-f.y, f.x)
	var j := []
	j.resize(17)
	var put := func(i: int, side: float, up: float, ahead := 0.0) -> void:
		var p := left * side + f * ahead
		j[i] = [p.x, p.y, up]
	put.call(5, 0.2, 1.4)
	put.call(6, -0.2, 1.4)
	put.call(11, 0.1, 0.9)
	put.call(12, -0.1, 0.9)
	put.call(15, 0.1, 0.05)
	put.call(16, -0.1, 0.05)
	return j


func test_yaw_from_pose_then_walk_then_last() -> void:
	t.ok(absf(AV.yaw(_joints(Vector2(0, -1)), Vector2.ZERO, 2.0)) < 1e-4, "facing the audience (−y) → yaw 0 (+Z)")
	t.ok(absf(AV.yaw(_joints(Vector2(1, 0)), Vector2(-1, 0), 2.0) - PI / 2.0) < 1e-4, "pose beats walking direction")
	t.ok(absf(AV.yaw(null, Vector2(0, 1.0), 0.3) - PI) < 1e-4, "walking upstage (+y) → yaw π")
	t.eq(AV.yaw(null, Vector2(0.1, 0), 0.3), 0.3, "slower than WALK_MIN: keep facing")
	var b := Basis(Vector3.UP, AV.yaw(null, Vector2(1, 0), 0.0))
	t.ok((b * Vector3.BACK).distance_to(C.psn_to_godot([1.0, 0.0, 0.0])) < 1e-4, "the avatar's front points where they walk")


func test_limb_dirs_in_the_body_frame() -> void:
	for f in [Vector2(0, -1), Vector2(1, 0), Vector2(-0.6, 0.8)]:
		var j := _joints(f)
		var left := Vector2(-f.y, f.x)
		var sh := Vector2(j[5][0], j[5][1])
		var w := sh + left * 0.6
		j[9] = [w.x, w.y, 1.4]  # left arm straight out sideways
		var y := AV.yaw(j, Vector2.ZERO, 0.0)
		var d := AV.limb_dirs(j, y)
		t.ok(d.arm_l.distance_to(Vector3.RIGHT) < 1e-3, "facing %s: the left arm out → +X (%s)" % [f, d.arm_l])
		t.ok(d.leg_l.distance_to(Vector3.DOWN) < 0.05 and d.leg_r.distance_to(Vector3.DOWN) < 0.05, "legs down")
		t.ok(not d.has("arm_r"), "no right wrist / elbow → no right arm direction")
	var j := _joints(Vector2(0, -1))
	j[15] = [0.1, -0.8, 0.9]  # left foot kicked forward, level with the hip
	var d := AV.limb_dirs(j, 0.0)
	t.ok(absf(d.leg_l.y - AV.LEG_MAX_UP) < 1e-4 and d.leg_l.z > 0.0, "a raised leg is clamped, still forward (%s)" % d.leg_l)
	t.eq(AV.limb_dirs(null, 0.0), {}, "no joints → nothing")
	for dir in [Vector3.RIGHT, Vector3(0, -0.6, 0.8), Vector3.DOWN, Vector3.UP]:
		t.ok((AV.hang_toward(dir) * Vector3.DOWN).distance_to(dir) < 1e-4, "hang_toward %s" % dir)


func test_stride() -> void:
	t.eq(AV.stride(1.0, 0.0), Vector2.ZERO, "standing: no swing, no bob")
	var s := AV.stride(PI / 2.0, 2.0)
	t.ok(absf(s.x - 0.5) < 1e-4 and absf(s.y - 0.025) < 1e-4, "full stride at a quarter cycle")


## Every material under a node, recursively.
func _materials(n: Node, out: Array) -> Array:
	if n is MeshInstance3D and (n as MeshInstance3D).material_override != null:
		out.append((n as MeshInstance3D).material_override)
	for ch in n.get_children():
		_materials(ch, out)
	return out


func test_avatar_has_no_camera_texture_and_wears_the_look() -> void:
	var a := Avatar.new()
	var mats := _materials(a, [])
	t.ok(mats.size() >= 14, "built from parts (%d)" % mats.size())
	var clean := true
	for m in mats:
		if m is StandardMaterial3D:
			clean = clean and (m as StandardMaterial3D).albedo_texture == null and (m as StandardMaterial3D).emission_texture == null
		elif m is ShaderMaterial:  # WO-1087: the avatar's own flat-colour shader — it has no texture input at all
			clean = clean and (m as ShaderMaterial).shader == Avatar.SHADER and not (m as ShaderMaterial).shader.code.contains("sampler")
		else:
			clean = false
	t.ok(clean, "only plain colour materials: no texture, no camera picture")
	a.set_target(Vector3(1, 0, -2), 1.6, AV.look(LOOK), null, 10.0)
	var s := a.shown()
	t.ok(_close(s.colours.top, Color8(200, 40, 44)) and _close(a.mats.top.get_shader_parameter("albedo"), Color8(200, 40, 44)), "first sight: the look at once")
	t.ok(absf(a.transform.basis.get_scale().y - 1.6 / Avatar.UNIT_TOP) < 1e-4 and a.position.distance_to(Vector3(1, 0, -2)) < 1e-5, "at the feet, scaled to 1.6 m")
	t.eq([a.hair_short.visible, a.hair_long.visible], [true, true], "long hair: cap + fall")
	a.set_target(Vector3(1, 0, -2), 1.6, AV.look({"top": [236, 236, 232], "hair_len": "bald"}), null, 10.1)
	t.eq([a.hair_short.visible, a.hair_long.visible], [false, false], "bald: no hair")
	a.step(0.1)
	var mid: Color = a.shown().colours.top
	t.ok(mid.r > Color8(200, 40, 44).r and mid.g < Color8(236, 236, 232).g - 0.2, "a new look fades in (%s)" % mid)
	for i in 120:
		a.step(1.0 / 60.0)
	t.ok(_close(a.shown().colours.top, Color8(236, 236, 232), 0.01), "… and arrives within 2 s")
	a.free()


func test_avatar_smooths_jitter_and_turns_to_walk() -> void:
	var a := Avatar.new()
	var now := 0.0
	var dev := 0.0
	for i in 60:  # 4 s of a standing person whose tracked point jitters ±5 cm at 15 Hz
		a.set_target(Vector3(0.05 if i % 2 else -0.05, 0, 0), 1.75, AV.look(null), null, now)
		for f in 4:
			a.step(1.0 / 60.0)
			if i > 10:
				dev = maxf(dev, absf(a.position.x))
		now += 1.0 / 15.0
	t.ok(dev < 0.03, "±5 cm jitter → the avatar moves < 3 cm (%.3f)" % dev)
	t.ok(a._vel.length() < AV.WALK_MIN, "… and is not walking (%.2f m/s)" % a._vel.length())
	var yaw0: float = a.shown().yaw
	for i in 45:  # then walks downstage-left (+x PSN) at 1.2 m/s for 3 s
		a.set_target(Vector3(i * 0.08, 0, 0), 1.75, AV.look(null), null, now)
		for f in 4:
			a.step(1.0 / 60.0)
		now += 1.0 / 15.0
	t.ok(absf(yaw0) < 1e-6, "jitter never turned them")
	t.ok(absf(wrapf(a.shown().yaw - PI / 2.0, -PI, PI)) < 0.15, "faces the way they walk (%.2f)" % a.shown().yaw)
	var swung := false
	for k in ["arm_l", "leg_l"]:
		swung = swung or (a.limbs[k] as Node3D).basis.get_rotation_quaternion().get_angle() > 0.15
	t.ok(swung, "arms / legs swing while walking")
	a.free()


## The world box of every visible mesh of a (not in tree) avatar.
func _bounds(a: Node3D) -> AABB:
	var box := AABB()
	var first := true
	var stack := [[a, a.transform]]
	while not stack.is_empty():
		var it: Array = stack.pop_back()
		for ch in (it[0] as Node).get_children():
			if not (ch is Node3D) or not (ch as Node3D).visible:
				continue
			var xf: Transform3D = (it[1] as Transform3D) * (ch as Node3D).transform
			if ch is MeshInstance3D:
				var b: AABB = xf * (ch as MeshInstance3D).mesh.get_aabb()
				box = b if first else box.merge(b)
				first = false
			stack.append([ch, xf])
	return box


func test_standing_soles_on_the_floor_hair_at_the_height() -> void:
	for h in [1.55, 1.75, 1.95]:
		var a := Avatar.new()
		a.set_target(Vector3(2, 0.639, -1), h, AV.look({"hair_len": "short"}), null, 0.0)
		var box := _bounds(a)
		t.ok(absf(box.position.y - 0.639) < 0.002, "%.2f m: soles on the stage top (%.4f)" % [h, box.position.y])
		t.ok(absf(box.end.y - 0.639 - h) < 0.002, "%.2f m: top of the hair = the height (%.4f)" % [h, box.end.y - 0.639])
		a.free()


func test_smile_is_a_lower_arc_on_the_face() -> void:
	var a := Avatar.new()
	var smile: MeshInstance3D = null
	for ch in a.get_child(0).get_children():
		if ch is MeshInstance3D and (ch as MeshInstance3D).mesh is ArrayMesh:
			smile = ch
	t.ok(smile != null, "the smile is its own arc mesh")
	var centre := Vector3(0, Avatar.SMILE.y, 0)
	var head := Vector3(0, Avatar.HEAD_Y, 0)
	var below := true
	var on_face := true
	for k in 11:
		var p := Avatar.smile_point(lerpf(Avatar.SMILE.from, Avatar.SMILE.to, k / 10.0))
		below = below and p.y < centre.y
		on_face = on_face and absf(p.distance_to(head) - Avatar.HEAD_R) < 0.004 and p.z > 0.15
	t.ok(below, "every point of it is below the arc centre: the ends turn up, a smile (never an O)")
	t.ok(on_face, "laid on the front of the head")
	var mid := Avatar.smile_point((Avatar.SMILE.from + Avatar.SMILE.to) / 2.0)
	var end := Avatar.smile_point(Avatar.SMILE.from)
	t.ok(mid.y < end.y - 0.02, "the middle hangs lower than the corners (%.3f vs %.3f)" % [mid.y, end.y])
	t.ok((smile.mesh as ArrayMesh).get_aabb().size.x < 0.09, "a small mouth (about a quarter of the head) (%.3f wide)" % (smile.mesh as ArrayMesh).get_aabb().size.x)
	a.free()


func test_layer_holds_and_adopts_avatars() -> void:
	var layer := Avatars.new()
	var card := func(id: int, keys: Array, top: Array) -> Dictionary:
		return {"id": id, "feet": [0.0, 1.0, 0.0], "height": 1.7, "joints": null, "keys": keys,
			"looks": [{"key": keys[0], "traits": {"top": top, "locked": true}}]}
	layer.show_cards([card.call(1, ["a:3"], RED), card.call(2, ["a:4"], NAVY)], 0.0)
	t.eq(layer.count(), 2, "two people, two avatars")
	var first: Node3D = layer.avatar(1)
	t.ok(_close(first.shown().colours.top, Color8(200, 40, 44)), "each wears their own look")
	layer.show_cards([card.call(2, ["a:4"], NAVY)], 0.5)
	t.eq(layer.count(), 2, "person 1 lost: their avatar is held")
	layer.show_cards([card.call(2, ["a:4"], NAVY), card.call(7, ["a:3"], RED)], 1.0)
	t.ok(layer.avatar(7) == first and layer.count() == 2, "a new world id with the same camera key takes the held avatar")
	var second: Node3D = layer.avatar(2)
	layer.show_cards([card.call(9, ["a:4"], NAVY)], 1.1)
	t.ok(layer.avatar(9) == second and layer.count() == 2, "re-numbered in one snapshot: adopted at once, no pop")
	layer.show_cards([], 1.2)
	layer.show_cards([], 1.2 + Avatars.HOLD_S + 0.01)
	t.eq(layer.count(), 0, "held avatars go after HOLD_S")
	layer.free()



## WO-1106 B33 — a held avatar expires on the clock when the snapshots stop (it used to expire only in show_cards()).
func test_held_avatars_expire_without_snapshots_wo1106_b33() -> void:
	var layer := Avatars.new()
	var card := {"id": 1, "feet": [0.0, 1.0, 0.0], "height": 1.7, "joints": null, "keys": ["a:3"],
		"looks": [{"key": "a:3", "traits": {"top": RED, "locked": true}}]}
	layer.show_cards([card], 10.0)
	layer.show_cards([], 10.1)  # the person is lost; then no snapshot comes any more
	t.eq(layer.count(), 1, "held")
	layer._process(0.016)
	t.eq(layer.count(), 1, "still held within HOLD_S")
	layer._snap_ticks -= Avatars.HOLD_S + 0.5  # HOLD_S and a bit pass on the engine clock, no snapshot
	layer._process(0.016)
	t.eq(layer.count(), 0, "gone without another snapshot")
	layer.free()

func test_cards_carry_keys_and_looks_best_view_first() -> void:
	var cam := C.camera(0.0, -10.0, 5.0, -20.0)
	var ce := func(id: String) -> Dictionary: return {"id": id, "role": "r" + id, "raster": [1920.0, 1080.0], "cam": cam}
	var snap := {"cameras": [
		{"id": "a", "role": "ra", "stale": false, "persons": [{"tid": 3, "box": [0.45, 0.4, 0.5, 0.6], "age_s": 0.0, "traits": {"top": RED}}]},
		{"id": "b", "role": "rb", "stale": false, "persons": [{"tid": 4, "box": [0.4, 0.2, 0.6, 0.9], "age_s": 0.0, "traits": {"top": NAVY}}]}],
		"world": {"plane_z": 0.0, "persons": [{"id": 5, "x": 0.0, "y": 0.0, "height": 1.7, "keys": ["a:3", "b:4"]}]}}
	var c: Dictionary = M.cards(snap, [ce.call("a"), ce.call("b")])[0]
	t.eq(c.keys, ["a:3", "b:4"], "keys")
	t.eq(c.looks.map(func(l: Dictionary) -> String: return l.key), ["b:4", "a:3"], "looks: the bigger view first")
