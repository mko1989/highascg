extends RefCounted
## WO-1039 — Screens sub-tab model: drafts, output-tile geometry (snapping, hit-testing, scale-to-fit), request bodies
## and the checks Studio's lib/studio-screens.js repeats. Pure, static, no autoloads.
## A draft is {window:{x,y,width,height}, outputs:[{id, pos:{x,y,width,height}}]} with tile pos relative to the window.

const MIN_SIZE := 64
const MAX_SIZE := 16384
const SNAP_PX := 12.0
const TYPE_MAIN := 2
const TYPE_AUX := 4
const TYPE_LED := 32
const RANGE_NAMES := ["SDR", "HDR10", "HLG"]
const SAMPLING := [[0, "RGB 4:4:4"], [1, "YCbCr 4:2:2"], [2, "YCbCr 4:4:4"]]
const GAMUT_NAMES := ["Rec.601", "Rec.709", "DCI-P3", "Rec.2020"]
const QUALITY := [["brightness", "Brightness", 0, 200, 100], ["contrast", "Contrast", 0, 200, 100], ["saturation", "Saturation", 0, 200, 100], ["hue", "Hue °", -180, 180, 0]]


static func _i(v: Variant) -> int:
	return int(round(float(v))) if (v is int or v is float) else 0


static func rect(x: int, y: int, w: int, h: int) -> Dictionary:
	return {"x": x, "y": y, "width": w, "height": h}


static func type_label(t: int) -> String:
	return "AUX" if t == TYPE_AUX else ("LED" if t == TYPE_LED else "Main")


static func screen_label(s: Dictionary) -> String:
	return "%s · %d × %d%s" % [str(s.get("name", "")), _i(s.get("width")), _i(s.get("height")), "" if s.get("enabled", true) != false else " · off"]


static func next_name(screens: Array) -> String:
	var n := 1
	while true:
		var name := "Screen %d" % n
		var taken := false
		for s in screens:
			if s is Dictionary and str(s.get("name", "")) == name:
				taken = true
		if not taken:
			return name
		n += 1
	return ""


# ---- drafts ---------------------------------------------------------------------------------------------------

static func draft_for(s: Dictionary) -> Dictionary:
	var sx := _i(s.get("x"))
	var sy := _i(s.get("y"))
	var outs: Array = []
	for o in s.get("outputs", []):
		var p: Dictionary = o.get("pos", {})
		outs.append({"id": _i(o.get("id")), "pos": rect(_i(p.get("x")) - sx, _i(p.get("y")) - sy, _i(p.get("width")), _i(p.get("height")))})
	return {"window": rect(sx, sy, _i(s.get("width")), _i(s.get("height"))), "outputs": outs}


static func bbox(outputs: Array) -> Dictionary:
	var w := MIN_SIZE
	var h := MIN_SIZE
	for o in outputs:
		var p: Dictionary = o.pos
		w = maxi(w, _i(p.x) + _i(p.width))
		h = maxi(h, _i(p.y) + _i(p.height))
	return {"width": w, "height": h}


## The screen grows to the tiles' bounding box so tiles always fit.
static func grow(draft: Dictionary) -> void:
	var b := bbox(draft.outputs)
	draft.window.width = maxi(_i(draft.window.width), b.width)
	draft.window.height = maxi(_i(draft.window.height), b.height)


static func fit_window(draft: Dictionary) -> void:
	if not (draft.outputs as Array).is_empty():
		var b := bbox(draft.outputs)
		draft.window.width = b.width
		draft.window.height = b.height


static func find_mapping(draft: Dictionary, output_id: int) -> int:
	for i in (draft.outputs as Array).size():
		if _i(draft.outputs[i].id) == output_id:
			return i
	return -1


## "+ Add": the tile goes right of the rightmost tile, at the output's own timing size.
static func add_output(draft: Dictionary, output: Dictionary) -> void:
	var right := 0
	for o in draft.outputs:
		right = maxi(right, _i(o.pos.x) + _i(o.pos.width))
	var tm: Dictionary = output.get("timing") if output.get("timing") is Dictionary else {}
	var w := _i(tm.get("width")) if _i(tm.get("width")) > 0 else 1920
	var h := _i(tm.get("height")) if _i(tm.get("height")) > 0 else 1080
	draft.outputs.append({"id": _i(output.get("id")), "pos": rect(right, 0, w, h)})
	grow(draft)


static func remove_output(draft: Dictionary, output_id: int) -> void:
	var i := find_mapping(draft, output_id)
	if i >= 0:
		(draft.outputs as Array).remove_at(i)


