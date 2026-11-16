extends RefCounted
## WO-1103 — bends a human puppet's skeleton (MPFB "game_engine" rig: human_body.gd) onto its feet (human_gait_model.gd)
## every frame, procedurally: no animation clips (none ship under a licence we could use, and clips slide on a body that
## walks at whatever speed the tracker says). Global rotations are built per bone as a change of its rest frame
## (G = D · G_rest) and turned into the bone's local pose against its parent's new frame.
##  - Legs: analytic two-bone IK from the hip to the ankle, the knee toward where the foot points. A planted foot is a
##    fixed point under the ball of the foot: when the hip runs away from it the heel rises (rolling on the ball), and the
##    pelvis drops only as far as the legs need (reach limit) — the bob of a walk falls out of that.
##  - Pelvis: sways over the standing foot, turns with the stride, drops on the swinging side; the spine turns back so
##    the shoulders stay square, leans a little into the walk; the head stays level and looks where the body goes.
##  - Arms hang (out of the rig's A-pose), swing against the legs, the elbows soften; fingers rest a little curled.
##  - Standing: slow breathing, a slight weight shift, small head movements.

const AXIS_X := Vector3(1, 0, 0)
const MAX_DROP := 0.09  # m — the pelvis never sinks more than this below its standing height
const REACH := 0.985  # × leg length: a knee is never quite straight
const HEEL_MAX := 0.9  # rad — the most a heel lifts (rolling on the ball of the foot)
const ARM_SWING := 0.3  # rad at a full stride
const FINGER_CURL := [0.18, 0.28, 0.22]  # rad per finger joint (01, 02, 03)
const BONES := ["Root", "pelvis", "spine_01", "spine_02", "spine_03", "neck_01", "head", "clavicle_l", "upperarm_l",
	"lowerarm_l", "hand_l", "clavicle_r", "upperarm_r", "lowerarm_r", "hand_r", "thigh_l", "calf_l", "foot_l", "ball_l",
	"thigh_r", "calf_r", "foot_r", "ball_r"]

var ok := false
var dims := {}  # model metres: height, ball_z, ball_h, stance_x, walk_x, pelvis_y, leg (thigh + calf)
var _b := {}  # name → bone index
var _rg := {}  # name → global rest Transform3D (skeleton space)
var _rl := {}  # name → local rest Transform3D
var _par := {}  # name → parent name ("" for Root)
var _leg := {}  # side "l"/"r" → {l1, l2, ankle_ball (ankle − ball, rest), heel_ball, yaw0, thigh_f, calf_f}
var _arm := {}  # side → {u, l} rest directions
var _g := {}  # this frame: name → global Transform3D
var _sway := 0.0
var _drop := 0.0


## Reads the rest skeleton. false (and ok false) if a bone the pose needs is missing.
func setup(sk: Skeleton3D, height: float) -> bool:
	for n in BONES:
		var i := sk.find_bone(n)
		if i < 0:
			push_warning("[human_pose] bone %s missing" % n)
			return false
		_b[n] = i
		_rg[n] = sk.get_bone_global_rest(i)
		_rl[n] = sk.get_bone_rest(i)
		var p := sk.get_bone_parent(i)
		_par[n] = sk.get_bone_name(p) if p >= 0 else ""
	for sd in ["l", "r"]:
		var hip: Vector3 = _o("thigh_" + sd)
		var knee: Vector3 = _o("calf_" + sd)
		var ankle: Vector3 = _o("foot_" + sd)
		var ball: Vector3 = _o("ball_" + sd)
		var heel := Vector3(ankle.x, 0.0, ankle.z - 0.06)
		_leg[sd] = {"l1": hip.distance_to(knee), "l2": knee.distance_to(ankle), "ankle_ball": ankle - ball, "heel_ball": heel - ball,
			"heel_ankle": ankle - heel, "yaw0": atan2(ball.x - ankle.x, ball.z - ankle.z)}
		_arm[sd] = {"u": (_o("lowerarm_" + sd) - _o("upperarm_" + sd)).normalized(), "l": (_o("hand_" + sd) - _o("lowerarm_" + sd)).normalized()}
	var b: Vector3 = _o("ball_l")
	dims = {"height": height, "ball_z": b.z - _o("pelvis").z, "ball_h": b.y, "stance_x": 0.1, "walk_x": 0.085,
		"pelvis_y": _o("pelvis").y, "leg": float(_leg.l.l1) + float(_leg.l.l2)}
	_curl_fingers(sk)
	ok = true
	return true


