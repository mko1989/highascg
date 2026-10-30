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
## WO-674: 4 … 32 loops come from CableModel.loop_specs too. CHAOS is a total cable mess with no gravity (owner: "should
## disregard the gravity and just make a mess in between connections"): the run is laid as a tangle that doubles back
## on itself between the two ports, its lengths taken from that tangle so it holds its shape, with loops of any size
## curled every which way. Moving an end still drags the tangle along.

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
const GRAB_REACH := 1.1  # a held point may pull the cable this much past its rest length (it already hangs a little stretched)
const SLEEP_EPS := 0.03  # px (or rad × 100) per step
const SLEEP_STEPS := 40
const CHAOS_BEND := 0.3  # the tangle holds its shape
const CHAOS_WAVES := 3  # summed waves per axis that lay the tangle
const CHAOS_AMP := 60.0  # px: how far the tangle strays from the straight line at most

var loops := 0
var x := PackedFloat32Array()
var y := PackedFloat32Array()
var coils := []  # [{i: rope index it hangs from, r, side, angle, spin, vx, rest (hanging angle), stretch}]
var keepout := []  # Rect2s no point or loop may sit in (the layer passes the tab's controls in chaos)
var _gravity := GRAVITY
var _ox := PackedFloat32Array()
var _oy := PackedFloat32Array()
var _cons := []  # [i, j, rest, stiffness]
var _span0 := 1.0
var _a := Vector2.ZERO
var _b := Vector2.ZERO
var _still := 0
var _grab := -1  # rope point held by the pointer (see grab()), -1 = none
var _goff := Vector2.ZERO  # held point − pointer at the press, so it stays under the cursor
var _gto := Vector2.ZERO  # where the pointer wants the held point


static func make(a: Vector2, b: Vector2, loop_count: int, seed: int) -> RefCounted:
	var r: RefCounted = load("res://features/devices/cable_rope.gd").new()
	r._init_rope(a, b, loop_count, seed)
	return r


func _init_rope(a: Vector2, b: Vector2, loop_count: int, seed: int) -> void:
	loops = loop_count
	var chaos := loop_count == CableModel.CHAOS
	var p := CableModel.path(a.x, a.y, b.x, b.y, 0, seed)
	for v in p.x:
		x.append(v)
	for v in p.y:
		y.append(v)
	if chaos:
		_tangle(seed)
		_gravity = 0.0
	_ox = x.duplicate()
	_oy = y.duplicate()
	_a = a
	_b = b
	_span0 = maxf(1.0, _boot_span())
	var n := x.size() - 1
	var slack := 1.0 if chaos else SLACK  # chaos: the tangle's own lengths are the rest shape
	for hop in [1, 2]:
		for i in maxi(0, n + 1 - hop):
			var rest := Vector2(x[i + hop] - x[i], y[i + hop] - y[i]).length() * slack
			_cons.append([i, i + hop, rest, 1.0 if hop == 1 else (CHAOS_BEND if chaos else BEND)])
	# The run from boot (index 1) to boot (n − 1) carries the coils at the web's positions and sizes.
	var li := 0
	for sp in CableModel.loop_specs(loop_count, _span0, seed):
		var i := clampi(1 + roundi(float(sp.t) * (n - 2)), 2, n - 2)
		var rest_angle := (CableModel.srand(li + 300, seed) - 0.5) * TAU if chaos else 0.0
		var stretch := 0.7 + CableModel.srand(li + 700, seed) * 0.6 if chaos else LOOP_STRETCH
		coils.append({"i": i, "r": float(sp.r), "side": float(sp.side), "angle": rest_angle, "spin": 0.0, "vx": 0.0,
			"rest": rest_angle, "stretch": stretch})
		li += 1


