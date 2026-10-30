extends RefCounted
## WO-869 — a mapping node's slices as data (pure; port of src/config/mapping-slices-model.js normalizeSlice and
## mapping-slices-geometry.js). A slice cuts `src` (input-feed px) and lands on one output at `dst` (output px):
## the dst rect, rotated about its centre (clockwise, y down), each screen corner moved by `warp[i]` (keystone),
## then the flips decide which screen corner each SOURCE corner (ul, ur, lr, ll) lands on. dst_quad() is that
## compiled quad — what the server sends to Caspar and what the output canvas draws. Golden-tested against the
## JS for the same fixtures (tests/golden/devices_mapping_slices.json, written by the Node smoke).

const MAX_SLICES := 64
const CORNERS := ["ul", "ur", "lr", "ll"]


## JS Number(v) with the model's "missing / blank / garbage → default" rule.
static func _num(o: Dictionary, k: String, d: float) -> float:
	if not o.has(k):
		return d
	var v: Variant = o[k]
	if v == null:
		return 0.0
	if v is bool:
		return 1.0 if v else 0.0
	if v is int or v is float:
		return float(v) if is_finite(float(v)) else d
	if v is String:
		var s := (v as String).strip_edges()
		return s.to_float() if s != "" and s.is_valid_float() else d
	return d


## Strict booleans (JS `=== true` / `!== false`): a "yes" string is neither.
static func is_true(v: Variant) -> bool:
	return v is bool and v


static func not_false(v: Variant) -> bool:
	return not (v is bool and not v)


## Math.round (halves go up: -2.5 → -2).
static func js_round(v: float) -> int:
	return int(floor(v + 0.5))


static func _int(o: Dictionary, k: String, d: float) -> int:
	return js_round(_num(o, k, d))


static func norm_rotation(v: float) -> float:
	var r := fmod(v, 360.0)
	if r > 180.0:
		r -= 360.0
	if r <= -180.0:
		r += 360.0
	return 0.0 if r == 0.0 else r


static func norm_rect(r: Variant, d: Dictionary) -> Dictionary:
	var o: Dictionary = r if r is Dictionary else {}
	return {"x": _int(o, "x", d.x), "y": _int(o, "y", d.y), "w": maxi(1, _int(o, "w", d.w)), "h": maxi(1, _int(o, "h", d.h))}


static func norm_warp(w: Variant) -> Array:
	var a: Array = w if w is Array else []
	var out := []
	for i in 4:
		var p: Array = a[i] if i < a.size() and a[i] is Array else []
		var px := {"0": p[0]} if p.size() > 0 else {}
		var py := {"1": p[1]} if p.size() > 1 else {}
		out.append([_num(px, "0", 0.0), _num(py, "1", 0.0)])
	return out


static func norm_feather(f: Variant) -> Dictionary:
	var o: Dictionary = f if f is Dictionary else {}
	var out := {}
	for k in ["l", "t", "r", "b"]:
		out[k] = maxi(0, _int(o, k, 0.0))
	return out


## normalizeSlice(raw, i, {outputIds, defaultSize}).
static func normalize_slice(raw: Variant, i: int, output_ids: Array, default_size := {"w": 1920, "h": 1080}) -> Dictionary:
	var s: Dictionary = raw if raw is Dictionary else {}
	var oid := str(s.get("outputId", "")) if s.get("outputId") != null else ""
	var output_id := oid if oid in output_ids else (str(output_ids[0]) if not output_ids.is_empty() else (oid if oid != "" else "out_1"))
	var src := norm_rect(s.get("src"), {"x": 0, "y": 0, "w": default_size.w, "h": default_size.h})
	var d: Dictionary = s.get("dst") if s.get("dst") is Dictionary else {}
	var id := str(s.get("id", "")).strip_edges() if s.get("id") != null else ""
	var name := str(s.get("name", "")).strip_edges() if s.get("name") != null else ""
	var op := clampf(_num(s, "opacity", 1.0), 0.0, 1.0)
	return {
		"id": id if id != "" else "slice_%d" % (i + 1),
		"name": name if name != "" else "Slice %d" % (i + 1),
		"outputId": output_id,
		"enabled": not_false(s.get("enabled")),
		"source": {"kind": "feed"},
		"src": src,
		"dst": {"rect": norm_rect(d.get("rect"), {"x": 0, "y": 0, "w": src.w, "h": src.h}),
			"rotation": norm_rotation(_num(d, "rotation", 0.0)), "flipH": is_true(d.get("flipH")),
			"flipV": is_true(d.get("flipV")), "warp": norm_warp(d.get("warp"))},
		"opacity": op,
		"feather": norm_feather(s.get("feather")),
		"z": _int(s, "z", 0.0),
	}


