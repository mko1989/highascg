extends RefCounted
## WO-1039 — PixelHue Screens model: drafts, tile geometry, request bodies, validation, format cascade.

const M := preload("res://features/pixelhue/screens_model.gd")
var t


func _screen() -> Dictionary:
	return {"id": 1, "type": 2, "name": "Screen 1", "x": 100, "y": 50, "width": 3840, "height": 1080, "enabled": true,
		"outputs": [{"id": 5, "pos": {"x": 100, "y": 50, "width": 1920, "height": 1080}}, {"id": 6, "pos": {"x": 2020, "y": 50, "width": 1920, "height": 1080}}]}


func test_draft_is_relative_to_window() -> void:
	var d := M.draft_for(_screen())
	t.eq(d.window, {"x": 100, "y": 50, "width": 3840, "height": 1080}, "window")
	t.eq(d.outputs[1].pos.x, 1920, "tile relative")
	t.ok(not M.draft_changed(d, _screen()), "fresh draft unchanged")
	d.outputs[0].pos.x = 10
	t.ok(M.draft_changed(d, _screen()), "edited draft changed")


func test_add_remove_grow_fit_tile() -> void:
	var d := M.draft_for(_screen())
	M.add_output(d, {"id": 7, "timing": {"width": 1280, "height": 720}})
	t.eq(d.outputs[2].pos, {"x": 3840, "y": 0, "width": 1280, "height": 720}, "added right of the rightmost")
	t.eq(d.window.width, 5120, "window grew")
	M.remove_output(d, 7)
	M.fit_window(d)
	t.eq([d.window.width, d.window.height], [3840, 1080], "fit to tiles")
	M.tile_grid(d, 1)
	t.eq(d.outputs[1].pos, {"x": 0, "y": 540, "width": 3840, "height": 540}, "one column, two rows")
	var e := M.draft_for({"id": 2, "x": 0, "y": 0, "width": 100, "height": 100, "outputs": []})
	M.add_output(e, {"id": 1})
	t.eq(e.outputs[0].pos, {"x": 0, "y": 0, "width": 1920, "height": 1080}, "defaults without timing")


func test_scale_hit_and_view_rect() -> void:
	t.eq(M.fit_scale(1000, 500, Vector2(500, 500)), 0.5, "fits width")
	var outs := [{"id": 1, "pos": {"x": 0, "y": 0, "width": 100, "height": 100}}, {"id": 2, "pos": {"x": 50, "y": 0, "width": 100, "height": 100}}]
	t.eq(M.hit_test(outs, Vector2(70, 10), 1.0, Vector2.ZERO), 1, "topmost wins")
	t.eq(M.hit_test(outs, Vector2(10, 10), 1.0, Vector2.ZERO), 0, "first tile")
	t.eq(M.hit_test(outs, Vector2(500, 10), 1.0, Vector2.ZERO), -1, "miss")
	t.eq(M.tile_view_rect(outs[1].pos, 0.5, Vector2(6, 6)), Rect2(31, 6, 50, 50), "view rect")


func test_snapping() -> void:
	var win := {"width": 1000, "height": 500}
	var other := [{"x": 0, "y": 0, "width": 400, "height": 500}]
	var p := M.snap_move({"x": 395, "y": 4, "width": 300, "height": 200}, win, other, 12.0)
	t.eq([p.x, p.y], [400, 0], "snaps to the neighbour edge and the top")
	p = M.snap_move({"x": 690, "y": 100, "width": 300, "height": 200}, win, other, 12.0)
	t.eq(p.x, 700, "right edge to window edge")
	p = M.drag_pos({"x": 395, "y": 4, "width": 300, "height": 200}, Vector2(0, 0), win, other, 1.0, true)
	t.eq([p.x, p.y], [395, 4], "alt = free")
	p = M.drag_pos({"x": 10, "y": 10, "width": 100, "height": 100}, Vector2(-500, -500), win, [], 1.0, true)
	t.eq([p.x, p.y], [0, 0], "never negative")


