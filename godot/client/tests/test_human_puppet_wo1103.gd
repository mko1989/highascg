extends RefCounted
## WO-1103 — realistic human test puppets (Microsoft Rocketbox, MIT): the bodies load (one skinned mesh with LODs and a
## material per part with its own textures, the Bip01 biped, heights as built), the baked motion-capture moves are all
## there with their measured speed / stride / turn, the puppet card's body / heading, the layer's choice (woman / man →
## the human, anything else → the untouched pebble), and the motion: a walking toe stands still on the floor while it
## carries the body (no sliding: the cycle rate is the ground speed over the clips' stride), faster plays the longer,
## quicker walk, standing is still, a heading change plays a turn on the spot, height scales the body.

const Body := preload("res://features/previs/tracking/human_body.gd")
const Human := preload("res://features/previs/tracking/person_human.gd")
const Avatar := preload("res://features/previs/tracking/person_avatar.gd")
const Avatars := preload("res://features/previs/tracking/person_avatars.gd")
const M := preload("res://features/previs/tracking/person_cards_model.gd")
var t

const LOOK := {"top": [120, 32, 44], "bottom": [40, 90, 190], "skin": [247, 224, 206], "hair": [25, 22, 22], "hair_len": "long", "locked": true}
const TOES := ["Bip01 L Toe0", "Bip01 R Toe0"]


func _human(body: String) -> Node3D:
	var h := Human.new(body)
	(t.root as Node).add_child(h)  # in the tree: the skeleton keeps its global poses
	h.set_process(false)  # the test steps it
	return h


func test_bodies_load_with_lods_and_their_own_textures() -> void:
	for b in ["woman", "man"]:
		t.ok(Body.available(b), "%s available" % b)
		var inst := Body.instance(b)
		var sk: Skeleton3D = inst.skeleton
		t.ok(sk.get_bone_count() >= 80 and sk.find_bone("Bip01") == 0, "%s: the Bip01 biped (%d bones)" % [b, sk.get_bone_count()])
		for n in TOES + ["Bip01 LEye", "Bip01 REyeBlinkTop", "Bip01 Head"]:
			t.ok(sk.find_bone(n) >= 0, "%s: bone %s" % [b, n])
		t.eq(inst.meshes.size(), 1, "%s: one skinned mesh" % b)
		var mi: MeshInstance3D = inst.meshes[0]
		var mesh: ArrayMesh = mi.mesh
		var tris := 0
		var parts := []
		for s in mesh.get_surface_count():
			tris += (mesh.surface_get_arrays(s)[Mesh.ARRAY_INDEX] as PackedInt32Array).size() / 3
			var lods: Array = RenderingServer.mesh_get_surface(mesh.get_rid(), s).get("lods", [])
			t.ok(lods.size() >= 2, "%s surface %d: %d LODs" % [b, s, lods.size()])
			var m: ShaderMaterial = mi.get_surface_override_material(s)
			parts.append(mesh.surface_get_material(s).resource_name)
			var tex: Variant = m.get_shader_parameter("albedo_tex")
			t.ok(tex is ImageTexture and (tex as ImageTexture).get_width() >= 1024, "%s %s: its own texture" % [b, parts[-1]])
		parts.sort()
		t.eq(parts, ["body", "head", "opacity"], "%s: body, head, hair / lashes" % b)
		t.ok(tris > 5000 and tris < 12000, "%s: %d triangles" % [b, tris])
		var hm: ShaderMaterial = mi.get_surface_override_material(parts.find("head"))
		t.ok(hm.get_shader_parameter("normal_tex") != null and hm.get_shader_parameter("spec_tex") != null, "%s head: normal + specular maps" % b)
		(inst.root as Node).free()
	t.ok(absf(float(Body.template("woman").height) - 1.72) < 0.04, "woman ≈ 1.72 m as built")
	t.ok(absf(float(Body.template("man").height) - 1.79) < 0.04, "man ≈ 1.79 m as built")
	t.ok(not Body.available("cartoon") and not Body.available("robot"), "only woman / man are bodies")


