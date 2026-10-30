extends RefCounted
## WO-602 slice 2 — timeline editing math, goldens from the web formulas (timeline-canvas-snap.js,
## timeline-canvas-pointer.js resize step, timeline-state-clips.js, fill-math.js sceneLayerPixelRectForContentFit).

const TE := preload("res://features/timeline/timeline_edit.gd")
var t


func _tl() -> Dictionary:
	return {"id": "x", "duration": 30000, "fps": 25, "flags": [{"id": "f", "timeMs": 12000, "label": "Cue"}],
		"layers": [{"id": "l1", "clips": [{"id": "a", "startTime": 0, "duration": 5000}, {"id": "b", "startTime": 8000, "duration": 2000}]},
			{"id": "l2", "clips": []}]}


func test_snap() -> void:
	t.eq(TE.snap_value(103.0, [0, 100, 200], 8.0), 100.0, "nearest within threshold")
	t.eq(TE.snap_value(110.0, [0, 100, 200], 8.0), 110.0, "outside threshold stays")
	var cands := TE.snap_candidates(_tl(), 3000.0, 0, "b")
	t.eq(cands, [0.0, 30000.0, 3000.0, 12000.0, 0.0, 5000.0], "0, end, playhead, flag, other clips' edges (own excluded)")
	t.eq(TE.snap_candidates(_tl(), null).size(), 7, "no playhead → not a candidate")
	# start snaps to 5000 (the end of clip a) when 4995 is dragged
	t.eq(TE.snapped_start(4995.0, 2000.0, [0, 5000, 12000], 80.0, null), 5000.0, "start edge snaps")
	t.eq(TE.snapped_start(9950.0, 2000.0, [0, 5000, 12000], 80.0, null), 10000.0, "end edge snaps to the flag")
	t.eq(TE.snapped_start(20000.0, 2000.0, [0], 80.0, 20120.0), 20120.0, "playhead pulls within 14/8 × thr")
	t.eq(TE.snapped_start(18000.0, 2000.0, [0], 80.0, 20100.0), 18100.0, "playhead pulls the end edge")
	t.eq(TE.snapped_start(-40.0, 2000.0, [], 80.0, null), 0.0, "never before 0")
	# WO-843: an edge exactly on a snap point wins over a near miss of the other edge (was 4997)
	t.eq(TE.snapped_start(5000.0, 2003.0, [0, 5000, 7000], 80.0, null), 5000.0, "start exactly on 5000 stays")
	t.eq(TE.snapped_start(4997.0, 2003.0, [0, 5000, 7000], 80.0, null), 4997.0, "end exactly on 7000 beats the start 3 ms off 5000 (was 5000)")
	t.eq(TE.snap_dist(5000.0, [5000], 80.0), 0.0, "distance 0 is a hit")
	t.ok(is_inf(TE.snap_dist(5100.0, [5000], 80.0)), "outside = none")
	t.eq(TE.snapped_edge(11950.0, [12000], 80.0, null), 12000.0, "edge snaps")
	t.eq(TE.snapped_edge(11900.0, [12000], 80.0, null), 11900.0, "edge outside threshold")
	t.eq(TE.snapped_edge(11900.0, [12000], 80.0, 11800.0), 11800.0, "playhead wins")


func test_edge_zone_and_resize() -> void:
	var c := {"startTime": 1000, "duration": 2000}
	t.eq(TE.edge_zone(c, 1050.0, 0.1), "left", "within 6 px (60 ms) of the start")
	t.eq(TE.edge_zone(c, 2950.0, 0.1), "right", "near the end")
	t.eq(TE.edge_zone(c, 2000.0, 0.1), "", "middle")
	var o := {"start": 1000.0, "dur": 2000.0, "inPoint": 10}
	t.eq(TE.resize_changes("left", 1400.0, o, 25.0), {"startTime": 1400.0, "duration": 1600.0, "inPoint": 20}, "trim the head: +10 frames")
	t.eq(TE.resize_changes("left", 600.0, o, 25.0), {"startTime": 600.0, "duration": 2400.0, "inPoint": 0}, "extend the head: in-point floors at 0")
	t.eq(TE.resize_changes("left", 2900.0, o, 25.0), {}, "under 200 ms → no change")
	t.eq(TE.resize_changes("right", 2500.0, o, 25.0), {"duration": 1500.0}, "trim the tail keeps the in-point")
	t.eq(TE.resize_changes("right", 4000.0, o, 25.0), {"duration": 3000.0, "inPoint": 0}, "longer than before resets the in-point")
	t.eq(TE.resize_changes("right", 1050.0, o, 25.0), {"duration": 200.0}, "minimum 200 ms")


