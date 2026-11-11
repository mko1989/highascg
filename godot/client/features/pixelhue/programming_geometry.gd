extends RefCounted
## WO-1039 — Programming geometry, pure (no autoloads): a port of Studio's public/program-stage.js (canvas margin,
## move/resize, snapping, drop size), public/group-geometry.js (grouped inputs GRP<n>-<H|V>-<A|B>) and
## public/layer-tools.js (align / fill / native / output tile), plus the stage's view transform and hit tests.
## Windows are Dictionaries {x, y, width, height} in screen-local pixels (ints), like Studio's.

const MIN := 64
const CANVAS_MARGIN := 0.2
const HANDLES := ["nw", "ne", "sw", "se"]
const HANDLE_PX := 7.0  # half size of a corner handle on screen (hit radius)


## JavaScript Math.round (half rounds towards +infinity; GDScript round() goes away from zero: -2.5 → -3).
static func jr(v: float) -> int:
	return int(floor(v + 0.5))


static func win(x: Variant, y: Variant, w: Variant, h: Variant) -> Dictionary:
	return {"x": int(x), "y": int(y), "width": int(w), "height": int(h)}


static func copy(w: Dictionary) -> Dictionary:
	return win(w.get("x", 0), w.get("y", 0), w.get("width", 0), w.get("height", 0))


static func same(a: Dictionary, b: Dictionary) -> bool:
	for k in ["x", "y", "width", "height"]:
		if int(a.get(k, 0)) != int(b.get(k, 0)):
			return false
	return true


## The geometry queue's local check (program-sync caller): whole numbers, at least 64 × 64.
static func window_ok(w: Variant) -> bool:
	if not (w is Dictionary):
		return false
	for k in ["x", "y", "width", "height"]:
		var v: Variant = (w as Dictionary).get(k)
		if not (v is int or (v is float and is_equal_approx(v, roundf(v)))):
			return false
	return int(w.width) >= MIN and int(w.height) >= MIN


## Device limits (lib/program-geometry.js geometry()): roam = anywhere (±500000, 64–131070); else inside the screen.
static func within_limits(w: Dictionary, screen: Dictionary, roam: bool) -> bool:
	var sw := int(screen.get("width", 0))
	var sh := int(screen.get("height", 0))
	if not window_ok(w):
		return false
	if roam:
		var gx := int(w.x) + int(screen.get("x", 0))
		var gy := int(w.y) + int(screen.get("y", 0))
		return int(w.width) <= 131070 and int(w.height) <= 131070 and absi(gx) <= 500000 and absi(gy) <= 500000
	return int(w.x) >= 0 and int(w.y) >= 0 and int(w.x) <= sw - MIN and int(w.y) <= sh - MIN \
		and int(w.width) <= sw - int(w.x) and int(w.height) <= sh - int(w.y)


## Without roam the device keeps layers inside the screen: shrink to fit, then move inside.
static func clamp_to_screen(w: Dictionary, screen: Dictionary) -> Dictionary:
	var sw := maxi(MIN, int(screen.get("width", MIN)))
	var sh := maxi(MIN, int(screen.get("height", MIN)))
	var width := clampi(int(w.width), MIN, sw)
	var height := clampi(int(w.height), MIN, sh)
	return win(clampi(int(w.x), 0, sw - width), clampi(int(w.y), 0, sh - height), width, height)


## The stage shows the screen inside a margin (20 % of the screen per side) so sources can be dropped next to it.
static func canvas_of(screen: Dictionary) -> Dictionary:
	var mx := jr(float(screen.get("width", 0)) * CANVAS_MARGIN)
	var my := jr(float(screen.get("height", 0)) * CANVAS_MARGIN)
	return {"mx": mx, "my": my, "width": int(screen.get("width", 0)) + 2 * mx, "height": int(screen.get("height", 0)) + 2 * my}


## Move (no handle) or resize from a corner handle ("nw" …); `ratio` > 0 keeps the aspect, the opposite corner anchored.
static func move_window(original: Dictionary, dx: float, dy: float, handle := "", ratio := 0.0) -> Dictionary:
	var o := copy(original)
	if handle == "":
		return win(jr(o.x + dx), jr(o.y + dy), o.width, o.height)
	var left := handle.contains("w")
	var top := handle.contains("n")
	var right: int = o.x + o.width
	var bottom: int = o.y + o.height
	var width := maxi(MIN, jr(o.width + (-dx if left else dx)))
	var height := maxi(MIN, jr(o.height + (-dy if top else dy)))
	if ratio > 0.0:
		if absf(width - o.width) / float(o.width) >= absf(height - o.height) / float(o.height):
			height = jr(width / ratio)
		else:
			width = jr(height * ratio)
		if height < MIN:
			height = MIN
			width = jr(MIN * ratio)
		if width < MIN:
			width = MIN
			height = jr(MIN / ratio)
	return win(right - width if left else o.x, bottom - height if top else o.y, width, height)


