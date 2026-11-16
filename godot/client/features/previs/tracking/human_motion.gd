extends RefCounted
## WO-1103 — how a human puppet moves: the Rocketbox motion-capture clips its body was baked with (human_body.gd
## `moves`) in an AnimationTree —
##   idle ─────────────────────────────┐
##   walk_slow / walk / walk_fast ─ BlendSpace1D by speed ─ TimeScale ─ Blend2 "move" (idle ↔ walking) ─ OneShot "turn"
##   turn_left/right_60/90 (one at a time) ───────────────────────────────────────────────────────────┘
## No sliding feet: the walks are baked in place (the forward travel out, a 1 s cycle each, all starting on the left
## heel strike, so a blend of two stays in phase), and the cycle rate is locked to the ground speed through the stride
## the clips were recorded with — cycles / s = speed / stride(speed) — so a planted foot moves back exactly as fast as
## the body moves on. Start / stop: the idle ↔ walk blend eases over ~0.25 s; slower than the slow walk, the slow walk
## plays slower (shorter cadence), not a shuffle. Standing turns play a turn clip; its root yaw (baked out of the
## clip, kept as a curve) turns the puppet node, scaled to the turn wanted.

const IDLE_TO_WALK := [0.06, 0.32]  # m/s (model) — the walk blend ramps in between
const MOVE_RATE := 4.5  # 1/s — the idle ↔ walk blend (≈ 0.25 s)
const TURN_MIN := 0.6  # rad — a standing puppet this far off its heading plays a turn
const TURNS := ["turn_left_60", "turn_right_60", "turn_left_90", "turn_right_90"]

var tree: AnimationTree
var walks := []  # [[speed m/s, stride m, name]] slow → fast
var move := 0.0  # 0 idle … 1 walking
var turn := {}  # {name, t, len, scale, from_yaw, curve} while a turn plays
var _sk: Skeleton3D


## Build the tree under `model_root` (the body's root: its "Skeleton3D" child is what the clips move).
func setup(model_root: Node3D, lib: AnimationLibrary) -> bool:
	for n in ["walk_slow", "walk", "walk_fast"]:
		if lib.has_animation(n):
			var a := lib.get_animation(n)
			walks.append([float(a.get_meta("speed", 1.0)), float(a.get_meta("stride", 1.2)), n])
	if walks.is_empty() or not lib.has_animation("idle"):
		return false
	walks.sort_custom(func(a: Array, b: Array) -> bool: return a[0] < b[0])
	_sk = model_root.get_node_or_null("Skeleton3D")
	tree = AnimationTree.new()
	tree.name = "Moves"
	tree.add_animation_library("", lib)
	tree.callback_mode_process = AnimationMixer.ANIMATION_CALLBACK_MODE_PROCESS_MANUAL
	var bt := AnimationNodeBlendTree.new()
	bt.add_node("idle", _anim("idle"))
	var bs := AnimationNodeBlendSpace1D.new()
	bs.sync = true
	bs.min_space = walks[0][0] - 0.01
	bs.max_space = walks[-1][0] + 0.01
	for w: Array in walks:
		bs.add_blend_point(_anim(w[2]), w[0], -1, w[2])
	bt.add_node("walk", bs)
	bt.add_node("ts", AnimationNodeTimeScale.new())
	bt.add_node("move", AnimationNodeBlend2.new())
	bt.add_node("turn_anim", _anim(TURNS[0] if lib.has_animation(TURNS[0]) else "idle"))
	var os := AnimationNodeOneShot.new()
	os.fadein_time = 0.25
	os.fadeout_time = 0.35
	bt.add_node("turn", os)
	bt.connect_node("ts", 0, "walk")
	bt.connect_node("move", 0, "idle")
	bt.connect_node("move", 1, "ts")
	bt.connect_node("turn", 0, "move")
	bt.connect_node("turn", 1, "turn_anim")
	bt.connect_node("output", 0, "turn")
	tree.tree_root = bt
	model_root.add_child(tree)
	tree.root_node = NodePath("..")
	tree.active = true
	return true


func _anim(name: String) -> AnimationNodeAnimation:
	var a := AnimationNodeAnimation.new()
	a.animation = name
	return a


## The stride (m per cycle) of the walk blend at `speed` (model m/s, clamped to the recorded range).
func stride_at(speed: float) -> float:
	if speed <= walks[0][0]:
		return walks[0][1]
	for i in range(1, walks.size()):
		if speed <= walks[i][0]:
			var u: float = (speed - walks[i - 1][0]) / (walks[i][0] - walks[i - 1][0])
			return lerpf(walks[i - 1][1], walks[i][1], u)
	return walks[-1][1]


## Cycles per second the walk plays at `speed` (model m/s): the ground speed over the blended clips' stride.
func cadence(speed: float) -> float:
	return speed / stride_at(speed)


## One frame: `speed` model m/s over the ground, `yaw_err` rad from the heading the puppet wants (+ = left).
## Returns the yaw (rad) a playing turn moved the body this frame (0 otherwise).
func update(dt: float, speed: float, yaw_err: float) -> float:
	if tree == null:
		return 0.0
	var want := smoothstep(IDLE_TO_WALK[0], IDLE_TO_WALK[1], speed)
	move = lerpf(move, want, 1.0 - exp(-MOVE_RATE * dt))
	var sp := clampf(speed, walks[0][0], walks[-1][0])
	tree.set("parameters/walk/blend_position", sp)
	tree.set("parameters/ts/scale", cadence(maxf(speed, 0.05)) if move > 0.01 else 0.0)
	tree.set("parameters/move/blend_amount", move)
	var dyaw := 0.0
	if not turn.is_empty():
		var t0 := float(turn.t)
		turn.t = minf(t0 + dt, float(turn.len))
		dyaw = (_curve(turn.t) - _curve(t0)) * float(turn.scale)
		if float(turn.t) >= float(turn.len):
			turn = {}
	elif move < 0.05 and absf(yaw_err) > TURN_MIN:
		_start_turn(yaw_err)
	tree.advance(dt)
	return dyaw


func turning() -> bool:
	return not turn.is_empty()


func _start_turn(err: float) -> void:
	var name := "turn_%s_%s" % ["left" if err > 0.0 else "right", "60" if absf(err) < 1.3 else "90"]
	var lib := tree.get_animation_library("")
	if not lib.has_animation(name):
		return
	var a := lib.get_animation(name)
	var total := float(a.get_meta("yaw", 0.0))
	if absf(total) < 0.1:
		return
	var c: PackedFloat32Array = a.get_meta("yaw_curve", PackedFloat32Array())
	turn = {"t": 0.0, "len": a.length, "scale": clampf(err / total, 0.5, 1.5) if absf(err) < 2.4 else 1.0, "curve": c}
	(tree.tree_root as AnimationNodeBlendTree).get_node("turn_anim").animation = name
	tree.set("parameters/turn/request", AnimationNodeOneShot.ONE_SHOT_REQUEST_FIRE)


## The baked turn's yaw so far at `t` (s), from its 30 Hz curve.
func _curve(t: float) -> float:
	var c: PackedFloat32Array = turn.get("curve", PackedFloat32Array())
	if c.is_empty():
		return 0.0
	var x := clampf(t * 30.0, 0.0, c.size() - 1.0)
	var i := int(x)
	return lerpf(c[i], c[mini(i + 1, c.size() - 1)], x - i)
