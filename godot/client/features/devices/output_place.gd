extends RefCounted
## WO-944 — "Place outputs": a mapping node's outputs as frames of their own resolution on the input canvas (the screen
## destination cabled into the node). Each output shows exactly the part of the canvas its frame covers, 1:1; what lies
## outside the canvas is black. Pure, unit-tested in test_devices_output_place.gd.
##
## No new data: a placed output IS the WO-869 single 1:1 slice — src {x, y, output w, output h} drawn at the output's
## top-left — which the planner already sends straight through (`direct`: DeckLink <subregion> src-x/src-y, GPU head at
## x/y). An output with no slice shows black; one with several, or a scaled / rotated / warped / feathered / faded one,
## is a "free slices" output and is left to the slice editor.

const SM := preload("res://features/devices/slice_model.gd")

## Canvas px (screen) within which an edge snaps to a canvas edge or another output's edge.
const SNAP_PX := 10.0
## Input px a free drag lands on when no edge is near (as slice_canvas_math.gd SNAP).
const GRID := 8.0


## True for a slice that shows exactly what a placed output shows: enabled, 1:1 at the output's top-left,
## untransformed, opaque, and per axis either the output's full size (what Place writes) or the output clipped to the
## `input` canvas (what the WO-869 editor wrote: it kept src rects inside the canvas — 3840×1024 for a 2160p output on a
## 1024-high canvas shows the same picture as 3840×2160).
static func is_placement(s: Dictionary, o: Dictionary, input: Vector2) -> bool:
	var r: Dictionary = s.dst.rect
	if not s.enabled or float(s.opacity) != 1.0 or float(s.dst.rotation) != 0.0 or s.dst.flipH or s.dst.flipV:
		return false
	if int(r.x) != 0 or int(r.y) != 0 or int(r.w) != int(s.src.w) or int(r.h) != int(s.src.h):
		return false
	var w := int(s.src.w)
	var h := int(s.src.h)
	if w != int(o.w) and w != mini(int(o.w), int(input.x) - int(s.src.x)):
		return false
	if h != int(o.h) and h != mini(int(o.h), int(input.y) - int(s.src.y)):
		return false
	for p in s.dst.warp:
		if float(p[0]) != 0.0 or float(p[1]) != 0.0:
			return false
	for k in ["l", "t", "r", "b"]:
		if int(s.feather[k]) != 0:
			return false
	return true


## Indices of the slices that land on output `id`.
static func slices_of(slices: Array, id: String) -> Array:
	var out := []
	for i in slices.size():
		if str(slices[i].outputId) == id:
			out.append(i)
	return out


## One frame per output: {id, label, w, h, x, y, kind}. kind: "placed" (one placement slice), "unplaced" (no slice —
## black; drawn where Side by side would put it), "free" (anything else — owned by the slice editor).
static func frames(slices: Array, outputs: Array, input: Vector2) -> Array:
	var pack := side_by_side(outputs)
	var out := []
	for k in outputs.size():
		var o: Dictionary = outputs[k]
		var mine := slices_of(slices, str(o.id))
		var f := {"id": str(o.id), "label": str(o.label), "w": int(o.w), "h": int(o.h), "x": int(pack[k].x), "y": 0, "kind": "unplaced"}
		if mine.size() == 1 and is_placement(slices[mine[0]], o, input):
			f.x = int(slices[mine[0]].src.x)
			f.y = int(slices[mine[0]].src.y)
			f.kind = "placed"
		elif not mine.is_empty():
			var s: Dictionary = slices[mine[0]]
			f.x = int(s.src.x)
			f.y = int(s.src.y)
			f.kind = "free"
		out.append(f)
	return out


## True when every output is placed or unplaced — the node needs nothing the slice editor alone can show.
static func all_placeable(slices: Array, outputs: Array, input: Vector2) -> bool:
	return frames(slices, outputs, input).all(func(f: Dictionary) -> bool: return f.kind != "free")