## One frame. `inv`: the layer's space → the skeleton's. `feet`: human_gait_model.foot(0 / 1). `st`: {yaw (layer),
## walk (0…1 how much of a walk), clock (s), dt (s), look (rad, head turn), stride (model m: step length)}. Returns the
## planted feet's heel lift [left, right] (the gait starts the next swing from it).
func apply(sk: Skeleton3D, inv: Transform3D, feet: Array, st: Dictionary) -> Array:
	var k := float(st.walk)
	var clock := float(st.clock)
	var ft := []
	for i in 2:
		var f: Dictionary = feet[i]
		var ball: Vector3 = inv * (f.ball as Vector3)
		ball.y += float(dims.ball_h)
		ft.append({"ball": ball, "yaw": angle_difference(float(st.yaw), float(f.yaw)), "air": f.air, "pitch": float(f.pitch), "u": float(f.u)})
	var fl: Dictionary = ft[0]
	var fr: Dictionary = ft[1]
	# pelvis: sway over the standing foot, turn with the stride, drop on the swinging side
	var bl: Vector3 = fl.ball
	var br: Vector3 = fr.ball
	var stance_x := (bl.x + br.x) * 0.5
	if fl.air != fr.air:
		stance_x = br.x if fl.air else bl.x
	var idle := 1.0 - k
	_sway = lerpf(_sway, clampf(stance_x * 0.32, -0.035, 0.035) + idle * 0.012 * sin(clock * 0.7), clampf(float(st.dt) * 5.0, 0.0, 1.0))
	var twist := clampf(-(bl.z - br.z) * 0.16, -0.11, 0.11)
	var roll := 0.0
	for i in 2:
		if ft[i].air:
			roll -= (1.0 if i == 0 else -1.0) * 0.045 * k * sin(PI * float(ft[i].u))
	var dp := Basis(Vector3.UP, twist) * Basis(Vector3.BACK, roll)
	var pb: Basis = dp * (_rg.pelvis as Transform3D).basis
	var po: Vector3 = (_rg.pelvis as Transform3D).origin
	var want_y := float(dims.pelvis_y) - k * 0.02 + idle * 0.004 * sin(clock * 1.3)
	# heel lift for a foot left behind, then the pelvis height the legs reach
	var hips := []
	for i in 2:
		var sd := "l" if i == 0 else "r"
		hips.append(pb * ((_rg["thigh_" + sd] as Transform3D).origin - po))
		if not ft[i].air:
			var behind := (po.z + float(hips[i].z)) - (float(ft[i].ball.z) + float(_leg[sd].ankle_ball.z))
			ft[i].pitch = clampf((behind - 0.1) / 0.3, 0.0, 1.0) * 0.45 * k
			# a foot left behind rolls onto its ball before the pelvis sinks much (toe-off)
			while behind > 0.0 and ft[i].pitch < HEEL_MAX and _reach_y(ft[i], hips[i], sd, po, _sway) < want_y - 0.025:
				ft[i].pitch += 0.05
	var y := want_y
	for i in 2:
		y = minf(y, _reach_y(ft[i], hips[i], "l" if i == 0 else "r", po, _sway))
	y = maxf(y, want_y - MAX_DROP)
	for i in 2:  # still too far: the heel rolls up further (planted feet only)
		var sd := "l" if i == 0 else "r"
		while not ft[i].air and ft[i].pitch < HEEL_MAX and _reach_y(ft[i], hips[i], sd, po, _sway) < y:
			ft[i].pitch += 0.05
	var porig := Vector3(_sway, y, po.z)
	_g.clear()
	_g.Root = _rg.Root
	_g.pelvis = Transform3D(pb, porig)
	# spine, neck, head (global turns about the model's own axes)
	var lean := k * 0.07
	var breath := idle * 0.012 * sin(clock * 1.5)
	var look := float(st.get("look", 0.0))
	_put("spine_01", Basis(Vector3.UP, twist * 0.5) * Basis(AXIS_X, lean * 0.4))
	_put("spine_02", Basis(Vector3.UP, -twist * 0.2) * Basis(AXIS_X, lean * 0.7 + breath * 0.5))
	_put("spine_03", Basis(Vector3.UP, -twist * 0.65) * Basis(AXIS_X, lean + breath))
	_put("neck_01", Basis(Vector3.UP, -twist * 0.3 + look * 0.4) * Basis(AXIS_X, lean * 0.4))
	_put("head", Basis(Vector3.UP, look) * Basis(AXIS_X, lean * 0.15 + idle * 0.02 * sin(clock * 0.37)))
	# arms against the legs
	var chest: Basis = Basis(Vector3.UP, -twist * 0.65) * Basis(AXIS_X, lean + breath)
	var stride := maxf(float(st.get("stride", 0.5)), 0.2)
	for i in 2:
		var sd := "l" if i == 0 else "r"
		var side := 1.0 if i == 0 else -1.0
		var opp: Dictionary = ft[1 - i]
		var mine: Dictionary = ft[i]
		var a := ARM_SWING * k * clampf((float(opp.ball.z) - float(mine.ball.z)) / stride, -1.0, 1.0) + idle * 0.015 * sin(clock * 0.9 + side)
		_put("clavicle_" + sd, null)
		var u := Basis(chest * AXIS_X, -a) * (chest * Vector3(side * 0.13, -1.0, -0.04).normalized())
		var e := 0.22 + k * (0.1 + 0.6 * maxf(a, 0.0))
		var bend := _orth(chest * Vector3(-side * 0.3, 0.0, 1.0), u)
		var l := (u * cos(e) + bend * sin(e)).normalized()
		var ar: Dictionary = _arm[sd]
		_put("upperarm_" + sd, _frame(u, _orth(l, u)) * _frame(ar.u, _orth(ar.l, ar.u)).inverse())
		_put("lowerarm_" + sd, _frame(l, _orth(-u, l)) * _frame(ar.l, _orth(-ar.u, ar.l)).inverse())
		_put("hand_" + sd, null)
	# legs
	var lifts := []
	for i in 2:
		var sd := "l" if i == 0 else "r"
		lifts.append(_leg_ik(ft[i], sd))
	_write(sk)
	return lifts


