extends Node3D
## WO-1086 — one tracked person as a "pebble person": our own toy-like avatar, about three heads tall, from Godot primitive
## meshes (no assets): a big round head in skin tone with dot eyes, a small smile and blush dots (the same drawing for
## everyone — never the person's face), a hair cap (short), plus a fall down the back (long), none (bald); a rounded
## capsule body and stubby arms in the top colour with round hands; short legs in the bottom colour, darker shoes.
## Built in a unit frame (feet at y = 0, top of the hair ≈ UNIT_TOP, front +Z, the person's left +X) and scaled to the
## person's height. One flat-colour shader (person_avatar.gdshader: matte, a little self-light, a light response that
## saturates so spots never blow the clothes out to white). No camera texture is bound.
##
## person_avatars.gd feeds set_target() per tracking snapshot (10–15 Hz); step() eases everything per frame (_process),
## so a jittery box never makes a jittery figure.

const AV := preload("res://features/previs/tracking/person_avatar_model.gd")
const SHADER := preload("res://features/previs/tracking/person_avatar.gdshader")

const UNIT_TOP := 1.02
const HIP_Y := 0.32
const SHOULDER := Vector3(0.155, 0.6, 0.0)
const HEAD_Y := 0.815
const HEAD_R := 0.175
const POS_RATE := 8.0  # 1/s — feet follow the tracked point
const SIZE_RATE := 3.0
const YAW_RATE := 5.0
const COLOUR_RATE := 2.5  # a new look fades in over about a second
const LIMB_RATE := 9.0
const SELF_LIGHT := 0.3  # emission as a share of the colour
const RIM := 0.2  # person_avatar.gdshader rim
const House := preload("res://features/previs/house_lights.gd")  # WO-1099
const LEAD_MAX := 0.15  # s — between snapshots a walking figure keeps going at its speed (no 15 Hz surge-and-stall)
const SMILE := {"y": 0.79, "r": 0.036, "tube": 0.0085, "from": 3.578, "to": 5.847}  # 205° … 335°
const VEL_WINDOW := 0.6  # s — speed is measured over this baseline, so box jitter never reads as walking

static var _shared := {}  # unit meshes + the face materials, built once

var mats := {}  # top, bottom, skin, hair, shoes, blush → ShaderMaterial (person_avatar.gdshader, this avatar's own)
var hair_short: Node3D  # the cap + the back of the head (short and long hair)
var hair_long: MeshInstance3D
var limbs := {}  # arm_l / arm_r / leg_l / leg_r → pivot Node3D (the limb hangs down −Y from it)
var _body := Node3D.new()  # bobs while walking
var _target := {}  # pos (Vector3, Godot), height, yaw, look, dirs {limb: Vector3}
var _colours := {}  # what the materials show now
var _pos := Vector3.ZERO
var _height := 1.75
var _yaw := 0.0
var _vel := Vector2.ZERO  # PSN m/s over VEL_WINDOW
var _hist := []  # [[t, feet]] of the last VEL_WINDOW
var _phase := 0.0
var _clock := 0.0
var _last_t := NAN
var _placed := false
var _since := 0.0  # s since the last tracking update (the walk lead)
var tag: Label3D  # WO-1087: the floating "TEST puppet n" over a test person (null for a real one)


func _init() -> void:
	add_child(_body)
	for k in ["top", "bottom", "skin", "hair", "shoes", "blush"]:
		var m := ShaderMaterial.new()
		m.shader = SHADER
		mats[k] = m
	House.shared().changed.connect(house)
	house(House.shared().level)
	_build()
	_apply_colours(AV.look(null), 1.0)


## WO-1099: house lights off → the avatar is lit by the rig like everything else; only a small self-light floor (ui.cfg
## [previs] avatar_floor) keeps a presenter outside every beam readable, the rim fading with it (no glowing figure).
func house(h: float) -> void:
	var sl := House.self_light(SELF_LIGHT, h, House.shared().avatar_floor)
	for m: ShaderMaterial in mats.values():
		m.set_shader_parameter("self_light", sl)
		m.set_shader_parameter("rim", RIM * sl / SELF_LIGHT)