## The smallest (value → line) delta within `threshold`, or null.
static func nearest(values: Array, lines: Array, threshold: float) -> Variant:
	var best: Variant = null
	for v in values:
		for l in lines:
			var d := float(l) - float(v)
			if absf(d) <= threshold and (best == null or absf(d) < absf(float(best))):
				best = d
	return best


## Snap to the screen's edges / centre and other layers' edges / centres (Studio snapWindow).
static func snap_window(w: Dictionary, screen: Dictionary, others: Array, threshold: float, handle := "", ratio := 0.0) -> Dictionary:
	var sw := float(screen.get("width", 0))
	var sh := float(screen.get("height", 0))
	var xs: Array = [0.0, sw / 2.0, sw]
	var ys: Array = [0.0, sh / 2.0, sh]
	for o in others:
		xs.append_array([float(o.x), o.x + o.width / 2.0, float(o.x + o.width)])
		ys.append_array([float(o.y), o.y + o.height / 2.0, float(o.y + o.height)])
	var n := copy(w)
	if handle == "":
		var dx: Variant = nearest([float(w.x), w.x + w.width / 2.0, float(w.x + w.width)], xs, threshold)
		var dy: Variant = nearest([float(w.y), w.y + w.height / 2.0, float(w.y + w.height)], ys, threshold)
		if dx != null:
			n.x = jr(w.x + float(dx))
		if dy != null:
			n.y = jr(w.y + float(dy))
		return n
	if handle.contains("w"):
		var x := mini(_edge(w.x, xs, threshold), int(w.x + w.width) - MIN)
		n.width = int(w.x + w.width) - x
		n.x = x
	if handle.contains("e"):
		n.width = maxi(MIN, _edge(w.x + w.width, xs, threshold) - int(w.x))
	if ratio > 0.0:
		var height := maxi(MIN, jr(n.width / ratio))
		if handle.contains("n"):
			n.y = int(w.y + w.height) - height
		n.height = height
		return n
	if handle.contains("n"):
		var y := mini(_edge(w.y, ys, threshold), int(w.y + w.height) - MIN)
		n.height = int(w.y + w.height) - y
		n.y = y
	if handle.contains("s"):
		n.height = maxi(MIN, _edge(w.y + w.height, ys, threshold) - int(w.y))
	return n


static func _edge(value: float, lines: Array, threshold: float) -> int:
	var d: Variant = nearest([value], lines, threshold)
	return jr(value) if d == null else jr(value + float(d))


## New layers use the source's native size centred on the drop point (unknown size → 1920 × 1080).
static func drop_window(source: Dictionary, point: Dictionary) -> Dictionary:
	var w := maxi(MIN, int(source.get("width", 0)) if int(source.get("width", 0)) > 0 else 1920)
	var h := maxi(MIN, int(source.get("height", 0)) if int(source.get("height", 0)) > 0 else 1080)
	return win(jr(float(point.x) - w / 2.0), jr(float(point.y) - h / 2.0), w, h)


# ---- grouped inputs (group-geometry.js) ----

static func parse_group(name: Variant) -> Dictionary:
	var re := RegEx.create_from_string("^GRP(\\d+)-([HV])-([AB])$")
	var m := re.search(str(name) if name != null else "")
	if m == null:
		return {}
	return {"group": int(m.get_string(1)), "orient": m.get_string(2), "part": m.get_string(3)}


## {group, orient, a, b} when `layer` is one member of a complete pair on its screen + scene, else {}.
static func group_of(layers: Array, layer: Variant) -> Dictionary:
	if not (layer is Dictionary):
		return {}
	var g := parse_group(layer.get("name"))
	if g.is_empty():
		return {}
	var a: Dictionary = {}
	var b: Dictionary = {}
	for l in layers:
		if l.get("screenId") != layer.get("screenId") or l.get("scene") != layer.get("scene"):
			continue
		var p := parse_group(l.get("name"))
		if p.is_empty() or p.group != g.group:
			continue
		if p.part == "A" and a.is_empty():
			a = l
		elif p.part == "B" and b.is_empty():
			b = l
	if a.is_empty() or b.is_empty():
		return {}
	return {"group": g.group, "orient": g.orient, "a": a, "b": b}


