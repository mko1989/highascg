extends RefCounted
## Timeline clip keyframes — web lib/timeline-state-keyframes.js + timeline-canvas-snap.js, the engine's _lerp and the
## eased segment Caspar plays (timeline-keyframe-mixer.js + caspar-tween.js).

const K := preload("res://features/timeline/timeline_keyframes.gd")
var t


func _kf(time: float, prop: String, v: float, e := "linear") -> Dictionary:
	return {"time": time, "property": prop, "value": v, "easing": e}


func test_mutations() -> void:
	var c := {"duration": 4000, "keyframes": []}
	K.add(c, _kf(1000, "opacity", 0.5))
	K.add(c, _kf(0, "opacity", 0))
	K.add(c, _kf(1000, "opacity", 0.8))
	t.eq(c.keyframes, [_kf(0, "opacity", 0), _kf(1000, "opacity", 0.8)], "same property + time replaced, sorted")
	K.add(c, _kf(1000, "volume", 1))
	t.eq(c.keyframes.size(), 3, "another property at the same time is kept")
	K.remove(c, "opacity", 1000.4)
	t.eq(c.keyframes, [_kf(0, "opacity", 0), _kf(1000, "volume", 1)], "remove within 0.5 ms")
	K.fade_in(c)
	K.fade_out(c)
	t.eq(K.of(c, "opacity"), [_kf(0, "opacity", 0), _kf(500, "opacity", 1), _kf(3500, "opacity", 1), _kf(4000, "opacity", 0)], "i + o")
	K.fade_in(c)
	t.eq(K.of(c, "opacity").size(), 4, "a second fade in replaces the first")
	K.add_scale(c, 200, 0.5, 9.0)
	t.eq([K.of(c, "scale_x")[0].value, K.of(c, "scale_y")[0].value], [0.5, 4.0], "scale per axis, clamped 0–4")
	K.clear_range(c, "opacity", 0, 500)
	t.eq(K.of(c, "opacity").size(), 2, "range is inclusive")


func test_drag_clamp() -> void:
	var ks := [_kf(0, "opacity", 0), _kf(1000, "volume", 1), _kf(2000, "opacity", 1), _kf(3000, "opacity", 0)]
	t.eq(K.clamp_drag_time(ks, 2, 5000, 4000), 2999.0, "stops 1 ms short of the next same-property key")
	t.eq(K.clamp_drag_time(ks, 2, -50, 4000), 1.0, "and of the previous one")
	t.eq(K.clamp_drag_time(ks, 1, 3500, 4000), 3500.0, "other properties are no barrier")
	t.eq(K.clamp_drag_time(ks, 3, 9000, 4000), 4000.0, "inside the clip")
	var c := {"duration": 4000, "keyframes": ks}
	var dragged: Dictionary = ks[0]
	t.ok(K.move(c, dragged, 2500), "moved")
	t.eq(dragged.time, 1999.0, "clamped below the 2000 key")
	t.ok(is_same(c.keyframes[1], dragged), "re-sorted in place, identity kept")
	t.ok(not K.move(c, dragged, 1999), "no change → false")


