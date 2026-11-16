extends RefCounted
## WO-1103 — where a human puppet's feet are (person_human.gd; human_pose.gd bends the body onto them). No animation
## clips: the feet are PLANTED in the layer's space and only move when a step lifts them, so a foot on the floor can not
## slide whatever the body does. Walking, the rear foot lifts every step time T and lands LAND_AHEAD of where the body
## will be by then (step length and cadence from the speed and the body's height, like people: longer and quicker
## steps when faster); standing, a foot that is off its idle spot (the body stopped, turned on the spot, was nudged)
## takes a short adjusting step, one foot at a time, never more than TURN_STEP per step.
##
## Units: the layer's metres; `s` = the body's scale (puppet height / model height) — dims (human_pose.dims) are in the
## model's metres. Yaw as person_avatar.gd: Basis(Vector3.UP, yaw) turns the model's front (+Z) to face that way.
## Feet: 0 = left, 1 = right.

const V_STAND := 0.12  # m/s (per model metre) — slower is standing: feet re-plant only when off their spots
const SWING := 0.8  # share of a step's time the lifted foot is in the air (the rest: both feet down)
const LAND_AHEAD := 0.5  # × step length: a foot lands this far ahead of the body (heel strike; it lifts ~0.7 behind)
const MIN_CADENCE := 1.3  # steps/s — slow walking shortens the steps instead of slowing to a shuffle
const STEP_H := [0.15, 0.18]  # step length = height × (a + b × speed)
const SPLAY := 0.1  # rad — toes turned out
const ADJUST_M := 0.07  # m — a standing foot this far off its spot takes a step
const ADJUST_RAD := 0.45  # rad — … or turned this far off
const ADJUST_S := 0.42  # s — an adjusting step's time in the air
const TURN_STEP := 0.75  # rad — at most this much turn per step
const LIFT := {"walk": 0.055, "adjust": 0.025}  # m — the ball of the foot's highest point in a swing
const TOE_UP := 0.22  # rad — the toes up just before a walking foot lands (heel first)
const REPLANT_M := 1.2  # m — the body this far from its feet (a jump): both feet are set down under it at once

## {at: Vector3 (floor point under the ball of the foot), yaw, air: bool, from, from_yaw, to, to_yaw, u (0…1 through the
## swing), dur (s, the swing's time at the current speed), lift, pitch (the pose writes it: the heel lift the foot had,
## so a swing starts from it), walk: bool}
var feet := [{}, {}]
var since_land := 9.0
var _next := 0


## The floor point under the ball of foot `i` when standing at `pos` facing `yaw`.
static func spot(i: int, pos: Vector3, yaw: float, s: float, dims: Dictionary, half_width: float) -> Vector3:
	var side := 1.0 if i == 0 else -1.0
	return pos + Basis(Vector3.UP, yaw) * (Vector3(side * half_width, 0.0, float(dims.ball_z)) * s)


## Step length (layer m) at `speed` (layer m/s) for a body `height_m` tall (model m) at scale `s`.
static func step_length(speed: float, height_m: float, s: float) -> float:
	var v := speed / maxf(s, 0.01)
	return s * minf(height_m * (STEP_H[0] + STEP_H[1] * v), v / MIN_CADENCE)


## A swing's progress 0…1 eased: slow off the floor, fast through, slow onto it.
static func swing_ease(u: float) -> float:
	u = clampf(u, 0.0, 1.0)
	return u * u * u * (u * (u * 6.0 - 15.0) + 10.0)


## How high (× the swing's lift) the ball of the foot is at `u`: up early (the heel already rose), down gently.
static func lift_at(u: float) -> float:
	return sin(PI * pow(clampf(u, 0.0, 1.0), 0.8))


## A walking swing's foot pitch at `u` (+ = heel up / toes down): from the heel lift it left the floor with, to toes up
## before the heel strikes, flat on landing. An adjusting step stays nearly flat.
static func swing_pitch(u: float, from_pitch: float, walk: bool) -> float:
	if not walk:
		return from_pitch * (1.0 - smoothstep(0.0, 0.4, u)) + 0.08 * sin(PI * u)
	var p := lerpf(from_pitch, -TOE_UP, smoothstep(0.0, 0.75, u))
	return lerpf(p, 0.0, smoothstep(0.86, 1.0, u))


## Both feet down at their idle spots (first placement, or after a jump).
func plant(pos: Vector3, yaw: float, s: float, dims: Dictionary) -> void:
	for i in 2:
		var side := 1.0 if i == 0 else -1.0
		feet[i] = {"at": spot(i, pos, yaw, s, dims, float(dims.stance_x)), "yaw": yaw + side * SPLAY, "air": false, "pitch": 0.0,
			"u": 1.0, "dur": 1.0, "lift": 0.0, "walk": false}
	since_land = 9.0


