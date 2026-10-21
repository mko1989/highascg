extends RefCounted
## WO-658 — Live 2D Auto layout: one PGM window per screen (main) on the top row, its PRV window right below it
## (owner 21.10: "pgm top its prv bottom always"), one column per main, tiled into the VISIBLE part of the
## width-filled operator canvas (WO-648) so the windows shrink with the panel. Each picture is contain-fitted at its
## main's program aspect and centred in its cell, leaving room under it for the label strip. Pure, tests headless.

const GAP := 0.03  # of the visible height, around and between the cells


## mains: [{main: int, prv: bool, aspect: float}] · view: the visible canvas rect (canvas px) · label: the label strip
## height in canvas px. Returns {cell id: {x, y, w, h} fractions of `canvas`} for "pgm_N" / "prv_N" (N = main + 1).
static func tile(mains: Array, view: Rect2, canvas: Vector2, label: float) -> Dictionary:
	var out := {}
	if mains.is_empty() or view.size.x <= 0.0 or view.size.y <= 0.0 or canvas.x <= 0.0 or canvas.y <= 0.0:
		return out
	var rows := 2 if mains.any(func(m: Dictionary) -> bool: return m.get("prv", false)) else 1
	var gap := view.size.y * GAP
	var col_w := (view.size.x - gap * (mains.size() + 1)) / mains.size()
	var row_h := (view.size.y - gap * (rows + 1)) / rows
	var pic_h := maxf(1.0, row_h - label)
	for ci in mains.size():
		var m: Dictionary = mains[ci]
		var ar := float(m.get("aspect", 16.0 / 9.0))
		var w := minf(col_w, pic_h * ar)
		var h := w / ar
		var x := view.position.x + gap + ci * (col_w + gap) + (col_w - w) / 2.0
		for r in rows:
			if r == 1 and not m.get("prv", false):
				continue
			var y := view.position.y + gap + r * (row_h + gap) + (pic_h - h) / 2.0
			out["%s_%d" % ["pgm" if r == 0 else "prv", int(m.main) + 1]] = {"x": x / canvas.x, "y": y / canvas.y, "w": w / canvas.x, "h": h / canvas.y}
	return out


## The part of the canvas the width-filled preview shows (canvas px): `image` = where the canvas is drawn in the panel.
static func visible_view(panel: Vector2, image: Rect2, canvas: Vector2) -> Rect2:
	if image.size.x <= 0.0:
		return Rect2()
	var k := canvas.x / image.size.x
	return Rect2((-image.position) * k, panel * k).intersection(Rect2(Vector2.ZERO, canvas))


## Merge the tiled rects into `cells`: existing pgm / prv windows move, missing ones are added (other windows —
## live sources, multiview cells — are left alone). Returns true when anything changed by more than `eps`.
static func apply(cells: Array, rects: Dictionary, eps := 1e-4) -> bool:
	var changed := false
	var seen := {}
	for c in cells:
		var id := str(c.get("id", ""))
		if rects.has(id):
			seen[id] = true
			var old: Dictionary = c.get("rect", {}) if c.get("rect") is Dictionary else {}
			for k in ["x", "y", "w", "h"]:
				if absf(float(old.get(k, -1.0)) - float(rects[id][k])) > eps:
					changed = true
			c["rect"] = (rects[id] as Dictionary).duplicate()
	for id in rects:
		if not seen.has(id):
			var parts := str(id).split("_")
			cells.append({"id": id, "role": parts[0], "mainIndex": int(parts[1]) - 1, "rect": (rects[id] as Dictionary).duplicate(), "surface": "compose"})
			changed = true
	return changed
