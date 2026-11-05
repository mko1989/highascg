extends RefCounted
## WO-966 — the media inspector's "Set in" / "Set out": the preview position in ms, never crossing the other point.

const MI := preload("res://features/live/media_inspector.gd")
var t


func test_mark_patch() -> void:
	t.eq(MI.mark_patch("trimInMs", 1.2345, {}), {"trimInMs": 1235}, "in at the preview position, ms")
	t.eq(MI.mark_patch("trimOutMs", 4.0, {"trimInMs": 1000}), {"trimOutMs": 4000}, "out after the in point")
	t.ok(MI.mark_patch("trimInMs", 5.0, {"trimOutMs": 4000}).has("error"), "in at / past out → refused")
	t.ok(MI.mark_patch("trimOutMs", 1.0, {"trimInMs": 1000}).has("error"), "out on the in point → refused")
	t.eq(MI.mark_patch("trimInMs", -0.5, {}), {"trimInMs": 0}, "never negative")
	t.eq(MI.mark_patch("trimOutMs", 2.0, {"trimInMs": null}), {"trimOutMs": 2000}, "a cleared in point does not block")
