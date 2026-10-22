extends RefCounted
## WO-672 — a live cable for the Devices rear panel (owner 22.10: "when running inside a game engine we can make the
## cable loops gravity better"). The web port (cable_model.gd build) solves each cable ONCE with no slack, so gravity
## can only stretch it: taut flat runs, kinks, coils that stay perfect circles in mid-air, and while cards move the
## old shape is warped onto the new ends.
##
## Here every cable is a Verlet rope that lives across frames: inertia + damping, a little slack so it hangs in a
## catenary, the two plug points at each end pinned to the ports. Coils ("Cable loops") are pendulums hung on the
## rope: each loop drops below the cable, stretched by gravity, crosses itself where it meets the run, and swings when
## the cable moves. (Coils as constrained rings were tried first: under the run's tension they crumple into kinks.)
## A rope that has stopped moving sleeps (no cost) until its ends move again. Pure: tests drive step() headless.

const CableModel := preload("res://features/devices/cable_model.gd")

const SLACK := 1.06  # the run is this much longer than the span → a hanging catenary, not a taut line
const GRAVITY := 0.45  # px per step² (one step per frame)
const DAMPING := 0.97
const ITERS := 8
const BEND := 0.05  # hop-2 stiffness: a cable, not a chain
const LOOP_STEPS := 32
const LOOP_STRETCH := 1.3  # a hanging loop is taller than wide
const LOOP_CROSS := 0.45  # rad: how far past the top the loop starts / ends, so it crosses itself
const SWING_K := 0.03  # pendulum restoring force
const SWING_PUSH := 0.012  # how much the cable's sideways acceleration kicks a loop
const SWING_DAMP := 0.93
const SLEEP_EPS := 0.03  # px (or rad × 100) per step
const SLEEP_STEPS := 40

var loops := 0
var x := PackedFloat32Array()
var y := PackedFloat32Array()
var coils := []  # [{i: rope index it hangs from, r, side, angle, spin, vx}]
var _ox := PackedFloat32Array()
var _oy := PackedFloat32Array()
var _cons := []  # [i, j, rest, stiffness]
var _span0 := 1.0
var _a := Vector2.ZERO
var _b := Vector2.ZERO
var _still := 0


static func make(a: Vector2, b: Vector2, loop_count: int, seed: int) -> RefCounted:
	var r: RefCounted = load("res://features/devices/cable_rope.gd").new()
	r._init_rope(a, b, loop_count, seed)
	return r


func _init_rope(a: Vector2, b: Vector2, loop_count: int, seed: int) -> void:
	loops = loop_count
	var p := CableModel.path(a.x, a.y, b.x, b.y, 0, seed)
	for v in p.x:
		x.append(v)
	for v in p.y:
		y.append(v)
	_ox = x.duplicate()
	_oy = y.duplicate()
	_a = a
	_b = b
	_span0 = maxf(1.0, _boot_span())
	var n := x.size() - 1
	for hop in [1, 2]:
		for i in maxi(0, n + 1 - hop):
			var rest := Vector2(x[i + hop] - x[i], y[i + hop] - y[i]).length() * SLACK
			_cons.append([i, i + hop, rest, 1.0 if hop == 1 else BEND])
	# The run from boot (index 1) to boot (n − 1) carries the coils at the web's positions and sizes.
	for sp in CableModel.loop_specs(loop_count, _span0, seed):
		var i := clampi(1 + roundi(float(sp.t) * (n - 2)), 2, n - 2)
		coils.append({"i": i, "r": float(sp.r), "side": float(sp.side), "angle": 0.0, "spin": 0.0, "vx": 0.0})


func _boot_span() -> float:
	return Vector2(_b.x - _a.x, _b.y - _a.y).length()


func asleep() -> bool:
	return _still >= SLEEP_STEPS


## Move the plugged ends to the ports' current positions (wakes the rope when they moved).
func pin(a: Vector2, b: Vector2) -> void:
	if a != _a or b != _b:
		_a = a
		_b = b
		_still = 0


