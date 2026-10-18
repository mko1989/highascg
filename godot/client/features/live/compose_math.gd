extends RefCounted
## WO-600 F — pure compose-frame math, 1:1 with client/components/scenes-compose-handlers.js
## (snapValue, startDrag's move+snap, edgeResizeDeltaToFill) and coordinate-origin.js applyDragDeltaToFill.
## Fill = {x, y, scaleX, scaleY} as fractions of the main's canvas. Golden-tested against the JS.


static func snap_value(v: float, candidates: Array, threshold: float) -> float:
	var best_diff := threshold
	var best := v
	for c in candidates:
		var d := absf(v - float(c))
		if d < best_diff:
			best_diff = d
			best = float(c)
	return best


## WO-611 #4 (fixed in the web too, client snapMoveAxis): snap along one axis by EITHER edge, nearest
## edge that actually snaps wins (tie → start edge).
static func snap_move_axis(v: float, size: float, candidates: Array, threshold: float) -> float:
	var a := snap_value(v, candidates, threshold)
	var end := v + size
	var e := snap_value(end, candidates, threshold)
	var da := absf(a - v) if a != v else INF
	var db := absf(e - end) if e != end else INF
	if is_inf(da) and is_inf(db):
		return v
	return a if da <= db else e - size


## Move by (dx, dy) canvas fractions; snap the left/right (top/bottom) edge to the canvas borders and
## the other layers' edges within `thr` (web: 10 px / frame size). Result clamped to ±5 like the web.
static func move_fill(start: Dictionary, dx: float, dy: float, others: Array, thr_x: float, thr_y: float) -> Dictionary:
	var sx := float(start.get("scaleX", 0.0))
	var sy := float(start.get("scaleY", 0.0))
	var nx := clampf(float(start.get("x", 0.0)) + dx, -5.0, 5.0)
	var ny := clampf(float(start.get("y", 0.0)) + dy, -5.0, 5.0)
	var xc: Array = [0.0, 1.0]
	var yc: Array = [0.0, 1.0]
	for f in others:
		if f is Dictionary:
			xc.append_array([float(f.get("x", 0)), float(f.get("x", 0)) + float(f.get("scaleX", 0))])
			yc.append_array([float(f.get("y", 0)), float(f.get("y", 0)) + float(f.get("scaleY", 0))])
	nx = snap_move_axis(nx, sx, xc, thr_x)
	ny = snap_move_axis(ny, sy, yc, thr_y)
	var out := start.duplicate()
	out["x"] = nx
	out["y"] = ny
	return out


## edgeResizeDeltaToFill: `edge` in n/s/e/w/ne/nw/se/sw; dx, dy in canvas fractions.
static func edge_resize(edge: String, start_fill: Dictionary, dx: float, dy: float, lock_aspect := true, min_s := 0.02,
		snap_x: Callable = Callable(), snap_y: Callable = Callable()) -> Dictionary:
	var fx := func(v: float) -> float: return snap_x.call(v) if snap_x.is_valid() else v
	var fy := func(v: float) -> float: return snap_y.call(v) if snap_y.is_valid() else v
	var x0 := _or(start_fill.get("x"), 0.0)
	var y0 := _or(start_fill.get("y"), 0.0)
	var sx0 := _or(start_fill.get("scaleX"), 1.0)
	var sy0 := _or(start_fill.get("scaleY"), 1.0)
	var right0 := x0 + sx0
	var bottom0 := y0 + sy0
	var he := edge.contains("e")
	var hw := edge.contains("w")
	var hs := edge.contains("s")
	var hn := edge.contains("n")
	var x := x0
	var y := y0
	var sx := sx0
	var sy := sy0
	if he:
		sx = fx.call(right0 + dx) - x
	if hw:
		var left: float = fx.call(x0 + dx)
		x = left
		sx = right0 - left
	if hs:
		sy = fy.call(bottom0 + dy) - y
	if hn:
		var top: float = fy.call(y0 + dy)
		y = top
		sy = bottom0 - top
	if lock_aspect:
		var ratio := sx0 / sy0 if sy0 > 1e-6 else 1.0
		var sx_floor := maxf(min_s, min_s * ratio)
		var horizontal := he or hw
		var vertical := hn or hs
		var drive_x := horizontal
		if horizontal and vertical:
			var rel_x := absf(sx / maxf(1e-6, sx0) - 1.0)
			var rel_y := absf(sy / maxf(1e-6, sy0) - 1.0)
			drive_x = rel_x >= rel_y
		if drive_x:
			sx = maxf(sx, sx_floor)
			sy = sx / maxf(1e-6, ratio)
		else:
			sy = maxf(sy, sx_floor / maxf(1e-6, ratio))
			sx = sy * ratio
		x = right0 - sx if hw else (x0 if he else x0 + (sx0 - sx) / 2.0)
		y = bottom0 - sy if hn else (y0 if hs else y0 + (sy0 - sy) / 2.0)
	else:
		if sx < min_s:
			if hw:
				x = right0 - min_s
			sx = min_s
		if sy < min_s:
			if hn:
				y = bottom0 - min_s
			sy = min_s
	var out := start_fill.duplicate()
	out["x"] = x
	out["y"] = y
	out["scaleX"] = sx
	out["scaleY"] = sy
	return out


## JS `v || d` for numbers (0 and missing → default).
static func _or(v: Variant, d: float) -> float:
	return float(v) if (v is float or v is int) and float(v) != 0.0 else d
