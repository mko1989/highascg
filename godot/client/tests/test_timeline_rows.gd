extends RefCounted
## WO-837 — the timeline's section rows, the viewport (lane + vertical scroll) and the screen-section layer ops.

const RW := preload("res://features/timeline/timeline_rows.gd")
const L := preload("res://features/timeline/timeline_layers.gd")
const TM := preload("res://features/timeline/timeline_math.gd")
var t


func _tl() -> Dictionary:
	# array order: A (all), B (screen 0), C (screen 1), D (all), E (screen 0)
	return {"layers": [{"name": "A", "clips": []}, {"name": "B", "screenIdx": 0, "clips": []}, {"name": "C", "screenIdx": 1, "clips": []},
		{"name": "D", "clips": []}, {"name": "E", "screenIdx": 0, "clips": []}], "screens": [0, 1]}


func _names(tl: Dictionary) -> Array:
	return RW.rows(tl).map(func(r: Dictionary) -> String: return "|" + str(r.screen) if r.kind == "divider" else str(tl.layers[r.li].name))


func test_without_screens_the_rows_are_the_layers() -> void:
	var tl := {"layers": [{"name": "A"}, {"name": "B"}, {"name": "C"}]}
	t.eq(_names(tl), ["A", "B", "C"], "no divider, array order")
	t.eq(RW.top(tl, 2, 0), 30.0 + 2 * 54, "same as TM.track_top")
	t.eq(RW.top(tl, 2, 20), TM.track_top(tl, 2, 20), "scrolled")
	t.eq(RW.layer_at(tl, 100, 0), TM.layer_at_y(tl, 100, 0), "layer_at matches")
	t.eq(RW.layer_at(tl, 500, 0), 3, "below the last = n")
	t.eq(RW.hit_divider(tl, 30 + 54, 0), [0, 1], "height divider between layers")


func test_sections_group_the_layers() -> void:
	var tl := _tl()
	t.eq(_names(tl), ["|-1", "A", "D", "|0", "B", "E", "|1", "C"], "all first, then a divider per screen")
	var rs := RW.rows(tl)
	t.eq(RW.content_h(tl), 3 * 24 + 5 * 54, "dividers + layers")
	t.eq(rs[3].y, 24 + 108, "screen 0 divider under the two all-screens layers")
	t.eq(RW.layer_at(tl, 30 + 5, 0), -1, "on the All screens divider")
	t.eq(RW.layer_at(tl, 30 + 24 + 54 + 54 + 24 + 10, 0), 1, "B is the first layer of screen 0")
	t.eq(RW.top(tl, 4, 0), 30.0 + 24 + 108 + 24 + 54, "E sits under B")
	t.eq(RW.hit_divider(tl, 30 + 24 + 54, 0), [0, 3], "A | D height divider (array indexes)")
	t.eq(RW.hit_divider(tl, 30 + 24 + 108, 0), [], "section border is not a height divider")


func test_screens_include_used_but_unlisted() -> void:
	var tl := {"layers": [{"screenIdx": 2.0}, {}], "screens": [1, 1, -4, "x"]}
	t.eq(RW.screens(tl), [1, 2], "listed first, deduped, invalid dropped, used appended")
	t.eq(RW.available_screens(tl, 4), [0, 3], "screens without a section")
	t.eq(RW.layer_screen({"screenIdx": -1}), RW.ALL, "negative = all")


func test_drop_target() -> void:
	var tl := _tl()
	t.eq(RW.drop_target(tl, 30 + 24 + 10, 0), {"li": 0, "screen": -1}, "on A")
	t.eq(RW.drop_target(tl, 30 + 24 + 108 + 5, 0), {"li": 5, "screen": 0}, "on screen 0's divider: a new layer there")
	t.eq(RW.drop_target(tl, 5000, 0), {"li": 5, "screen": 1}, "below everything: new layer in the last section")


func test_viewport_lane_and_scroll() -> void:
	var tl := {"layers": [{}, {}]}  # 108 px of layers
	var vp := RW.viewport(tl, 400, 1)
	t.eq([vp.lane_top, vp.lane_h, vp.max_scroll, vp.pinned], [138.0, 40.0, 0.0, false], "lane right under the layers")
	vp = RW.viewport(tl, 400, 3)
	t.eq(vp.lane_h, 104.0, "three rows")
	var tall := {"layers": [{}, {}, {}, {}, {}, {}, {}, {}]}  # 432 px
	vp = RW.viewport(tall, 300, 2)  # avail 270, lane 72 → layers 198
	t.eq([vp.pinned, vp.lane_top, vp.max_scroll], [true, 228.0, 234.0], "pinned to the bottom, layers scroll")
	t.eq(RW.clamp_scroll(tall, 300, 2, 999), 234.0, "clamped")
	t.eq(RW.clamp_scroll(tl, 400, 1, 50), 0.0, "nothing to scroll")
	var th := RW.thumb(vp, 432, 0)
	t.eq(th[0], 30.0, "thumb at the top")
	t.ok(th[1] < 198.0 and th[1] >= 24.0, "thumb shorter than the track")
	t.eq(snappedf(RW.scroll_for_thumb(vp, 432, 30.0 + 198.0 - th[1]), 0.01), 234.0, "thumb at the bottom = max scroll")
	t.eq(RW.thumb(RW.viewport(tl, 400, 1), 108, 0), [], "no thumb when it all fits")
	t.eq(RW.lane_h(0), 40, "an empty lane keeps one row")


