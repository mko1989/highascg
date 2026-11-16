extends Node3D
## WO-1103 — a test puppet as a realistic human (Tracking → Markers → Test people → Look: Woman / Man / Mixed): the
## MakeHuman CC0 body (human_body.gd) at the puppet's floor point, scaled to its height, walking on planted feet
## (human_gait_model.gd + human_pose.gd: no sliding, cadence and step length from the speed, turning on the spot in
## small steps, idle breathing and weight shift when it stands). The same interface as the pebble avatar
## (person_avatar.gd), so the people layer (person_avatars.gd) drives either: set_target per snapshot, step per frame,
## set_tag, shown(). Puppets only — a camera person never gets a body from here, and nothing about the body comes from a
## camera: the body is the operator's Look choice, the skin tone the puppet's own random look.
##
## Lit like the rest of the stage (person_human.gdshaderinc): no glow with the house lights on, only the small
## readability floor when they are down; casts shadows where the quality level has spot shadows (High / Ultra). Two
## levels of detail switch by distance (LOD0 nearer on higher quality levels).

const Body := preload("res://features/previs/tracking/human_body.gd")
const Gait := preload("res://features/previs/tracking/human_gait_model.gd")
const Pose := preload("res://features/previs/tracking/human_pose.gd")
const AV := preload("res://features/previs/tracking/person_avatar_model.gd")
const PQ := preload("res://features/previs/previs_quality.gd")

const POS_RATE := 8.0  # 1/s — as person_avatar.gd: the floor point follows the tracked point
const SIZE_RATE := 3.0
const YAW_RATE := 3.5  # a body turns a little slower than the pebble
const VEL_RATE := 5.0  # 1/s — the walking speed the steps follow (from where the body really is)
const LEAD_MAX := 0.15
const VEL_WINDOW := 0.6
const LOD0_M := [7.0, 10.0, 14.0, 20.0]  # m — LOD0 (full mesh) nearer than this, per quality level (Low … Ultra)
const BOUNDS := AABB(Vector3(-0.7, -0.05, -0.7), Vector3(1.4, 2.15, 1.4))  # the moving body's bounds (model m)

var body := ""
var tone := ""
var tag: Label3D
var _root: Node3D
var _sk: Skeleton3D
var _lod := {"lod0": [], "lod1": []}
var _pose := Pose.new()
var _gait := Gait.new()
var _model_h := 1.7
var _target := {}
var _pos := Vector3.ZERO
var _height := 1.7
var _yaw := 0.0
var _heading := NAN  # Godot yaw the puppet faces when it stands (the server's heading), NAN unknown
var _vel := Vector2.ZERO  # PSN m/s over VEL_WINDOW (facing while walking)
var _rv := Vector3.ZERO  # Godot m/s of the drawn body (the steps)
var _hist := []
var _last_t := NAN
var _since := 0.0
var _clock := 0.0
var _placed := false
var _walk := 0.0


## A human node for `body_` ("woman" / "man"); ok() false if its files are missing (the layer then keeps a pebble).
func _init(body_ := "woman", tone_ := "light") -> void:
	body = body_
	var inst := Body.instance(body_, tone_)
	if inst.is_empty():
		return
	tone = tone_
	_root = inst.root
	_sk = inst.skeleton
	_model_h = float(inst.height)
	_lod = {"lod0": inst.lod0, "lod1": inst.lod1}
	add_child(_root)
	for mi: MeshInstance3D in inst.lod0 + inst.lod1:
		mi.custom_aabb = BOUNDS
	if not _pose.setup(_sk, _model_h):
		_root.free()
		_root = null
		return
	PQ.shared().changed.connect(_quality)
	_quality(int(PQ.shared().level))


## The people layer: does a card with this body get a human node? (only woman / man, and only if the files load)
static func wants(body_: Variant) -> bool:
	return str(body_) in Body.BODIES and Body.available(str(body_))


func ok() -> bool:
	return _root != null


## LOD0 nearer than LOD0_M of the level, LOD1 beyond (the same bounds on every part: they all switch together).
func _quality(level: int) -> void:
	var d: float = LOD0_M[clampi(level, 0, LOD0_M.size() - 1)]
	for mi: MeshInstance3D in _lod.lod0:
		mi.visibility_range_end = d
	for mi: MeshInstance3D in _lod.lod1:
		mi.visibility_range_begin = d


## The puppet's skin tone from its look (light / mid / dark); a new tone swaps the skin material only.
func set_tone(t: String) -> void:
	if t == tone or _root == null:
		return
	tone = t
	for mi: MeshInstance3D in _lod.lod0 + _lod.lod1:
		if Body.part_of(mi) == "skin":
			mi.material_override = Body.material(body, "skin", t)


