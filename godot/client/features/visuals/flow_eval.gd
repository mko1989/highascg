extends RefCounted
## WO-1011 — one frame of one Flow node (the library is flow_nodes.gd). The logic of each op follows its cables.gl
## counterpart (https://github.com/cables-gl/cables, MIT, Copyright (c) 2019-present undefined development; see
## THIRD_PARTY_NOTICES) re-implemented per frame with `dt`:
##   lfo ← Ops.Anim.LFO_v4 (waveforms, phase, pulse width, the random / smooth-random hash; + a beat clock)
##   smooth ← Ops.Anim.Smooth (rise / fall factors, made frame-rate independent) · spring ← Ops.Anim.Spring
##   map ← Ops.Math.MapRange (smoothstep / smootherstep, clamp) · curve ← Ops.Math.SchlickBias · ease ← Ops.Math.Ease
##   compare ← Ops.Trigger.Threshold · counter ← Ops.Trigger.TriggerCounterLoop · nth ← Ops.Trigger.NthTrigger
##   chance ← Ops.Trigger.ProbabilityTrigger · random ← Ops.Math.TriggerRandomNumber · hold ← Ops.Boolean.MonoFlop
##   toggle ← Ops.Boolean.ToggleBool · and / or ← Ops.Boolean.And / Or · switch ← Ops.Number.SwitchNumber
##   gate ← Ops.Number.GateNumber · sample ← Ops.Number.FreezeNumber · delay ← Ops.Number.DelayNumberSimple
##   average ← Ops.Math.SimpleMovingAverage (by time) · speed ← Ops.Math.Speed · peak ← Ops.Math.MaxSinceReset
## Noise is our own smooth value noise on the LFO hash (cables' PerlinNoise comes from p5.js and is not ported).
## A trigger input fires on a rising edge through 0.5 and re-arms below 0.3. State lives in `st` (plain data, so a
## bank's state can be duplicated — visuals_dj.gd).

const N := preload("res://features/visuals/flow_nodes.gd")
const DEFAULT_BPM := 120.0
const BUF_MAX := 2400  # samples a Delay / Average keeps (40 s at 60 fps)
const TRANS := {"linear": Tween.TRANS_LINEAR, "sine": Tween.TRANS_SINE, "quad": Tween.TRANS_QUAD, "cubic": Tween.TRANS_CUBIC,
	"quart": Tween.TRANS_QUART, "quint": Tween.TRANS_QUINT, "expo": Tween.TRANS_EXPO, "circ": Tween.TRANS_CIRC,
	"back": Tween.TRANS_BACK, "elastic": Tween.TRANS_ELASTIC, "bounce": Tween.TRANS_BOUNCE, "spring": Tween.TRANS_SPRING}
const EASE := {"in": Tween.EASE_IN, "out": Tween.EASE_OUT, "in-out": Tween.EASE_IN_OUT, "out-in": Tween.EASE_OUT_IN}


