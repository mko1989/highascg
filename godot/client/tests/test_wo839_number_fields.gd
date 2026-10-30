extends RefCounted
## WO-839 (RULES.md "Input fields" 3): number fields take only numbers. A commit gives the correct value or the PREVIOUS
## one — "100+", "12abc", "42px", "1920/0", "" are never salvaged. The pure parsers every number / timecode field commits
## through (MI.parse / MI.commit, TM.parse_tc, F.parse_hms, clip trim parse_tc) plus the widgets that were missing the
## maths (NumericField.math_line with blank_ok, the host browser size row, the DeckLink buffer depth).

const MI := preload("res://core/math_input.gd")
const NF := preload("res://core/numeric_field.gd")
const TM := preload("res://features/timeline/timeline_math.gd")
const F := preload("res://features/timeline/timeline_flags.gd")
const CT := preload("res://features/live/clip_trim_model.gd")
var t

const GIBBERISH := ["100+", "1920/", "12abc", "42px", "1920/0", "", "  ", "abc", "1e3", "1,5", "--", "(5", "5)", "1.2.3", "$5", "1 2", "0x10"]


func test_mi_parse_never_salvages() -> void:
	for bad in GIBBERISH:
		t.ok(is_nan(MI.parse(bad)), "MI.parse rejects '%s'" % bad)
	t.eq(MI.parse("1920/2"), 960.0, "expression")
	t.eq(MI.parse(" 42 "), 42.0, "plain number")
	t.eq(MI.parse("-(2+3)"), -5.0, "unary minus, parentheses")


func test_mi_commit_reverts() -> void:
	for bad in GIBBERISH:
		var r := MI.commit(bad, 0.0, 10000.0, 0, 77.0)
		t.eq([r.value, r.text, r.restored], [77.0, "77", true], "'%s' → previous" % bad)
	var ok := MI.commit("3840/2", 0.0, 1000.0, 0, 77.0)
	t.eq([ok.value, ok.restored], [1000.0, false], "a valid expression is clamped, not reverted")


func test_timecode_parsers_digits_only() -> void:
	t.eq(TM.parse_tc("1:-5", 0.0, null, 25), null, "TM: signed group")
	t.eq(TM.parse_tc("+3:10", 0.0, null, 25), null, "TM: signed group (+)")
	t.eq(TM.parse_tc("1:2x", 0.0, null, 25), null, "TM: trailing text")
	t.eq(TM.parse_tc("", 0.0, null, 25), null, "TM: blank")
	t.eq(TM.parse_tc("1:5", 0.0, null, 25), 1200.0, "TM: s:ff still works")
	t.eq(TM.parse_tc("1:00:05", 0.0, null, 25), 60200.0, "TM: m:s:ff still works")
	t.eq(F.parse_hms("1:-5", 0.0, null), null, "F: signed group")
	t.eq(F.parse_hms("00:00:12abc", 0.0, null), null, "F: trailing text")
	t.eq(F.parse_hms("00:01:02:003", 0.0, null), 62003.0, "F: hh:mm:ss:mmm still works")
	t.eq(F.parse_hms("++500", 1000.0, null), 1500.0, "F: ++N offset still works")
	t.ok(is_nan(CT.parse_tc("1:+3", 25.0)), "clip trim: signed group")
	t.ok(is_nan(CT.parse_tc("1:02.x", 25.0)), "clip trim: bad frames")
	t.ok(is_nan(CT.parse_tc("12abc", 25.0)), "clip trim: seconds with trailing text")
	t.eq(CT.parse_tc("1:02.12", 25.0), 62480.0, "clip trim: m:ss.ff still works")
	t.eq(CT.parse_tc("2*3", 25.0), 6000.0, "clip trim: plain seconds take maths")


func _focus_type(le: LineEdit, text: String) -> void:
	le.focus_entered.emit()
	le.text = text
	le.text_submitted.emit(text)


func test_math_line_blank_and_gibberish() -> void:
	var px := NF.math_line(LineEdit.new(), true, -INF, INF, Callable(), true)  # "blank = preset" field
	px.text = "40"
	_focus_type(px, "")
	t.eq(px.text, "", "blank_ok: clearing is kept")
	_focus_type(px, "100+")
	t.eq(px.text, "", "blank_ok: gibberish over a blank reverts to blank")
	_focus_type(px, "960*2")
	t.eq(px.text, "1920", "blank_ok: maths still works")
	_focus_type(px, "42px")
	t.eq(px.text, "1920", "blank_ok: gibberish reverts to the number")
	px.free()
	var plain := NF.math_line(LineEdit.new(), true, 1.0, 60.0)
	plain.text = "25"
	for bad in GIBBERISH:
		_focus_type(plain, bad)
		t.eq(plain.text, "25", "plain number field: '%s' reverts" % bad)
	_focus_type(plain, "999")
	t.eq(plain.text, "60", "clamped")
	plain.free()