func _build() -> void:
	var s := _meshes()
	for side in [1.0, -1.0]:
		var leg := _pivot("leg_l" if side > 0 else "leg_r", Vector3(0.065 * side, HIP_Y, 0.0))
		_part(leg, s.leg, mats.bottom, Vector3(0, -0.15, 0))
		_part(leg, s.ball, mats.shoes, Vector3(0, -HIP_Y + 0.045, 0.025), Vector3(0.075, 0.045, 0.11))  # soles at y 0
		var arm := _pivot("arm_l" if side > 0 else "arm_r", Vector3(SHOULDER.x * side, SHOULDER.y, 0.0))
		_part(arm, s.arm, mats.top, Vector3(0, -0.11, 0))
		_part(arm, s.ball, mats.skin, Vector3(0, -0.245, 0), Vector3.ONE * 0.05)
		_part(_body, s.ball, s.eye, Vector3(0.058 * side, 0.83, 0.161), Vector3(0.019, 0.025, 0.011))
		_part(_body, s.ball, s.glint, Vector3(0.058 * side + 0.007, 0.838, 0.171), Vector3.ONE * 0.0055)
		_part(_body, s.ball, mats.blush, Vector3(0.1 * side, 0.775, 0.137), Vector3(0.028, 0.017, 0.009))
	_part(_body, s.torso, mats.top, Vector3(0, 0.48, 0), Vector3(1, 1, 0.8))
	_part(_body, s.ball, mats.skin, Vector3(0, HEAD_Y, 0), Vector3.ONE * HEAD_R)
	_part(_body, s.smile, s.mouth, Vector3.ZERO)  # an arc on the face surface (built in this frame), round ends
	for a in [SMILE.from, SMILE.to]:
		_part(_body, s.ball, s.mouth, smile_point(a), Vector3.ONE * SMILE.tube)
	hair_short = Node3D.new()
	_body.add_child(hair_short)
	_part(hair_short, s.ball, mats.hair, Vector3(0, 0.86, -0.02), Vector3(0.185, 0.16, 0.185))
	_part(hair_short, s.ball, mats.hair, Vector3(0, 0.8, -0.045), Vector3(0.18, 0.13, 0.16))  # the back of the head
	hair_long = _part(_body, s.long, mats.hair, Vector3(0, 0.72, -0.075), Vector3(1.6, 1, 0.65))


## The shared unit meshes and face materials (one set for every avatar).
static func _meshes() -> Dictionary:
	if not _shared.is_empty():
		return _shared
	var ball := SphereMesh.new()  # radius 1: scaled per part
	ball.radius = 1.0
	ball.height = 2.0
	ball.radial_segments = 32
	ball.rings = 16
	var eye := StandardMaterial3D.new()
	eye.albedo_color = Color(0.11, 0.10, 0.14)
	eye.roughness = 0.3
	var glint := StandardMaterial3D.new()  # the catch-light in each eye
	glint.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	glint.albedo_color = Color(1, 1, 1)
	var mouth := StandardMaterial3D.new()
	mouth.albedo_color = Color(0.42, 0.14, 0.17)
	mouth.roughness = 0.6
	_shared = {"ball": ball, "eye": eye, "glint": glint, "mouth": mouth, "smile": _smile_mesh(), "leg": _capsule(0.058, 0.30),
		"arm": _capsule(0.042, 0.24), "torso": _capsule(0.13, 0.36), "long": _capsule(0.12, 0.34)}
	return _shared


## A point of the smile's centre line (unit frame): on the arc around (0, SMILE.y) at angle `a`, laid on the face.
static func smile_point(a: float) -> Vector3:
	var x: float = SMILE.r * cos(a)
	var y: float = SMILE.y + SMILE.r * sin(a)
	var dy: float = y - HEAD_Y
	return Vector3(x, y, sqrt(maxf(HEAD_R * HEAD_R - x * x - dy * dy, 0.0)) + 0.002)


## The smile: a thin tube along the lower arc (SMILE.from … to, both below the centre: the ends turn up).
static func _smile_mesh() -> ArrayMesh:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var n := 16
	var ring := 8
	var rings := []
	for i in n + 1:
		var a: float = lerpf(SMILE.from, SMILE.to, float(i) / n)
		var c := smile_point(a)
		var t := (smile_point(a + 0.01) - smile_point(a - 0.01)).normalized()
		var u := t.cross(Vector3.BACK).normalized()
		var v := t.cross(u).normalized()
		var pts := []
		for j in ring:
			var ang := TAU * j / ring
			pts.append(c + (u * cos(ang) + v * sin(ang)) * SMILE.tube)
		rings.append(pts)
	for i in n:
		for j in ring:
			var a0: Vector3 = rings[i][j]
			var a1: Vector3 = rings[i][(j + 1) % ring]
			var b0: Vector3 = rings[i + 1][j]
			var b1: Vector3 = rings[i + 1][(j + 1) % ring]
			for p in [a0, b0, a1, a1, b0, b1]:
				st.add_vertex(p)
	st.generate_normals()
	return st.commit()


static func _capsule(r: float, h: float) -> CapsuleMesh:
	var m := CapsuleMesh.new()
	m.radius = r
	m.height = h
	m.radial_segments = 16
	m.rings = 4
	return m


func _pivot(name_: String, at: Vector3) -> Node3D:
	var p := Node3D.new()
	p.position = at
	_body.add_child(p)
	limbs[name_] = p
	return p


func _part(parent: Node3D, mesh: Mesh, mat: Material, at: Vector3, size := Vector3.ONE) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.material_override = mat
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.position = at
	mi.scale = size
	parent.add_child(mi)
	return mi