## Lay boot → boot as a tangle: a straight run 3× denser than the hanging one (the tangle stretches it), then
## summed waves across AND along it (the along-run ones make it double back and cross itself), fading out at both
## boots, scaled to the span.
func _tangle(seed: int) -> void:
	var n := x.size() - 1
	var a := Vector2(x[1], y[1])
	var d := Vector2(x[n - 1], y[n - 1]) - a
	var span := maxf(1.0, d.length())
	var along := d / span
	var across := Vector2(-along.y, along.x)
	var amp := clampf(span * 0.14, 18.0, CHAOS_AMP)
	var m := maxi(30, (n - 2) * 3)
	var port_b := Vector2(x[n], y[n])
	x.resize(2)
	y.resize(2)
	for i in range(1, m + 1):
		var u := float(i) / m
		var w_across := 0.0
		var w_along := 0.0
		for k in CHAOS_WAVES:
			var f := 1.5 + CableModel.srand(k + 20, seed) * 4.0
			w_across += sin(TAU * f * u + CableModel.srand(k + 40, seed) * TAU) / (k + 1)
			w_along += sin(TAU * f * 1.7 * u + CableModel.srand(k + 60, seed) * TAU) / (k + 1)
		var q := a + d * u + (across * w_across + along * w_along * 0.9) * amp * sin(PI * u)
		x.append(q.x)
		y.append(q.y)
	x.append(port_b.x)
	y.append(port_b.y)


func _boot_span() -> float:
	return Vector2(_b.x - _a.x, _b.y - _a.y).length()


func asleep() -> bool:
	return _still >= SLEEP_STEPS


func wake() -> void:
	_still = 0


## Move the plugged ends to the ports' current positions (wakes the rope when they moved).
func pin(a: Vector2, b: Vector2) -> void:
	if a != _a or b != _b:
		_a = a
		_b = b
		_still = 0


## Hold rope point `i` (a free one: not the plug or its boot) at the pointer `at`: the rope follows it, the ends stay
## plugged. Wakes the rope; `release()` lets it swing back, keeping the last drag's momentum.
func grab(i: int, at: Vector2) -> void:
	_grab = clampi(i, 2, maxi(2, x.size() - 3))
	_goff = Vector2(x[_grab], y[_grab]) - at
	_gto = Vector2(x[_grab], y[_grab])
	_still = 0


func drag(at: Vector2) -> void:
	_gto = at + _goff
	_still = 0


func release() -> void:
	_grab = -1
	_still = 0


func grabbed() -> bool:
	return _grab >= 0


## The pointer can pull the held point no further than the cable paid out to each plug lets it (a taut rope, not a
## stretched one): `_gto` clamped to the circle of each end's cable length around that end's boot.
func _grab_target(n: int, s: float) -> Vector2:
	var ra := 0.0
	var rb := 0.0
	for k in range(1, _grab):
		ra += float(_cons[k][2])
	for k in range(_grab, n - 1):
		rb += float(_cons[k][2])
	var t := _gto
	for e in [[Vector2(x[1], y[1]), ra * s * GRAB_REACH], [Vector2(x[n - 1], y[n - 1]), rb * s * GRAB_REACH]]:
		var d: Vector2 = t - e[0]
		if d.length() > e[1]:
			t = e[0] + d.normalized() * e[1]
	return t


## One frame: Verlet-integrate the free points, satisfy the lengths with the ends pinned, swing the coils.
## The run's rest lengths follow the span (a card dragged away pays out cable).
func step() -> void:
	var n := x.size() - 1
	if n < 4:
		return
	var s := maxf(1.0, _boot_span()) / _span0
	if _grab >= 0:
		_gto = _grab_target(n, s)
	for i in range(2, n - 1):
		if i == _grab:
			_ox[i] = x[i]  # the pointer moves it (_pin_ends); what it travelled this frame is its momentum
			_oy[i] = y[i]
			continue
		var vx := (x[i] - _ox[i]) * DAMPING
		var vy := (y[i] - _oy[i]) * DAMPING + _gravity
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
			var fi := i > 1 and i != _grab
			var fj := j < n - 1 and j != _grab
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
	if not keepout.is_empty():
		_push_out(n)
	var moved := 0.0
	for i in range(2, n - 1):
		moved = maxf(moved, absf(x[i] - _ox[i]) + absf(y[i] - _oy[i]))
	for c in coils:
		var i: int = c.i
		var vx: float = x[i] - _ox[i]
		var push: float = (vx - float(c.vx)) * SWING_PUSH  # sideways acceleration of the hanging point
		c.vx = vx
		c.spin = (float(c.spin) - SWING_K * sin(float(c.angle) - float(c.rest)) - push) * SWING_DAMP
		c.angle = float(c.angle) + float(c.spin)
		moved = maxf(moved, absf(float(c.spin)) * 100.0)
	_still = _still + 1 if moved < SLEEP_EPS and _grab < 0 else 0


