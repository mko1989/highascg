extends RefCounted
## WO-1103 — realistic human test puppets: the bodies load (two levels of detail, a material per part, no camera
## picture), heights and skin tones, the puppet card's body / heading, the layer's choice (woman / man → the human,
## anything else → the untouched pebble), and the walk: planted feet never slide (the drawn foot bone stays on its
## floor point), longer and quicker steps when faster, standing still is still, turning on the spot steps round.

const Body := preload("res://features/previs/tracking/human_body.gd")
const Human := preload("res://features/previs/tracking/person_human.gd")
const Gait := preload("res://features/previs/tracking/human_gait_model.gd")
const Avatar := preload("res://features/previs/tracking/person_avatar.gd")
const Avatars := preload("res://features/previs/tracking/person_avatars.gd")
const AV := preload("res://features/previs/tracking/person_avatar_model.gd")
const M := preload("res://features/previs/tracking/person_cards_model.gd")
var t

const LOOK := {"top": [120, 32, 44], "bottom": [40, 90, 190], "skin": [247, 224, 206], "hair": [25, 22, 22], "hair_len": "long", "locked": true}


func _tris(meshes: Array) -> int:
	var n := 0
	for mi: MeshInstance3D in meshes:
		var a: Array = mi.mesh.surface_get_arrays(0)
		n += (a[Mesh.ARRAY_INDEX] as PackedInt32Array).size() / 3
	return n


func test_bodies_load_with_two_lods_and_their_own_textures() -> void:
	for b in ["woman", "man"]:
		t.ok(Body.available(b), "%s available" % b)
		var inst := Body.instance(b, "light")
		var sk: Skeleton3D = inst.skeleton
		t.eq(sk.get_bone_count(), 53, "%s: the 53-bone game_engine rig" % b)
		var t0 := _tris(inst.lod0)
		var t1 := _tris(inst.lod1)
		t.ok(t0 > 15000 and t0 <= 25000, "%s LOD0 %d triangles (15–25k)" % [b, t0])
		t.ok(t1 > 3000 and t1 <= 8000, "%s LOD1 %d triangles" % [b, t1])
		var parts := {}
		for mi: MeshInstance3D in inst.lod0 + inst.lod1:
			var m: ShaderMaterial = mi.material_override
			parts[Body.part_of(mi)] = true
			var tex: Variant = m.get_shader_parameter("albedo_tex")
			t.ok(tex is ImageTexture and (tex as ImageTexture).get_width() >= 256, "%s %s: its own texture" % [b, mi.name])
		t.eq(parts.keys().size(), 7, "%s: skin, clothes, shoes, eyes, hair, eyebrows, eyelashes" % b)
		(inst.root as Node).free()
	t.ok(absf(float(Body.template("woman").height) - 1.68) < 0.03, "woman ≈ 1.68 m as built")
	t.ok(absf(float(Body.template("man").height) - 1.80) < 0.03, "man ≈ 1.80 m as built")
	t.ok(not Body.available("cartoon") and not Body.available("robot"), "only woman / man are bodies")


func test_skin_tone_from_the_puppet_look() -> void:
	var got := []
	for c in [[247, 224, 206], [234, 196, 166], [214, 165, 128], [176, 124, 88], [128, 86, 58], [88, 58, 40]]:
		got.append(Body.tone_for(Color8(c[0], c[1], c[2])))
	t.eq(got, ["light", "light", "light", "mid", "mid", "dark"], "the six palette skins → three textures")
	t.eq(Body.tone_for(null), "light", "no look")
	var h := Human.new("woman", "light")
	h.set_target(Vector3.ZERO, 1.68, AV.look({"skin": [88, 58, 40]}), null, 0.0)
	t.eq(h.tone, "dark", "the look's skin picks the tone")
	h.free()