## Unique ids (a repeated id gets _2, _3 …), at most MAX_SLICES.
static func normalize_slices(list: Variant, output_ids: Array, default_size := {"w": 1920, "h": 1080}) -> Array:
	var seen := {}
	var out := []
	for raw in (list if list is Array else []).slice(0, MAX_SLICES):
		var s := normalize_slice(raw, out.size(), output_ids, default_size)
		var id: String = s.id
		var k := 2
		while seen.has(id):
			id = "%s_%d" % [s.id, k]
			k += 1
		s.id = id
		seen[id] = true
		out.append(s)
	return out


# ---------------------------------------------------------------- geometry (mapping-slices-geometry.js)

static func rect_corners(r: Dictionary) -> Array:
	var x := float(r.x)
	var y := float(r.y)
	return [Vector2(x, y), Vector2(x + float(r.w), y), Vector2(x + float(r.w), y + float(r.h)), Vector2(x, y + float(r.h))]


## Clockwise on screen; 90° steps stay exact.
static func rotate_about(pts: Array, c: Vector2, deg: float) -> Array:
	if deg == 0.0:
		return pts.duplicate()
	var q := roundi(deg / 90.0)
	var exact := absf(deg - q * 90.0) < 1e-12
	var cs: float = [1.0, 0.0, -1.0, 0.0][posmod(q, 4)] if exact else cos(deg_to_rad(deg))
	var sn: float = [0.0, 1.0, 0.0, -1.0][posmod(q, 4)] if exact else sin(deg_to_rad(deg))
	return pts.map(func(p: Vector2) -> Vector2:
		var d := p - c
		return Vector2(c.x + d.x * cs - d.y * sn, c.y + d.x * sn + d.y * cs))


## Screen-corner index each source corner (ul, ur, lr, ll) lands on.
static func flip_perm(flip_h: bool, flip_v: bool) -> Array:
	if flip_h and flip_v:
		return [2, 3, 0, 1]
	if flip_h:
		return [1, 0, 3, 2]
	if flip_v:
		return [3, 2, 1, 0]
	return [0, 1, 2, 3]


## The slice's screen corners (ul, ur, lr, ll on screen) after rotation and warp — where the editor draws handles.
static func screen_corners(dst: Dictionary) -> Array:
	var r: Dictionary = dst.rect
	var c := Vector2(float(r.x) + float(r.w) / 2.0, float(r.y) + float(r.h) / 2.0)
	var pts := rotate_about(rect_corners(r), c, float(dst.get("rotation", 0.0)))
	var warp: Array = dst.get("warp", [])
	for i in 4:
		if i < warp.size() and warp[i] is Array and warp[i].size() >= 2:
			pts[i] += Vector2(float(warp[i][0]), float(warp[i][1]))
	return pts


## dst[k] = where source corner k lands.
static func dst_quad(dst: Dictionary) -> Array:
	var sc := screen_corners(dst)
	return flip_perm(is_true(dst.get("flipH")), is_true(dst.get("flipV"))).map(func(i: int) -> Vector2: return sc[i])


static func quad_area(q: Array) -> float:
	var a := 0.0
	for i in 4:
		a += q[i].x * q[(i + 1) % 4].y - q[(i + 1) % 4].x * q[i].y
	return a / 2.0