## Move each free point that sits in a keep-out rect to its nearest edge, without bounce.
func _push_out(n: int) -> void:
	for i in range(2, n - 1):
		if i == _grab:
			continue
		var p := Vector2(x[i], y[i])
		for r: Rect2 in keepout:
			if not r.has_point(p):
				continue
			var to_l := p.x - r.position.x
			var to_r := r.end.x - p.x
			var to_t := p.y - r.position.y
			var to_b := r.end.y - p.y
			var m := minf(minf(to_l, to_r), minf(to_t, to_b))
			if m == to_l:
				p.x = r.position.x - 0.01  # has_point() counts the near edges as inside
			elif m == to_r:
				p.x = r.end.x
			elif m == to_t:
				p.y = r.position.y - 0.01
			else:
				p.y = r.end.y
		if p.x != x[i] or p.y != y[i]:
			x[i] = p.x
			y[i] = p.y
			_ox[i] = p.x
			_oy[i] = p.y


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
	if _grab >= 0:
		x[_grab] = _gto.x
		y[_grab] = _gto.y


## The drawn cable: the rope, with each coil's loop spliced in where it hangs.
func points() -> PackedVector2Array:
	return _splice(false)[0]


## [points(), owners]: owners[k] is the rope point index drawn point k belongs to (a loop's points: the one it hangs
## from) — what cable_grab.gd needs to know which rope point a press on the drawn cable holds.
func points_owned() -> Array:
	return _splice(true)


func _splice(want_owners: bool) -> Array:
	var at := {}
	for c in coils:
		at[c.i] = c
	var out := PackedVector2Array()
	var own := PackedInt32Array()
	for i in x.size():
		out.append(Vector2(x[i], y[i]))
		if want_owners:
			own.append(i)
		if at.has(i):
			var lp := loop_points(out[out.size() - 1], at[i])
			if not _hits_keepout(lp):
				out.append_array(lp)
				if want_owners:
					own.resize(out.size())
					for k in range(out.size() - lp.size(), out.size()):
						own[k] = i
	return [out, own]


func _hits_keepout(pts: PackedVector2Array) -> bool:
	for r: Rect2 in keepout:
		for q in pts:
			if r.has_point(q):
				return true
	return false


## One hanging loop from `top`: an ellipse below it (taller than wide), started and ended LOOP_CROSS past the top on
## either side so the cable crosses itself, the whole loop turned by the pendulum angle.
static func loop_points(top: Vector2, c: Dictionary) -> PackedVector2Array:
	var r: float = c.r
	var side: float = c.side
	var k_y: float = c.get("stretch", LOOP_STRETCH)
	var rot := Transform2D(float(c.angle), Vector2.ZERO)
	var centre := Vector2(0.0, r * k_y)
	var out := PackedVector2Array()
	for k in LOOP_STEPS + 1:
		var a := -PI / 2.0 - side * LOOP_CROSS + side * (TAU + 2.0 * LOOP_CROSS) * k / LOOP_STEPS
		out.append(top + rot * (centre + Vector2(cos(a) * r, sin(a) * r * k_y)))
	out.append(top)
	return out
