extends RefCounted
## WO-621 N1 — operator compose window geometry (web operator-compose-tiles-geometry.js rules, applied to the
## server's cell rects): a cell `rect` is {x, y, w, h} as fractions of the operator canvas — the picture area
## itself (the web's "hole"); chrome is drawn outside it. Moves and resizes work in canvas px: snapped to an
## 8 px grid, kept inside the canvas, never below MIN (160×90, web MIN_BODY), resizes keep the window's aspect.

const GRID := 8.0
const MIN := Vector2(160, 90)


static func to_px(r: Dictionary, canvas: Vector2) -> Rect2:
	return Rect2(float(r.get("x", 0)) * canvas.x, float(r.get("y", 0)) * canvas.y,
		float(r.get("w", 0)) * canvas.x, float(r.get("h", 0)) * canvas.y)


static func to_frac(p: Rect2, canvas: Vector2) -> Dictionary:
	return {"x": p.position.x / canvas.x, "y": p.position.y / canvas.y, "w": p.size.x / canvas.x, "h": p.size.y / canvas.y}


static func snap(v: float) -> float:
	return roundf(v / GRID) * GRID


## Web clampTileRect: inside [0, canvas], at least `mn`.
static func clamp_rect(p: Rect2, canvas: Vector2, mn := MIN) -> Rect2:
	var w := maxf(mn.x, minf(p.size.x, maxf(mn.x, canvas.x)))
	var h := maxf(mn.y, minf(p.size.y, maxf(mn.y, canvas.y)))
	var x := maxf(0.0, minf(p.position.x, maxf(0.0, canvas.x - w)))
	var y := maxf(0.0, minf(p.position.y, maxf(0.0, canvas.y - h)))
	return Rect2(x, y, w, h)


## Drag the whole window by `d` canvas px from `start`.
static func moved(start: Rect2, d: Vector2, canvas: Vector2) -> Rect2:
	return clamp_rect(Rect2(snap(start.position.x + d.x), snap(start.position.y + d.y), start.size.x, start.size.y), canvas)


## Drag a corner by `d` canvas px: `corner` = (±1, ±1), +1 = right / bottom. The opposite corner stays put; the
## larger relative change wins and the other side follows the start aspect; the minimum and the canvas edge both
## cap it without distorting the picture.
static func resized(start: Rect2, d: Vector2, canvas: Vector2, corner := Vector2i(1, 1)) -> Rect2:
	var ar := start.size.x / start.size.y if start.size.y > 0 else 16.0 / 9.0
	var w := start.size.x + d.x * corner.x
	var h := start.size.y + d.y * corner.y
	if absf(d.x) / maxf(start.size.x, 1.0) >= absf(d.y) / maxf(start.size.y, 1.0):
		w = snap(w)
		h = w / ar
	else:
		h = snap(h)
		w = h * ar
	var room_x := canvas.x - start.position.x if corner.x > 0 else start.end.x
	var room_y := canvas.y - start.position.y if corner.y > 0 else start.end.y
	var lo := maxf(MIN.x, MIN.y * ar)  # smallest width meeting both minimums at this aspect
	w = clampf(w, lo, maxf(lo, minf(room_x, room_y * ar)))
	h = w / ar
	var x := start.position.x if corner.x > 0 else start.end.x - w
	var y := start.position.y if corner.y > 0 else start.end.y - h
	return Rect2(x, y, w, h)


## Which corner (±1, ±1) of `r` has its `zone`-sized hot square under `p`, or (0, 0).
static func corner_at(r: Rect2, p: Vector2, zone: float) -> Vector2i:
	for c in [Vector2i(1, 1), Vector2i(-1, 1), Vector2i(1, -1), Vector2i(-1, -1)]:
		var at := Vector2(r.end.x if c.x > 0 else r.position.x, r.end.y if c.y > 0 else r.position.y)
		if Rect2(at - Vector2(zone, zone) * 0.5, Vector2(zone, zone)).has_point(p):
			return c
	return Vector2i.ZERO


## Index of the window under canvas point `p` (topmost = last drawn), or -1. `below` (canvas px) widens the hit
## box by the label strip below the picture.
static func hit(rects: Array, p: Vector2, below := 0.0) -> int:
	for i in range(rects.size() - 1, -1, -1):
		var r: Rect2 = rects[i]
		if Rect2(r.position, r.size + Vector2(0, below)).has_point(p):
			return i
	return -1