## "Tile selected outputs": a cols × rows grid filling the window.
static func tile_grid(draft: Dictionary, cols_in: int) -> void:
	var n: int = (draft.outputs as Array).size()
	var cols := clampi(cols_in, 1, 32)
	var rows := maxi(1, ceili(float(n) / cols))
	var ww := _i(draft.window.width)
	var wh := _i(draft.window.height)
	for i in n:
		var c := i % cols
		var r := i / cols
		var x := roundi(float(c * ww) / cols)
		var y := roundi(float(r * wh) / rows)
		draft.outputs[i].pos = rect(x, y, roundi(float((c + 1) * ww) / cols) - x, roundi(float((r + 1) * wh) / rows) - y)


# ---- canvas geometry ------------------------------------------------------------------------------------------

static func fit_scale(win_w: int, win_h: int, avail: Vector2) -> float:
	return minf(avail.x / maxf(MIN_SIZE, win_w), avail.y / maxf(MIN_SIZE, win_h))


static func tile_view_rect(pos: Dictionary, scale: float, origin: Vector2) -> Rect2:
	return Rect2(origin + Vector2(_i(pos.x), _i(pos.y)) * scale, Vector2(_i(pos.width), _i(pos.height)) * scale)


## Topmost (last drawn) tile under a view point, -1 for none.
static func hit_test(outputs: Array, point: Vector2, scale: float, origin: Vector2) -> int:
	for i in range(outputs.size() - 1, -1, -1):
		if tile_view_rect(outputs[i].pos, scale, origin).has_point(point):
			return i
	return -1


## Nearest alignment delta within the threshold, or INF.
static func _nearest(values: Array, lines: Array, thr: float) -> float:
	var best := INF
	for v in values:
		for l in lines:
			var d: float = float(l) - float(v)
			if absf(d) <= thr and absf(d) < absf(best):
				best = d
	return best


## Studio's snapWindow for a move: tile edges / centres snap to the window's and the other tiles' edges / centres.
static func snap_move(pos: Dictionary, win: Dictionary, others: Array, thr: float) -> Dictionary:
	var xs: Array = [0, _i(win.width) / 2.0, _i(win.width)]
	var ys: Array = [0, _i(win.height) / 2.0, _i(win.height)]
	for o in others:
		xs.append_array([o.x, o.x + o.width / 2.0, o.x + o.width])
		ys.append_array([o.y, o.y + o.height / 2.0, o.y + o.height])
	var next := pos.duplicate()
	var dx := _nearest([pos.x, pos.x + pos.width / 2.0, pos.x + pos.width], xs, thr)
	var dy := _nearest([pos.y, pos.y + pos.height / 2.0, pos.y + pos.height], ys, thr)
	if dx != INF:
		next.x = roundi(pos.x + dx)
	if dy != INF:
		next.y = roundi(pos.y + dy)
	return next


## A drag of `delta` window pixels from `before`; snaps unless `free` (Alt); never below the origin.
static func drag_pos(before: Dictionary, delta: Vector2, win: Dictionary, others: Array, scale: float, free: bool) -> Dictionary:
	var p := before.duplicate()
	p.x = roundi(before.x + delta.x)
	p.y = roundi(before.y + delta.y)
	if not free:
		p = snap_move(p, win, others, SNAP_PX / maxf(scale, 0.0001))
	p.x = maxi(0, p.x)
	p.y = maxi(0, p.y)
	return p


# ---- outputs list ---------------------------------------------------------------------------------------------

## Outputs a screen may map: AUX screens take AUX outputs, Main screens the others.
static func available_outputs(screen: Dictionary, outputs: Array) -> Array:
	var r: Array = []
	for o in outputs:
		if o is Dictionary and (_i(screen.get("type")) == TYPE_AUX) == (str(o.get("role", "")) == "AUX"):
			r.append(o)
	return r


static func owner_name(screens: Array, screen_id: int, output_id: int) -> String:
	for s in screens:
		if _i(s.get("id")) != screen_id:
			for o in s.get("outputs", []):
				if _i(o.get("id")) == output_id:
					return str(s.get("name", ""))
	return ""


static func output_size(o: Dictionary) -> String:
	var tm: Dictionary = o.get("timing") if o.get("timing") is Dictionary else {}
	return "%s × %s" % [str(tm.get("width", "?")), str(tm.get("height", "?"))]


# ---- validation (studio-screens.js rect / applyScreens) ---------------------------------------------------------

static func _int_in(v: Variant, label: String, lo: int, hi: int) -> String:
	if not (v is int or v is float) or float(v) != floorf(float(v)) or v < lo or v > hi:
		return "%s must be a whole number from %d to %d." % [label, lo, hi]
	return ""