func test_clip_mutations() -> void:
	var tl := _tl()
	var c := TE.add_clip(tl, 1, {"type": "media", "value": "CLIP"}, 29000.0, 4000.0, {"contentFit": "fill-canvas", "loopAlways": true})
	t.eq([c.startTime, c.duration, c.naturalDuration, c.contentFit, c.loopAlways, c.loop, c.audioRoute], [29000.0, 4000.0, 4000.0, "fill-canvas", true, false, "1+2"], "defaults")
	t.eq(tl.duration, 35000.0, "timeline grows to content end + 2 s")
	t.eq(TE.default_clip(null, 0, 0, {"contentFit": "bogus"}).contentFit, "native", "unknown fit → native")
	t.eq(TE.default_clip(null, 0, 0).duration, 5000.0, "no duration → 5 s")
	TE.update_clip(tl, 0, "a", {"startTime": 34000.0})
	t.eq(tl.duration, 41000.0, "update expands")
	t.eq(TE.move_clip_to_layer(tl, "a", 0, 1).id, "a", "moved")
	t.eq([tl.layers[0].clips.size(), tl.layers[1].clips.size()], [1, 2], "layer counts after move")
	t.eq(TE.move_clip_to_layer(tl, "a", 0, 5), {}, "bad layer")
	TE.remove_clip(tl, 1, "a")
	t.eq(tl.layers[1].clips.size(), 1, "removed")
	t.eq(TE.find_clip(tl, 0, "b").startTime, 8000, "find")


func test_replace_source() -> void:
	var tl := _tl()
	var c := TE.add_clip(tl, 1, {"value": "A"}, 0.0, 4000.0)
	c["keyframes"] = [{"time": 3500, "property": "opacity", "value": 1}]
	TE.replace_clip_source(tl, 1, c.id, {"value": "B"}, 3000.0)
	t.eq([c.source.value, c.duration, c.naturalDuration, c.keyframes[0].time], ["B", 3000.0, 3000.0, 3000.0], "media-length clip adopts the new length, keyframes clamp")
	c["duration"] = 2500.0
	c["inPoint"] = 40
	TE.replace_clip_source(tl, 1, c.id, {"value": "C"}, 9000.0)
	t.eq([c.duration, c.naturalDuration, c.inPoint, c.outPoint], [2500.0, 9000.0, 0, null], "operator-resized clip keeps its length")
	var old := {"id": "o", "startTime": 0, "duration": 1000, "source": {"value": "X"}}
	tl.layers[0].clips.append(old)
	TE.replace_clip_source(tl, 0, "o", {"value": "Y"}, 7000.0)
	t.eq(old.duration, 1000.0, "unknown naturalDuration counts as resized")


func test_fit_rect() -> void:
	t.eq(TE.fit_rect(1920, 1080, 1280, 720, "native"), {"x": 320.0, "y": 180.0, "w": 1280.0, "h": 720.0}, "native centred")
	t.eq(TE.fit_rect(1920, 1080, 1080, 1080, "fill-canvas"), {"x": 420.0, "y": 0.0, "w": 1080.0, "h": 1080.0}, "contain")
	t.eq(TE.fit_rect(1920, 1080, 1000, 1000, "horizontal"), {"x": 0, "y": -420.0, "w": 1920.0, "h": 1920.0}, "fill width")
	t.eq(TE.fit_rect(1920, 1080, 4000, 1000, "vertical"), {"x": -1200.0, "y": 0, "w": 4320.0, "h": 1080.0}, "fill height")
	t.eq(TE.fit_rect(1920, 1080, 640, 480, "stretch"), {"x": 0, "y": 0, "w": 1920.0, "h": 1080.0}, "stretch")
	t.eq(TE.fit_rect(1920, 1080, 0, 0, "native"), {"x": 0, "y": 0, "w": 1920.0, "h": 1080.0}, "unknown media → full canvas")
	t.eq(TE.fit_rect(1920, 1080, 1921, 1081, "native"), {"x": 0.0, "y": 0.0, "w": 1921.0, "h": 1081.0}, "Math.round(-0.5) = -0")
	t.eq(TE.parse_resolution("1920x1080"), Vector2i(1920, 1080), "resolution")
	t.eq(TE.parse_resolution("3840 × 2160 @50"), Vector2i(3840, 2160), "× and spaces")
	t.eq(TE.parse_resolution(""), Vector2i.ZERO, "none")


func test_replace_refit_and_lookup() -> void:
	t.eq(TE.contain_rect({"x": 100, "y": 50, "w": 800, "h": 450}, 1080, 1080), {"x": 275.0, "y": 50.0, "w": 450.0, "h": 450.0}, "square inside the old 16:9 rect, centre kept")
	t.eq(TE.contain_rect({"x": 10, "y": 20, "w": 300, "h": 200}, 0, 0), {"x": 10.0, "y": 20.0, "w": 300.0, "h": 200.0}, "unknown media leaves the rect")
	var rows := [{"id": "FOLDER/CLIP A", "durationMs": 4000}, {"id": "OTHER/Intro.MOV", "durationMs": 9000}]
	t.eq(TE.find_media_row(rows, "FOLDER/CLIP A").durationMs, 4000, "exact id")
	t.eq(TE.find_media_row(rows, "intro").durationMs, 9000, "basename, case and extension insensitive")
	t.eq(TE.find_media_row(rows, "nope"), {}, "missing")
	t.eq(TE.next_layer_name({"layers": [{"name": "Layer 1"}, {"name": "Layer 7"}]}), "Layer 8", "after the highest number")
	t.eq(TE.next_layer_name({"layers": [{"name": "BG"}, {"name": "FG"}]}), "Layer 3", "after the count")
