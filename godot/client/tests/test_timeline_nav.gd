extends RefCounted
## Timeline keyboard helpers — web timeline-editor-inputs.js buildTimelineSnapCandidates / prevSnapPoint /
## nextSnapPoint / resolvePasteLayerIdx, timeline-state-clips.js insertClipClone, the transport's Trim.

const N := preload("res://features/timeline/timeline_nav.gd")
var t


func _tl() -> Dictionary:
	return {"duration": 30000, "fps": 25, "flags": [{"id": "f1", "timeMs": 7000.4}],
		"layers": [{"id": "a", "clips": [{"id": "c1", "startTime": 1000, "duration": 4000}]},
			{"id": "b", "clips": [{"id": "c2", "startTime": 5000, "duration": 2500, "keyframes": [{"time": 0}]}]}]}


func test_snap_points() -> void:
	var tl := _tl()
	t.eq(N.snap_points(tl, 12345.6), [0, 1000, 5000, 7000, 7500, 12346, 30000], "bounds, playhead, flags, clip edges, unique")
	t.eq(N.snap_points(tl, null, "c2", "f1"), [0, 1000, 5000, 30000], "the moved clip / flag left out (c1 still ends at 5000)")
	var pts := [0, 1000, 5000]
	t.eq(N.next_point(pts, 1000), 5000, "strictly after (> 1 ms)")
	t.eq(N.next_point(pts, 999.5), 5000, "within 1 ms counts as on it")
	t.eq(N.next_point(pts, 5000), null)
	t.eq(N.prev_point(pts, 5000), 1000)
	t.eq(N.prev_point(pts, 0), null)
	t.eq(N.frame_ms(tl), 40.0)
	t.eq(N.frame_ms({"fps": 0}), 40.0, "bad fps → 25")


func test_trim_and_paste() -> void:
	var tl := _tl()
	t.eq(N.clips_end(tl), 7500.0, "clips only (the flag does not count)")
	t.eq(N.clips_end({"layers": []}), 0.0)
	t.eq(N.paste_layer(tl, 1, 0), 1, "the selected layer wins")
	t.eq(N.paste_layer(tl, 5, 7), 1, "else the copied clip's layer, clamped")
	t.eq(N.paste_layer(tl, -1, -1), 1, "else the last layer")
	var src: Dictionary = tl.layers[1].clips[0]
	var c := N.paste_clip(tl, 0, src, 29000)
	t.ok(c.id != "c2" and c.startTime == 29000.0 and c.duration == 2500, "copy with a new id at the playhead")
	t.ok(not is_same(c.keyframes, src.keyframes), "deep copy")
	t.eq(tl.layers[0].clips.size(), 2, "appended to the target layer")
	t.eq(tl.duration, 33500.0, "grows to start + dur + 2 s")
	t.ok(N.paste_clip(tl, 4, src, 0).is_empty(), "no such layer")
