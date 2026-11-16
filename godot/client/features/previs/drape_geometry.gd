extends RefCounted
## WO-1104 — a stage drape's pleats, generated from its parameters (stage_objects.gd type "drape"). Pure: no nodes,
## no textures — every fold comes from this code (owner rule: nothing in the ISO we may not redistribute).
## Twin: src/stage/drape-geometry.js (MVR export + the games' bake) — the same hash, nodes and profile, so a drape looks
## the same in the previs, the exported .mvr and the games.
##
## Plan profile (object frame: x across, z towards the audience, origin bottom-centre): `2n` half pleats between fold
## nodes that alternate front / back (n = width / pleat spacing). Each half pleat is a half cosine between its nodes
## (smooth, C1 at the folds, like hanging cloth); widths vary ±15 % and depths 70…100 % per node, seeded by the
## object's id (stable across sessions, a duplicate gets its own folds). Depth A follows the fullness: the regular
## sine of the same spacing whose cloth length is (1 + fullness) × width. Fullness 0 = flat molton.
## The profile is extruded over the height in two bands, the folds a little tighter at the top (gathered at the
## header): ×0.88 at the top, ×0.95 halfway, ×1 at the floor.

const SAMPLES := [3, 4, 6, 8]  ## points per half pleat at previs quality Low, Medium, High, Ultra
const MAX_COLS := 4000
const JITTER_W := 0.3
const AMP_MIN := 0.7
const ROW_SCALE := [1.0, 0.95, 0.88]  ## fold depth at the floor, halfway, at the top
const ARC_STEPS := 64


## FNV-1a (32 bit) of the id's UTF-8 bytes — the seed of a drape's folds.
static func seed_of(id: String) -> int:
	var h := 2166136261
	for b in id.to_utf8_buffer():
		h = ((h ^ b) * 16777619) & 0xFFFFFFFF
	return h


## Deterministic 0..1 from (seed, i); the JS twin does the same 32-bit integer steps (Math.imul).
static func hash01(seed: int, i: int) -> float:
	var x: int = (seed ^ ((i * 374761393) & 0xFFFFFFFF)) & 0xFFFFFFFF
	x = ((x ^ (x >> 16)) * 0x7feb352d) & 0xFFFFFFFF
	x = ((x ^ (x >> 15)) * 0x5bd1e995) & 0xFFFFFFFF
	x = x ^ (x >> 16)
	return float(x) / 4294967296.0


## Cloth length per width of a sine with k = 2π·A / spacing.
static func arc_ratio(k: float) -> float:
	var s := 0.0
	for i in ARC_STEPS:
		var th := TAU * (i + 0.5) / ARC_STEPS
		s += sqrt(1.0 + pow(k * sin(th), 2.0))
	return s / ARC_STEPS


## Half the fold depth (m) for `fullness` (0..2, 0.6 = 60 % more cloth than width) at `spacing` m fold to fold.
static func amplitude(fullness: float, spacing: float) -> float:
	if fullness < 0.005:
		return 0.0
	var lo := 0.0
	var hi := 20.0
	for _i in 40:
		var mid := (lo + hi) / 2.0
		if arc_ratio(mid) < 1.0 + fullness:
			lo = mid
		else:
			hi = mid
	return (lo + hi) / 2.0 * spacing / TAU


static func pleats(o: Dictionary) -> int:
	if float(o.get("fullness", 0.0)) < 0.5:
		return 0
	return maxi(1, roundi(float(o.size_m[0]) / float(o.pleat_m)))


## Fold nodes (x, z) left → right at the floor: 2n + 1 points (2 for a flat drape).
static func nodes(o: Dictionary) -> PackedVector2Array:
	var w := float(o.size_m[0])
	var n := pleats(o)
	var out := PackedVector2Array()
	if n == 0:
		out.append(Vector2(-w / 2.0, 0.0))
		out.append(Vector2(w / 2.0, 0.0))
		return out
	var seed := seed_of(str(o.get("id", "")))
	var a := amplitude(float(o.fullness) / 100.0, w / n)
	var widths := []
	var total := 0.0
	for j in 2 * n:
		var ww := 1.0 + JITTER_W * (hash01(seed, j) - 0.5)
		widths.append(ww)
		total += ww
	var x := -w / 2.0
	for j in 2 * n + 1:
		var depth := a * (AMP_MIN + (1.0 - AMP_MIN) * hash01(seed, 7919 + j))
		out.append(Vector2(x, depth if j % 2 == 0 else -depth))
		if j < 2 * n:
			x += w * float(widths[j]) / total
	out[out.size() - 1] = Vector2(w / 2.0, out[out.size() - 1].y)
	return out


## The sampled plan profile at the floor: `samples` points per half pleat (half cosine between nodes).
static func profile(o: Dictionary, samples: int) -> PackedVector2Array:
	var nd := nodes(o)
	var halves := nd.size() - 1
	var s := clampi(samples, 1, maxi(1, MAX_COLS / maxi(1, halves))) if halves > 1 else 1
	var out := PackedVector2Array()
	for j in halves:
		for i in s:
			var t := float(i) / s
			var e := (1.0 - cos(PI * t)) / 2.0
			out.append(Vector2(lerpf(nd[j].x, nd[j + 1].x, t), lerpf(nd[j].y, nd[j + 1].y, e)))
	out.append(nd[halves])
	return out


## Cloth length (m) of a profile.
static func cloth_m(prof: PackedVector2Array) -> float:
	var s := 0.0
	for i in prof.size() - 1:
		s += prof[i].distance_to(prof[i + 1])
	return s


## Plan extent of the folds: (z back, z front) in the object frame.
static func depth_range(o: Dictionary) -> Vector2:
	var lo := 0.0
	var hi := 0.0
	for p in nodes(o):
		lo = minf(lo, p.y)
		hi = maxf(hi, p.y)
	return Vector2(lo, hi)


static func triangles(o: Dictionary, samples: int) -> int:
	return (profile(o, samples).size() - 1) * 2 * (ROW_SCALE.size() - 1)


## The cloth mesh: rows at the floor, halfway and the top. UV in metres (u along the cloth, v down from the top);
## COLOR.r = how far forward the fold is (1 front … 0 back, the shader's fold shading).
static func mesh(o: Dictionary, samples: int) -> ArrayMesh:
	var prof := profile(o, samples)
	var h := float(o.size_m[1])
	var dr := depth_range(o)
	var span := maxf(dr.y - dr.x, 1e-4)
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var rows := ROW_SCALE.size()
	var u := 0.0
	for i in prof.size():
		if i > 0:
			u += prof[i].distance_to(prof[i - 1])
		var a := prof[maxi(0, i - 1)]
		var b := prof[mini(prof.size() - 1, i + 1)]
		for r in rows:
			var k: float = ROW_SCALE[r]
			var d := Vector2(b.x - a.x, (b.y - a.y) * k).normalized()
			var y := h * r / (rows - 1)
			st.set_normal(Vector3(-d.y, 0.0, d.x))
			st.set_uv(Vector2(u, h - y))
			st.set_color(Color(clampf((prof[i].y - dr.x) / span, 0.0, 1.0), 0.0, 0.0))
			st.add_vertex(Vector3(prof[i].x, y, prof[i].y * k))
	for i in prof.size() - 1:
		for r in rows - 1:
			var bl := i * rows + r
			var br := (i + 1) * rows + r
			for v in [bl + 1, br + 1, br, bl + 1, br, bl]:
				st.add_index(v)
	return st.commit()
