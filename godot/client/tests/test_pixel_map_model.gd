extends RefCounted
## WO-807 phase 2 — pixel_map_model.gd: channel raster / role, rect snapping and validation, regions from the stored
## mappings, pixel rows, the POST list and its 400 errors back on rows, colour orders, live swatches.

const P := preload("res://features/previs/fixtures/pixel_map_model.gd")
var t

const CM := {"programChannels": [1.0, 3.0], "previewChannels": [2.0, 4.0],
	"channelResolutionsByChannel": {"1": {"w": 3840.0, "h": 1792.0, "fps": 50.0}, "2": {"w": 3840, "h": 1792},
		"3": {"w": 1920, "h": 1080}, "4": {"w": 1920, "h": 1080}, "6": {"w": 1280, "h": 720}, "9": {"w": 0, "h": 0}}}

const FX := {"id": "mvr-a", "name": "Pixel Line IP 1042", "universe": 18.0, "address": 421.0,
	"pixels": [{"pixel": 1.0, "geometry": "Array 109", "order": "rgb"}, {"pixel": 2.0, "geometry": "Array 110", "order": "rgb"},
		{"pixel": 3.0, "geometry": "Array 125", "order": "w"}]}

const STORED := [
	{"id": "other", "enabled": true, "fixtureId": "mvr-b", "pixel": 1.0, "channelNo": 1.0, "rect": {"x": 0.0, "y": 0.0, "w": 100.0, "h": 200.0}, "mode": "average", "colourOrder": "auto"},
	{"id": "a1", "enabled": true, "fixtureId": "mvr-a", "pixel": 1.0, "channelNo": 1.0, "rect": {"x": 0.0, "y": 0.0, "w": 100.0, "h": 200.0}, "mode": "point", "colourOrder": "grb"},
	{"id": "a2", "enabled": true, "fixtureId": "mvr-a", "pixel": 2.0, "channelNo": 3.0, "rect": {"x": 10.0, "y": 20.0, "w": 30.0, "h": 40.0}, "mode": "average", "colourOrder": "auto"},
]


func test_raster_channels_and_roles() -> void:
	t.eq(P.raster_of(CM, 1), Vector2i(3840, 1792), "floats from JSON")
	t.eq(P.raster_of(CM, 5), Vector2i.ZERO, "not running")
	t.eq(P.raster_of(null, 1), Vector2i.ZERO)
	t.eq(P.channels(CM), [1, 2, 3, 4, 6], "sorted; a 0×0 channel is not listed")
	t.eq([P.role_for(1, CM), P.role_for(2, CM), P.role_for(3, CM), P.role_for(4, CM), P.role_for(6, CM)],
		["pgm1", "prv1", "pgm2", "prv2", "ch6"], "same as the server's roleFor")
	t.eq(P.role_for(2, {"programChannels": [2], "previewChannels": [2]}), "pgm1", "a bus that is its own preview is pgm")
	t.eq(P.channel_label(2, CM), "Channel 2 (Preview 1) · 3840×1792")
	t.eq(P.channel_label(6, CM), "Channel 6 · 1280×720")


func test_snap_clamp_move_resize() -> void:
	var r := Vector2i(1920, 1080)
	t.eq(P.snap_rect(Vector2(10.4, 20.6), Vector2(110.2, 220.1), r), Rect2i(10, 20, 101, 201), "covers both points")
	t.eq(P.snap_rect(Vector2(110, 220), Vector2(10, 20), r), Rect2i(10, 20, 100, 200), "any corner order, whole pixels")
	t.eq(P.snap_rect(Vector2(5, 5), Vector2(5, 5), r), Rect2i(5, 5, 1, 1), "a click is 1 × 1")
	t.eq(P.snap_rect(Vector2(-50, -9), Vector2(3000, 2000), r), Rect2i(0, 0, 1920, 1080), "clamped to the raster")
	t.eq(P.snap_rect(Vector2(1925, 1090), Vector2(1930, 1095), r), Rect2i(1919, 1079, 1, 1), "outside → the last pixel")
	t.eq(P.clamp_rect(Rect2i(1900, 1000, 100, 200), r), Rect2i(1820, 880, 100, 200), "pushed back inside")
	t.eq(P.clamp_rect(Rect2i(-5, 0, 0, 5000), r), Rect2i(0, 0, 1, 1080))
	t.eq(P.move_rect(Rect2i(10, 10, 100, 200), Vector2(5.6, -3.2), r), Rect2i(16, 7, 100, 200), "whole-pixel steps")
	t.eq(P.move_rect(Rect2i(10, 10, 100, 200), Vector2(-50, 5000), r), Rect2i(0, 880, 100, 200))
	t.eq(P.resize_rect(Rect2i(10, 10, 100, 200), Vector2(60.4, 30.6), r), Rect2i(10, 10, 50, 21))
	t.eq(P.resize_rect(Rect2i(10, 10, 100, 200), Vector2(0, 0), r), Rect2i(10, 10, 1, 1), "never below 1 × 1")
	t.eq(P.resize_rect(Rect2i(10, 10, 100, 200), Vector2(5000, 5000), r), Rect2i(10, 10, 1910, 1070))


