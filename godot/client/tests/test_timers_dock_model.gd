extends RefCounted
## WO-806 Timers dock — golden values from the web's timer-control-panel-inline-time.js under node
## (parseTimeText / secondsToClockText / timeConfigPatch / timeInputValue), the row list, the requests, and the
## WO-381 / WO-567 rules (no create / assign / remove; the ⚙ form is the short one).

const M := preload("res://features/live/timers_dock_model.gd")
const Form := preload("res://features/live/screen_timer_settings.gd")
const T := preload("res://features/live/screen_timer_model.gd")
var t


func test_parse_time_text_golden() -> void:
	# web parseTimeText: null → -1 here
	for c in [["90", 90], ["5:00", 300], ["01:30:00", 5400], ["90:00", 5400], ["0", 0], ["", -1], ["abc", -1],
			["1:2:3:4", -1], ["  7:05 ", 425], ["00:59", 59]]:
		t.eq(M.parse_time_text(c[0]), c[1], "parseTimeText(%s)" % c[0])


func test_parse_time_text_takes_maths() -> void:
	# RULES.md input rule 2 (the web returns null for these): a plain expression without ':' is evaluated
	t.eq(M.parse_time_text("5*60"), 300, "5*60")
	t.eq(M.parse_time_text("(1+1)*30"), 60, "(1+1)*30")
	t.eq(M.parse_time_text("1234"), 1234, "4 digits = seconds (web: null)")
	t.eq(M.parse_time_text("10-20"), -1, "negative → invalid")
	t.eq(M.parse_time_text("5*:"), -1, "garbage with ':'")


func test_seconds_to_clock_text_golden() -> void:
	for c in [[0, "00:00:00"], [59, "00:00:59"], [3600, "01:00:00"], [86399, "23:59:59"], [86400, "00:00:00"],
			[90061, "01:01:01"], [-5, "00:00:00"], [1.9, "00:00:01"]]:
		t.eq(M.seconds_to_clock_text(c[0]), c[1], "secondsToClockText(%s)" % c[0])


func test_time_config_patch_and_value_golden() -> void:
	t.eq(M.time_config_patch({"config": {"mode": "duration"}}, 300), {"durationSec": 300}, "duration")
	t.eq(M.time_config_patch({"config": {"mode": "clock"}}, 66600), {"targetTime": "18:30:00"}, "clock")
	t.eq(M.time_config_patch({}, 90), {"durationSec": 90}, "no config = duration")
	t.eq(M.time_input_value({"config": {"durationSec": 5400}}), "01:30:00", "duration value")
	t.eq(M.time_input_value({"config": {"mode": "clock", "targetTime": "18:30:00"}}), "18:30:00", "clock value")
	t.eq(M.time_input_value({"config": {"mode": "clock"}}), "00:00:00", "clock without target")
	t.eq(M.time_input_value({}), "00:00:00", "empty")


func test_commit_time() -> void:
	var tm := {"timerId": "a", "config": {"mode": "duration", "durationSec": 300}, "screens": {"0": {}}}
	t.eq(M.commit_time(tm, "5:00"), ["00:05:00", {}], "unchanged → no write")
	t.eq(M.commit_time(tm, "90:00"), ["01:30:00", {"durationSec": 5400}], "changed → patch")
	t.eq(M.commit_time(tm, "nope"), ["00:05:00", {}], "garbage → the stored value back")
	var clock := {"timerId": "b", "config": {"mode": "clock", "targetTime": "18:00:00"}}
	t.eq(M.commit_time(clock, "18:30"), ["00:18:30", {"targetTime": "00:18:30"}], "clock: MM:SS reads as minutes (web)")
	t.eq(M.commit_time(clock, "18:30:00"), ["18:30:00", {"targetTime": "18:30:00"}], "clock target")


func test_rows_screens_and_requests() -> void:
	var list := [{"timerId": "x1", "name": "", "screens": {"1": {"visible": true}, "0": {"visible": false}}, "config": {"durationSec": 60}},
		{"name": "no id"}, "junk", {"timerId": "x2", "name": "Walk-in"}]
	var rows := M.rows(list)
	t.eq(rows.size(), 2, "only timers with an id")
	t.eq(M.screens(rows[0]), [0, 1], "screens ascending")
	t.ok(M.screen_visible(rows[0], 1) and not M.screen_visible(rows[0], 0), "visible per screen")
	t.eq(M.name_of(rows[0]), "Timer x1", "unnamed → Timer <id>")
	t.eq(M.name_of(rows[1]), "Walk-in", "name")
	t.eq(M.screens(rows[1]), [], "unassigned")
	t.eq(M.visible_body("x1", 1, false), {"timerId": "x1", "screenIdx": 1, "visible": false, "fadeFrames": 25}, "eye = 25-frame fade (WO-381)")
	t.eq(M.cmd_body("x1", "pause"), {"timerId": "x1", "cmd": "pause"}, "cmd")
	var bodies := M.assign_bodies(rows[0], {"durationSec": 90})
	t.eq(bodies.size(), 2, "one assign per screen")
	t.eq(bodies[1], {"timerId": "x1", "screenIdx": 1, "config": {"durationSec": 90}}, "merged config")
	t.eq(M.assign_bodies(rows[1], {"durationSec": 90}), [], "unassigned → nothing to write")
	t.ok(M.shape(rows) != M.shape(M.rows([list[0]])), "shape changes with the list")
	var moved: Dictionary = (list[0] as Dictionary).duplicate(true)
	moved["remainingSec"] = 12.5
	moved["lastCmd"] = "start"
	t.eq(M.shape(M.rows([moved])), M.shape(M.rows([list[0]])), "a running timer does not rebuild the rows")


func test_dock_is_a_controller_only() -> void:
	var src := FileAccess.get_file_as_string("res://features/live/timers_dock.gd")
	for banned in ["/api/timers/unassign", "Add timer", "new_name("]:
		t.ok(not src.contains(banned), "WO-381: the dock has no %s" % banned)
	t.ok(src.contains("Form.build(g, form, _cfg(t), false,"), "WO-567: the dock's ⚙ is the short form")
	t.ok(FileAccess.get_file_as_string("res://features/live/screen_timer_panel.gd").contains("SettingsForm.build(g, box, cfg, true,"),
		"the Inspector page keeps the extended form")


func test_short_form_has_no_font_colours_border() -> void:
	var cfg := T.DEFAULTS.duplicate()
	var short := _form(cfg, false)
	var full := _form(cfg, true)
	t.ok(_labels(short).has("Position") and _labels(short).has("Size (vw)") and _labels(short).has("Duration"), "short form fields")
	for gone in ["Font", "Color", "Amber", "Red", "Border (px)", "Border color"]:
		t.ok(not _labels(short).has(gone), "short form has no %s" % gone)
		t.ok(_labels(full).has(gone), "extended form has %s" % gone)
	t.eq(_count(short, "ColorPickerButton"), 0, "no colour pickers in the short form")
	short.free()
	full.free()


func _form(cfg: Dictionary, extended: bool) -> VBoxContainer:
	var box := VBoxContainer.new()
	var g := GridContainer.new()
	box.add_child(g)
	Form.build(g, box, cfg, extended, func(_p: Dictionary) -> void: pass)
	return box


func _labels(n: Node) -> Array:
	var out: Array = []
	for c in n.find_children("*", "Label", true, false):
		out.append((c as Label).text)
	return out


func _count(n: Node, cls: String) -> int:
	return n.find_children("*", cls, true, false).size()