## Source aspect of a PRV / PGM cell (web operator-compose-tiles-state.js resolveTileAspect, the server's
## resolveCellSourceDims): the cell's own srcW/srcH, else its channel's resolution
## (channelResolutionsByChannel[program/previewChannels[mainIndex]]), else programResolutions[mainIndex], else 16:9.
static func source_aspect(c: Dictionary, cm: Variant) -> float:
	if float(c.get("srcW", 0)) > 0 and float(c.get("srcH", 0)) > 0:
		return float(c.srcW) / float(c.srcH)
	var m: Dictionary = cm if cm is Dictionary else {}
	var mi := int(c.get("mainIndex", -1))
	var chans: Variant = m.get("programChannels" if str(c.get("role", "")) == "pgm" else "previewChannels")
	if chans is Array and mi >= 0 and mi < chans.size():
		var by: Variant = m.get("channelResolutionsByChannel")
		var res: Variant = (by as Dictionary).get(str(int(chans[mi]))) if by is Dictionary else null
		if res is Dictionary and float(res.get("w", 0)) > 0 and float(res.get("h", 0)) > 0:
			return float(res.w) / float(res.h)
	var pr: Variant = m.get("programResolutions")
	if pr is Array and mi >= 0 and mi < pr.size() and pr[mi] is Dictionary and float(pr[mi].get("w", 0)) > 0 and float(pr[mi].get("h", 0)) > 0:
		return float(pr[mi].w) / float(pr[mi].h)
	return 16.0 / 9.0


## The picture inside a cell rect: the largest `ar` rect centred in it (the server contain-fits the source).
static func fit(p: Rect2, ar: float) -> Rect2:
	var w := p.size.x
	var h := w / ar
	if h > p.size.y:
		h = p.size.y
		w = h * ar
	return Rect2(p.position + (p.size - Vector2(w, h)) / 2.0, Vector2(w, h))


## WO-624 E1: a Sources "Live" row payload ({type, value: "route://…", label, resolution, …}) — what the preview takes
## as a new window. Media files, looks and bare strings pass through.
static func droppable(data: Variant) -> bool:
	return data is Dictionary and str(data.get("value", "")).begins_with("route://")


## The ✕ square at the right end of a window's label strip (the strip hangs 2 px below the picture, 2 px wider).
static func close_rect(picture: Rect2, label_h: float, w: float) -> Rect2:
	return Rect2(picture.end.x + 2.0 - w, picture.end.y + 2.0, w, label_h)


## The preview area outside the canvas (`canvas_r` fit-centred in `area`): the letterbox / pillarbox bars. Owner
## 20.10: "invisible barriers … should be able to position it along the whole canvas" — the canvas edge was not drawn,
## so the black bars beside a 16:9 canvas read as canvas the windows could not reach.
static func outside(area: Vector2, canvas_r: Rect2) -> Array:
	var out := []
	if canvas_r.position.x > 0.5:
		out.append(Rect2(0, 0, canvas_r.position.x, area.y))
	if area.x - canvas_r.end.x > 0.5:
		out.append(Rect2(canvas_r.end.x, 0, area.x - canvas_r.end.x, area.y))
	if canvas_r.position.y > 0.5:
		out.append(Rect2(canvas_r.position.x, 0, canvas_r.size.x, canvas_r.position.y))
	if area.y - canvas_r.end.y > 0.5:
		out.append(Rect2(canvas_r.position.x, canvas_r.end.y, canvas_r.size.x, area.y - canvas_r.end.y))
	return out


## WO-597 §D: the server's atlas descriptor ({w, h, slots: {id: rect fractions}}), or {} for the monitor mosaic.
static func atlas_of(v: Variant) -> Dictionary:
	return (v as Dictionary).duplicate(true) if v is Dictionary and v.get("slots") is Dictionary else {}


## The slot window `id` crops, in texture px; an empty rect when the atlas has none for it.
static func slot_px(atlas: Dictionary, id: String, canvas: Vector2) -> Rect2:
	var s: Variant = (atlas.get("slots", {}) as Dictionary).get(id)
	if not (s is Dictionary):
		return Rect2()
	return Rect2(float(s.get("x", 0)) * canvas.x, float(s.get("y", 0)) * canvas.y, float(s.get("w", 0)) * canvas.x, float(s.get("h", 0)) * canvas.y)