## One frame: the body at `pos` facing `yaw` (wanting `yaw_to`), moving at `vel` (layer m/s, smoothed), scale `s`.
func update(dt: float, pos: Vector3, yaw: float, yaw_to: float, vel: Vector3, s: float, dims: Dictionary) -> void:
	if (feet[0] as Dictionary).is_empty():
		plant(pos, yaw, s, dims)
	var mid: Vector3 = ((feet[0].at as Vector3) + (feet[1].at as Vector3)) * 0.5
	if Vector2(mid.x - pos.x, mid.z - pos.z).length() > REPLANT_M * s:
		plant(pos, yaw, s, dims)
		return
	var flat := Vector3(vel.x, 0.0, vel.z)
	var speed := flat.length()
	var moving := speed > V_STAND * s
	var L := step_length(speed, float(dims.height), s)
	var T := L / speed if moving else 1.0
	since_land += dt
	for i in 2:
		var f: Dictionary = feet[i]
		if not f.air:
			continue
		if f.walk and moving:  # a swing quickens as the body speeds up (the first steps off a standstill)
			f.dur = clampf(SWING * T, 0.26, 0.75)
		f.u = minf(float(f.u) + dt / float(f.dur), 1.0)
		if f.walk and moving:  # keep aiming where the body will be when it lands (it may speed up, slow or turn)
			var left := (1.0 - float(f.u)) * float(f.dur)
			var want := _landing(i, pos + flat * left, yaw, yaw_to, flat / speed, L, s, dims)
			f.to = (f.to as Vector3).lerp(want.at, clampf(dt * 10.0, 0.0, 1.0))
			f.to_yaw = lerp_angle(float(f.to_yaw), float(want.yaw), clampf(dt * 10.0, 0.0, 1.0))
		if float(f.u) >= 1.0:
			f.air = false
			f.at = f.to
			f.yaw = f.to_yaw
			f.pitch = 0.0
			since_land = 0.0
	if feet[0].air or feet[1].air:
		return
	if moving:
		if since_land < (1.0 - SWING) * T:
			return
		var dir := flat / speed
		var i := _rear(pos, dir)
		var dur := clampf(SWING * T, 0.26, 0.75)
		_lift(i, _landing(i, pos + flat * dur, yaw, yaw_to, dir, L, s, dims), dur, true)
		return
	# standing: the foot furthest off its spot steps to it (the other one next, if it still needs to)
	if since_land < 0.12:
		return
	var worst := -1
	var score := 1.0
	for i in 2:
		var side := 1.0 if i == 0 else -1.0
		var off := Vector2((feet[i].at as Vector3).x, (feet[i].at as Vector3).z).distance_to(
			_xz(spot(i, pos, yaw, s, dims, float(dims.stance_x)))) / (ADJUST_M * s)
		var turn := absf(angle_difference(float(feet[i].yaw), yaw + side * SPLAY)) / ADJUST_RAD
		if maxf(off, turn) > score:
			score = maxf(off, turn)
			worst = i
	if worst >= 0:
		var side := 1.0 if worst == 0 else -1.0
		var want_yaw := yaw + side * SPLAY
		var y0 := float(feet[worst].yaw)
		var y1 := y0 + clampf(angle_difference(y0, want_yaw), -TURN_STEP, TURN_STEP)
		_lift(worst, {"at": spot(worst, pos, yaw, s, dims, float(dims.stance_x)), "yaw": y1}, ADJUST_S, false)


## Foot `i` now (for the pose): {ball: Vector3 (the floor point under the ball of the foot, raised by the swing), yaw,
## air, pitch (in the air: the swing's; planted: the heel lift it had), u (0…1 through a swing, 1 planted)}.
func foot(i: int, s: float) -> Dictionary:
	var f: Dictionary = feet[i]
	if not f.air:
		return {"ball": f.at, "yaw": f.yaw, "air": false, "pitch": f.pitch, "u": 1.0}
	var u := float(f.u)
	var e := swing_ease(u)
	var at: Vector3 = (f.from as Vector3).lerp(f.to, e)
	at.y += float(f.lift) * s * lift_at(u)
	return {"ball": at, "yaw": lerp_angle(float(f.from_yaw), float(f.to_yaw), e), "air": true,
		"pitch": swing_pitch(u, float(f.from_pitch), bool(f.walk)), "u": u}


## The pose reports a planted foot's heel lift (a swing starts from it).
func set_pitch(i: int, pitch: float) -> void:
	if not feet[i].air:
		feet[i].pitch = pitch


func _lift(i: int, to: Dictionary, dur: float, walk: bool) -> void:
	var f: Dictionary = feet[i]
	f.air = true
	f.from = f.at
	f.from_yaw = f.yaw
	f.from_pitch = float(f.get("pitch", 0.0))
	f.to = to.at
	f.to_yaw = to.yaw
	f.u = 0.0
	f.dur = dur
	f.walk = walk
	f.lift = LIFT.walk if walk else LIFT.adjust
	_next = 1 - i


## Where foot `i` lands for the body at `body_at` (then) walking along `dir` with steps of `L`.
func _landing(i: int, body_at: Vector3, yaw: float, yaw_to: float, dir: Vector3, L: float, s: float, dims: Dictionary) -> Dictionary:
	var side := 1.0 if i == 0 else -1.0
	var face := yaw + clampf(angle_difference(yaw, yaw_to), -TURN_STEP, TURN_STEP)
	var at := spot(i, body_at, face, s, dims, float(dims.walk_x)) + dir * LAND_AHEAD * L
	var y0 := float(feet[i].yaw)
	return {"at": at, "yaw": y0 + clampf(angle_difference(y0, face + side * SPLAY), -TURN_STEP, TURN_STEP)}


## The foot further back along `dir` (the one that lifts next); level → alternate.
func _rear(pos: Vector3, dir: Vector3) -> int:
	var a := ((feet[0].at as Vector3) - pos).dot(dir)
	var b := ((feet[1].at as Vector3) - pos).dot(dir)
	if absf(a - b) < 0.02:
		return _next
	return 0 if a < b else 1


static func _xz(v: Vector3) -> Vector2:
	return Vector2(v.x, v.z)