## The slice list with output `o` placed at (x, y): its slices become one placement slice (the first one's id / name
## kept, so the server's plan and the inspector row stay the same object).
static func placed(slices: Array, o: Dictionary, x: int, y: int) -> Array:
	var mine := slices_of(slices, str(o.id))
	var src := {"x": x, "y": y, "w": int(o.w), "h": int(o.h)}
	var out := []
	var done := false
	for i in slices.size():
		if not i in mine:
			out.append(slices[i])
		elif not done:
			var s: Dictionary = slices[i].duplicate(true)
			s.src = src
			s.enabled = true
			s.opacity = 1.0
			s.dst = {"rect": {"x": 0, "y": 0, "w": src.w, "h": src.h}, "rotation": 0.0, "flipH": false, "flipV": false,
				"warp": [[0.0, 0.0], [0.0, 0.0], [0.0, 0.0], [0.0, 0.0]]}
			s.feather = {"l": 0, "t": 0, "r": 0, "b": 0}
			out.append(s)
			done = true
	if not done:
		var s := SM.new_slice(out, str(o.id), src)
		s.name = str(o.label)
		out.append(s)
	return out


## Left to right at y 0, each at its own width: [{x, y}] per output.
static func side_by_side(outputs: Array) -> Array:
	var x := 0
	var out := []
	for o in outputs:
		out.append({"x": x, "y": 0})
		x += int(o.w)
	return out


## "Side by side" applied: every placeable output at side_by_side()'s spot; free-slice outputs keep their slices.
static func lined_up(slices: Array, outputs: Array, input: Vector2) -> Array:
	var pos := side_by_side(outputs)
	var fs := frames(slices, outputs, input)
	var list := slices
	for k in outputs.size():
		if fs[k].kind != "free":
			list = placed(list, outputs[k], int(pos[k].x), int(pos[k].y))
	return list


## Keep a frame touching the canvas: its top-left inside [0, input).
static func clamp_pos(p: Vector2, input: Vector2) -> Vector2i:
	return Vector2i(clampi(roundi(p.x), 0, maxi(0, int(input.x) - 1)), clampi(roundi(p.y), 0, maxi(0, int(input.y) - 1)))


## A dragged top-left `p` for a w×h frame, snapped (per axis, nearest within `tol` input px) to: the canvas edges
## (frame's left / right on 0 or the canvas width; same for top / bottom), and every other frame's edges (abut or
## align); nothing near → the 8 px grid; tol 0 (Alt) → exact. `others` = [{x, y, w, h}]. Then clamped (clamp_pos).
static func snapped(p: Vector2, w: int, h: int, input: Vector2, others: Array, tol: float) -> Vector2i:
	var xs := [0.0, input.x, input.x - w]
	var ys := [0.0, input.y, input.y - h]
	for o in others:
		xs.append_array([float(o.x), float(o.x) + o.w, float(o.x) - w, float(o.x) + o.w - w])
		ys.append_array([float(o.y), float(o.y) + o.h, float(o.y) - h, float(o.y) + o.h - h])
	return clamp_pos(Vector2(_nearest(p.x, xs, tol), _nearest(p.y, ys, tol)), input)


## The nearest candidate within `tol`; none near → the 8 px grid (the slice editor's snap); tol 0 (Alt) → as is.
static func _nearest(v: float, cands: Array, tol: float) -> float:
	if tol <= 0.0:
		return v
	var best := roundf(v / GRID) * GRID
	var d := tol
	for c in cands:
		if absf(c - v) <= d:
			d = absf(c - v)
			best = c
	return best


## "shows canvas x 3840–6144, y 0–1024 · rest black" — what part of the canvas the output carries.
static func shows_text(f: Dictionary, input: Vector2) -> String:
	var x0 := clampi(int(f.x), 0, int(input.x))
	var y0 := clampi(int(f.y), 0, int(input.y))
	var x1 := clampi(int(f.x) + int(f.w), 0, int(input.x))
	var y1 := clampi(int(f.y) + int(f.h), 0, int(input.y))
	if x1 <= x0 or y1 <= y0:
		return "off the canvas · all black"
	var t := "canvas x %d–%d, y %d–%d" % [x0, x1, y0, y1]
	return t + (" · rest black" if (x1 - x0) * (y1 - y0) < int(f.w) * int(f.h) else "")