func test_rect_problem_and_labels() -> void:
	var r := Vector2i(1920, 1080)
	t.eq(P.rect_problem(Rect2i(0, 0, 1920, 1080), r), "")
	t.eq(P.rect_problem(Rect2i(1821, 0, 100, 200), r), "outside 1920×1080")
	t.eq(P.rect_problem(Rect2i(0, 0, 0, 5), r), "empty")
	t.eq(P.rect_problem(Rect2i(0, 0, 5, 5), Vector2i.ZERO), "channel not running")
	t.eq(P.size_label(Rect2i(3, 4, 100, 200)), "100 × 200 px")


func test_regions_from_and_hit() -> void:
	var regs := P.regions_from(STORED)
	t.eq(regs.size(), 2, "the shared ch1 rect is one region")
	t.eq(regs[0], {"id": "R1", "channelNo": 1, "x": 0, "y": 0, "w": 100, "h": 200})
	t.eq(regs[1], {"id": "R2", "channelNo": 3, "x": 10, "y": 20, "w": 30, "h": 40})
	t.eq(P.next_region_id(regs), "R3")
	t.eq(P.next_region_id([]), "R1")
	t.eq(P.hit(regs, 1, Vector2(50, 50)), 0)
	t.eq(P.hit(regs, 3, Vector2(50, 50)), -1, "another channel's region is not hit")
	t.eq(P.hit(regs, 1, Vector2(100, 50)), -1, "the right edge is outside (w px wide)")
	regs.append(P.make_region("R3", 1, Rect2i(40, 40, 10, 10)))
	t.eq(P.hit(regs, 1, Vector2(45, 45)), 2, "the topmost (last drawn) wins")
	t.eq(P.region_label(regs[0], 1), "R1 · 100 × 200 px")
	t.eq(P.region_label(regs[1], 1), "R2 · ch 3")


func test_rows_for() -> void:
	var regs := P.regions_from(STORED)
	var rows := P.rows_for(FX, STORED, regs)
	t.eq(rows.size(), 3)
	t.eq(rows[0], {"pixel": 1, "geometry": "Array 109", "order": "rgb", "id": "a1", "enabled": true, "region": "R1",
		"mode": "point", "colourOrder": "grb"})
	t.eq([rows[1].id, rows[1].region, rows[1].mode], ["a2", "R2", "average"])
	t.eq([rows[2].id, rows[2].region, rows[2].mode, rows[2].colourOrder], ["", "", "average", "auto"], "unmapped pixel")
	var dup := STORED.duplicate(true)
	dup.insert(0, {"id": "off", "enabled": false, "fixtureId": "mvr-a", "pixel": 3, "channelNo": 1, "rect": {"x": 0, "y": 0, "w": 100, "h": 200}})
	dup.append({"id": "on", "enabled": true, "fixtureId": "mvr-a", "pixel": 3, "channelNo": 1, "rect": {"x": 0, "y": 0, "w": 100, "h": 200}})
	t.eq(P.rows_for(FX, dup, regs)[2].id, "on", "an enabled mapping wins over a disabled one")


func test_build_keeps_others_and_maps_rows() -> void:
	var regs := P.regions_from(STORED)
	regs.append(P.make_region("R3", 6, Rect2i(5, 6, 7, 8)))
	var rows := P.rows_for(FX, STORED, regs)
	rows[1].region = ""  # unmap pixel 2 → its stored mapping a2 goes
	rows[2].region = "R3"  # map pixel 3
	rows[2].mode = "point"
	var ms := P.build(STORED, "mvr-a", rows, regs)
	t.eq(ms.map(func(m: Dictionary) -> String: return str(m.id)), ["other", "a1", "px-mvr-a-3"], "in place; new appended")
	t.eq(ms[0], STORED[0], "another fixture's mapping is kept unchanged")
	t.eq(ms[1], {"id": "a1", "enabled": true, "fixtureId": "mvr-a", "pixel": 1, "channelNo": 1,
		"rect": {"x": 0, "y": 0, "w": 100, "h": 200}, "mode": "point", "colourOrder": "grb"})
	t.eq([ms[2].channelNo, ms[2].rect, ms[2].mode], [6, {"x": 5, "y": 6, "w": 7, "h": 8}, "point"])
	t.eq(P.rows_for(FX, ms, regs).map(func(r: Dictionary) -> String: return r.region), ["R1", "", "R3"], "round trip")
	var clash := [{"id": "px-mvr-a-3", "fixtureId": "mvr-z", "pixel": 1}]
	t.eq(P.build(clash, "mvr-a", rows, regs).map(func(m: Dictionary) -> String: return str(m.id)), ["px-mvr-a-3", "a1", "px-mvr-a-3_"], "a new id never repeats a stored one")
	t.eq(P.build(STORED, "mvr-a", [], regs), STORED, "no rows → nothing changes")


