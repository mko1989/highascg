extends RefCounted
## WO-601 — golden values from running the web media inspector helpers under node (2026-10-18).

const M := preload("res://features/live/media_math.gd")
var t

func test_format_timecode_golden() -> void:
	t.eq(M.format_timecode(0.0, 25.0), "0:00.00", "0 @ 25")
	t.eq(M.format_timecode(62.5, 25.0), "1:02.12", "62.5 @ 25")
	t.eq(M.format_timecode(3725.04, 50.0), "1:02:05.02", "3725.04 @ 50")
	t.eq(M.format_timecode(1.999, 30.0), "0:01.29", "1.999 @ 30")
	t.eq(M.format_timecode(-3.0, 25.0), "0:00.00", "-3 @ 25")
	t.eq(M.format_timecode(10.0, 0.0), "0:10.00", "10 @ 0")
	t.eq(M.format_timecode(59.96, 25.0), "0:59.24", "59.96 @ 25")