static func _rect_error(r: Dictionary, label: String) -> String:
	for k in [["x", "X", -100000, 100000], ["y", "Y", -100000, 100000], ["width", "width", MIN_SIZE, MAX_SIZE], ["height", "height", MIN_SIZE, MAX_SIZE]]:
		var e := _int_in(r.get(k[0]), "%s %s" % [label, k[1]], k[2], k[3])
		if e != "":
			return e
	return ""


static func draft_error(draft: Dictionary) -> String:
	var e := _rect_error(draft.window, "Screen")
	if e != "":
		return e
	var seen := {}
	for o in draft.outputs:
		if seen.has(o.id):
			return "Unknown or duplicate screen output."
		seen[o.id] = true
		e = _rect_error(o.pos, "Output tile")
		if e != "":
			return e
		var p: Dictionary = o.pos
		if p.x < 0 or p.y < 0 or p.x + p.width > draft.window.width or p.y + p.height > draft.window.height:
			return "Output tiles must fit inside their screen."
	return ""


static func draft_changed(draft: Dictionary, screen: Dictionary) -> bool:
	return draft != draft_for(screen)


# ---- request bodies -------------------------------------------------------------------------------------------

static func create_body(name: String, type: int) -> Dictionary:
	return {"action": "create", "name": name, "type": type}


static func delete_body(id: int) -> Dictionary:
	return {"action": "delete", "id": id}


static func toggle_body(action: String, id: int, current: int) -> Dictionary:
	return {"action": action, "id": id, "enable": 0 if current != 0 else 1}


static func update_body(id: int, draft: Dictionary) -> Dictionary:
	return {"action": "update", "id": id, "window": draft.window.duplicate(), "outputs": draft.outputs.duplicate(true)}


static func pattern_body(id: int, change: Dictionary) -> Dictionary:
	return {"action": "pattern", "id": id, "pattern": change}


static func quality_body(id: int, change: Dictionary) -> Dictionary:
	return {"action": "quality", "id": id, "quality": change}


static func format_body(id: int, change: Dictionary) -> Dictionary:
	return {"action": "format", "id": id, "format": change}


# ---- test pattern / colour / format ---------------------------------------------------------------------------

static func is_line_pattern(t: int) -> bool:
	return t >= 512 and t <= 517


static func is_grid_pattern(t: int) -> bool:
	return (t >= 5 and t <= 7) or (t >= 256 and t <= 263)


static func gear_label(g: int) -> String:
	return "%d px" % roundi(2048.0 / pow(2.0, g))


static func bright_label(v: int) -> String:
	return "%d%%" % (v * 25)


static func speed_label(v: int) -> String:
	return "Speed %d" % v if v != 0 else "Still"


## options[str(type)] → limits dict, {} when the screen type offers nothing.
static func limits_for(options: Dictionary, type: int) -> Dictionary:
	var l: Variant = options.get(str(type))
	return l if l is Dictionary else {}


static func has_extras(limits: Dictionary) -> bool:
	return limits.get("pattern") is Dictionary or not (limits.get("quality", []) as Array).is_empty() or limits.get("format") is Dictionary


## Pattern dropdown choice → request change ("off" or a type number).
static func pattern_choice_change(choice: Variant) -> Dictionary:
	if str(choice) == "off":
		return {"enable": false}
	return {"enable": true, "type": _i(choice)}


static func format_rule(limits: Dictionary, range_v: int) -> Dictionary:
	var rules: Dictionary = limits.get("rules", {})
	var r: Variant = rules.get(str(range_v), rules.get("0"))
	return r if r is Dictionary else {}


static func _has(arr: Variant, v: int) -> bool:
	for x in (arr if arr is Array else []):
		if _i(x) == v:
			return true
	return false


## Entering a dynamic range also moves depth and gamut to values that range allows, in one request.
static func range_change(limits: Dictionary, f: Dictionary, range_v: int) -> Dictionary:
	var next := format_rule(limits, range_v)
	var c := {"dynamicRange": range_v}
	var depths: Array = next.get("depths", [])
	if not (_has(depths, _i(f.get("colorDepth"))) or (_i(f.get("colorSpace")) == 1 and next.get("fixed422") != null)) and not depths.is_empty():
		c.colorDepth = _i(depths[0])
	var gamuts: Array = next.get("gamuts", [])
	if not _has(gamuts, _i(f.get("colorGamut"))) and not gamuts.is_empty():
		c.colorGamut = _i(gamuts[gamuts.size() - 1])
	return c


## Bit depths offered: YCbCr 4:2:2 fixes the depth on screens whose rule says so.
static func depth_choices(rule: Dictionary, color_space: int) -> Array:
	if color_space == 1 and rule.get("fixed422") != null:
		return [_i(rule.fixed422)]
	return rule.get("depths", [])