func test_move_and_drop_region() -> void:
	var regs := P.regions_from(STORED)
	var before: Dictionary = regs[0].duplicate()
	regs[0].merge(P.make_region("R1", 1, Rect2i(8, 9, 64, 32)), true)
	t.eq(P.users(STORED, before), 2, "R1 is shared by two fixtures")
	var moved := P.move_region(STORED, before, regs[0])
	t.eq([moved[0].rect, moved[1].rect], [{"x": 8, "y": 9, "w": 64, "h": 32}, {"x": 8, "y": 9, "w": 64, "h": 32}],
		"every pixel on it follows, whichever fixture")
	t.eq(moved[2], STORED[2], "other regions untouched")
	t.eq(STORED[0].rect.w, 100.0, "the input list is not changed")
	t.eq(P.rows_for(FX, moved, regs)[0].region, "R1", "rows still find the moved region")
	var dropped := P.drop_region(moved, regs[0])
	t.eq(dropped.map(func(m: Dictionary) -> String: return str(m.id)), ["a2"])
	t.eq(P.users(dropped, regs[0]), 0)


func test_row_errors() -> void:
	var posted := P.build(STORED, "mvr-a", [], [])
	var errs := [{"index": 1.0, "id": "a1", "error": "rect 0,0 5000×1 is not inside channel 1 (3840×1792)"},
		{"index": 1, "id": "a1", "error": "second"}, {"index": 0, "id": "other", "error": "fixture gone"},
		{"index": -1, "id": null, "error": "mappings must be an array"}]
	var r := P.row_errors(errs, posted)
	t.eq(r.by_target, {"mvr-a#1": "rect 0,0 5000×1 is not inside channel 1 (3840×1792); second", "mvr-b#1": "fixture gone"})
	t.eq(r.other, ["mappings must be an array"])
	t.eq(P.row_errors(null, []), {"by_target": {}, "other": []})
	t.eq(P.target("mvr-a", 3), "mvr-a#3")


func test_order_options() -> void:
	t.eq(P.order_options("rgb", "auto"), ["auto", "rgb", "rbg", "grb", "gbr", "brg", "bgr"])
	t.eq(P.order_options("rgbw", "auto").size(), 25, "auto + 24 orderings")
	t.eq(P.order_options("w", "auto"), ["auto"], "one channel: nothing to reorder")
	t.eq(P.order_options("r-b", "rgb"), ["auto", "rgb"], "dark channel: auto, the stored value stays")


func test_live_and_fixture_label() -> void:
	var live := {"mappings": [{"id": "a1", "rgb": [255.0, 128.0, 0.0], "problem": null, "on_wire": false},
		{"id": "a2", "rgb": null, "problem": "channel 3 is not running in Caspar"}]}
	var by := P.live_by_id(live)
	t.eq(by.a1.color, Color8(255, 128, 0))
	t.eq([by.a1.on_wire, by.a2.color, by.a2.problem], [false, null, "channel 3 is not running in Caspar"])
	t.eq(P.live_by_id({}), {})
	t.eq(P.fixture_label(FX), "Pixel Line IP 1042 · U18.421 · 3 px")


## WO-807 e2e finding: hundreds of proposal regions edge to edge drew overlapping labels. The view keeps a grid of the
## cells already under a label and skips a label that would land on one (pixel_map_view.gd _label, P.label_cells).
func test_label_cells_detect_overlap() -> void:
	var a: Array = P.label_cells(Rect2(0, 0, 80, 15))
	t.eq(a.size(), 11 * 2, "80×15 px → 11 columns × 2 rows of 8 px cells")
	var next: Array = P.label_cells(Rect2(4, 0, 80, 15))  # a region 4 px to the right: same cells
	t.ok(next.any(func(k: Vector2i) -> bool: return a.has(k)), "a label 4 px over collides")
	var below: Array = P.label_cells(Rect2(0, 24, 80, 15))
	t.ok(not below.any(func(k: Vector2i) -> bool: return a.has(k)), "a label one row below is free")
	var src := FileAccess.get_file_as_string("res://features/previs/fixtures/pixel_map_view.gd")
	t.ok(src.contains("labels.push_front(l)"), "the selected region's label is placed first, so it always shows")
