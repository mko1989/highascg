extends Control
## WO-605 slice 1 — the cable overlay (web renderCableOverlay): one hanging cable per graph edge from its source
## anchor to its sink anchor, in the edge's hash colour, over the whole Devices tab. Click-through. Rebuilds a
## cable only when its endpoints or the loop count change (web getOrBuild cache), and only once the anchors have
## been still for SETTLE_MS — while they move (splitter drag, resize) the last build is warped onto them. Polls
## anchors each frame because cards and sockets move with layout, not through signals.
## Slice 2c: `selected_id` thickens a cable like hover, `hidden_id` hides the cable whose end is held (re-grab), and
## while `ghost_from` is set a dashed straight ghost runs from that anchor to `pointer` (web --ghost, dasharray 5 4).
## `hit()` is the click hit-test the tab uses, since the layer itself stays click-through.
## Slice 10b: `simple` (Node view) draws each cable as cable_model.gd's fanned Bézier instead — rebuilt at once on
## any anchor change (it is cheap), the fan counted over `edges` (the graph's, minus the held one, like the web) — and
## the ghost as a dashed curve.

const CableModel := preload("res://features/devices/cable_model.gd")
const SETTLE_MS := 150
const GHOST := Color("#58a6ff")
const HIT_PX := 6.0

var anchors := {}  # anchor key → port_icon.gd Control
var cables: Array = []  # devices_model.gd build().cables
var loops := 0:
	set(v):
		loops = v
		_sig = ""
var active_id := "":
	set(v):
		active_id = v
		queue_redraw()

var selected_id := "":
	set(v):
		selected_id = v
		queue_redraw()
var hidden_id := "":
	set(v):
		hidden_id = v
		if simple:
			_sig = ""
		queue_redraw()
var simple := false:
	set(v):
		simple = v
		_sig = ""
		_built = {}
var edges: Array = []  # the graph's edges (Node view fans)
var ghost_from := "":  # anchor key, "" = no ghost
	set(v):
		if v != "" and ghost_from == "" and is_inside_tree():
			pointer = get_local_mouse_position()  # arming: start at the mouse, not (0, 0), before the first motion
		ghost_from = v
		queue_redraw()
var pointer := Vector2.ZERO:  # local
	set(v):
		pointer = v
		if ghost_from != "":
			queue_redraw()

var _built := {}  # cable id → {key, pts, color, ends}
var _ends := {}  # cable id → [from, to] (local), as of the last anchor change
var _sig := ""
var _settle_at := 0


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)


func set_cables(list: Array, anchor_map: Dictionary) -> void:
	cables = list
	anchors = anchor_map
	_sig = ""


## A destination's `id#pgm` falls back to the plain id when the card has no pair dots (web connectorCenter), and a
## bare destination id to its PGM dot when it has them (web anchorKeyFor(id, 'pgm')).
func _find(key: String) -> Control:
	var c: Variant = anchors.get(key)
	if c == null and key.contains("#"):
		c = anchors.get(key.get_slice("#", 0))
	elif c == null:
		c = anchors.get(key + "#pgm")
	return c if c is Control and is_instance_valid(c) and c.is_visible_in_tree() else null


func _process(_delta: float) -> void:
	if not is_visible_in_tree():
		return
	var inv := get_global_transform().affine_inverse()
	var ends := {}
	var parts: Array[String] = [str(loops)]
	for c in cables:
		var a := _find(c.from)
		var b := _find(c.to)
		if a == null or b == null:
			continue
		var p1: Vector2 = inv * a.anchor()
		var p2: Vector2 = inv * b.anchor()
		ends[c.id] = [p1, p2]
		parts.append("%s:%.1f,%.1f,%.1f,%.1f" % [c.id, p1.x, p1.y, p2.x, p2.y])
	var sig := "|".join(parts)
	var now := Time.get_ticks_msec()
	if sig != _sig:
		_sig = sig
		_ends = ends
		_settle_at = now + SETTLE_MS
		for id in _built.keys():
			if not ends.has(id):
				_built.erase(id)
		if simple:
			_build_simple()
		queue_redraw()
	if simple or now < _settle_at:
		return
	# Settled: rebuild ONE stale cable per frame (a GDScript build costs ~35–75 ms).
	for c in cables:
		if not _ends.has(c.id):
			continue
		var e: Array = _ends[c.id]
		var key := "%.1f,%.1f,%.1f,%.1f,%d" % [e[0].x, e[0].y, e[1].x, e[1].y, loops]
		var old: Variant = _built.get(c.id)
		if old is Dictionary and old.key == key:
			continue
		_built[c.id] = {"key": key, "color": CableModel.color(c.id), "ends": e,
			"pts": CableModel.build(e[0].x, e[0].y, e[1].x, e[1].y, loops, CableModel.seed_of(c.id))}
		queue_redraw()
		return