func test_divider_buttons() -> void:
	t.eq(RW.divider_button(TM.HEADER_W - 40, 0), "add", "plus")
	t.eq(RW.divider_button(TM.HEADER_W - 10, 0), "remove", "x")
	t.eq(RW.divider_button(TM.HEADER_W - 10, RW.ALL), "", "no remove on All screens")
	t.eq(RW.divider_button(10, 0), "", "the name")


func test_screen_names() -> void:
	var cm := {"virtualMainChannels": [{"name": "Dioda"}, {}], "screenLabels": ["", "Proj"], "screenCount": 2}
	var n := RW.screen_names(cm, 3)
	t.eq(RW.screen_label(n, 0), "Dioda", "the destination name")
	t.eq(RW.screen_label(n, 2), "Screen 3", "fallback")
	t.eq(RW.screen_label(n, RW.ALL), "All screens")


func test_section_ops() -> void:
	var tl := {"layers": [{"name": "A"}, {"name": "B"}]}
	t.ok(L.add_screen(tl, 1) and not L.add_screen(tl, 1), "added once")
	t.ok(not L.add_screen(tl, -1), "not a screen")
	var i := L.add_in_section(tl, 1)
	t.eq([i, tl.layers[i].screenIdx, tl.layerHeights.size()], [2, 1, 3], "new layer in the section, heights follow")
	t.ok(not L.remove_screen(tl, 1), "a section with layers stays")
	L.set_screen(tl, 2, RW.ALL)
	t.ok(not tl.layers[2].has("screenIdx"), "all screens drops the key")
	t.ok(L.remove_screen(tl, 1) and tl.screens.is_empty(), "an empty section goes")
	# a new layer added below a layer of a section joins it
	L.set_screen(tl, 1, 0)
	var below := L.insert_below(tl, 1)
	t.eq([below, tl.layers[below].screenIdx], [2, 0], "insert_below inherits the section")
	var plain := L.insert_below(tl, 0)
	t.ok(not tl.layers[plain].has("screenIdx"), "all-screens layer: all-screens neighbour")


func test_drag_across_a_divider_changes_the_screen() -> void:
	var tl := _tl()
	TM.ensure_heights(tl)
	# A (all, index 0) dragged onto screen 1's divider → screen 1, first in the section
	var rs := RW.rows(tl)
	var d1: Dictionary = rs.filter(func(r: Dictionary) -> bool: return r.kind == "divider" and r.screen == 1)[0]
	var at := L.drag_over(tl, 0, d1)
	t.eq(tl.layers[at].name, "A", "A is where it was told")
	t.eq(tl.layers[at].screenIdx, 1, "screenIdx = 1")
	t.eq(RW.rows(tl).filter(func(r: Dictionary) -> bool: return r.kind == "layer" and r.screen == 1).map(func(r: Dictionary) -> String: return tl.layers[r.li].name), ["A", "C"], "A heads screen 1")
	t.eq(tl.layerHeights.size(), 5, "heights stay aligned")
	# over a divider of the section it is in: nothing
	var again := L.drag_over(tl, at, d1)
	t.eq(again, at, "same section: no move")
	# C dragged onto the All screens divider → no screenIdx, in front of the first all-screens layer (D)
	var da: Dictionary = RW.rows(tl)[0]
	var ci := 0
	for k in tl.layers.size():
		if tl.layers[k].name == "C":
			ci = k
	var cn := L.drag_over(tl, ci, da)
	t.ok(not tl.layers[cn].has("screenIdx"), "C is on every screen again")
	var all_names := RW.rows(tl).filter(func(r: Dictionary) -> bool: return r.kind == "layer" and r.screen == -1).map(func(r: Dictionary) -> String: return tl.layers[r.li].name)
	t.eq(all_names, ["C", "D"], "C leads the all-screens layers")
	# over another section's layer: joins it and takes its place
	var e := 0
	for k in tl.layers.size():
		if tl.layers[k].name == "E":
			e = k
	var row := RW.row_of_layer(tl, e)
	var dn := L.drag_over(tl, cn, row)
	t.eq([tl.layers[dn].screenIdx, tl.layers[dn].name], [0, "C"], "joined screen 0 over E")
