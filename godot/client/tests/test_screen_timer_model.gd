extends RefCounted
## WO-601 screen timers — golden values from the web's timer-control-panel-display.js under node (Date.now pinned).

const T := preload("res://features/live/screen_timer_model.gd")
const NOW := 1792327632855.0
var t


func test_display_time_duration_golden() -> void:
	# [record, computeDisplayTime, formatDisplayTime]
	var cases := [
		[{"config": {"mode": "duration", "durationSec": 300}}, 300.0, "00:05:00"],
		[{"config": {"mode": "duration", "durationSec": 300}, "lastCmd": "start", "cmdAt": NOW - 12500}, 287.5, "00:04:47"],
		[{"config": {"mode": "duration", "durationSec": 300}, "lastCmd": "start", "cmdAt": NOW - 12500, "remainingSec": 100}, 87.5, "00:01:27"],
		[{"config": {"mode": "duration", "durationSec": 300}, "lastCmd": "pause", "remainingSec": 87.4}, 87.4, "00:01:27"],
		[{"config": {"mode": "duration", "durationSec": 300}, "lastCmd": "pause"}, 300.0, "00:05:00"],
		[{"config": {"mode": "duration", "durationSec": 10}, "lastCmd": "start", "cmdAt": NOW - 75300}, -65.3, "-00:01:05"],
		[{"config": {}, "durationSec": 42, "lastCmd": "reset"}, 42.0, "00:00:42"],
		[{"config": {"mode": "countup"}}, 0.0, "00:00:00"],
	]
	for c in cases:
		var v := T.display_time(c[0], NOW, 0.0)
		t.ok(absf(v - c[1]) < 1e-6, "value %s → %s (got %s)" % [c[0], c[1], v])
		t.eq(T.format(v), c[2], "format %s" % c[1])


func test_format_golden() -> void:
	for c in [[0.0, "00:00:00"], [59.9, "00:00:59"], [3600.0, "01:00:00"], [-0.4, "-00:00:00"], [-65.3, "-00:01:05"], [359999.0, "99:59:59"]]:
		t.eq(T.format(c[0]), c[1], "formatDisplayTime(%s)" % c[0])


func test_clock_mode_and_state() -> void:
	var rec := {"config": {"mode": "clock", "targetTime": "18:30", "amberThresholdSec": 60, "redThresholdSec": 15}}
	t.eq(T.display_time(rec, NOW, 18 * 3600 + 29 * 60), 60.0, "18:30 target, 18:29 local → 60 s")
	t.eq(T.display_time({"config": {"mode": "clock", "targetTime": "x:y"}}, NOW, 10.0), -10.0, "bad target = midnight")
	t.eq(T.state(rec, 60.0), "amber", "≤ amber")
	t.eq(T.state(rec, 15.0), "red", "≤ red")
	t.eq(T.state(rec, 61.0), "", "normal")


func test_screen_filter_px_name() -> void:
	var timers := [{"timerId": "a", "screens": {"0": {}}}, {"timerId": "b", "screens": {"1": {}}}, {"timerId": "c"}]
	t.eq(T.on_screen(timers, 1).map(func(x: Dictionary) -> String: return x.timerId), ["b"], "screen filter")
	t.eq(T.px_value("  "), "", "blank → preset")
	t.eq(T.px_value("120.6"), 121, "rounded")
	t.eq(T.new_name("Main", 0), "Timer Main", "first")
	t.eq(T.new_name("Main", 1), "Timer Main #2", "second")
