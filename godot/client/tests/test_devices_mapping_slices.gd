extends RefCounted
## WO-869 — slice_model.gd against the JS model + geometry (tests/golden/devices_mapping_slices.json, written and
## pinned by tools/smoke/smoke-wo869-slice-golden.test.js), plus the editor's list ops and the page's slice items.

const SM := preload("res://features/devices/slice_model.gd")
const SP := preload("res://features/devices/slice_page_model.gd")
const CM := preload("res://features/devices/slice_canvas_math.gd")
const MP := preload("res://features/devices/mapping_page_model.gd")
var t
var _g: Dictionary


func _golden() -> Dictionary:
	if _g.is_empty():
		_g = JSON.parse_string(FileAccess.get_file_as_string("res://tests/golden/devices_mapping_slices.json"))
	return _g


static func _norm(v: Variant) -> Variant:
	if v is int:
		return float(v)
	if v is Vector2:
		return [float(v.x), float(v.y)]
	if v is Dictionary:
		var o := {}
		for k in v:
			o[k] = _norm(v[k])
		return o
	if v is Array:
		return v.map(func(x: Variant) -> Variant: return _norm(x))
	return v


func _pts_close(got: Array, want: Array, what: String) -> void:
	t.eq(got.size(), want.size(), what + " size")
	for i in mini(got.size(), want.size()):
		t.ok(absf(got[i].x - float(want[i][0])) < 1e-3 and absf(got[i].y - float(want[i][1])) < 1e-3,
			"%s[%d] %s vs %s" % [what, i, got[i], want[i]])


static func _v(a: Array) -> Array:
	return a.map(func(p: Array) -> Vector2: return Vector2(float(p[0]), float(p[1])))


func test_normalize_matches_js() -> void:
	var g := _golden()
	var got := SM.normalize_slices(g.raws, g.outputIds, g.defaultSize)
	t.eq(got.size(), g.normalized.size(), "count")
	for i in got.size():
		t.eq(_norm(got[i]), _norm(g.normalized[i]), "slice %d" % i)


func test_quads_match_js() -> void:
	for q in _golden().quads:
		_pts_close(SM.screen_corners(q.dst), q.screen, "screen " + JSON.stringify(q.dst))
		_pts_close(SM.dst_quad(q.dst), q.quad, "quad " + JSON.stringify(q.dst))
	for c in _golden().convex:
		t.eq(SM.is_convex(_v(c[0])), c[1], "convex " + JSON.stringify(c[0]))
	var h: Dictionary = _golden().homography
	var hm := SM.homography(_v(h.from), _v(h.to))
	t.eq(hm.size(), 9, "homography solved")
	for i in 9:
		t.ok(absf(hm[i] - float(h.H[i])) < 1e-4 * maxf(1.0, absf(float(h.H[i]))), "H[%d] %f vs %f" % [i, hm[i], h.H[i]])
	_pts_close([SM.apply_h(hm, _v([h.probe[0]])[0])], [h.probe[1]], "probe")


func test_list_ops() -> void:
	var list := []
	list.append(SM.new_slice(list, "out_1", {"x": 0, "y": 0, "w": 960, "h": 1080}))
	list.append(SM.new_slice(list, "out_2", {"x": 960, "y": 0, "w": 960, "h": 1080}))
	t.eq(list.map(func(s: Dictionary) -> String: return s.id), ["slice_1", "slice_2"], "ids")
	t.eq(list[1].dst.rect, {"x": 0, "y": 0, "w": 960, "h": 1080}, "new slice is 1:1 at the output's top-left")
	t.eq(list[1].z, 1, "new slice on top")
	var d := SM.duplicated(list, 0)
	t.eq(d.id, "slice_3", "duplicate id")
	t.eq([d.dst.rect.x, d.dst.rect.y], [32, 32], "duplicate offset")
	list.append(d)
	t.eq(SM.draw_order(list), [0, 1, 2], "z then list position (the duplicate ties slice 2 at z 1)")
	t.ok(SM.move_z(list, 0, 1), "raise")
	t.eq(SM.draw_order(list), [1, 0, 2], "raised one step")
	t.ok(not SM.move_z(list, 2, 1), "top cannot rise")
	t.ok(SM.move_z(list, 2, -1), "lower the top")
	t.eq(SM.draw_order(list), [1, 2, 0], "lowered one step")
	SM.set_at(list[0], "dst.warp.2.1", 7.0)
	t.eq(SM.get_at(list[0], "dst.warp.2.1"), 7.0, "path access into arrays")
	SM.set_at(list[0], "feather.l", 4)
	t.eq(SM.get_at(list[0], "feather.l"), 4, "path access into dicts")


