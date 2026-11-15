extends Node3D
## WO-1086 — one tracked person as a "pebble person": our own toy-like avatar, about 4½ heads tall, from Godot primitive
## meshes (no assets): a big round head in skin tone with dot eyes, a small smile and blush dots (the same drawing for
## everyone — never the person's face), a hair cap (short), plus a fall down the back (long), none (bald); a rounded
## capsule body and stubby arms in the top colour with round hands; short legs in the bottom colour, darker shoes.
## Built in a unit frame (feet at y = 0, top of the hair ≈ UNIT_TOP, front +Z, the person's left +X) and scaled to the
## person's height. Matte colours with a little self-light, so they read in a dark venue. No camera texture is bound.
##
## person_avatars.gd feeds set_target() per tracking snapshot (10–15 Hz); step() eases everything per frame (_process),
## so a jittery box never makes a jittery figure.

const AV := preload("res://features/previs/tracking/person_avatar_model.gd")

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
const SELF_LIGHT := 0.35  # emission as a share of the colour
const VEL_WINDOW := 0.6  # s — speed is measured over this baseline, so box jitter never reads as walking

static var _shared := {}  # unit meshes + the face materials, built once

var mats := {}  # top, bottom, skin, hair, shoes, blush → StandardMaterial3D (this avatar's own)
var hair_short: MeshInstance3D
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


func _init() -> void:
	add_child(_body)
	for k in ["top", "bottom", "skin", "hair", "shoes", "blush"]:
		var m := StandardMaterial3D.new()
		m.roughness = 0.85
		m.diffuse_mode = BaseMaterial3D.DIFFUSE_LAMBERT_WRAP
		m.emission_enabled = true
		m.emission_energy_multiplier = SELF_LIGHT
		m.rim_enabled = true
		m.rim = 0.25
		m.rim_tint = 0.6
		mats[k] = m
	_build()
	_apply_colours(AV.look(null), 1.0)


func _build() -> void:
	var s := _meshes()
	for side in [1.0, -1.0]:
		var leg := _pivot("leg_l" if side > 0 else "leg_r", Vector3(0.065 * side, HIP_Y, 0.0))
		_part(leg, s.leg, mats.bottom, Vector3(0, -0.15, 0))
		_part(leg, s.ball, mats.shoes, Vector3(0, -0.295, 0.025), Vector3(0.075, 0.045, 0.11))
		var arm := _pivot("arm_l" if side > 0 else "arm_r", Vector3(SHOULDER.x * side, SHOULDER.y, 0.0))
		_part(arm, s.arm, mats.top, Vector3(0, -0.11, 0))
		_part(arm, s.ball, mats.skin, Vector3(0, -0.245, 0), Vector3.ONE * 0.05)
		_part(_body, s.ball, s.eye, Vector3(0.06 * side, 0.835, 0.162), Vector3(0.024, 0.03, 0.012))
		_part(_body, s.ball, mats.blush, Vector3(0.1 * side, 0.775, 0.137), Vector3(0.028, 0.017, 0.009))
	_part(_body, s.torso, mats.top, Vector3(0, 0.48, 0), Vector3(1, 1, 0.8))
	_part(_body, s.ball, mats.skin, Vector3(0, HEAD_Y, 0), Vector3.ONE * HEAD_R)
	var smile := _part(_body, s.smile, s.mouth, Vector3(0, 0.79, 0.165))
	smile.rotation = Vector3(PI / 2.0, 0, 0)  # the ring faces front; its upper half sinks into the head: a smile
	hair_short = _part(_body, s.ball, mats.hair, Vector3(0, 0.86, -0.02), Vector3(0.185, 0.16, 0.185))
	hair_long = _part(_body, s.long, mats.hair, Vector3(0, 0.72, -0.075), Vector3(1.6, 1, 0.65))


## The shared unit meshes and face materials (one set for every avatar).
static func _meshes() -> Dictionary:
	if not _shared.is_empty():
		return _shared
	var ball := SphereMesh.new()  # radius 1: scaled per part
	ball.radius = 1.0
	ball.height = 2.0
	ball.radial_segments = 24
	ball.rings = 12
	var eye := StandardMaterial3D.new()
	eye.albedo_color = Color(0.11, 0.10, 0.14)
	eye.roughness = 0.3
	var mouth := StandardMaterial3D.new()
	mouth.albedo_color = Color(0.45, 0.17, 0.2)
	var smile := TorusMesh.new()
	smile.inner_radius = 0.024
	smile.outer_radius = 0.04
	smile.rings = 24
	smile.ring_segments = 8
	_shared = {"ball": ball, "eye": eye, "mouth": mouth, "smile": smile, "leg": _capsule(0.058, 0.30),
		"arm": _capsule(0.042, 0.24), "torso": _capsule(0.13, 0.36), "long": _capsule(0.12, 0.34)}
	return _shared


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
	_pos = _pos.lerp(_target.pos, AV.blend(dt, POS_RATE))
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
		var m: StandardMaterial3D = mats[key]
		m.albedo_color = c
		m.emission = c


## What the avatar shows now (tests): {top, bottom, skin, hair, shoes, blush: Color}, height, yaw, position.
func shown() -> Dictionary:
	return {"colours": _colours.duplicate(), "height": _height, "yaw": _yaw, "pos": _pos}