## The highest pelvis y (pelvis origin) at which foot `f`'s ankle is still in reach.
func _reach_y(f: Dictionary, hip_off: Vector3, sd: String, po: Vector3, sway: float) -> float:
	var ankle := _ankle(f, sd)
	var hip := Vector3(sway, 0.0, po.z) + hip_off
	var r := REACH * float(dims.leg)
	var h := Vector2(hip.x - ankle.x, hip.z - ankle.z).length()
	if h >= r:
		return -INF
	return ankle.y + sqrt(r * r - h * h) - hip_off.y


## Ankle point for a foot (ball on the floor, yaw relative to the body, pitch: + rolls up on the ball, − on the heel).
func _ankle(f: Dictionary, sd: String) -> Vector3:
	var lg: Dictionary = _leg[sd]
	var r0 := Basis(Vector3.UP, float(f.yaw) - float(lg.yaw0))
	var d := _foot_turn(f, sd)
	if float(f.pitch) >= 0.0:
		return (f.ball as Vector3) + d * (lg.ankle_ball as Vector3)
	var heel: Vector3 = (f.ball as Vector3) + r0 * (lg.heel_ball as Vector3)
	return heel + d * (lg.heel_ankle as Vector3)


## The foot's change from rest: turned to its yaw, then pitched about its own left–right axis.
func _foot_turn(f: Dictionary, sd: String) -> Basis:
	var r0 := Basis(Vector3.UP, float(f.yaw) - float(_leg[sd].yaw0))
	var lat := Basis(Vector3.UP, float(f.yaw)) * AXIS_X
	return Basis(lat, float(f.pitch)) * r0