func test_interp_and_ease() -> void:
	var c := {"keyframes": [_kf(1000, "opacity", 0), _kf(3000, "opacity", 1, "ease-out"), _kf(5000, "opacity", 0.5, "ease-in-out")]}
	t.eq(K.interp(c, 500, "opacity", 1), 1.0, "before the first key: the default")
	t.eq(K.interp(c, 2000, "opacity", 1), 0.5, "linear between")
	t.eq(K.interp(c, 9000, "opacity", 1), 0.5, "after the last: the last value")
	t.eq(K.eased(c, 2000, "opacity", 1), 0.75, "easeoutquad at u = 0.5")
	t.eq(K.eased(c, 3500, "opacity", 1), 1.0 - 0.5 * 0.125, "easeinoutquad at u = 0.25 → 0.125")
	t.eq(K.eased(c, 500, "opacity", 1), 1.0, "outside the segments = interp")
	t.eq(K.ease_curve("ease-in", 0.5), 0.25, "easeinquad")
	t.eq(K.ease_curve("easeinoutquad", 0.75), 0.875, "Penner in-out second half")
	t.eq(K.ease_curve("easeoutincubic", 0.25), 0.4375, "out-in first half")
	t.eq(K.ease_curve("easeinsine", 1.0), 1.0, "sine end")
	t.eq(K.ease_curve("easeoutbounce", 0.3), 0.3, "unported family previews linear")
	t.eq(K.ease_curve("bogus", 0.3), 0.3, "unknown = linear (Caspar gets linear too)")
	t.eq(K.caspar_token("Ease-In-Out"), "easeinoutquad", "same mapping as toCasparTween")
	t.eq(K.caspar_token("easeboth"), "easeinoutquad")
	var r := K.rect_at({"keyframes": [_kf(0, "fill_x", 0.5), _kf(0, "scale_y", 0.25)]}, 10, {"x": 0, "y": 108, "w": 1920, "h": 540}, Vector2(1920, 1080))
	t.eq(r, {"x": 960.0, "y": 108.0, "w": 1920.0, "h": 270.0}, "keys over the base rect")


func test_geometry_and_snap() -> void:
	t.eq(K.marker_y(_kf(0, "opacity", 1), 46), 7.0, "opacity 1 at the top of the lane")
	t.eq(K.marker_y(_kf(0, "volume", 2), 46), 7.0, "volume clamps to the lane")
	t.eq(K.marker_y(_kf(0, "opacity", 0.5), 46), 23.0, "half")
	t.eq(K.marker_y(_kf(0, "fill_x", 0.3), 46), 39.0, "fill on the bottom lane")
	var c := {"startTime": 1000, "duration": 3000, "keyframes": [_kf(0, "opacity", 0), _kf(100, "opacity", 1)]}
	var x_at := func(ms: float) -> float: return ms * 0.1
	t.eq(K.hit(c, 50, 46, Vector2(101, 50 + 39), x_at), 0, "nearest diamond")
	t.eq(K.hit(c, 50, 46, Vector2(110, 57), x_at), 1, "value-aware y")
	t.eq(K.hit(c, 50, 46, Vector2(120, 57), x_at), -1, "outside ±8 px")
	t.eq(K.hit(c, 50, 7, Vector2(100, 50), x_at), -1, "row too short")
	var tl := {"duration": 9000, "flags": [{"timeMs": 4000}], "layers": [{"clips": [c]}]}
	t.eq(K.snap_candidates(tl, 300, c.keyframes[0]), [0.0, 9000.0, 300.0, 4000.0, 1000.0, 4000.0, 1100.0], "own clip edges + other keys, not the dragged one")


func test_shortcuts() -> void:
	var cv := Vector2(1920, 1080)
	var base := {"x": 0, "y": 204, "w": 1920, "h": 672}
	var c := {"startTime": 1000, "duration": 4000, "volume": 0.5, "keyframes": []}
	t.ok(not K.shortcut(c, "x", 0, base, cv), "other keys ignored")
	t.ok(K.shortcut(c, "p", 3000, base, cv), "p")
	t.eq(K.of(c, "fill_x"), [_kf(2000, "fill_x", 0)], "position at the clip-local playhead")
	t.eq(K.of(c, "fill_y")[0].value, 204.0 / 1080.0, "normalized y")
	K.shortcut(c, "s", 99999, base, cv)
	t.eq([K.of(c, "scale_x")[0].time, K.of(c, "scale_x")[0].value, K.of(c, "scale_y")[0].value], [4000.0, 1.0, 672.0 / 1080.0], "scale per axis, clamped to the clip end")
	K.shortcut(c, "v", 0, base, cv)
	t.eq(K.of(c, "volume"), [_kf(0, "volume", 0.5)], "volume = the clip volume, before the clip → 0")
	K.shortcut(c, "i", 0, base, cv)
	K.shortcut(c, "t", 1250, base, cv)
	t.eq(K.of(c, "opacity")[1], _kf(250, "opacity", 0.5), "t records the interpolated opacity")
