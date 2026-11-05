extends RefCounted
## WO-960 — look editor snapping with guide lines, pure (autoload-free, so the headless runner loads it).
## A dragged layer's left / centre / right (top / centre / bottom) snap to the canvas's edges and centre and to every
## other visible layer's edges and centre, within a threshold given in SCREEN px (the caller divides by the canvas's
## on-screen size, so it feels the same at any zoom). Every value is a canvas fraction, like the look's `fill`.
## A layer's snap box = its visible picture: the crop applied, then its rotation about the fill centre (WO-635) —
## the axis-aligned bounds of what Caspar shows. Guides = the target lines the result lies on; the editor draws them.

const C := preload("res://features/live/compose_math.gd")
const THRESHOLD_PX := 8.0
const EPS := 1e-6
const MIN_SIZE := 0.02  # edge_resize's floor (look_editor: 0.02)


## The axis-aligned bounds of a layer's visible picture as {x, y, scaleX, scaleY} canvas fractions. `crop` =
## {left, top, right, bottom} (0–1 of the layer) or null; `deg` clockwise about the fill centre, in canvas px so a
## turned box's corners land where the picture's do on a non-square canvas.
static func bounds(fill: Dictionary, crop: Variant, deg: float, canvas: Vector2) -> Dictionary:
	var r := Rect2(Vector2(float(fill.get("x", 0.0)), float(fill.get("y", 0.0))) * canvas,
		Vector2(float(fill.get("scaleX", 1.0)), float(fill.get("scaleY", 1.0))) * canvas)
	var v := r
	if crop is Dictionary:
		var c: Dictionary = crop
		v = Rect2(r.position + Vector2(float(c.get("left", 0.0)), float(c.get("top", 0.0))) * r.size,
			Vector2(float(c.get("right", 1.0)) - float(c.get("left", 0.0)), float(c.get("bottom", 1.0)) - float(c.get("top", 0.0))) * r.size)
	if absf(deg) > 1e-4:
		var xf := C.layer_xform(r, deg)
		var pts := [xf * v.position, xf * Vector2(v.end.x, v.position.y), xf * v.end, xf * Vector2(v.position.x, v.end.y)]
		var lo: Vector2 = pts[0]
		var hi: Vector2 = pts[0]
		for p in pts:
			lo = lo.min(p)
			hi = hi.max(p)
		v = Rect2(lo, hi - lo)
	var cv := canvas.max(Vector2.ONE)
	return {"x": v.position.x / cv.x, "y": v.position.y / cv.y, "scaleX": v.size.x / cv.x, "scaleY": v.size.y / cv.y}


## The snap lines on one axis: the canvas's start / centre / end, then each other box's (bounds()).
static func targets(others: Array, x_axis: bool) -> Array:
	var out: Array = [0.0, 0.5, 1.0]
	var kp := "x" if x_axis else "y"
	var ks := "scaleX" if x_axis else "scaleY"
	for f in others:
		if f is Dictionary:
			var a := float(f.get(kp, 0.0))
			var s := float(f.get(ks, 0.0))
			out.append_array([a, a + s / 2.0, a + s])
	return out


## The shift that puts the nearest of `points` on the nearest target, strictly inside `thr`; 0.0 when none is close
## (ties: the earlier point — start before centre before end — and the earlier target).
static func best_shift(points: Array, tg: Array, thr: float) -> float:
	var best := 0.0
	var best_d := thr
	for p in points:
		for t in tg:
			var d := float(t) - float(p)
			if absf(d) < best_d:
				best_d = absf(d)
				best = d
	return best


## The targets one of `points` lies on (each once, in target order) — the guide lines to draw.
static func hits(points: Array, tg: Array) -> Array:
	var out: Array = []
	for t in tg:
		for p in points:
			if absf(float(t) - float(p)) <= EPS and not out.any(func(o: float) -> bool: return absf(o - float(t)) <= EPS):
				out.append(float(t))
	return out


static func _span(a: float, s: float) -> Array: return [a, a + s / 2.0, a + s]


## Move the layer by (dx, dy) and snap its snap box (`box` = bounds() of the start fill) by its start / centre / end
## on each axis. `others` = the other layers' bounds(); `thr` = THRESHOLD_PX / the canvas's on-screen size; `off`
## (the modifier held) = a plain move. → {"fill": the moved fill (clamped to ±5 like the web), "guides": {x: [], y: []}}
static func move(start: Dictionary, box: Dictionary, dx: float, dy: float, others: Array, thr: Vector2, off := false) -> Dictionary:
	var x0 := float(start.get("x", 0.0))
	var y0 := float(start.get("y", 0.0))
	var nx := clampf(x0 + dx, -5.0, 5.0)
	var ny := clampf(y0 + dy, -5.0, 5.0)
	var ox := float(box.get("x", x0)) - x0  # the snap box's offset from the fill: fixed under a pure move
	var oy := float(box.get("y", y0)) - y0
	var bw := float(box.get("scaleX", start.get("scaleX", 0.0)))
	var bh := float(box.get("scaleY", start.get("scaleY", 0.0)))
	var gx: Array = []
	var gy: Array = []
	if not off:
		var tx := targets(others, true)
		var ty := targets(others, false)
		nx = clampf(nx + best_shift(_span(nx + ox, bw), tx, thr.x), -5.0, 5.0)
		ny = clampf(ny + best_shift(_span(ny + oy, bh), ty, thr.y), -5.0, 5.0)
		gx = hits(_span(nx + ox, bw), tx)
		gy = hits(_span(ny + oy, bh), ty)
	var f := start.duplicate()
	f["x"] = nx
	f["y"] = ny
	return {"fill": f, "guides": {"x": gx, "y": gy}}


## Edge / corner resize (compose_math.edge_resize, aspect lock as given) with the dragged edges snapping to the same
## targets. Snaps only an upright, uncropped-handle box: on a turned layer the dragged edge is not an axis line.
## → {"fill", "guides"} — guides only for the dragged edges that ended on a target.
static func resize(edge: String, start: Dictionary, dx: float, dy: float, locked: bool, others: Array, thr: Vector2, off := false) -> Dictionary:
	var tx := targets(others, true)
	var ty := targets(others, false)
	var sx := Callable()
	var sy := Callable()
	if not off:
		sx = func(v: float) -> float: return v + best_shift([v], tx, thr.x)
		sy = func(v: float) -> float: return v + best_shift([v], ty, thr.y)
	var f := C.edge_resize(edge, start, dx, dy, locked, MIN_SIZE, sx, sy)
	if off:
		return {"fill": f, "guides": {"x": [], "y": []}}
	var px: Array = []
	var py: Array = []
	if edge.contains("w"):
		px.append(float(f.x))
	if edge.contains("e"):
		px.append(float(f.x) + float(f.scaleX))
	if edge.contains("n"):
		py.append(float(f.y))
	if edge.contains("s"):
		py.append(float(f.y) + float(f.scaleY))
	return {"fill": f, "guides": {"x": hits(px, tx), "y": hits(py, ty)}}


## A guide's on-screen line: `v` on the x axis = a vertical line across `area` at the canvas box `b`'s x(v).
static func guide_line(v: float, x_axis: bool, b: Rect2, area: Rect2) -> PackedVector2Array:
	if x_axis:
		var x := b.position.x + v * b.size.x
		return PackedVector2Array([Vector2(x, area.position.y), Vector2(x, area.end.y)])
	var y := b.position.y + v * b.size.y
	return PackedVector2Array([Vector2(area.position.x, y), Vector2(area.end.x, y)])
