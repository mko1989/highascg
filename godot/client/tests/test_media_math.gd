extends RefCounted
## WO-601 — golden values from running the web media inspector helpers under node (2026-10-18).

const M := preload("res://features/live/media_math.gd")
var t

func test_parse_time_input_golden() -> void:
	t.ok(M.parse_time_input("") == null, "parse '' \u2192 null")
	t.ok(M.parse_time_input("  ") == null, "parse '  ' \u2192 null")
	t.ok(absf(float(M.parse_time_input("62.5")) - 62.5) < 1e-9, "parse '62.5' \u2192 62.5")
	t.ok(absf(float(M.parse_time_input("1:02.5")) - 62.5) < 1e-9, "parse '1:02.5' \u2192 62.5")
	t.ok(absf(float(M.parse_time_input("1:02:03")) - 3723) < 1e-9, "parse '1:02:03' \u2192 3723")
	t.ok(absf(float(M.parse_time_input("0:00:00.04")) - 0.04) < 1e-9, "parse '0:00:00.04' \u2192 0.04")
	t.ok(is_nan(M.parse_time_input("abc")), "parse 'abc' \u2192 NaN")
	t.ok(is_nan(M.parse_time_input("1:-2")), "parse '1:-2' \u2192 NaN")
	t.ok(absf(float(M.parse_time_input("1::2")) - 3602) < 1e-9, "parse '1::2' \u2192 3602")
	t.ok(absf(float(M.parse_time_input("90")) - 90) < 1e-9, "parse '90' \u2192 90")


func test_format_timecode_golden() -> void:
	t.eq(M.format_timecode(0.0, 25.0), "0:00.00", "0 @ 25")
	t.eq(M.format_timecode(62.5, 25.0), "1:02.12", "62.5 @ 25")
	t.eq(M.format_timecode(3725.04, 50.0), "1:02:05.02", "3725.04 @ 50")
	t.eq(M.format_timecode(1.999, 30.0), "0:01.29", "1.999 @ 30")
	t.eq(M.format_timecode(-3.0, 25.0), "0:00.00", "-3 @ 25")
	t.eq(M.format_timecode(10.0, 0.0), "0:10.00", "10 @ 0")
	t.eq(M.format_timecode(59.96, 25.0), "0:59.24", "59.96 @ 25")