## One tracking update: feet (Godot frame), height (m), the look (person_avatar_model.look), body joints (PSN | null),
## the time in seconds. The first one places the avatar at once; later ones only move the targets.
func set_target(feet: Vector3, height: float, look: Dictionary, joints: Variant, t: float) -> void:
	if is_nan(_last_t) or t - _last_t > 0.02:
		_last_t = t
		_since = 0.0
		_hist.append([t, feet])
		while _hist.size() > 2 and t - float(_hist[1][0]) >= VEL_WINDOW:
			_hist.pop_front()
		var dt := t - float(_hist[0][0])
		if dt >= VEL_WINDOW - 0.1:  # not before a full baseline: two jittery samples are no speed
			var d: Vector3 = feet - _hist[0][1]
			_vel = Vector2(d.x, -d.z) / dt
	var yaw := AV.yaw(joints, _vel, float(_target.get("yaw", _yaw)))
	_target = {"pos": feet, "height": height, "yaw": yaw, "look": look, "dirs": AV.limb_dirs(joints, yaw)}
	hair_short.visible = look.hair_len != "bald"
	hair_long.visible = look.hair_len == "long"
	if not _placed:
		_placed = true
		_pos = feet
		_height = height
		_yaw = yaw
		_apply_colours(look, 1.0)
		step(0.0)


## Ease toward the targets by `dt` seconds (called every frame).
func step(dt: float) -> void:
	if _target.is_empty():
		return
	_clock += dt
	_since += dt
	var lead := Vector3.ZERO
	if _vel.length() >= AV.WALK_MIN:  # walking: aim where they are now, not where the last snapshot saw them
		lead = Vector3(_vel.x, 0.0, -_vel.y) * minf(_since, LEAD_MAX)
	_pos = _pos.lerp(_target.pos + lead, AV.blend(dt, POS_RATE))
	_height = lerpf(_height, float(_target.height), AV.blend(dt, SIZE_RATE))
	_yaw = lerp_angle(_yaw, float(_target.yaw), AV.blend(dt, YAW_RATE))
	_apply_colours(_target.look, AV.blend(dt, COLOUR_RATE))
	var speed := _vel.length()
	_phase = fmod(_phase + dt * speed / maxf(0.35 * _height, 0.1) * PI, TAU)
	var sw := AV.stride(_phase, speed)
	_body.position = Vector3(0, sw.y, 0)
	_body.scale = Vector3(1, 1.0 + 0.006 * sin(_clock * 2.2), 1)  # breathing
	var dirs: Dictionary = _target.dirs
	for k in limbs:
		var want: Basis
		if dirs.has(k):
			want = AV.hang_toward(dirs[k])
		else:
			var swing: float = sw.x * (1.0 if k in ["arm_l", "leg_r"] else -1.0)
			var out := 0.12 if k == "arm_l" else -0.12 if k == "arm_r" else 0.0  # arms a little away from the body
			want = Basis(Vector3.RIGHT, swing) * Basis(Vector3.BACK, out)
		var p: Node3D = limbs[k]
		p.basis = Basis(p.basis.get_rotation_quaternion().slerp(want.get_rotation_quaternion(), AV.blend(dt, LIMB_RATE)))
	transform = Transform3D(Basis(Vector3.UP, _yaw).scaled(Vector3.ONE * (_height / UNIT_TOP)), _pos)


func _process(delta: float) -> void:
	step(delta)


func _apply_colours(look: Dictionary, k: float) -> void:
	var want := {"top": look.top, "bottom": look.bottom, "skin": look.skin, "hair": look.hair, "shoes": look.shoes,
		"blush": (look.skin as Color).lerp(Color(1.0, 0.45, 0.5), 0.45)}
	for key in want:
		var c: Color = (want[key] as Color) if k >= 1.0 or not _colours.has(key) else (_colours[key] as Color).lerp(want[key], k)
		_colours[key] = c
		(mats[key] as ShaderMaterial).set_shader_parameter("albedo", c)


## WO-1087: a floating label over the head ("" hides it) — a test puppet person says it is one.
func set_tag(text: String) -> void:
	if tag == null and text != "":
		tag = Label3D.new()
		tag.billboard = BaseMaterial3D.BILLBOARD_ENABLED
		tag.position = Vector3(0, UNIT_TOP + 0.13, 0)
		tag.pixel_size = 0.002
		tag.font_size = 48
		tag.outline_size = 14
		tag.modulate = Color(1.0, 0.8, 0.25)
		tag.outline_modulate = Color(0.08, 0.06, 0.04)
		add_child(tag)
	if tag != null and tag.text != text:
		tag.text = text
		tag.visible = text != ""


## What the avatar shows now (tests): {top, bottom, skin, hair, shoes, blush: Color}, height, yaw, position.
func shown() -> Dictionary:
	return {"colours": _colours.duplicate(), "height": _height, "yaw": _yaw, "pos": _pos}
