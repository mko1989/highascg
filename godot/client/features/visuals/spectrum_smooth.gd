extends RefCounted
## WO-875 — the GDScript twin of template/shaders/player-smooth.js (keep the two identical; test_spectrum_smooth.gd pins
## the same parity golden as the Node smoke). GLava-style smoothing of the 512 raw FFT bytes, once per rendered frame:
## spread (bin k averages ±floor(k·spread) neighbours), gravity (instant rise, at most `fall` bytes/s drop; 0 = off),
## then a windowed average of the last `frames` outputs. Params come from each WS audio_fft frame (`smooth`).

const DEFAULTS := {"fall": 200.0, "frames": 3, "spread": 0.02}
const MAX_FRAMES := 8

var _n: int
var _grav := PackedFloat32Array()
var _hist: Array[PackedFloat32Array] = []
var _prefix := PackedFloat64Array()
var _out := PackedByteArray()
var _head := 0
var _filled := 0
var _frames := 0


func _init(n := 512) -> void:
	_n = n
	_grav.resize(n)
	_prefix.resize(n + 1)
	_out.resize(n)
	for i in MAX_FRAMES:
		var h := PackedFloat32Array()
		h.resize(n)
		_hist.append(h)


static func _num(v: Variant, fb: float, lo: float, hi: float) -> float:
	if not (v is float or v is int):
		return fb
	return clampf(float(v), lo, hi)


static func params(p: Variant) -> Dictionary:
	var o: Dictionary = p if p is Dictionary else {}
	return {"fall": _num(o.get("fall"), DEFAULTS.fall, 0.0, 5000.0),
		"frames": roundi(_num(o.get("frames"), DEFAULTS.frames, 1.0, MAX_FRAMES)),
		"spread": _num(o.get("spread"), DEFAULTS.spread, 0.0, 0.25)}


## Weight of the frame `age` renders old in an `m`-frame window (GLava window_shallow for 3, window_frame above).
static func weight(age: int, m: int) -> float:
	if m < 3:
		return 1.0
	var c := cos(TAU * age / (m - 1))
	return 0.7 - 0.3 * c if m == 3 else 0.6 - 0.4 * c


## `raw` (≥ n bytes) → the smoothed n bytes. `dt` in seconds (clamped to 0.1).
func step(raw: PackedByteArray, dt: float, p: Variant) -> PackedByteArray:
	var q := params(p)
	var fall: float = q.fall
	var spread: float = q.spread
	var d := clampf(dt, 0.0, 0.1)
	if q.frames != _frames:
		_frames = q.frames
		_head = 0
		_filled = 0
	var m := mini(raw.size(), _n)
	for i in _n:
		_prefix[i + 1] = _prefix[i] + (raw[i] if i < m else 0)
	var h := _hist[_head]
	for k in _n:
		var r := floori(k * spread)
		var v := float(raw[k]) if k < m else 0.0
		if r >= 1:
			var lo := maxi(0, k - r)
			var hi := mini(_n, k + r + 1)
			v = (_prefix[hi] - _prefix[lo]) / (hi - lo)
		var g := _grav[k] - fall * d
		_grav[k] = g if fall > 0.0 and g > v else v
		h[k] = _grav[k]
	_hist[_head] = h  # packed arrays are values: write the row back
	_head = (_head + 1) % _frames
	_filled = mini(_filled + 1, _frames)
	if _filled == 1:
		for k in _n:
			_out[k] = clampi(roundi(h[k]), 0, 255)
		return _out
	var total := 0.0
	var w := PackedFloat64Array()
	var rows: Array[PackedFloat32Array] = []
	for age in _filled:
		w.append(weight(age, _filled))
		total += w[age]
		rows.append(_hist[(_head - 1 - age + _frames) % _frames])
	for k in _n:
		var s := 0.0
		for age in _filled:
			s += w[age] * rows[age][k]
		_out[k] = clampi(roundi(s / total), 0, 255)
	return _out