## Thigh + calf onto the ankle point, the knee toward where the foot points; the foot turned and pitched, the toes flat
## on the floor while the heel is up. Returns the foot's pitch.
func _leg_ik(f: Dictionary, sd: String) -> float:
	var lg: Dictionary = _leg[sd]
	_put("thigh_" + sd, Basis())  # placed first for the hip point
	var hip: Vector3 = (_g["thigh_" + sd] as Transform3D).origin
	var ankle := _ankle(f, sd)
	var l1 := float(lg.l1)
	var l2 := float(lg.l2)
	var to := ankle - hip
	var dist := clampf(to.length(), absf(l1 - l2) + 0.001, l1 + l2 - 0.0005)
	var dir := to.normalized()
	var side := 1.0 if sd == "l" else -1.0
	var pole := (Basis(Vector3.UP, float(f.yaw) * 0.6) * Vector3(side * 0.08, 0.0, 1.0)).normalized()
	var pp := _orth(pole, dir)
	var a := (l1 * l1 - l2 * l2 + dist * dist) / (2.0 * dist)
	var knee := hip + dir * a + pp * sqrt(maxf(l1 * l1 - a * a, 0.0))
	var t_dir := (knee - hip).normalized()
	var c_dir := (hip + dir * dist - knee).normalized()
	var thigh_r: Vector3 = ((_rg["calf_" + sd] as Transform3D).origin - (_rg["thigh_" + sd] as Transform3D).origin).normalized()
	var calf_r: Vector3 = ((_rg["foot_" + sd] as Transform3D).origin - (_rg["calf_" + sd] as Transform3D).origin).normalized()
	var fwd := Vector3.BACK
	_put("thigh_" + sd, _frame(t_dir, _orth(pp, t_dir)) * _frame(thigh_r, _orth(fwd, thigh_r)).inverse())
	_put("calf_" + sd, _frame(c_dir, _orth(pp, c_dir)) * _frame(calf_r, _orth(fwd, calf_r)).inverse())
	var d := _foot_turn(f, sd)
	_put("foot_" + sd, d)
	var flat := Basis(Vector3.UP, float(f.yaw) - float(lg.yaw0))
	_put("ball_" + sd, flat if float(f.pitch) > 0.0 and not f.air else d)
	return float(f.pitch)


## Bone `n`'s global this frame: its parent's (already placed) × its rest offset, turned by `d` (a change of its rest
## frame in model axes) — or, with d null, carried by its parent unchanged.
func _put(n: String, d: Variant) -> void:
	var par: Transform3D = _g[_par[n]]
	var rl: Transform3D = _rl[n]
	var o := par * rl.origin
	var bas: Basis = par.basis * rl.basis if d == null else (d as Basis) * (_rg[n] as Transform3D).basis
	_g[n] = Transform3D(bas, o)


func _write(sk: Skeleton3D) -> void:
	for n in BONES:
		if n == "Root" or not _g.has(n):
			continue
		var par: Transform3D = _g[_par[n]]
		var local := par.affine_inverse() * (_g[n] as Transform3D)
		sk.set_bone_pose_rotation(_b[n], local.basis.get_rotation_quaternion())
		if n == "pelvis":
			sk.set_bone_pose_position(_b[n], local.origin)


func _curl_fingers(sk: Skeleton3D) -> void:
	for sd in ["l", "r"]:
		for f in ["index", "middle", "ring", "pinky"]:
			for j in 3:
				var i := sk.find_bone("%s_%02d_%s" % [f, j + 1, sd])
				if i >= 0:
					var q := sk.get_bone_rest(i).basis.get_rotation_quaternion()
					sk.set_bone_pose_rotation(i, q * Quaternion(AXIS_X, FINGER_CURL[j]))


func _o(n: String) -> Vector3:
	return (_rg[n] as Transform3D).origin


## Orthonormal frame: y along `y`, z along `f` (made perpendicular), x = y × z.
static func _frame(y: Vector3, f: Vector3) -> Basis:
	var yy := y.normalized()
	var zz := _orth(f, yy)
	return Basis(yy.cross(zz), yy, zz)


## `v` made perpendicular to unit `n`, normalised (a fallback when they are parallel).
static func _orth(v: Vector3, n: Vector3) -> Vector3:
	var w := v - n * v.dot(n)
	if w.length_squared() < 1e-8:
		w = Vector3.BACK - n * n.z if absf(n.z) < 0.9 else AXIS_X - n * n.x
	return w.normalized()