## Node `n`'s output this frame from its input values `x` (one per port, the fallback where nothing is linked).
static func step(n: Dictionary, x: Array, st: Dictionary, buses: Dictionary, dt: float) -> float:
	var a: float = x[0] if x.size() > 0 else 0.0
	var b: float = x[1] if x.size() > 1 else 0.0
	match str(n.type):
		"bus":
			return float(buses.get(n.bus, 0.0))
		"value":
			return n.value
		"lfo":
			return _lfo(n, a, st, buses, dt)
		"noise":
			st.pos = float(st.get("pos", 0.0)) + dt * n.rate
			var v := (_smooth_rand(st.pos, n.seed) + 0.5 * _smooth_rand(st.pos * 2.03 + 17.0, n.seed)) / 1.5
			return lerpf(n.lo, n.hi, v)
		"random":
			if edge(st, "t", a):
				st.k = int(st.get("k", 0)) + 1
				st.v = lerpf(n.lo, n.hi, hash01(st.k, n.seed))
			return float(st.get("v", n.lo))
		"add":
			return a + b
		"sub":
			return a - b
		"mul":
			return a * b
		"min":
			return minf(a, b)
		"max":
			return maxf(a, b)
		"mix":
			return lerpf(a, b, clampf(x[2], 0.0, 1.0))
		"map":
			return map_range(a, n)
		"clamp":
			return clampf(a, minf(n.lo, n.hi), maxf(n.lo, n.hi))
		"invert":
			return 1.0 - a
		"abs":
			return absf(a)
		"pow":
			return signf(a) * pow(absf(a), n.exp)
		"steps":
			return roundf(a * n.steps) / n.steps
		"wrap":
			return fposmod(a, n.mod)
		"curve":
			return schlick_gain(clampf(a, 0.0, 1.0), n.gain)
		"ease":
			return float(Tween.interpolate_value(0.0, 1.0, clampf(a, 0.0, 1.0), 1.0, TRANS[n.trans], EASE[n.ease]))
		"compare":
			return 1.0 if (a >= n.at if n.dir == "above" else a <= n.at) else 0.0
		"shape":
			st.v = follow(float(st.get("v", 0.0)), a, n.attack, n.release, dt)
			return st.v * n.gain
		"smooth":
			var v := float(st.get("v", a))
			st.v = v + (a - v) * (1.0 - pow(1.0 - 1.0 / (n.up if a > v else n.down), dt * 60.0))
			return st.v
		"spring":
			return _spring(n, a, st, dt)
		"slew":
			var v := float(st.get("v", a))
			st.v = minf(a, v + n.up * dt) if a > v else maxf(a, v - n.down * dt)
			return st.v
		"delay":
			return _delay(n, a, st, dt)
		"average":
			return _average(n, a, st, dt)
		"speed":
			var prev := float(st.get("prev", a))
			st.prev = a
			return absf(a - prev) / maxf(dt, 1e-4) * n.scale
		"peak":
			var v := float(st.get("v", 0.0))
			if edge(st, "r", b) or a >= v:
				st.v = a
				st.held = 0.0
				return a
			st.held = float(st.get("held", 0.0)) + dt
			st.v = v if st.held * 1000.0 < n.hold else follow(v, a, 0.0, n.release, dt)
			return st.v
		"pulse":
			var v := maxf(0.0, float(st.get("v", 0.0)) - n.level * dt * 1000.0 / n.release)
			st.v = n.level if edge(st, "t", a) else v
			return st.v
		"hold":
			st.left = n.ms if edge(st, "t", a) else float(st.get("left", 0.0)) - dt * 1000.0
			return 1.0 if st.left > 0.0 else 0.0
		"counter":
			var steps := int(n.steps)
			if edge(st, "r", b):
				st.n = 0
			if edge(st, "t", a):
				st.n = (int(st.get("n", 0)) + 1) % steps
			return float(st.get("n", 0)) / float(steps - 1)
		"toggle":
			if edge(st, "r", b):
				st.on = false
			if edge(st, "t", a):
				st.on = not bool(st.get("on", false))
			return 1.0 if st.get("on", false) else 0.0
		"nth":
			if edge(st, "r", b):
				st.k = 0
			if edge(st, "t", a):
				st.k = int(st.get("k", 0)) + 1
				if st.k >= int(n.n):
					st.k = 0
					return 1.0
			return 0.0
		"chance":
			if edge(st, "t", a):
				st.k = int(st.get("k", 0)) + 1
				return 1.0 if hash01(st.k, n.seed) < n.p else 0.0
			return 0.0
		"sample":
			if edge(st, "t", b):
				st.v = a
			return float(st.get("v", 0.0))
		"gate":
			return a if b >= 0.5 else 0.0
		"switch":
			return x[1 + clampi(roundi(a * 3.0), 0, 3)]
		"and":
			return 1.0 if a >= 0.5 and b >= 0.5 else 0.0
		"or":
			return 1.0 if a >= 0.5 or b >= 0.5 else 0.0
	return a


## A trigger: true on the frame `v` rises through 0.5; re-armed once it falls below 0.3 (`key` names the input).
static func edge(st: Dictionary, key: String, v: float) -> bool:
	var armed: bool = st.get(key + "_armed", true)
	if armed and v >= 0.5:
		st[key + "_armed"] = false
		return true
	if not armed and v < 0.3:
		st[key + "_armed"] = true
	return false


## Envelope follower: rises with `attack_ms`, falls with `release_ms` (0 = jump).
static func follow(prev: float, x: float, attack_ms: float, release_ms: float, dt: float) -> float:
	var ms := attack_ms if x > prev else release_ms
	if ms <= 0.0:
		return x
	return prev + (x - prev) * (1.0 - exp(-dt * 1000.0 / ms))


## cables' hash (LFO_v4 random): −1..1 from a cycle number and a seed.
static func hash_s(k: float, seed: float) -> float:
	var h := sin(k * 12.9898 + seed * 78.233) * 43758.5453
	return (h - floorf(h)) * 2.0 - 1.0


