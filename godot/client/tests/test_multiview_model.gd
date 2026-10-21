extends RefCounted
## WO-600 M — mv_geometry.gd / mv_layout.gd against the web multiview editor run under Node
## (tools/dev/gen-godot-golden-multiview.mjs → tests/golden/multiview_editor.json): default layouts, API layout,
## overlay type / resolution suffix / source resolution, contained video rects, the aspect solver, resize handles,
## addCell, canvas rescale, move + resize drags with snapping and aspect lock, drop sizing, route migration and
## WO-271 source-channel healing.

const G := preload("res://features/multiview/mv_geometry.gd")
const L := preload("res://features/multiview/mv_layout.gd")
var t
var g: Dictionary


## Deep equality with float tolerance; a missing key equals null (JSON.stringify drops undefined).
static func same(a: Variant, b: Variant) -> bool:
	if (a is int or a is float) and (b is int or b is float):
		return absf(float(a) - float(b)) <= 1e-9 * maxf(1.0, absf(float(b)))
	if a is Dictionary and b is Dictionary:
		for k in a.keys() + b.keys():
			if not same(a.get(k), b.get(k)):
				return false
		return true
	if a is Array and b is Array:
		if a.size() != b.size():
			return false
		for i in a.size():
			if not same(a[i], b[i]):
				return false
		return true
	return a == b


func _ok(a: Variant, b: Variant, what: String) -> void:
	t.ok(same(a, b), "%s — got %s want %s" % [what, JSON.stringify(a), JSON.stringify(b)] if not same(a, b) else what)


func _golden() -> Dictionary:
	if g.is_empty():
		g = JSON.parse_string(FileAccess.get_file_as_string("res://tests/golden/multiview_editor.json"))
	return g


func _cell(id: String) -> Dictionary:
	for c in _golden().layoutCells + _golden().api[0].cells:
		if c.id == id:
			return c
	return {}


func test_defaults_and_api_layout() -> void:
	var gd := _golden()
	for c in gd.defaults:
		_ok(L.default_layout(gd.maps[c.map], c.cw, c.ch), c.cells, "default %s %dx%d" % [c.map, c.cw, c.ch])
	for c in gd.api:
		_ok(L.cells_to_api_layout(c.cells, c.cw, c.ch), c.layout, "api layout %dx%d" % [c.cw, c.ch])
	for c in gd.migrate:
		_ok(L.migrate_preview_route_sources(c.cells, gd.maps[c.map]), c.out, "migrate routes")
	for c in gd.channel:
		_ok(G.parse_route(G._src_str(_cell(c.cell))), c.parsed, "parse %s" % c.cell)
		_ok(L.mv_cell_source_channel(_cell(c.cell), c.parsed, gd.maps[c.map]), c.ch, "source channel %s" % c.cell)


func test_overlay_and_contained_rects() -> void:
	var gd := _golden()
	for c in gd.overlay:
		var cell := _cell(c.cell)
		var cm: Dictionary = gd.maps[c.map]
		_ok(G.overlay_type(cell, cm), c.type, "overlay %s/%s" % [c.map, c.cell])
		_ok(G.resolution_suffix(cell, cm), c.suffix, "suffix %s/%s" % [c.map, c.cell])
		_ok(G.source_resolution(cell, cm), c.res, "res %s/%s" % [c.map, c.cell])
		_ok(G.source_ratio(cell, cm), c.ratio, "ratio %s/%s" % [c.map, c.cell])
	for c in gd.contained:
		_ok(G.contained_video_rect(_cell(c.cell), gd.maps[c.map], c.cw, c.ch, c.timers), c.rect,
			"contained %s/%s %dx%d timers=%s" % [c.map, c.cell, c.cw, c.ch, c.timers])


func test_solver_and_handles() -> void:
	var gd := _golden()
	for c in gd.solve:
		_ok(G.solve_dims(c.w, c.h, c.ratio, c.lock, c.ov, c.timers, c.cw, c.ch), c.out,
			"solve %s %s %sx%s r=%s timers=%s @%dx%d" % [c.ov, c.lock, c.w, c.h, c.ratio, c.timers, c.cw, c.ch])
	var hc := {"x": 100, "y": 100, "w": 400, "h": 200}
	for c in gd.handles:
		_ok(G.resize_handle(hc, c.x, c.y, c.scale), c.handle if c.handle != null else "", "handle (%s,%s) @%s" % [c.x, c.y, c.scale])


func test_add_and_rescale() -> void:
	var gd := _golden()
	for c in gd.add:
		_ok(L.add_cell(c.opts, c.cw, c.ch), c.cell, "add %s @%dx%d" % [c.opts.get("id"), c.cw, c.ch])
	t.ok(str(L.add_cell({}, 1920, 1080, 1700000000000).id) == "cell_loyw3v28", "web id = cell_ + Date.now() base 36")
	for c in gd.rescale:
		var src: Array = gd.api[0].cells.duplicate(true)
		var wh := L.rescale(src, c.cw, c.ch, c.nw, c.nh)
		_ok(wh, [c.outW, c.outH], "rescale size %dx%d→%sx%s" % [c.cw, c.ch, c.nw, c.nh])
		_ok(src, c.cells, "rescale cells %dx%d→%sx%s" % [c.cw, c.ch, c.nw, c.nh])


func test_drags_and_drop() -> void:
	var gd := _golden()
	var cells: Array = gd.layoutCells
	for c in gd.move:
		_ok(L.drag_move(_cell(c.cell), c.dx, c.dy, cells, c.cw, c.ch, c.scale), c.out,
			"move %s by (%s,%s) @%dx%d s=%s" % [c.cell, c.dx, c.dy, c.cw, c.ch, c.scale])
	for c in gd.resize:
		_ok(L.drag_resize(c.handle, _cell(c.cell), c.dx, c.dy, cells, c.cw, c.ch, c.scale, gd.maps[c.map], c.timers), c.out,
			"resize %s %s by (%s,%s) @%dx%d s=%s timers=%s" % [c.cell, c.handle, c.dx, c.dy, c.cw, c.ch, c.scale, c.timers])
	for c in gd.drop:
		_ok(L.drop_cell(c.data, c.x, c.y, c.cw, c.ch, c.timers), c.out, "drop %s at (%s,%s) @%dx%d" % [c.data.value, c.x, c.y, c.cw, c.ch])