## Where the puppet faces when it stands (PSN heading, rad: atan2(y, x)), or null.
func set_heading(h: Variant) -> void:
	_heading = atan2(cos(float(h)), -sin(float(h))) if (h is float or h is int) else NAN


## One tracking update (as person_avatar.gd): feet (Godot), height (m), look (person_avatar_model.look), joints (unused:
## puppets have none), the time in seconds.
func set_target(feet: Vector3, height: float, look: Dictionary, _joints: Variant, t: float) -> void:
	if is_nan(_last_t) or t - _last_t > 0.02:
		_last_t = t
		_since = 0.0
		_hist.append([t, feet])
		while _hist.size() > 2 and t - float(_hist[1][0]) >= VEL_WINDOW:
			_hist.pop_front()
		var dt := t - float(_hist[0][0])
		if dt >= VEL_WINDOW - 0.1:
			var d: Vector3 = feet - _hist[0][1]
			_vel = Vector2(d.x, -d.z) / dt
	var yaw := AV.yaw(null, _vel, float(_target.get("yaw", _yaw)))
	if _vel.length() < AV.WALK_MIN and not is_nan(_heading):
		yaw = _heading
	_target = {"pos": feet, "height": height, "yaw": yaw}
	set_tone(Body.tone_for(look.get("skin")))
	if not _placed:
		_placed = true
		_pos = feet
		_height = height
		_yaw = yaw
		step(0.0)


## Ease toward the targets by `dt` seconds and pose the body (every frame).
func step(dt: float) -> void:
	if _target.is_empty() or _root == null:
		return
	_clock += dt
	_since += dt
	var lead := Vector3.ZERO
	if _vel.length() >= AV.WALK_MIN:
		lead = Vector3(_vel.x, 0.0, -_vel.y) * minf(_since, LEAD_MAX)
	var was := _pos
	_pos = _pos.lerp(_target.pos + lead, AV.blend(dt, POS_RATE))
	_height = lerpf(_height, float(_target.height), AV.blend(dt, SIZE_RATE))
	_yaw = lerp_angle(_yaw, float(_target.yaw), AV.blend(dt, YAW_RATE))
	if dt > 0.0:
		_rv = _rv.lerp((_pos - was) / dt, AV.blend(dt, VEL_RATE))
	var s := _height / _model_h
	transform = Transform3D(Basis(Vector3.UP, _yaw).scaled(Vector3.ONE * s), _pos)
	var dims: Dictionary = _pose.dims
	_gait.update(dt, _pos, _yaw, float(_target.yaw), _rv, s, dims)
	var speed := Vector2(_rv.x, _rv.z).length() / s
	_walk = lerpf(_walk, clampf((speed - 0.1) / 0.6, 0.0, 1.0), AV.blend(dt, 4.0))
	var look := clampf(angle_difference(_yaw, float(_target.yaw)), -0.5, 0.5) * 0.6
	var st := {"yaw": _yaw, "walk": _walk, "clock": _clock, "dt": dt, "look": look,
		"stride": Gait.step_length(maxf(speed, 0.3), float(dims.height), 1.0)}
	var lifts := _pose.apply(_sk, transform.affine_inverse(), [_gait.foot(0, s), _gait.foot(1, s)], st)
	for i in 2:
		_gait.set_pitch(i, float(lifts[i]))


func _process(delta: float) -> void:
	step(delta)


## WO-1087: the floating "TEST puppet n" over the head ("" hides it).
func set_tag(text: String) -> void:
	if tag == null and text != "":
		tag = Label3D.new()
		tag.billboard = BaseMaterial3D.BILLBOARD_ENABLED
		tag.position = Vector3(0, _model_h + 0.15, 0)
		tag.pixel_size = 0.002
		tag.font_size = 48
		tag.outline_size = 14
		tag.modulate = Color(1.0, 0.8, 0.25)
		tag.outline_modulate = Color(0.08, 0.06, 0.04)
		add_child(tag)
	if tag != null and tag.text != text:
		tag.text = text
		tag.visible = text != ""


## What the puppet shows now (tests, avatar_probe.gd): body, tone, height, yaw, position, feet (planted / in the air).
func shown() -> Dictionary:
	var feet := []
	for i in 2:
		var f: Dictionary = _gait.feet[i]
		feet.append({"at": f.get("at"), "air": f.get("air", false), "yaw": f.get("yaw")})
	return {"body": body, "tone": tone, "height": _height, "yaw": _yaw, "pos": _pos, "walk": _walk, "feet": feet, "colours": {}}