static func hash01(k: float, seed: float) -> float:
	return hash_s(k, seed) * 0.5 + 0.5


## Smooth value noise 0..1 at `pos` (smoothstep between two hashed integers, as LFO_v4 "smooth random").
static func _smooth_rand(pos: float, seed: float) -> float:
	var i := floorf(pos)
	var f := pos - i
	return lerpf(hash01(i, seed), hash01(i + 1.0, seed), f * f * (3.0 - 2.0 * f))


static func _lfo(n: Dictionary, reset: float, st: Dictionary, buses: Dictionary, dt: float) -> float:
	if edge(st, "r", reset):
		st.pos = 0.0
	var bpm := float(buses.get("_bpm", DEFAULT_BPM))
	var hz: float = n.rate if n.clock == "free" else bpm / 60.0 / maxf(0.25, n.beats)
	st.pos = float(st.get("pos", 0.0)) + dt * hz
	var shifted: float = st.pos + n.phase
	var cycle := floorf(shifted)
	var p := shifted - cycle
	var w := 0.0
	match str(n.wave):
		"random":
			w = hash_s(cycle, n.seed)
		"smooth random":
			var s := p * p * (3.0 - 2.0 * p)
			w = lerpf(hash_s(cycle, n.seed), hash_s(cycle + 1.0, n.seed), s)
		"triangle":
			w = p * 4.0 - 1.0 if p < 0.5 else 3.0 - p * 4.0
		"ramp up":
			w = p * 2.0 - 1.0
		"ramp down":
			w = 1.0 - p * 2.0
		"square":
			w = -1.0 if p < 1.0 - n.width else 1.0
		_:
			w = -cos(p * TAU)
	return lerpf(n.lo, n.hi, (w + 1.0) * 0.5)


static func map_range(x: float, n: Dictionary) -> float:
	var span: float = n.in_hi - n.in_lo
	var t: float = 0.0 if is_zero_approx(span) else (x - n.in_lo) / span
	if n.clamp == "on":
		t = clampf(t, 0.0, 1.0)
	if n.ease == "smoothstep":
		t = t * t * (3.0 - 2.0 * t)
	elif n.ease == "smootherstep":
		t = t * t * t * (t * (t * 6.0 - 15.0) + 10.0)
	return lerpf(n.out_lo, n.out_hi, t)


## Schlick's gain (cables SchlickBias): < 0.5 eases into the middle, > 0.5 out of it.
static func schlick_gain(x: float, gain: float) -> float:
	if x < 0.5:
		return _bias(x * 2.0, gain) / 2.0
	return _bias(x * 2.0 - 1.0, 1.0 - gain) / 2.0 + 0.5


static func _bias(x: float, bias: float) -> float:
	return x / ((1.0 / bias - 2.0) * (1.0 - x) + 1.0)


static func _spring(n: Dictionary, target: float, st: Dictionary, dt: float) -> float:
	var ms := dt * 1000.0
	var v := float(st.get("v", target))
	var vel := float(st.get("vel", 0.0))
	vel = vel * maxf(0.0, 1.0 - n.damping * 50.0 * dt) + (target - v) * n.stiffness * 10.0 * ms * 0.01
	v += vel * ms * 0.01
	if absf(v - target) < 0.001 and absf(vel) < 0.001:
		v = target
		vel = 0.0
	st.v = v
	st.vel = vel
	return v


## The input as it was `ms` ago (the oldest sample until the buffer covers the delay).
static func _delay(n: Dictionary, x: float, st: Dictionary, dt: float) -> float:
	var buf: Array = st.get("buf", [])
	st.t = float(st.get("t", 0.0)) + dt
	buf.append([st.t, x])
	var at: float = st.t - n.ms / 1000.0 + 1e-6  # the frame clock is a float sum
	while buf.size() > 1 and (buf[1][0] <= at or buf.size() > BUF_MAX):
		buf.pop_front()
	st.buf = buf
	return buf[0][1]


static func _average(n: Dictionary, x: float, st: Dictionary, dt: float) -> float:
	var buf: Array = st.get("buf", [])
	st.t = float(st.get("t", 0.0)) + dt
	buf.append([st.t, x])
	while buf.size() > 1 and (buf[0][0] < st.t - n.ms / 1000.0 or buf.size() > BUF_MAX):
		buf.pop_front()
	st.buf = buf
	var sum := 0.0
	for s in buf:
		sum += s[1]
	return sum / buf.size()