## One frame: Verlet-integrate the free points, satisfy the lengths with the ends pinned, swing the coils.
## The run's rest lengths follow the span (a card dragged away pays out cable).
func step() -> void:
	var n := x.size() - 1
	if n < 4:
		return
	var s := maxf(1.0, _boot_span()) / _span0
	for i in range(2, n - 1):
		var vx := (x[i] - _ox[i]) * DAMPING
		var vy := (y[i] - _oy[i]) * DAMPING + GRAVITY
		_ox[i] = x[i]
		_oy[i] = y[i]
		x[i] += vx
		y[i] += vy
	for _it in ITERS:
		_pin_ends(n)
		for c in _cons:
			var i: int = c[0]
			var j: int = c[1]
			var dx := x[j] - x[i]
			var dy := y[j] - y[i]
			var d := sqrt(dx * dx + dy * dy)
			if d < 0.001:
				continue
			var f: float = (d - c[2] * s) / d * 0.5 * c[3]
			var fi := i > 1
			var fj := j < n - 1
			if fi and fj:
				x[i] += dx * f
				y[i] += dy * f
				x[j] -= dx * f
				y[j] -= dy * f
			elif fi:
				x[i] += dx * f * 2.0
				y[i] += dy * f * 2.0
			elif fj:
				x[j] -= dx * f * 2.0
				y[j] -= dy * f * 2.0
	_pin_ends(n)
	var moved := 0.0
	for i in range(2, n - 1):
		moved = maxf(moved, absf(x[i] - _ox[i]) + absf(y[i] - _oy[i]))
	for c in coils:
		var i: int = c.i
		var vx: float = x[i] - _ox[i]
		var push: float = (vx - float(c.vx)) * SWING_PUSH  # sideways acceleration of the hanging point
		c.vx = vx
		c.spin = (float(c.spin) - SWING_K * sin(float(c.angle)) - push) * SWING_DAMP
		c.angle = float(c.angle) + float(c.spin)
		moved = maxf(moved, absf(float(c.spin)) * 100.0)
	_still = _still + 1 if moved < SLEEP_EPS else 0


func _pin_ends(n: int) -> void:
	x[0] = _a.x
	y[0] = _a.y
	x[1] = _a.x
	y[1] = _a.y + CableModel.BOOT_DROP
	x[n - 1] = _b.x
	y[n - 1] = _b.y + CableModel.BOOT_DROP
	x[n] = _b.x
	y[n] = _b.y
	for i in [0, 1, n - 1, n]:
		_ox[i] = x[i]
		_oy[i] = y[i]


## The drawn cable: the rope, with each coil's loop spliced in where it hangs.
func points() -> PackedVector2Array:
	var at := {}
	for c in coils:
		at[c.i] = c
	var out := PackedVector2Array()
	for i in x.size():
		var p := Vector2(x[i], y[i])
		out.append(p)
		if at.has(i):
			out.append_array(loop_points(p, at[i]))
	return out


## One hanging loop from `top`: an ellipse below it (taller than wide), started and ended LOOP_CROSS past the top on
## either side so the cable crosses itself, the whole loop turned by the pendulum angle.
static func loop_points(top: Vector2, c: Dictionary) -> PackedVector2Array:
	var r: float = c.r
	var side: float = c.side
	var rot := Transform2D(float(c.angle), Vector2.ZERO)
	var centre := Vector2(0.0, r * LOOP_STRETCH)
	var out := PackedVector2Array()
	for k in LOOP_STEPS + 1:
		var a := -PI / 2.0 - side * LOOP_CROSS + side * (TAU + 2.0 * LOOP_CROSS) * k / LOOP_STEPS
		var q := centre + Vector2(cos(a) * r, sin(a) * r * LOOP_STRETCH)
		out.append(top + rot * q)
	out.append(top)
	return out
