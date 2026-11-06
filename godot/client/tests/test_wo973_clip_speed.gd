extends RefCounted
## WO-973 — per-layer clip playback speed (clip_trim_model.gd): read, clamp, patch, which sources take it.

const T := preload("res://features/live/clip_trim_model.gd")
var t


func test_speed_of() -> void:
	t.eq(T.speed_of({}), 1.0, "absent = normal speed")
	t.eq(T.speed_of({"speed": null}), 1.0, "null = normal speed")
	t.eq(T.speed_of({"speed": 0.5}), 0.5, "stored speed")
	t.eq(T.speed_of({"speed": 9}), 4.0, "clamped to 4x")
	t.eq(T.speed_of({"speed": 0.01}), 0.25, "clamped to 0.25x")
	t.eq(T.speed_of({"speed": -2}), 1.0, "nonsense = normal")


func test_speed_patch() -> void:
	t.eq(T.speed_patch(1.0), {"speed": null}, "1x clears the key")
	t.eq(T.speed_patch(0.9996), {"speed": null}, "1x within rounding clears")
	t.eq(T.speed_patch(2.0), {"speed": 2.0}, "2x stored")
	t.eq(T.speed_patch(0.333), {"speed": 0.33}, "snapped to 0.01")
	t.eq(T.speed_patch(100.0), {"speed": 4.0}, "clamped")


func test_supports_speed() -> void:
	t.ok(T.supports_speed("clip.mp4", "media"), "a video file")
	t.ok(not T.supports_speed("still.png", "media"), "a still has no clip to retime")
	t.ok(not T.supports_speed("route://1", "route"), "a route")
	t.ok(not T.supports_speed("tl", "timeline"), "a timeline")
	t.ok(not T.supports_speed("", "media"), "empty")
