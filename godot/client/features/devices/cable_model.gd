extends RefCounted
## WO-605 slice 1 — device-view cables, ported 1:1 from client/components/device-view-cables-physics.js: the
## per-edge colour (string hash → 32-colour palette) and the Verlet "hanging cable" with optional coils. Pure (tests
## preload it); the view caches build() results per edge and endpoints, as the web getOrBuild() does.

const COLORS := [
	"#FF3333", "#FF6633", "#FF9933", "#FFCC33", "#FFFF33",
	"#CCFF33", "#99FF33", "#66FF33", "#33FF33", "#33FF66",
	"#33FF99", "#33FFCC", "#33FFFF", "#33CCFF", "#3399FF",
	"#3366FF", "#3333FF", "#6633FF", "#9933FF", "#CC33FF",
	"#FF33FF", "#FF33CC", "#FF3399", "#FF3366", "#FF0055",
	"#D2691E", "#FF1493", "#00CED1", "#32CD32", "#9400D3",
	"#1E90FF", "#FF8C00",
]
const NO_ID_COLOR := "#94a3b8"
const BOOT_DROP := 16.0  # straight plug boot below each port
const STEPS_PER_LOOP := 36
const GRAVITY := 0.85
const ITERS := 200
const SUBSTEPS := 6


## JS ToInt32.
static func _i32(x: int) -> int:
	x &= 0xFFFFFFFF
	return x - 0x100000000 if x >= 0x80000000 else x


## JS `h = (h << 5) - h + c`: only the shift is truncated to int32 — h itself stays an (exact) double between steps.
static func hash_id(id: String) -> int:
	var h := 0
	for i in id.length():
		h = _i32(_i32(h) << 5) - h + id.unicode_at(i)
	return h


static func color_hex(id: String) -> String:
	if id == "":
		return NO_ID_COLOR
	return COLORS[(absi(hash_id(id)) * 7) % COLORS.size()]


static func color(id: String) -> Color:
	return Color(color_hex(id))


## Seed for the coil placement: the sum of the id's char codes (web getOrBuild).
static func seed_of(id: String) -> int:
	var s := 0
	for i in id.length():
		s += id.unicode_at(i)
	return s


static func srand(n: float, seed: float) -> float:
	var v := sin(n * 127.1 + seed * 311.7) * 43758.5453
	return v - floor(v)