func test_backend_text() -> void:
	t.eq(SP.backend_text({"backend": "direct", "sink": "decklink"}), "SDI placement (1:1)", "direct sdi")
	t.eq(SP.backend_text({"backend": "direct", "sink": "gpu"}), "GPU head (1:1)", "direct gpu")
	t.eq(SP.backend_text({"backend": "screen-slices"}), "Slice window (live edits)", "screen")
	t.ok(SP.backend_text({"backend": "refused", "reason": "SDI_PLACEMENT_ONLY"}).begins_with("Not drawn"), "refused")
	t.eq(SP.backend_text({"backend": "idle"}), "Not cabled", "idle")


func test_canvas_math() -> void:
	var f := CM.fit(Vector2(1000, 600), Vector2(1920, 1080), 20.0)
	t.eq(f.scale, minf(960.0 / 1920.0, 560.0 / 1080.0), "fit scale")
	t.ok(absf(f.off.x - (1000.0 - 1920.0 * f.scale) / 2.0) < 1e-4, "fit centred")
	var r := {"x": 96, "y": 64, "w": 400, "h": 200}
	t.eq(CM.moved_src(r, Vector2(13, -3), Vector2(1920, 1080)), {"x": 112, "y": 64, "w": 400, "h": 200}, "move snaps to 8")
	t.eq(CM.moved_src(r, Vector2(5000, 5000), Vector2(1920, 1080)), {"x": 1520, "y": 880, "w": 400, "h": 200}, "move stays inside")
	t.eq(CM.resized(r, Vector2i(1, 1), Vector2(3000, 21), Vector2(1920, 1080)), {"x": 96, "y": 64, "w": 1824, "h": 224}, "resize clamps to the input")
	t.eq(CM.resized(r, Vector2i(-1, 0), Vector2(1000, 0), Vector2(1920, 1080)).w, CM.MIN, "never below MIN")
	t.eq(CM.drawn(Vector2(803, 597), Vector2(101, 59), Vector2(1920, 1080)), {"x": 104, "y": 56, "w": 696, "h": 544}, "drawn either way")
	t.eq(CM.handle_at(Rect2(0, 0, 100, 50), Vector2(99, 26), 4.0), Vector2i(1, 0), "right edge handle")
	t.eq(CM.handle_at(Rect2(0, 0, 100, 50), Vector2(50, 25), 4.0), CM.NONE, "no handle in the middle")
	# scale a 90°-rotated rect by its local right edge: the local left edge stays where it is on screen
	var rr := {"x": 0, "y": 0, "w": 200, "h": 100}
	var before := SM.rotate_about(SM.rect_corners(rr), Vector2(100, 50), 90.0)
	var n := CM.scaled_dst(rr, 90.0, Vector2i(1, 0), Vector2(0, 50))
	t.eq([n.w, n.h], [250, 100], "the pointer's move along the rotated x axis widens it")
	var after := SM.rotate_about(SM.rect_corners(n), Vector2(n.x + n.w / 2.0, n.y + n.h / 2.0), 90.0)
	_pts_close([after[0], after[3]], [[before[0].x, before[0].y], [before[3].x, before[3].y]], "opposite edge fixed")
	t.eq(CM.rotation_to(Vector2(0, 0), Vector2(0, -10)), 0.0, "knob straight up = 0°")
	t.eq(CM.rotation_to(Vector2(0, 0), Vector2(10, 0)), 90.0, "knob right = 90° clockwise")
	t.eq(CM.rotation_to(Vector2(0, 0), Vector2(10, -9), 15.0), 45.0, "15° steps")
	var dst := {"rect": rr, "rotation": 0.0, "flipH": false, "flipV": false, "warp": [[0, 0], [0, 0], [0, 0], [0, 0]]}
	t.ok(not CM.warped(dst, 1, [0, 0], Vector2(10, 5)).is_empty(), "a keystone corner is taken")
	t.ok(CM.warped(dst, 1, [0, 0], Vector2(-150, 120)).is_empty(), "a corner pulled past the diagonal is refused")
	t.ok(CM.in_quad(SM.dst_quad(dst), Vector2(100, 50)), "inside")
	t.ok(not CM.in_quad(SM.dst_quad(dst), Vector2(250, 50)), "outside")