func test_puppet_card_carries_body_and_heading() -> void:
	var snap := {"world": {"plane_z": 0.5, "persons": [
		{"id": 900001, "x": 1.0, "y": 2.0, "height": 1.7, "puppet": true, "name": "TEST puppet 1", "traits": LOOK, "body": "woman", "heading": 1.2},
		{"id": 900002, "x": 3.0, "y": 2.0, "height": 1.7, "puppet": true, "name": "TEST puppet 2", "traits": LOOK}]}}
	var cs := M.puppet_cards(snap)
	t.eq([cs[0].body, cs[0].heading], ["woman", 1.2], "body + heading through")
	t.eq([cs[1].body, cs[1].heading], ["cartoon", null], "an older server: the cartoon")


func test_layer_picks_human_or_pebble_and_swaps() -> void:
	var layer := Avatars.new()
	var card := func(id: int, body: Variant) -> Dictionary:
		var c := {"id": id, "feet": [1.0, 2.0, 0.0], "height": 1.7, "joints": null, "keys": ["puppet:%d" % id],
			"looks": [{"key": "puppet:%d" % id, "traits": LOOK}], "tag": "TEST puppet"}
		if body != null:
			c.body = body
		return c
	layer.show_cards([card.call(1, "woman"), card.call(2, "man"), card.call(3, "cartoon"), card.call(4, null), card.call(5, "robot")], 0.0)
	t.ok(layer.avatar(1) is Human and layer.avatar(2) is Human, "woman / man → the human")
	t.eq([layer.avatar(1).body, layer.avatar(2).body], ["woman", "man"], "the right bodies")
	t.ok(layer.avatar(3) is Avatar and layer.avatar(4) is Avatar and layer.avatar(5) is Avatar, "cartoon / none / unknown → the pebble")
	var pebble: Node3D = layer.avatar(3)
	layer.show_cards([card.call(1, "man"), card.call(3, "cartoon")], 0.1)
	t.eq(layer.avatar(1).body, "man", "a body change swaps the node")
	t.ok(layer.avatar(3) == pebble, "the pebble stays the same node")
	layer.show_cards([card.call(1, "cartoon")], 0.2)
	t.ok(layer.avatar(1) is Avatar, "back to the cartoon")
	layer.clear()
	layer.free()


## A bone's skeleton-space transform from the local poses the pose wrote (the node is not in a tree: no skeleton update).
func _global(sk: Skeleton3D, b: int) -> Transform3D:
	var tr := sk.get_bone_pose(b)
	var p := sk.get_bone_parent(b)
	while p >= 0:
		tr = sk.get_bone_pose(p) * tr
		p = sk.get_bone_parent(p)
	return tr


## Walk a human from (0, 0) along +x (Godot) at `speed` for `secs` with 15 Hz updates and 60 fps steps.
## Returns {steps, planted_slip (max m a planted foot's floor point moved), bone_slip (max m the drawn ball bone left its
## planted point), lens [step lengths], h}.
func _walk(body: String, speed: float, secs: float, height := 1.7) -> Dictionary:
	var h := Human.new(body, "light")
	var dt := 1.0 / 60.0
	var tt := 0.0
	var next_upd := 0.0
	var res := {"steps": 0, "planted_slip": 0.0, "bone_slip": 0.0, "lens": []}
	var was := [null, null]
	var sk: Skeleton3D = h._sk
	var balls := [sk.find_bone("ball_l"), sk.find_bone("ball_r")]
	var look := AV.look(LOOK)
	while tt < secs:
		if tt >= next_upd:
			h.set_target(Vector3(speed * tt, 0.0, 0.0), height, look, null, tt)
			next_upd += 1.0 / 15.0
		h.step(dt)
		tt += dt
		for i in 2:
			var f: Dictionary = h._gait.feet[i]
			if f.air:
				was[i] = null
				continue
			if was[i] == null:
				if f.has("from"):
					res.steps += 1
					res.lens.append(Vector2((f.at as Vector3).x - (f.from as Vector3).x, (f.at as Vector3).z - (f.from as Vector3).z).length())
				was[i] = f.at
			res.planted_slip = maxf(res.planted_slip, (f.at as Vector3).distance_to(was[i]))
			if tt > 1.0:  # the drawn foot: the ball bone over its floor point (planted feet only; heel may be up)
				var g: Vector3 = h.transform * _global(sk, balls[i]).origin
				var want: Vector3 = f.at
				res.bone_slip = maxf(res.bone_slip, Vector2(g.x - want.x, g.z - want.z).length())
	res.h = h
	return res


