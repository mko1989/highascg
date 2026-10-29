extends RefCounted
## WO-807 phase 2 — the pixel map editor's pure logic (pixel_map_window.gd draws it). Server model: phase 1
## `project.pixelMappings` (src/fixtures/pixel-map-model.js): one mapping per fixture pixel, each with its own
## channelNo + rect {x, y, w, h} in channel pixels. The editor shows REGIONS: the distinct (channel, rect) pairs of
## the stored list plus rectangles drawn and not yet used; a pixel row picks one. Regions: {id "R<n>", channelNo, x, y,
## w, h} (ints). Rows: {pixel, geometry, order, id (mapping id or ""), enabled, region ("" = unmapped), mode,
## colourOrder}. Godot's JSON numbers are floats: everything from the API is cast with int().

const MODES := ["average", "point"]


## Caspar channel → its raster from channelMap.channelResolutionsByChannel (the map the server checks rects against).
static func raster_of(cm: Variant, ch: int) -> Vector2i:
	var by: Variant = (cm as Dictionary).get("channelResolutionsByChannel") if cm is Dictionary else null
	var r: Variant = (by as Dictionary).get(str(ch)) if by is Dictionary else null
	if r is Dictionary and int(r.get("w", 0)) > 0 and int(r.get("h", 0)) > 0:
		return Vector2i(int(r.w), int(r.h))
	return Vector2i.ZERO


## The channels Caspar runs, ascending.
static func channels(cm: Variant) -> Array:
	var by: Variant = (cm as Dictionary).get("channelResolutionsByChannel") if cm is Dictionary else null
	var out: Array = []
	if by is Dictionary:
		for k in by:
			if str(k).is_valid_int() and raster_of(cm, int(k)) != Vector2i.ZERO:
				out.append(int(k))
	out.sort()
	return out


## The video surface role of channel ch — the same as the server's roleFor (pixel-map-service.js), so the editor and
## the sampler share one Caspar consumer: pgmN / prvN when the channel is that bus, else chN.
static func role_for(ch: int, cm: Variant) -> String:
	var m: Dictionary = cm if cm is Dictionary else {}
	var pgm: Array = (m.get("programChannels", []) as Array).map(func(v: Variant) -> int: return int(v)) if m.get("programChannels") is Array else []
	var prv: Array = (m.get("previewChannels", []) as Array).map(func(v: Variant) -> int: return int(v)) if m.get("previewChannels") is Array else []
	var i := pgm.find(ch)
	if i >= 0 and i < 4:
		return "pgm%d" % (i + 1)
	i = prv.find(ch)
	if i >= 0 and i < 4 and (i >= pgm.size() or pgm[i] != ch):
		return "prv%d" % (i + 1)
	return "ch%d" % ch


static func channel_label(ch: int, cm: Variant) -> String:
	var r := raster_of(cm, ch)
	var role := role_for(ch, cm)
	var bus := "Program %s" % role.substr(3) if role.begins_with("pgm") else ("Preview %s" % role.substr(3) if role.begins_with("prv") else "")
	return "Channel %d%s · %d×%d" % [ch, " (%s)" % bus if bus != "" else "", r.x, r.y]


## Two raster points (any order, fractional) → the whole-pixel rect that covers both, inside the raster, ≥ 1 × 1.
static func snap_rect(a: Vector2, b: Vector2, raster: Vector2i) -> Rect2i:
	var x0 := clampi(floori(minf(a.x, b.x)), 0, maxi(raster.x - 1, 0))
	var y0 := clampi(floori(minf(a.y, b.y)), 0, maxi(raster.y - 1, 0))
	var x1 := clampi(ceili(maxf(a.x, b.x)), x0 + 1, maxi(raster.x, x0 + 1))
	var y1 := clampi(ceili(maxf(a.y, b.y)), y0 + 1, maxi(raster.y, y0 + 1))
	return Rect2i(x0, y0, x1 - x0, y1 - y0)


