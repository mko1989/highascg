extends RefCounted
## WO-837 — the control lane: stacking of overlapping chips, lane growth, hit-testing.

const LN := preload("res://features/timeline/timeline_lane.gd")
const RW := preload("res://features/timeline/timeline_rows.gd")
var t


func _txt(f: Dictionary) -> String:
	return str(f.get("label", ""))


func _flag(id: String, ms: float, type := "companion_press", label := "") -> Dictionary:
	return {"id": id, "timeMs": ms, "type": type, "label": label}


func test_only_control_flags_become_chips() -> void:
	var tl := {"flags": [_flag("a", 0, "pause"), _flag("b", 100), _flag("c", 200, "light", "x"), _flag("d", 300, "jump")]}
	var lane := LN.layout(tl, 1.0, _txt)
	t.eq(lane.chips.map(func(c: Dictionary) -> String: return c.flag.id), ["b", "c"], "pause / jump stay in the ruler")


func test_far_apart_chips_share_row_zero() -> void:
	var tl := {"flags": [_flag("a", 0), _flag("b", 1000), _flag("c", 2000)]}
	var lane := LN.layout(tl, 0.1, _txt)  # 100 px apart, 30 px wide
	t.eq(lane.chips.map(func(c: Dictionary) -> int: return c.row), [0, 0, 0], "no overlap")
	t.eq(lane.count, 1, "one row")


func test_overlapping_chips_stack_upward() -> void:
	var tl := {"flags": [_flag("a", 1000), _flag("b", 1100), _flag("c", 1200), _flag("d", 2000)]}
	var lane := LN.layout(tl, 0.1, _txt)  # a 100..130, b 110.. → row 1, c 120.. → row 2, d 200 → row 0
	t.eq(lane.chips.map(func(c: Dictionary) -> int: return c.row), [0, 1, 2, 0], "first fit from the bottom")
	t.eq(lane.count, 3, "lane grows one row per extra row")
	t.eq(RW.lane_h(lane.count), 8 + 96, "and gets taller by a row each")


func test_gap_counts_as_overlap() -> void:
	var tl := {"flags": [_flag("a", 0), _flag("b", 330)]}  # at 0.1 px/ms: 0..30 and 33..: gap 3 < 4
	t.eq(LN.layout(tl, 0.1, _txt).count, 2, "touching chips stack")
	tl = {"flags": [_flag("a", 0), _flag("b", 340)]}
	t.eq(LN.layout(tl, 0.1, _txt).count, 1, "a 4 px gap does not")


func test_zooming_in_unstacks() -> void:
	var tl := {"flags": [_flag("a", 1000), _flag("b", 1100)]}
	t.eq(LN.layout(tl, 0.1, _txt).count, 2, "overlap at 0.1 px/ms")
	t.eq(LN.layout(tl, 1.0, _txt).count, 1, "100 px apart at 1 px/ms")


func test_light_chip_width_follows_text() -> void:
	var short := LN.chip_w({"type": "light"}, "ab")
	var long := LN.chip_w({"type": "light"}, "a much longer console name · Go 12 / cue 3")
	t.ok(short == LN.MIN_LIGHT_W and long > short and long <= LN.MAX_LIGHT_W, "clamped to the chip limits")
	t.eq(LN.chip_w({"type": "companion_press"}, "x"), LN.COMPANION_W, "companion thumbnail chip")


func test_rows_do_not_depend_on_scroll() -> void:
	var tl := {"flags": [_flag("a", 1000), _flag("b", 1100)]}
	var lane := LN.layout(tl, 0.1, _txt)
	for scroll in [0.0, 500.0]:
		var x_at := func(ms: float) -> float: return 112.0 + (ms - scroll) * 0.1
		var r0 := LN.rect(lane.chips[0], lane.count, 200.0, x_at)
		var r1 := LN.rect(lane.chips[1], lane.count, 200.0, x_at)
		t.ok(r1.position.y < r0.position.y, "the stacked chip is higher on screen")
		t.eq(r0.position.y, 200.0 + 4 + 32, "row 0 is the bottom row of a 2-row lane")
		t.eq(r0.position.x, 112.0 + (1000 - scroll) * 0.1, "x follows the flag time")


func test_hit_picks_the_chip_under_the_pointer() -> void:
	var tl := {"flags": [_flag("a", 1000), _flag("b", 1100)]}
	var lane := LN.layout(tl, 0.1, _txt)
	var x_at := func(ms: float) -> float: return 112.0 + ms * 0.1
	var top := 200.0
	var ra := LN.rect(lane.chips[0], lane.count, top, x_at)
	var rb := LN.rect(lane.chips[1], lane.count, top, x_at)
	t.eq(LN.hit(lane, top, ra.get_center(), x_at).get("id"), "a", "bottom chip")
	t.eq(LN.hit(lane, top, rb.get_center(), x_at).get("id"), "b", "stacked chip")
	t.ok(LN.hit(lane, top, Vector2(rb.end.x + 30, rb.get_center().y), x_at).is_empty(), "empty lane")
	t.ok(LN.hit(lane, top, Vector2(50, ra.get_center().y), x_at).is_empty(), "not over the headers")
	t.ok(LN.hit(lane, top, Vector2(ra.get_center().x, top - 3), x_at).is_empty(), "above the lane")