func test_walking_feet_never_slide() -> void:
	for b in ["woman", "man"]:
		var r := _walk(b, 1.2, 8.0)
		t.ok(r.steps >= 10, "%s walked %d steps in 8 s" % [b, r.steps])
		t.eq(r.planted_slip, 0.0, "%s: a planted foot's floor point never moves" % b)
		t.ok(r.bone_slip < 0.03, "%s: the drawn ball of the foot stays on it (%.3f m)" % [b, r.bone_slip])
		var p: Dictionary = r.h.shown()
		t.ok(absf(float(p.pos.x) - 1.2 * 8.0) < 0.5, "%s: the body kept up with the target" % b)
		(r.h as Node).free()


func test_faster_means_longer_and_quicker_steps() -> void:
	var slow := _walk("woman", 0.6, 10.0)
	var fast := _walk("woman", 1.3, 10.0)
	var mean := func(a: Array) -> float:
		var s := 0.0
		for v in a.slice(2):
			s += float(v)
		return s / maxf(a.size() - 2, 1)
	var ls: float = mean.call(slow.lens)
	var lf: float = mean.call(fast.lens)
	t.ok(lf > ls * 1.3, "stride longer when faster (%.2f vs %.2f m)" % [lf, ls])
	t.ok(fast.steps > slow.steps, "and quicker (%d vs %d steps)" % [fast.steps, slow.steps])
	t.ok(lf > 1.0 and lf < 1.7, "a brisk walk's stride (two steps) %.2f m" % lf)
	t.ok(Gait.step_length(1.4, 1.68, 1.0) > Gait.step_length(0.7, 1.68, 1.0), "step length grows with speed")
	t.ok(Gait.step_length(1.0, 1.68, 1.1) > Gait.step_length(1.0, 1.68, 1.0) * 1.03, "a taller body steps further")
	for r in [slow, fast]:
		(r.h as Node).free()


func test_standing_is_still_and_turning_steps_round() -> void:
	var h := Human.new("man", "light")
	var look := AV.look(LOOK)
	var tt := 0.0
	h.set_target(Vector3.ZERO, 1.8, look, null, 0.0)
	for k in 180:
		h.step(1.0 / 60.0)
	var feet0 := [h._gait.feet[0].at, h._gait.feet[1].at]
	for k in 300:  # five seconds standing
		tt += 1.0 / 60.0
		if k % 4 == 0:
			h.set_target(Vector3.ZERO, 1.8, look, null, tt)
		h.step(1.0 / 60.0)
	t.eq([h._gait.feet[0].at, h._gait.feet[1].at], feet0, "standing: no fidget steps")
	h.set_heading(PI / 2.0)  # PSN +y: the other way round (it stood facing PSN −y)
	var lifts := 0
	var air := [false, false]
	for k in 360:
		tt += 1.0 / 60.0
		if k % 4 == 0:
			h.set_target(Vector3.ZERO, 1.8, look, null, tt)
		h.step(1.0 / 60.0)
		for i in 2:
			if h._gait.feet[i].air and not air[i]:
				lifts += 1
			air[i] = h._gait.feet[i].air
	var want := atan2(cos(PI / 2.0), -sin(PI / 2.0))
	t.ok(absf(angle_difference(float(h.shown().yaw), want)) < 0.1, "turned to the heading")
	t.ok(lifts >= 4, "turning on the spot took %d steps" % lifts)
	for i in 2:
		var side := 1.0 if i == 0 else -1.0
		t.ok(absf(angle_difference(float(h._gait.feet[i].yaw), want + side * Gait.SPLAY)) < Gait.ADJUST_RAD, "foot %d turned round too" % i)
	h.free()


func test_height_scales_the_body() -> void:
	var h := Human.new("woman", "light")
	h.set_target(Vector3.ZERO, 1.55, AV.look(LOOK), null, 0.0)
	t.ok(absf(h.transform.basis.get_scale().y * float(Body.template("woman").height) - 1.55) < 0.005, "1.55 m tall")
	t.eq(h.shown().height, 1.55, "shown height")
	h.free()
