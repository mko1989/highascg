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


func test_font_items_are_the_installed_families() -> void:
	var items := T.font_items(["Ubuntu", "DejaVu Serif"], "'Ubuntu'")
	t.eq(items, [["", "Default"], ["'Ubuntu'", "Ubuntu"], ["'DejaVu Serif'", "DejaVu Serif"]], "Default + installed, css value quoted")
	var legacy := T.font_items(["Ubuntu"], "'Verdana', sans-serif")
	t.eq(legacy[-1], ["'Verdana', sans-serif", "Verdana (not installed)"], "a stored font that is not installed stays selectable, marked")
	t.eq(T.font_items([], "").size(), T.FALLBACK_FONTS.size() + 1, "no answer from the server → the box image's list")
	t.eq(T.font_items(null, "")[0], ["", "Default"], "null → fallback, Default first")


## Owner 14.11: stop at 00:00 as an option; a timer parked on the preview channel; sliders across the screen.
func test_overrun_bus_and_canvas() -> void:
	var over := {"config": {"mode": "duration", "durationSec": 10}, "lastCmd": "start", "cmdAt": NOW - 75300}
	t.ok(T.display_time(over, NOW, 0.0) < -65.0, "default: counts on below zero")
	over.config["overrun"] = false
	t.eq(T.display_time(over, NOW, 0.0), 0.0, "overrun off: held at 0")
	t.eq(T.format(T.display_time(over, NOW, 0.0)), "00:00:00", "no minus sign")
	t.eq(T.display_time({"config": {"mode": "duration", "durationSec": 300, "overrun": false}}, NOW, 0.0), 300.0, "positive values untouched")
	t.eq(T.DEFAULTS.overrun, true, "new timers keep counting, as before")
	var rec := {"screens": {"0": {"channel": 3, "layer": 980, "bus": "prv"}, "1": {"channel": 4, "layer": 980}}}
	t.eq([T.bus(rec, 0), T.bus(rec, 1), T.bus(rec, 5), T.bus({}, 0)], ["prv", "pgm", "pgm", "pgm"], "bus per screen entry")
	var cm := {"programResolutions": [{"w": 3072, "h": 1024}, null], "previewChannels": [3, null]}
	t.eq(T.canvas(cm, 0), Vector2i(3072, 1024), "slider range = the screen's canvas")
	t.eq([T.canvas(cm, 1), T.canvas(cm, 9), T.canvas({}, 0)], [Vector2i.ZERO, Vector2i.ZERO, Vector2i.ZERO], "unknown → no sliders")
	t.eq([T.has_preview(cm, 0), T.has_preview(cm, 1), T.has_preview({}, 0)], [true, false, false], "PRV only where the screen has one")
	var form := FileAccess.get_file_as_string("res://features/live/screen_timer_settings.gd")
	t.ok(form.contains("sl.scrollable = false"), "the wheel never moves a timer")
	t.ok(FileAccess.get_file_as_string("res://features/live/screen_timer_panel.gd").contains("\"/api/timers/bus\""), "Send to PRV / PGM")