func test_validation() -> void:
	var d := M.draft_for(_screen())
	t.eq(M.draft_error(d), "", "valid")
	d.outputs[0].pos.x = 3000
	t.eq(M.draft_error(d), "Output tiles must fit inside their screen.", "outside")
	d = M.draft_for(_screen())
	d.window.width = 10
	t.ok(M.draft_error(d).begins_with("Screen width"), "window too small")
	d = M.draft_for(_screen())
	d.outputs[1].id = 5
	t.eq(M.draft_error(d), "Unknown or duplicate screen output.", "duplicate")


func test_bodies() -> void:
	t.eq(M.create_body("S", 4), {"action": "create", "name": "S", "type": 4}, "create")
	t.eq(M.delete_body(3), {"action": "delete", "id": 3}, "delete")
	t.eq(M.toggle_body("freeze", 3, 0), {"action": "freeze", "id": 3, "enable": 1}, "freeze")
	t.eq(M.toggle_body("ftb", 3, 1), {"action": "ftb", "id": 3, "enable": 0}, "clear ftb")
	var d := M.draft_for(_screen())
	var b := M.update_body(1, d)
	t.eq(b.keys(), ["action", "id", "window", "outputs"], "update keys")
	t.eq(b.outputs[0], {"id": 5, "pos": {"x": 0, "y": 0, "width": 1920, "height": 1080}}, "update tile")
	t.eq(M.pattern_choice_change("off"), {"enable": false}, "pattern off")
	t.eq(M.pattern_choice_change(516), {"enable": true, "type": 516}, "pattern on")
	t.eq(M.quality_body(2, {"hue": 5}), {"action": "quality", "id": 2, "quality": {"hue": 5}}, "quality")


func test_outputs_and_labels() -> void:
	var outs := [{"id": 5, "role": "Output"}, {"id": 34, "role": "AUX"}]
	t.eq(M.available_outputs({"type": 2}, outs).size(), 1, "main takes non-AUX")
	t.eq(M.available_outputs({"type": 4}, outs)[0].id, 34, "AUX takes AUX")
	t.eq(M.owner_name([_screen(), {"id": 9, "name": "Other", "outputs": [{"id": 8}]}], 1, 8), "Other", "owner")
	t.eq(M.owner_name([_screen()], 1, 5), "", "own output has no other owner")
	t.eq(M.next_name([{"name": "Screen 1"}, {"name": "Screen 2"}]), "Screen 3", "next name")
	t.eq(M.screen_label(_screen()), "Screen 1 · 3840 × 1080", "label")
	t.eq(M.type_label(32), "LED", "led")
	t.eq(M.gear_label(5), "64 px", "gear")
	t.eq(M.bright_label(3), "75%", "bright")
	t.eq(M.speed_label(0), "Still", "still")


func test_format_cascade() -> void:
	var lim := {"ranges": [0, 1, 2], "spaces": [0, 1, 2], "rules": {"0": {"depths": [8, 10, 12], "fixed422": 12, "gamuts": [0, 1, 2, 3]}, "1": {"depths": [10, 12], "fixed422": 12, "gamuts": [2, 3]}}}
	var f := {"dynamicRange": 0, "colorDepth": 8, "colorGamut": 1, "colorSpace": 0}
	t.eq(M.range_change(lim, f, 1), {"dynamicRange": 1, "colorDepth": 10, "colorGamut": 3}, "HDR moves depth and gamut")
	f = {"dynamicRange": 0, "colorDepth": 10, "colorGamut": 2, "colorSpace": 0}
	t.eq(M.range_change(lim, f, 1), {"dynamicRange": 1}, "already valid")
	t.eq(M.depth_choices(lim.rules["0"], 1), [12], "4:2:2 fixes depth")
	t.eq(M.depth_choices(lim.rules["0"], 0), [8, 10, 12], "RGB all depths")
	t.ok(M.has_extras({"pattern": null, "quality": [], "format": null}) == false, "nothing to offer")
	t.eq(M.limits_for({"2": {"quality": ["hue"]}}, 2).quality, ["hue"], "limits by string key")