## Size clamped to 1…raster, then position so the rect lies inside the raster.
static func clamp_rect(r: Rect2i, raster: Vector2i) -> Rect2i:
	var w := clampi(r.size.x, 1, maxi(raster.x, 1))
	var h := clampi(r.size.y, 1, maxi(raster.y, 1))
	return Rect2i(clampi(r.position.x, 0, maxi(raster.x - w, 0)), clampi(r.position.y, 0, maxi(raster.y - h, 0)), w, h)


## Move by a raster delta (rounded to whole pixels), kept inside the raster.
static func move_rect(r: Rect2i, delta: Vector2, raster: Vector2i) -> Rect2i:
	return clamp_rect(Rect2i(r.position + Vector2i(roundi(delta.x), roundi(delta.y)), r.size), raster)


## Drag the bottom-right corner to raster point p (the top-left stays; never smaller than 1 × 1).
static func resize_rect(r: Rect2i, p: Vector2, raster: Vector2i) -> Rect2i:
	var w := clampi(roundi(p.x) - r.position.x, 1, maxi(raster.x - r.position.x, 1))
	var h := clampi(roundi(p.y) - r.position.y, 1, maxi(raster.y - r.position.y, 1))
	return Rect2i(r.position, Vector2i(w, h))


## Why rect r cannot be saved on a channel of this raster ("" = fine). Mirrors the server's checkMapping rect test.
static func rect_problem(r: Rect2i, raster: Vector2i) -> String:
	if raster.x <= 0 or raster.y <= 0:
		return "channel not running"
	if r.size.x < 1 or r.size.y < 1:
		return "empty"
	if r.position.x < 0 or r.position.y < 0 or r.end.x > raster.x or r.end.y > raster.y:
		return "outside %d×%d" % [raster.x, raster.y]
	return ""


static func size_label(r: Rect2i) -> String:
	return "%d × %d px" % [r.size.x, r.size.y]


static func to_rect(region: Dictionary) -> Rect2i:
	return Rect2i(int(region.get("x", 0)), int(region.get("y", 0)), int(region.get("w", 0)), int(region.get("h", 0)))


static func make_region(id: String, ch: int, r: Rect2i) -> Dictionary:
	return {"id": id, "channelNo": ch, "x": r.position.x, "y": r.position.y, "w": r.size.x, "h": r.size.y}


static func next_region_id(regions: Array) -> String:
	var n := 0
	for g in regions:
		var s := str(g.id).substr(1)
		if s.is_valid_int():
			n = maxi(n, int(s))
	return "R%d" % (n + 1)


## Topmost region of channel ch containing raster point p (index into regions), -1 for none.
static func hit(regions: Array, ch: int, p: Vector2) -> int:
	for i in range(regions.size() - 1, -1, -1):
		var g: Dictionary = regions[i]
		if int(g.channelNo) == ch and Rect2(to_rect(g)).has_point(p):
			return i
	return -1


static func _key(ch: int, x: int, y: int, w: int, h: int) -> String:
	return "%d:%d,%d,%d,%d" % [ch, x, y, w, h]


static func _mapping_key(m: Dictionary) -> String:
	var r: Dictionary = m.get("rect", {}) if m.get("rect") is Dictionary else {}
	return _key(int(m.get("channelNo", 0)), int(r.get("x", 0)), int(r.get("y", 0)), int(r.get("w", 0)), int(r.get("h", 0)))


## The stored mappings' distinct (channel, rect) pairs as regions R1, R2, … in first-use order.
static func regions_from(mappings: Array) -> Array:
	var out: Array = []
	var seen := {}
	for m in mappings:
		if not (m is Dictionary):
			continue
		var k := _mapping_key(m)
		if seen.has(k):
			continue
		var r: Dictionary = m.get("rect", {}) if m.get("rect") is Dictionary else {}
		var g := make_region("R%d" % (out.size() + 1), int(m.get("channelNo", 0)),
			Rect2i(int(r.get("x", 0)), int(r.get("y", 0)), int(r.get("w", 0)), int(r.get("h", 0))))
		seen[k] = g.id
		out.append(g)
	return out