func test_moves_are_baked_with_speed_stride_and_turns() -> void:
	for b in ["woman", "man"]:
		var lib: AnimationLibrary = Body.template(b).moves
		var last := 0.0
		for n in ["walk_slow", "walk", "walk_fast"]:
			var a := lib.get_animation(n)
			t.eq(a.loop_mode, Animation.LOOP_LINEAR, "%s %s loops" % [b, n])
			t.ok(absf(a.length - 1.0) < 0.01, "%s %s: a 1 s cycle (blends stay in phase)" % [b, n])
			var sp := float(a.get_meta("speed", 0.0))
			var st := float(a.get_meta("stride", 0.0))
			t.ok(sp > last and sp > 0.7 and sp < 1.7, "%s %s: %.2f m/s, faster than the last" % [b, n, sp])
			t.ok(st > 1.0 and st < 1.8, "%s %s: stride %.2f m" % [b, n, st])
			last = sp
		t.ok(lib.get_animation("idle").length > 5.0, "%s: a long idle" % b)
		for n in ["turn_left_60", "turn_right_60", "turn_left_90", "turn_right_90"]:
			var y := float(lib.get_animation(n).get_meta("yaw", 0.0))
			var want := (PI / 3.0 if n.ends_with("60") else PI / 2.0) * (1.0 if n.contains("left") else -1.0)
			t.ok(absf(y - want) < 0.12, "%s %s turns %.2f rad" % [b, n, y])


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


## Walk a human along +x (Godot) at `speed` for `secs` (15 Hz targets, 60 fps steps). Per toe, after the first 2 s:
## the stance phases (runs of frames where the toe is on the floor, < 3 cm up, and moves < 12 cm/s — a tenth of the
## walking speed; the recorded toe rolls a centimetre or two over a stance) → {stances, drift (max m a toe moved during
## one stance), still (frames standing, both toes), frames, cad [cadence per frame], h}.
func _walk(body: String, speed: float, secs: float, height := 1.7) -> Dictionary:
	var h := _human(body)
	var dt := 1.0 / 60.0
	var tt := 0.0
	var nxt := 0.0
	var was: Array = [null, null]
	var run: Array = [null, null]
	var res := {"stances": 0, "drift": 0.0, "still": 0, "frames": 0, "cad": []}
	while tt < secs:
		if tt >= nxt:
			h.set_target(Vector3(speed * tt, 0.0, 0.0), height, {}, null, tt)
			nxt += 1.0 / 15.0
		h.step(dt)
		tt += dt
		var sh: Dictionary = h.shown()
		if tt < 2.0:
			was = sh.feet.duplicate()
			continue
		res.frames += 1
		res.cad.append(float(sh.cadence))
		for i in 2:
			var p: Vector3 = sh.feet[i]
			var v := Vector2(p.x - was[i].x, p.z - was[i].z).length() / dt
			was[i] = p
			if p.y > 0.05:
				run[i] = null  # in the air: the next floor contact is a new plant
			elif v < 0.12 and p.y < 0.03:
				res.still += 1
				if run[i] == null:
					run[i] = p
					res.stances += 1
				res.drift = maxf(res.drift, Vector2(p.x - run[i].x, p.z - run[i].z).length())
	res.h = h
	return res


func test_walking_toes_stand_still_while_they_carry_the_body() -> void:
	for b in ["woman", "man"]:
		var r := _walk(b, 1.2, 8.0)
		var share: float = float(r.still) / (2.0 * r.frames)
		t.ok(share > 0.3, "%s: each toe stands still %.0f %% of the walk" % [b, share * 100.0])
		t.ok(r.stances >= 7 and r.stances <= 14, "%s: %d foot plants in 6 s" % [b, r.stances])
		t.ok(r.drift < 0.04, "%s: a planted toe drifts %.3f m at most" % [b, r.drift])
		var p: Dictionary = r.h.shown()
		t.ok(absf(float(p.pos.x) - 1.2 * 8.0) < 0.5, "%s: the body kept up with the target" % b)
		t.ok(float(p.walk) > 0.95, "%s: walking" % b)
		(r.h as Node).free()


func test_cadence_is_ground_speed_over_stride() -> void:
	var h := _human("woman")
	var mo: RefCounted = h.motion
	for sp in [0.9, 1.2, 1.5]:
		t.ok(absf(mo.cadence(sp) * mo.stride_at(sp) - sp) < 1e-4, "%.1f m/s: cycles/s × stride = speed" % sp)
	t.ok(mo.stride_at(1.5) > mo.stride_at(0.9) * 1.1, "faster: a longer stride")
	t.ok(mo.cadence(1.5) > mo.cadence(0.9), "and a quicker cycle")
	var r := _walk("woman", 1.2, 6.0)
	var c: float = r.cad[-1]
	var s: float = 1.7 / float(Body.template("woman").height)
	t.ok(absf(c - mo.cadence(1.2 / s)) < 0.03, "the drawn walk's cadence %.2f /s matches %.2f m/s" % [c, 1.2])
	t.ok(absf(float(r.h.motion.tree.get("parameters/ts/scale")) - c) < 0.03, "the tree plays at that rate")
	for n in [h, r.h]:
		(n as Node).free()


