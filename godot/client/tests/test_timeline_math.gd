extends RefCounted
## WO-602 timeline math — golden values from the web's timeline-canvas-utils.js / timeline-track-heights.js under node.

const TM := preload("res://features/timeline/timeline_math.gd")
var t


func test_timecode() -> void:
	for c in [[0, 25, "00:00", "00:00:00:00"], [1040, 25, "01:01", "00:00:01:01"], [61500, 25, "1:01:12", "00:01:01:12"],
			[3725480, 50, "1:02:05:24", "01:02:05:24"], [59999, 30, "59:29", "00:00:59:29"]]:
		t.eq(TM.fmt_timecode(c[0], c[1]), c[2], "fmtTimecode(%s, %s)" % [c[0], c[1]])
		t.eq(TM.fmt_smpte(c[0], c[1]), c[3], "fmtSmpte(%s, %s)" % [c[0], c[1]])
	for c in [[0.0, "00:00:00:000"], [61500.7, "00:01:01:501"], [3725480.0, "01:02:05:480"]]:
		t.eq(TM.fmt_hms(c[0]), c[1], "fmtHms(%s)" % c[0])


func test_parse_tc() -> void:
	for c in [["00:01:02:10", 0, null, 62400.0], ["1:02:10", 0, null, 62400.0], ["02:10", 0, null, 2400.0], ["1500", 0, null, 1500.0],
			["++500", 1000, 1200, 1200.0], ["--5000", 1000, 9000, 0.0], ["x", 0, null, null], ["", 0, null, null]]:
		t.eq(TM.parse_tc(c[0], c[1], c[2], 25), c[3], "parseTcInput(%s)" % c[0])


func test_track_heights() -> void:
	var tl := {"layers": [{}, {}, {}], "layerHeights": [10, 200, "x"]}
	TM.ensure_heights(tl)
	t.eq(tl.layerHeights, [54, 120, 54], "below-min/invalid → default, above → max (web: 10 → 54, not 28)")
	t.eq(TM.track_top(tl, 2, 5, 30), 199.0, "trackTopForLayer")
	t.eq(TM.total_height(tl), 228, "totalTracksHeight")
	t.eq(TM.layer_at_y(tl, 120, 0, 30), 1, "layerIndexAtCanvasY")
	t.eq(TM.layer_at_y(tl, 500, 0, 30), 3, "below all tracks → n")
	t.eq(TM.hit_divider(tl, 84, 0, 30), 0, "hitLayerDivider")


func test_view_and_clock() -> void:
	t.eq(TM.ruler_interval(0.1), 1000, "55 px at 0.1 px/ms → 1 s ticks")
	t.eq(TM.ruler_interval(0.00001), 300000, "fully zoomed out")
	t.eq(TM.ms_at(TM.x_at(1234.0, 0.25, 500.0), 0.25, 500.0), 1234.0, "x ↔ ms")
	t.eq(TM.zoom(5.0, 1), 5.0, "zoom clamped")
	var c := {"pos": 1000.0, "at": 0.0}
	t.eq(TM.apply_tick(c, 1300.0, 100.0).pos, 1300.0, "server 200 ms ahead → snap")
	t.eq(TM.apply_tick(c, 1080.0, 100.0).pos, 1080.0, "within latency → server")
	t.eq(TM.apply_tick(c, 1000.0, 100.0).pos, 1100.0, "late report → keep extrapolating")
	var tl := TM.default_timeline()
	t.eq((tl.layers as Array).size(), 3, "three layers")
	t.eq(tl.layerHeights, [54, 54, 54], "heights ensured")
	t.ok(str(tl.id).begins_with("t") and tl.id != tl.layers[0].id, "uid shape")