static func region_for(regions: Array, m: Dictionary) -> String:
	var k := _mapping_key(m)
	for g in regions:
		if _key(int(g.channelNo), int(g.x), int(g.y), int(g.w), int(g.h)) == k:
			return str(g.id)
	return ""


static func find_region(regions: Array, id: String) -> Dictionary:
	for g in regions:
		if str(g.id) == id:
			return g
	return {}


## One row per pixel of fixture f (GET /api/fixtures/pixelmap/pixels entry) with its stored mapping, if any (an
## enabled one wins over a disabled one).
static func rows_for(f: Dictionary, mappings: Array, regions: Array) -> Array:
	var fid := str(f.get("id", ""))
	var rows: Array = []
	for p in f.get("pixels", []):
		var n := int(p.get("pixel", 0))
		var hit_m: Dictionary = {}
		for m in mappings:
			if m is Dictionary and str(m.get("fixtureId", "")) == fid and int(m.get("pixel", 0)) == n:
				if hit_m.is_empty() or (m.get("enabled", true) != false and hit_m.get("enabled", true) == false):
					hit_m = m
		rows.append({"pixel": n, "geometry": str(p.get("geometry", "")), "order": str(p.get("order", "")),
			"id": str(hit_m.get("id", "")), "enabled": hit_m.get("enabled", true) != false,
			"region": region_for(regions, hit_m) if not hit_m.is_empty() else "",
			"mode": str(hit_m.get("mode", "average")), "colourOrder": str(hit_m.get("colourOrder", "auto"))})
	return rows


static func _new_id(fid: String, pixel: int, taken: Dictionary) -> String:
	var id := "px-%s-%d" % [fid.left(48), pixel]
	while taken.has(id):
		id += "_"
	return id


## The working list after editing fixture fid's rows: other mappings stay unchanged and in place; a row's stored
## mapping is rewritten in place (or dropped when the row has no region); a newly mapped row is appended.
static func build(mappings: Array, fid: String, rows: Array, regions: Array) -> Array:
	var by_id := {}
	for row in rows:
		if str(row.id) != "":
			by_id[str(row.id)] = row
	var taken := {}
	for m in mappings:
		if m is Dictionary:
			taken[str(m.get("id", ""))] = true
	var out: Array = []
	var done := {}
	for m in mappings:
		if not (m is Dictionary):
			continue
		var row: Variant = by_id.get(str(m.get("id", "")))
		if row == null:
			out.append(m)
		elif not done.has(str(row.id)):
			done[str(row.id)] = true
			if not find_region(regions, str(row.region)).is_empty():
				out.append(_row_mapping(str(row.id), fid, row, find_region(regions, str(row.region))))
	for row in rows:
		var g := find_region(regions, str(row.region))
		if not done.has(str(row.id)) and not g.is_empty():
			var id := str(row.id) if str(row.id) != "" and not taken.has(str(row.id)) else _new_id(fid, int(row.pixel), taken)
			taken[id] = true
			out.append(_row_mapping(id, fid, row, g))
	return out


static func _row_mapping(id: String, fid: String, row: Dictionary, g: Dictionary) -> Dictionary:
	return {"id": id, "enabled": row.get("enabled", true) != false, "fixtureId": fid, "pixel": int(row.pixel),
		"channelNo": int(g.channelNo), "rect": {"x": int(g.x), "y": int(g.y), "w": int(g.w), "h": int(g.h)},
		"mode": str(row.mode) if MODES.has(str(row.mode)) else "average", "colourOrder": str(row.colourOrder)}


## A region moved / resized from `before` (a copy of it) to `after`: every mapping on the old rect follows, whichever
## fixture it drives (a region is shared by the pixels that pick it).
static func move_region(mappings: Array, before: Dictionary, after: Dictionary) -> Array:
	var k := _key(int(before.channelNo), int(before.x), int(before.y), int(before.w), int(before.h))
	var out: Array = []
	for m in mappings:
		if m is Dictionary and _mapping_key(m) == k:
			var c: Dictionary = (m as Dictionary).duplicate(true)
			c.channelNo = int(after.channelNo)
			c.rect = {"x": int(after.x), "y": int(after.y), "w": int(after.w), "h": int(after.h)}
			out.append(c)
		else:
			out.append(m)
	return out


