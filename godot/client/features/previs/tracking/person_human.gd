extends Node3D
## WO-1103 — a test puppet as a realistic human (Tracking → Markers → Test people → Look: Woman / Man / Mixed): a
## Microsoft Rocketbox avatar (human_body.gd) at the puppet's floor point, scaled to its height, moved by motion-capture
## clips (human_motion.gd: idle, walks blended by speed with the cycle rate locked to the ground speed — no sliding
## feet —, standing turns). The same interface as the pebble avatar (person_avatar.gd), so the people layer
## (person_avatars.gd) drives either: set_target per snapshot, step per frame, set_tag, shown(). Puppets only — a
## camera person never gets a body from here, and nothing about the body comes from a camera: the body is the
## operator's Look choice.
##
## Lit like the rest of the stage (person_human.gdshaderinc): no glow with the house lights on, only the small
## readability floor when they are down; casts shadows where the quality level has spot shadows (High / Ultra).

const Body := preload("res://features/previs/tracking/human_body.gd")
const Motion := preload("res://features/previs/tracking/human_motion.gd")
const AV := preload("res://features/previs/tracking/person_avatar_model.gd")

const POS_RATE := 8.0  # 1/s — as person_avatar.gd: the floor point follows the tracked point
const SIZE_RATE := 3.0
const YAW_RATE := 3.0  # 1/s — walking: the body turns into its path
const VEL_RATE := 5.0  # 1/s — the walking speed the clips follow (from where the body really is)
const LEAD_MAX := 0.15
const VEL_WINDOW := 0.6

var body := ""
var tag: Label3D
var motion := Motion.new()
var _root: Node3D
var _sk: Skeleton3D
var _model_h := 1.7
var _toes := []  # the toe bones (shown(): the drawn feet)
var _sk_space := Transform3D.IDENTITY  # skeleton → model root (an own model's skeleton sits deeper)
var _target := {}
var _pos := Vector3.ZERO
var _height := 1.7
var _yaw := 0.0
var _heading := NAN  # Godot yaw the puppet faces when it stands (the server's heading), NAN unknown
var _vel := Vector2.ZERO  # PSN m/s over VEL_WINDOW (facing while walking)
var _rv := Vector3.ZERO  # Godot m/s of the drawn body
var _hist := []
var _last_t := NAN
var _since := 0.0
var _placed := false


## A human node for `body_` ("woman" / "man"); ok() false if its files are missing (the layer then keeps a pebble).
func _init(body_ := "woman") -> void:
	body = body_
	var inst := Body.instance(body_)
	if inst.is_empty():
		return
	_root = inst.root
	_sk = inst.skeleton
	_model_h = float(inst.height)
	_toes = inst.toes
	var n: Node = _sk
	while n != null and n != _root:
		_sk_space = (n as Node3D).transform * _sk_space if n is Node3D else _sk_space
		n = n.get_parent()
	add_child(_root)
	if not motion.setup(_root, inst.moves):
		_root.free()
		_root = null


## The people layer: does a card with this body get a human node? (woman / man / own:<slug>, and only if it loads)
static func wants(body_: Variant) -> bool:
	return Body.is_body(str(body_)) and Body.available(str(body_))


func ok() -> bool:
	return _root != null


## Where the puppet faces when it stands (PSN heading, rad: atan2(y, x)), or null.
func set_heading(h: Variant) -> void:
	_heading = atan2(cos(float(h)), -sin(float(h))) if (h is float or h is int) else NAN


## One tracking update (as person_avatar.gd): feet (Godot), height (m), look (unused: the avatar has its own), joints
## (unused: puppets have none), the time in seconds.
func set_target(feet: Vector3, height: float, _look: Dictionary, _joints: Variant, t: float) -> void:
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
	if not _placed:
		_placed = true
		_pos = feet
		_height = height
		_yaw = yaw
		step(0.0)


## Ease toward the targets by `dt` seconds and play the moves (every frame).
func step(dt: float) -> void:
	if _target.is_empty() or _root == null:
		return
	_since += dt
	var lead := Vector3.ZERO
	if _vel.length() >= AV.WALK_MIN:
		lead = Vector3(_vel.x, 0.0, -_vel.y) * minf(_since, LEAD_MAX)
	var was := _pos
	_pos = _pos.lerp(_target.pos + lead, AV.blend(dt, POS_RATE))
	_height = lerpf(_height, float(_target.height), AV.blend(dt, SIZE_RATE))
	if dt > 0.0:
		_rv = _rv.lerp((_pos - was) / dt, AV.blend(dt, VEL_RATE))
	var s := _height / _model_h
	var speed := Vector2(_rv.x, _rv.z).length() / s
	var err := angle_difference(_yaw, float(_target.yaw))
	_yaw += motion.update(dt, speed, err)
	if not motion.turning() and motion.move > 0.05:  # walking: turn into the path
		_yaw = lerp_angle(_yaw, float(_target.yaw), AV.blend(dt, YAW_RATE * motion.move))
	transform = Transform3D(Basis(Vector3.UP, _yaw).scaled(Vector3.ONE * s), _pos)


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


## What the puppet shows now (tests, avatar_probe.gd): body, height, yaw, position, walk (0 idle … 1 walking),
## cadence (cycles / s), turning, the drawn feet (global: the toes' floor points, the probe checks they stay put).
func shown() -> Dictionary:
	var feet := []
	if _sk != null:
		for n in _toes:
			var b := _sk.find_bone(n)
			feet.append(_sk.global_transform * _sk.get_bone_global_pose(b).origin if _sk.is_inside_tree() else transform * _root.transform * _bone_global(b).origin)
	var s := _height / _model_h
	var sp := Vector2(_rv.x, _rv.z).length() / s
	return {"body": body, "height": _height, "yaw": _yaw, "pos": _pos, "walk": motion.move, "feet": feet,
		"cadence": motion.cadence(maxf(sp, 0.05)) if motion.tree != null else 0.0, "turning": motion.turning(), "colours": {}}


## A bone's skeleton-space transform from its local poses (outside the tree the skeleton does not update its globals).
func _bone_global(b: int) -> Transform3D:
	var tr := _sk.get_bone_pose(b)
	var p := _sk.get_bone_parent(b)
	while p >= 0:
		tr = _sk.get_bone_pose(p) * tr
		p = _sk.get_bone_parent(p)
	return _sk_space * tr