static func union_window(a: Dictionary, b: Dictionary) -> Dictionary:
	var x := mini(int(a.x), int(b.x))
	var y := mini(int(a.y), int(b.y))
	return win(x, y, maxi(int(a.x + a.width), int(b.x + b.width)) - x, maxi(int(a.y + a.height), int(b.y + b.height)) - y)


## A's share of the main axis (H = width, V = height) of the pair as it is now.
static func group_share(group: Dictionary) -> float:
	var a: Dictionary = group.a.window
	var b: Dictionary = group.b.window
	if group.orient == "H":
		return float(a.width) / float(a.width + b.width)
	return float(a.height) / float(a.height + b.height)


## Split a combined rectangle between A and B keeping A's share of the main axis (each at least 64).
static func split_window(rect: Dictionary, orient: String, share: float) -> Array:
	if orient == "H":
		var wa := maxi(MIN, mini(int(rect.width) - MIN, jr(rect.width * share)))
		return [win(rect.x, rect.y, wa, rect.height), win(rect.x + wa, rect.y, rect.width - wa, rect.height)]
	var ha := maxi(MIN, mini(int(rect.height) - MIN, jr(rect.height * share)))
	return [win(rect.x, rect.y, rect.width, ha), win(rect.x, rect.y + ha, rect.width, rect.height - ha)]


## Native combined size of two sources (1920 × 1080 each when unknown).
static func group_size(a: Variant, b: Variant, orient: String) -> Dictionary:
	var wa := _dim(a, "width", 1920)
	var ha := _dim(a, "height", 1080)
	var wb := _dim(b, "width", 1920)
	var hb := _dim(b, "height", 1080)
	if orient == "H":
		return {"width": wa + wb, "height": maxi(ha, hb), "share": float(wa) / float(wa + wb)}
	return {"width": maxi(wa, wb), "height": ha + hb, "share": float(ha) / float(ha + hb)}


static func _dim(s: Variant, key: String, fallback: int) -> int:
	var v := int(s.get(key, 0)) if s is Dictionary and s.get(key) != null else 0
	return v if v > 0 else fallback


## The window a tool or drag acts on: the pair's union for a group member, else the layer's own.
static func target_window(layers: Array, layer: Dictionary) -> Dictionary:
	var g := group_of(layers, layer)
	return union_window(g.a.window, g.b.window) if not g.is_empty() else copy(layer.window)


## Aspect ratio to keep (0 = free): a locked layer, or a group with either member locked.
static func keep_ratio(layers: Array, layer: Dictionary) -> float:
	var g := group_of(layers, layer)
	var locked: bool = (g.a.get("aspectLocked") == true or g.b.get("aspectLocked") == true) if not g.is_empty() else layer.get("aspectLocked") == true
	if not locked:
		return 0.0
	var w := target_window(layers, layer)
	return float(w.width) / float(w.height) if int(w.height) > 0 else 0.0


# ---- layer tools (layer-tools.js) ----

static func align_window(w: Dictionary, screen: Dictionary, where: String) -> Dictionary:
	var n := copy(w)
	var sw := int(screen.width)
	var sh := int(screen.height)
	match where:
		"left": n.x = 0
		"hcenter": n.x = jr((sw - n.width) / 2.0)
		"right": n.x = sw - n.width
		"top": n.y = 0
		"vcenter": n.y = jr((sh - n.height) / 2.0)
		"bottom": n.y = sh - n.height
		"center":
			n.x = jr((sw - n.width) / 2.0)
			n.y = jr((sh - n.height) / 2.0)
	return n


## The output tile (screen-local) under the window's centre, else the first; {} when the screen has none.
static func output_tile(w: Dictionary, screen: Dictionary) -> Dictionary:
	var tiles: Array = []
	for o in screen.get("outputs", []):
		var p: Dictionary = o.get("pos", {}) if o is Dictionary and o.get("pos") is Dictionary else {}
		if p.is_empty():
			continue
		tiles.append(win(int(p.x) - int(screen.get("x", 0)), int(p.y) - int(screen.get("y", 0)), p.width, p.height))
	var cx: float = w.x + w.width / 2.0
	var cy: float = w.y + w.height / 2.0
	for t in tiles:
		if cx >= t.x and cx < t.x + t.width and cy >= t.y and cy < t.y + t.height:
			return t
	return tiles[0] if not tiles.is_empty() else {}