func test_standing_is_still_and_a_heading_turns_on_the_spot() -> void:
	var h := _human("man")
	var tt := 0.0
	h.set_heading(-PI / 2.0)
	for k in 240:
		tt += 1.0 / 60.0
		if k % 4 == 0:
			h.set_target(Vector3.ZERO, 1.8, {}, null, tt)
		h.step(1.0 / 60.0)
	var feet0: Array = h.shown().feet
	var moved := 0.0
	for k in 300:  # five seconds standing (the idle breathes and shifts its weight; the feet stay)
		tt += 1.0 / 60.0
		if k % 4 == 0:
			h.set_target(Vector3.ZERO, 1.8, {}, null, tt)
		h.step(1.0 / 60.0)
		for i in 2:
			moved = maxf(moved, (h.shown().feet[i] as Vector3).distance_to(feet0[i]))
	t.ok(moved < 0.06, "standing: the feet stay (%.3f m)" % moved)
	t.ok(float(h.shown().walk) < 0.05, "and it does not walk")
	h.set_heading(PI / 2.0)  # the other way round
	var turned := false
	var lifted := 0.0
	for k in 480:
		tt += 1.0 / 60.0
		if k % 4 == 0:
			h.set_target(Vector3.ZERO, 1.8, {}, null, tt)
		h.step(1.0 / 60.0)
		turned = turned or bool(h.shown().turning)
		for i in 2:
			lifted = maxf(lifted, (h.shown().feet[i] as Vector3).y)
	var want := atan2(cos(PI / 2.0), -sin(PI / 2.0))
	t.ok(turned, "a turn clip played")
	t.ok(absf(angle_difference(float(h.shown().yaw), want)) < 0.2, "turned to the heading (%.2f off)" % absf(angle_difference(float(h.shown().yaw), want)))
	t.ok(lifted > 0.03, "stepping round, not spinning (a toe lifted %.2f m)" % lifted)
	t.ok(Vector2(h.shown().pos.x, h.shown().pos.z).length() < 0.05, "on the spot")
	h.free()


func test_height_scales_the_body() -> void:
	var h := _human("woman")
	h.set_target(Vector3.ZERO, 1.55, {}, null, 0.0)
	t.ok(absf(h.transform.basis.get_scale().y * float(Body.template("woman").height) - 1.55) < 0.005, "1.55 m tall")
	t.eq(h.shown().height, 1.55, "shown height")
	h.free()


func test_blink() -> void:
	for b in ["woman", "man"]:
		var h := Human.new(b)
		(t.root as Node).add_child(h)
		h.set_process(false)
		h.set_target(Vector3.ZERO, 1.7, {}, null, 0.0)
		var sk: Skeleton3D = h._sk
		var top := sk.find_bone("Bip01 LEyeBlinkTop")
		var bot := sk.find_bone("Bip01 LEyeBlinkBottom")
		var gap := func() -> float: return h._bone_global(top).origin.y - h._bone_global(bot).origin.y
		h.step(1.0 / 60.0)
		var open_gap: float = gap.call()
		var shut := 0
		var least := open_gap
		for i in 60 * 14:
			h.step(1.0 / 60.0)
			var g: float = gap.call()
			least = minf(least, g)
			if g < open_gap * 0.4:
				shut += 1
		t.ok(least < open_gap * 0.4, "%s: the lids close (gap %.4f → %.4f m)" % [b, open_gap, least])
		t.ok(shut > 0 and shut < 60 * 14 / 10, "%s: briefly (%d of %d frames)" % [b, shut, 60 * 14])
		var eye := h._bone_global(sk.find_bone("Bip01 LEye")).origin
		h.blink.hold = 0.0
		h.step(1.0 / 60.0)
		var up: Vector3 = h._bone_global(top).origin
		h.blink.hold = 1.0
		h.step(1.0 / 60.0)
		var lid: Vector3 = h._bone_global(top).origin
		t.ok(lid.y < up.y - 0.008 and lid.z > eye.z, "%s: shut, the top lid %.3f m lower and still in front of the eye" % [b, up.y - lid.y])
		h.free()