## Cable from port (x1, y1) to port (x2, y2); loops 0–2 = the "Cable loops" setting. Returns the polyline.
static func build(x1: float, y1: float, x2: float, y2: float, loops: int, seed: int) -> PackedVector2Array:
	var mx1 := x1
	var my1 := y1 + BOOT_DROP
	var mx2 := x2
	var my2 := y2 + BOOT_DROP
	var dist := Vector2(mx2 - mx1, my2 - my1).length()
	if dist == 0.0:
		dist = 1.0
	var actual := 0
	if loops == 1 and dist >= 90.0:
		actual = 1
	elif loops == 2:
		actual = 2 if dist >= 120.0 else (1 if dist >= 70.0 else 0)
	var n_base := maxi(28, floori(dist / 10.0))

	var wx := PackedFloat64Array([mx1])
	var wy := PackedFloat64Array([my1])
	var wl := PackedByteArray([0])
	var loop_ts: Array[float] = []
	for li in actual:
		var base := 0.5 if actual == 1 else (0.35 if li == 0 else 0.65)
		loop_ts.append(base - 0.1 + srand(li + 11, seed) * 0.2)
	loop_ts.sort()
	var c_dx := (mx2 - mx1) / dist
	var c_dy := (my2 - my1) / dist
	var prev_t := 0.0
	for li in loop_ts.size():
		var t := loop_ts[li]
		var segs := maxi(1, floori((t - prev_t) * n_base))
		for i in range(1, segs + 1):
			var st := prev_t + (t - prev_t) * (float(i) / segs)
			wx.append(mx1 + (mx2 - mx1) * st)
			wy.append(my1 + (my2 - my1) * st)
			wl.append(0)
		var r := 20.0 + srand(li + 42, seed) * 12.0
		var side := 1.0 if srand(li + 101, seed) > 0.5 else -1.0
		var cx := mx1 + (mx2 - mx1) * t + (-c_dy * side * r)
		var cy := my1 + (my2 - my1) * t + (c_dx * side * r)
		var a0 := atan2(my1 + (my2 - my1) * t - cy, mx1 + (mx2 - mx1) * t - cx)
		for i in range(1, STEPS_PER_LOOP + 1):
			var ang := a0 + side * (float(i) / STEPS_PER_LOOP) * PI * 2.0
			wx.append(cx + cos(ang) * r)
			wy.append(cy + sin(ang) * r)
			wl.append(1)
		prev_t = t
	var fin := maxi(1, floori((1.0 - prev_t) * n_base))
	for i in range(1, fin + 1):
		var st := prev_t + (1.0 - prev_t) * (float(i) / fin)
		wx.append(mx1 + (mx2 - mx1) * st)
		wy.append(my1 + (my2 - my1) * st)
		wl.append(0)
	# Rigid plug boots: the port itself before the run, the far port after it.
	wx.insert(0, x1)
	wy.insert(0, y1)
	wl.insert(0, 0)
	wx.append(x2)
	wy.append(y2)
	wl.append(0)
	return _relax(wx, wy, wl, x1, y1, x2, y2)


## Verlet relaxation: gravity on the hanging interior, exact rest lengths for 1-, 2- and 3-hop constraints (stiff on
## coils, soft on straight runs), ends and boot points pinned after every substep.
static func _relax(px: PackedFloat64Array, py: PackedFloat64Array, lp: PackedByteArray,
		x1: float, y1: float, x2: float, y2: float) -> PackedVector2Array:
	var n := px.size() - 1
	var rest: Array[PackedFloat64Array] = []
	var stiff: Array[PackedFloat64Array] = []
	for hop in [1, 2, 3]:
		var l := PackedFloat64Array()
		var k := PackedFloat64Array()
		for i in maxi(0, n + 1 - hop):
			l.append(Vector2(px[i + hop] - px[i], py[i + hop] - py[i]).length())
			var on_loop := false
			for m in range(i, i + hop + 1):
				on_loop = on_loop or lp[m] == 1
			k.append(1.0 if hop == 1 else ((0.6 if on_loop else 0.06) if hop == 2 else (0.3 if on_loop else 0.02)))
		rest.append(l)
		stiff.append(k)
	var mx1 := x1
	var my1 := y1 + BOOT_DROP
	var mx2 := x2
	var my2 := y2 + BOOT_DROP
	for _iter in ITERS:
		for i in range(2, n - 1):
			py[i] += GRAVITY
		for _s in SUBSTEPS:
			for hop in [1, 2, 3]:
				var l: PackedFloat64Array = rest[hop - 1]
				var ks: PackedFloat64Array = stiff[hop - 1]
				for i in l.size():
					var j: int = i + hop
					var dx := px[j] - px[i]
					var dy := py[j] - py[i]
					var d := sqrt(dx * dx + dy * dy)
					if d == 0.0:
						d = 0.001
					var f := (d - l[i]) / d * 0.5 * ks[i]
					if i > 1:
						px[i] += dx * f
						py[i] += dy * f
					if j < n - 1:
						px[j] -= dx * f
						py[j] -= dy * f
			px[0] = x1
			py[0] = y1
			px[1] = mx1
			py[1] = my1
			px[n - 1] = mx2
			py[n - 1] = my2
			px[n] = x2
			py[n] = y2
	var out := PackedVector2Array()
	for i in n + 1:
		out.append(Vector2(px[i], py[i]))
	return out