## The source's own resolution centred on the window; {} when the source has no signal size.
static func native_window(w: Dictionary, source: Variant) -> Dictionary:
	if not (source is Dictionary) or int(source.get("width", 0)) <= 0 or int(source.get("height", 0)) <= 0:
		return {}
	return win(jr(w.x + w.width / 2.0 - source.width / 2.0), jr(w.y + w.height / 2.0 - source.height / 2.0), source.width, source.height)


## Fill a target; with a ratio, fit inside it (contain) and centre.
static func fill_window(target: Dictionary, ratio := 0.0) -> Dictionary:
	if ratio <= 0.0:
		return copy(target)
	if float(target.width) / float(target.height) > ratio:
		var w := maxi(MIN, jr(target.height * ratio))
		return win(jr(target.x + (target.width - w) / 2.0), target.y, w, target.height)
	var h := maxi(MIN, jr(target.width / ratio))
	return win(target.x, jr(target.y + (target.height - h) / 2.0), target.width, h)


## Fill one axis ("width" / "height"); the other keeps its size, or follows the ratio, centred on the layer.
static func fill_axis(w: Dictionary, target: Dictionary, axis: String, ratio := 0.0) -> Dictionary:
	if axis == "width":
		var h: int = maxi(MIN, jr(target.width / ratio)) if ratio > 0.0 else int(w.height)
		return win(target.x, jr(w.y + w.height / 2.0 - h / 2.0), target.width, h)
	var wd: int = maxi(MIN, jr(target.height * ratio)) if ratio > 0.0 else int(w.width)
	return win(jr(w.x + w.width / 2.0 - wd / 2.0), target.y, wd, target.height)


static func nudge(w: Dictionary, dx: int, dy: int, step: int) -> Dictionary:
	return win(int(w.x) + dx * step, int(w.y) + dy * step, w.width, w.height)


## Changing W or H on a locked layer derives the other from the ratio.
static func field_edit(w: Dictionary, key: String, value: int, ratio := 0.0) -> Dictionary:
	var n := copy(w)
	n[key] = value
	if ratio > 0.0 and key == "width":
		n.height = maxi(MIN, jr(value / ratio))
	if ratio > 0.0 and key == "height":
		n.width = maxi(MIN, jr(value * ratio))
	return n


# ---- the stage's view (canvas ↔ control pixels) ----

## Fit the screen's canvas into a control of `size`: {scale, ox, oy, mx, my}.
static func view_of(screen: Dictionary, size: Vector2) -> Dictionary:
	var c := canvas_of(screen)
	var s := 0.0
	if c.width > 0 and c.height > 0:
		s = minf(size.x / float(c.width), size.y / float(c.height))
	return {"scale": s, "ox": (size.x - c.width * s) / 2.0, "oy": (size.y - c.height * s) / 2.0, "mx": c.mx, "my": c.my}


## Screen-local pixel rectangle → control rectangle.
static func to_view(w: Dictionary, view: Dictionary) -> Rect2:
	var s: float = view.scale
	return Rect2(view.ox + (float(w.x) + view.mx) * s, view.oy + (float(w.y) + view.my) * s, float(w.width) * s, float(w.height) * s)


## Control point → screen-local pixel point {x, y} (floats).
static func to_screen(p: Vector2, view: Dictionary) -> Dictionary:
	var s: float = view.scale if float(view.scale) > 0.0 else 1.0
	return {"x": (p.x - view.ox) / s - view.mx, "y": (p.y - view.oy) / s - view.my}


## What a press at `p` hits: {id, handle} — a handle of the selected layer / group frame first, then the topmost layer.
static func hit(layers: Array, selected_id: Variant, p: Vector2, view: Dictionary) -> Dictionary:
	var sel: Dictionary = {}
	for l in layers:
		if selected_id != null and l.get("id") == selected_id:
			sel = l
	if not sel.is_empty():
		var r := to_view(target_window(layers, sel), view)
		for h in HANDLES:
			if p.distance_to(corner(r, h)) <= HANDLE_PX + 2.0:
				return {"id": sel.id, "handle": h}
	var sorted := by_zorder(layers)
	for i in range(sorted.size() - 1, -1, -1):
		var l: Dictionary = sorted[i]
		if to_view(l.window, view).has_point(p):
			return {"id": l.id, "handle": ""}
	return {}


static func corner(r: Rect2, h: String) -> Vector2:
	return Vector2(r.position.x if h.contains("w") else r.end.x, r.position.y if h.contains("n") else r.end.y)


## Back-to-front painting order (Studio: zorder ascending).
static func by_zorder(layers: Array) -> Array:
	var out := layers.duplicate()
	out.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return int(a.get("zorder", 0)) < int(b.get("zorder", 0)))
	return out
