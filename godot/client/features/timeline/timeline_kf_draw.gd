extends RefCounted
## WO-602 slice 4 — keyframe diamonds on a clip (web timeline-canvas-clip.js): one colour per property, opacity / volume
## at value height, the selected one larger with a blue (dragging: white) outline. Where the web joins opacity / volume
## keys with a straight dashed line, this draws the curve Caspar actually plays — each segment eased by its end key
## (owner decision, WO-602) — sampled every 3 px.

const K := preload("res://features/timeline/timeline_keyframes.gd")
const SAMPLE_PX := 3.0


## `top` / `h`: the clip row on screen (same rect the hit test uses); `x_at`: timeline ms → x; [x_min, x_max]: visible.
static func draw(ci: CanvasItem, clip: Dictionary, top: float, h: float, x_at: Callable, x_min: float, x_max: float,
		sel: Variant, dragging: bool) -> void:
	var ks: Array = clip.get("keyframes", []) if clip.get("keyframes") is Array else []
	if ks.is_empty():
		return
	var st := float(clip.get("startTime", 0))
	for prop in K.PROPS:
		var pk := K.of(clip, prop)
		if pk.size() < 2:
			continue
		var x0 := maxf(x_at.call(st + float(pk[0].time)), x_min)
		var x1 := minf(x_at.call(st + float(pk[-1].time)), x_max)
		if x1 <= x0:
			continue
		var pts := PackedVector2Array()
		var sx: float = x_at.call(st)
		var px_ms := maxf(1e-9, (x_at.call(st + 1000.0) - sx) / 1000.0)  # x_at is linear
		var x := x0
		while true:
			pts.append(Vector2(x, top + K.value_y(K.eased(clip, (x - sx) / px_ms, prop, 1.0), h)))
			if x >= x1:
				break
			x = minf(x + SAMPLE_PX, x1)
		var col := Color(K.COLORS[prop])
		col.a = 0.6
		ci.draw_polyline(pts, col, 1.5, true)
	for kf in ks:
		var kx: float = x_at.call(st + float(kf.time))
		if kx < x_min or kx > x_max:
			continue
		var ky := top + K.marker_y(kf, h)
		var on := is_same(kf, sel)
		var r := 6.0 if on else 4.0
		var rv := 7.0 if on else 5.0
		var poly := PackedVector2Array([Vector2(kx, ky - rv), Vector2(kx + r, ky), Vector2(kx, ky + rv), Vector2(kx - r, ky)])
		ci.draw_colored_polygon(poly, Color(K.COLORS.get(str(kf.property), "#ffd700")))
		if on:
			poly.append(poly[0])
			ci.draw_polyline(poly, Color.WHITE if dragging else Color("#58a6ff"), 1.5, true)