func _fans() -> Dictionary:
	return CableModel.simple_fans(edges.filter(func(e: Variant) -> bool: return not (e is Dictionary and str(e.get("id", "")) == hidden_id)))


func _build_simple() -> void:
	var fans := _fans()
	for c in cables:
		if _ends.has(c.id):
			var e: Array = _ends[c.id]
			var edge := {"id": c.id, "sourceId": str(c.from).get_slice("#", 0), "sinkId": c.to}
			_built[c.id] = {"key": "", "color": CableModel.color(c.id), "ends": e,
				"pts": CableModel.bezier(CableModel.simple_curve(edge, e[0], e[1], fans))}


## The cable as drawn now: its last build, its ends shifted onto the current anchors (a linear blend along the
## rope) until the settled rebuild replaces it; a straight run before the first build.
func _shape(id: String) -> PackedVector2Array:
	var e: Array = _ends[id]
	var b: Variant = _built.get(id)
	if not b is Dictionary:
		return PackedVector2Array([e[0], e[1]])
	var pts: PackedVector2Array = b.pts
	var d1: Vector2 = e[0] - b.ends[0]
	var d2: Vector2 = e[1] - b.ends[1]
	if d1 == Vector2.ZERO and d2 == Vector2.ZERO:
		return pts
	var out := PackedVector2Array()
	var last := maxf(1.0, pts.size() - 1.0)
	for i in pts.size():
		out.append(pts[i] + d1.lerp(d2, i / last))
	return out


## The visible cable under `local` (within HIT_PX of its drawn polyline), nearest first; "" when none.
func hit(local: Vector2) -> String:
	var best := ""
	var best_d := HIT_PX
	for id in _ends:
		if id == hidden_id:
			continue
		var pts := _shape(id)
		for i in range(pts.size() - 1):
			var dist := local.distance_to(Geometry2D.get_closest_point_to_segment(local, pts[i], pts[i + 1]))
			if dist < best_d:
				best_d = dist
				best = id
	return best


func _draw() -> void:
	for id in _ends:
		if id == hidden_id:
			continue
		var pts := _shape(id)
		var color: Color = _built[id].color if _built.has(id) else CableModel.color(id)
		var shadow := PackedVector2Array()
		for p in pts:
			shadow.append(p + Vector2(0, 3))
		draw_polyline(shadow, Color(0, 0, 0, 0.45), 4.0, true)
		draw_polyline(pts, color, 4.2 if id == active_id or id == selected_id else 2.8, true)
	var a := _find(ghost_from) if ghost_from != "" else null
	if a and simple:
		var from: Vector2 = get_global_transform().affine_inverse() * a.anchor()
		var ghost := {"id": "ghost", "sourceId": ghost_from.get_slice("#", 0), "sinkId": "ghost-sink"}
		_dashes(CableModel.bezier(CableModel.simple_curve(ghost, from, pointer, _fans())))
	elif a:
		draw_dashed_line(get_global_transform().affine_inverse() * a.anchor(), pointer, GHOST, 2.5, 5.0, true, true)


## A polyline dashed 5 on / 4 off (stroke-dasharray 5 4).
func _dashes(pts: PackedVector2Array) -> void:
	var on := true
	var left := 5.0
	for i in range(pts.size() - 1):
		var p := pts[i]
		var q := pts[i + 1]
		var seg := p.distance_to(q)
		while seg > 0.0:
			var run := minf(left, seg)
			var r := p + (q - p).normalized() * run
			if on:
				draw_line(p, r, GHOST, 2.5, true)
			p = r
			seg -= run
			left -= run
			if left <= 0.0:
				on = not on
				left = 5.0 if on else 4.0
