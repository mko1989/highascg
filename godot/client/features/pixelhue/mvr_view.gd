extends RefCounted
## WO-1039 MVR — pure view maths of the layout canvas: where the MVR output sits in the control (letterboxed),
## pixel ↔ output conversion, which window / corner handle is under the pointer. No autoloads.

const HANDLE_PX := 7.0
const MARGIN := 8.0


## The output's rectangle inside a control of `size` (aspect kept, MARGIN around).
static func frame(size: Vector2, screen_w: int, screen_h: int) -> Rect2:
	if screen_w <= 0 or screen_h <= 0:
		return Rect2()
	var avail := size - Vector2(MARGIN * 2, MARGIN * 2)
	if avail.x <= 0 or avail.y <= 0:
		return Rect2()
	var scale := minf(avail.x / screen_w, avail.y / screen_h)
	var dim := Vector2(screen_w * scale, screen_h * scale)
	return Rect2((size - dim) / 2.0, dim)


static func scale_of(f: Rect2, screen_w: int) -> float:
	return f.size.x / screen_w if screen_w > 0 else 1.0


static func to_output(f: Rect2, screen_w: int, p: Vector2) -> Vector2:
	return (p - f.position) / scale_of(f, screen_w)


static func window_rect(f: Rect2, screen_w: int, w: Dictionary) -> Rect2:
	var s := scale_of(f, screen_w)
	return Rect2(f.position + Vector2(float(w.x), float(w.y)) * s, Vector2(float(w.width), float(w.height)) * s)


## The corner handle of `r` under `p`: "nw" / "ne" / "sw" / "se", or "".
static func handle_at(r: Rect2, p: Vector2) -> String:
	var corners := {"nw": r.position, "ne": Vector2(r.end.x, r.position.y), "sw": Vector2(r.position.x, r.end.y), "se": r.end}
	for k in corners:
		var c: Vector2 = corners[k]
		if absf(p.x - c.x) <= HANDLE_PX and absf(p.y - c.y) <= HANDLE_PX:
			return k
	return ""


## The window id under `p` (control pixels): the selected window first (drawn on top), then the last drawn. -1 = none.
static func hit(f: Rect2, screen_w: int, windows: Array, selected_id: int, p: Vector2) -> int:
	for l in windows:
		if int(l.id) == selected_id:
			var r := window_rect(f, screen_w, l.window)
			if r.has_point(p) or handle_at(r, p) != "":
				return selected_id
	for i in range(windows.size() - 1, -1, -1):
		if window_rect(f, screen_w, windows[i].window).has_point(p):
			return int(windows[i].id)
	return -1