## A region deleted: every mapping on it goes (its pixels become unmapped).
static func drop_region(mappings: Array, g: Dictionary) -> Array:
	var k := _key(int(g.channelNo), int(g.x), int(g.y), int(g.w), int(g.h))
	return mappings.filter(func(m: Variant) -> bool: return not (m is Dictionary and _mapping_key(m) == k))


## How many mappings (of any fixture) use region g.
static func users(mappings: Array, g: Dictionary) -> int:
	var k := _key(int(g.channelNo), int(g.x), int(g.y), int(g.w), int(g.h))
	return mappings.filter(func(m: Variant) -> bool: return m is Dictionary and _mapping_key(m) == k).size()


static func target(fid: String, pixel: int) -> String:
	return "%s#%d" % [fid, pixel]


## A 400 body's errors [{index, id, error}] against the posted list → {by_target: {"fid#pixel": "msg; msg"},
## other: ["msg", …]} (other = an error on the whole list).
static func row_errors(errors: Variant, posted: Array) -> Dictionary:
	var by := {}
	var other: Array = []
	for e in (errors if errors is Array else []):
		if not (e is Dictionary):
			continue
		var i := int(e.get("index", -1))
		var msg := str(e.get("error", "?"))
		if i >= 0 and i < posted.size() and posted[i] is Dictionary:
			var k := target(str(posted[i].get("fixtureId", "")), int(posted[i].get("pixel", 0)))
			by[k] = msg if not by.has(k) else "%s; %s" % [by[k], msg]
		else:
			other.append(msg)
	return {"by_target": by, "other": other}


## Colour order choices for a pixel: auto, then every ordering of its own letters (≤ 4 letters, no dark channel);
## the current value always stays listed.
static func order_options(order: String, current: String) -> Array:
	var out: Array = ["auto"]
	if order.length() >= 2 and order.length() <= 4 and not order.contains("-"):
		for p in _perms(order):
			if not out.has(p):
				out.append(p)
	if current != "" and not out.has(current):
		out.append(current)
	return out


static func _perms(s: String) -> Array:
	if s.length() <= 1:
		return [s]
	var out: Array = []
	for i in s.length():
		for rest in _perms(s.substr(0, i) + s.substr(i + 1)):
			out.append(s[i] + rest)
	return out


## GET /api/fixtures/pixelmap/live → {mapping id: {color: Color | null, problem, on_wire}}.
static func live_by_id(live: Variant) -> Dictionary:
	var out := {}
	var list: Variant = (live as Dictionary).get("mappings") if live is Dictionary else null
	for m in (list if list is Array else []):
		if not (m is Dictionary):
			continue
		var rgb: Variant = m.get("rgb")
		var c: Variant = null
		if rgb is Array and rgb.size() >= 3:
			c = Color8(int(rgb[0]), int(rgb[1]), int(rgb[2]))
		out[str(m.get("id", ""))] = {"color": c, "problem": m.get("problem"), "on_wire": m.get("on_wire") == true}
	return out


static func fixture_label(f: Dictionary) -> String:
	return "%s · U%d.%03d · %d px" % [str(f.get("name", f.get("id", "?"))), int(f.get("universe", 0)),
		int(f.get("address", 0)), (f.get("pixels", []) as Array).size()]


## Region picker text: "R1 · 100 × 200 px", "R3 · ch 2" for a region on another channel than the one shown.
static func region_label(g: Dictionary, ch: int) -> String:
	if int(g.channelNo) != ch:
		return "%s · ch %d" % [g.id, int(g.channelNo)]
	return "%s · %s" % [g.id, size_label(to_rect(g))]