## Strictly convex, non-degenerate, either winding (the screen consumer refuses anything else).
static func is_convex(q: Array) -> bool:
	if q.size() != 4:
		return false
	var sign := 0.0
	for i in 4:
		var o: Vector2 = q[i]
		var a: Vector2 = q[(i + 1) % 4]
		var b: Vector2 = q[(i + 2) % 4]
		var c := (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
		if absf(c) < 1e-6:
			return false
		if sign == 0.0:
			sign = signf(c)
		elif signf(c) != sign:
			return false
	return absf(quad_area(q)) > 1e-6


## 3x3 row-major (h33 = 1) mapping 4 points `from` onto `to`; [] when degenerate.
static func homography(from: Array, to: Array) -> Array:
	var a := []
	var b := []
	for i in 4:
		var p: Vector2 = from[i]
		var u: Vector2 = to[i]
		a.append([p.x, p.y, 1.0, 0.0, 0.0, 0.0, -u.x * p.x, -u.x * p.y])
		b.append(u.x)
		a.append([0.0, 0.0, 0.0, p.x, p.y, 1.0, -u.y * p.x, -u.y * p.y])
		b.append(u.y)
	for col in 8:
		var piv := col
		for r in range(col + 1, 8):
			if absf(a[r][col]) > absf(a[piv][col]):
				piv = r
		if absf(a[piv][col]) < 1e-12:
			return []
		var t: Array = a[col]
		a[col] = a[piv]
		a[piv] = t
		var tb: float = b[col]
		b[col] = b[piv]
		b[piv] = tb
		for r in 8:
			if r == col:
				continue
			var f: float = a[r][col] / a[col][col]
			if f == 0.0:
				continue
			for c in range(col, 8):
				a[r][c] -= f * a[col][c]
			b[r] -= f * b[col]
	var h := []
	for i in 8:
		h.append(b[i] / a[i][i])
	h.append(1.0)
	return h


static func apply_h(h: Array, p: Vector2) -> Vector2:
	var w: float = h[6] * p.x + h[7] * p.y + h[8]
	return Vector2((h[0] * p.x + h[1] * p.y + h[2]) / w, (h[3] * p.x + h[4] * p.y + h[5]) / w)


# ---------------------------------------------------------------- list ops (the editor's)

static func next_id(slices: Array) -> String:
	var n := slices.size() + 1
	var ids := slices.map(func(s: Dictionary) -> String: return str(s.get("id", "")))
	while "slice_%d" % n in ids:
		n += 1
	return "slice_%d" % n


## A 1:1 slice of `src` on `out_id` at the output's top-left, on top of the others.
static func new_slice(slices: Array, out_id: String, src: Dictionary) -> Dictionary:
	var z := 0
	for s in slices:
		z = maxi(z, int(s.get("z", 0)) + 1)
	var id := next_id(slices)
	return normalize_slice({"id": id, "name": "Slice %s" % id.trim_prefix("slice_"), "outputId": out_id, "src": src,
		"dst": {"rect": {"x": 0, "y": 0, "w": src.w, "h": src.h}}, "z": z}, slices.size(), [out_id])


static func duplicated(slices: Array, i: int) -> Dictionary:
	var c: Dictionary = slices[i].duplicate(true)
	c.id = next_id(slices)
	c.name = "%s copy" % str(slices[i].get("name", ""))
	c.z = int(c.get("z", 0)) + 1
	c.dst.rect.x = int(c.dst.rect.x) + 32
	c.dst.rect.y = int(c.dst.rect.y) + 32
	return c


## Raise (dir 1) / lower (-1): swap z with the neighbour in draw order. Returns false at the end of the stack.
static func move_z(slices: Array, i: int, dir: int) -> bool:
	var order := draw_order(slices)
	var at := order.find(i)
	var to := at + dir
	if at < 0 or to < 0 or to >= order.size():
		return false
	for k in order.size():
		slices[order[k]].z = k
	slices[order[at]].z = to
	slices[order[to]].z = at
	return true


## Indices sorted by z, then list position (the planner's draw order: later = on top).
static func draw_order(slices: Array) -> Array:
	var idx := range(slices.size())
	idx.sort_custom(func(a: int, b: int) -> bool:
		var za := int(slices[a].get("z", 0))
		var zb := int(slices[b].get("z", 0))
		return za < zb or (za == zb and a < b))
	return idx


## Field access by dotted path ("src.x", "dst.rect.w", "dst.warp.2.1", "feather.l", "opacity").
static func get_at(s: Dictionary, path: String) -> Variant:
	var cur: Variant = s
	for k in path.split("."):
		cur = cur[int(k)] if cur is Array else (cur as Dictionary).get(k)
	return cur


static func set_at(s: Dictionary, path: String, v: Variant) -> void:
	var keys := path.split(".")
	var cur: Variant = s
	for i in keys.size() - 1:
		cur = cur[int(keys[i])] if cur is Array else cur[keys[i]]
	var last := keys[keys.size() - 1]
	if cur is Array:
		cur[int(last)] = v
	else:
		cur[last] = v