func test_page_items() -> void:
	var outs := [{"id": "out_1", "label": "Left"}, {"id": "out_2", "label": "Right"}]
	var list := [SM.new_slice([], "out_2", {"x": 0, "y": 0, "w": 100, "h": 50})]
	var none := SP.items(list, outs, -1, [["Left", "GPU head (1:1)"]])
	t.eq(none.filter(func(it: Dictionary) -> bool: return it.t == "slice_row").map(func(it: Dictionary) -> String: return it.text),
		["Slice 1 → Right"], "rows name the output")
	t.ok(none.any(func(it: Dictionary) -> bool: return it.t == "readout" and it.text == "Left: GPU head (1:1)"), "drawn-as line")
	t.ok(not none.any(func(it: Dictionary) -> bool: return it.t == "row"), "no fields without a selection")
	var keys := []
	for it in SP.items(list, outs, 0):
		for sub in (it.items if it.t == "row" else [it]):
			if sub.t == "num":
				keys.append(sub.key)
	t.eq(keys.size(), 4 + 4 + 2 + 8 + 4, "src, dst, rotation + opacity, 4 warp corners × 2, feather")
	t.ok("dst.warp.3.1" in keys and "feather.b" in keys and "opacity" in keys, "warp / feather / opacity fields")
	var p := {"graph": {"devices": [{"id": "m", "role": "pixel_mapping", "settings": {"outputs": [{"id": "out_1", "mode": "1080p5000"}]}}],
		"connectors": [], "edges": []}}
	t.ok(MP.items(p, "m").any(func(it: Dictionary) -> bool: return it.get("text") == "Src X"), "web-parity page keeps Src X")
	t.ok(not MP.items(p, "m", {}, true).any(func(it: Dictionary) -> bool: return it.get("text") == "Src X"), "Godot page drops it")


func test_graph_edits_carry_slices() -> void:
	var G := preload("res://features/devices/mapping_graph.gd")
	var mk := func() -> Dictionary:
		return {"devices": [{"id": "m", "role": "pixel_mapping", "label": "M", "settings": {
			"outputs": [{"id": "out_1", "mode": "1080p5000"}, {"id": "out_3", "mode": "1080p5000"}],
			"mappings": [], "slices": [{"id": "a", "outputId": "out_3"}, {"id": "b", "outputId": "out_1"}]}}],
			"connectors": [], "edges": []}
	var g: Dictionary = mk.call()
	t.ok(G.remove_output(g, "m", "out_3").ok, "remove")
	t.eq(g.devices[0].settings.slices.map(func(s: Dictionary) -> String: return s.outputId), ["out_1", "out_1"],
		"slices of the removed output move to the first one")
	g = mk.call()
	var r: Dictionary = G.duplicate_node(g, "m", "x", func() -> String: return "r")
	t.eq(r.graph.devices[1].settings.slices.map(func(s: Dictionary) -> String: return s.outputId), ["out_2", "out_1"],
		"the copy's slices follow their output by position (out_3 is the copy's out_2)")
