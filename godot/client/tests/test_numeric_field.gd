extends RefCounted
## RULES.md "Input fields" — core/numeric_field.gd: the evaluator (pure), the commit text, and the live SpinBox /
## LineEdit behaviour (select-on-focus, maths on focus-out, invalid keeps the old value, no code execution).

const NF := preload("res://core/numeric_field.gd")
var t


func test_evaluate_valid() -> void:
	t.eq(NF.evaluate("1920*2"), 3840.0, "multiply")
	t.eq(NF.evaluate("3840/2+10"), 1930.0, "precedence")
	t.eq(NF.evaluate("(1080-8)/2"), 536.0, "parentheses")
	t.eq(NF.evaluate("10-2-3"), 5.0, "left associative")
	t.eq(NF.evaluate("2+3*4"), 14.0, "* before +")
	t.eq(NF.evaluate("(2+3)*4"), 20.0, "parens first")
	t.eq(NF.evaluate("1/3 * 3"), 1.0, "real division, spaces")
	t.eq(NF.evaluate("5/2"), 2.5, "no integer division")
	t.eq(NF.evaluate("-5+2"), -3.0, "unary minus")
	t.eq(NF.evaluate(" 1.5*2 "), 3.0, "decimals")
	t.eq(NF.evaluate("1920"), 1920.0, "plain number")


func test_evaluate_rejects() -> void:
	for bad in ["", "  ", "abc", "1920x", "7 +", "(1+2", "1+2)", "2**3", "1/0", "randi()", "OS.crash()", "1e3", "1;2", "0x10", "1,5", "'a'", "$a"]:
		t.ok(NF.evaluate(bad) == null, "rejected: '%s'" % bad)


func test_resolve() -> void:
	t.eq(NF.resolve("1920/2", "100"), "960", "evaluated")
	t.eq(NF.resolve("3840-64", "100", true), "3776", "int field")
	t.eq(NF.resolve("7/2", "1", true), "4", "int fields round")
	t.eq(NF.resolve("1/4", "1"), "0.25", "float result")
	t.eq(NF.resolve("garbage", "42", true), "42", "invalid keeps the previous value")
	t.eq(NF.resolve("1/0", "42"), "42", "division by zero keeps the previous value")
	t.eq(NF.resolve("10-50", "5", true, 1.0, 100.0), "1", "clamped to min")
	t.eq(NF.resolve("10*50", "5", true, 1.0, 100.0), "100", "clamped to max")
	t.eq(NF.resolve("", "5"), "5", "WO-839: blank reverts")
	t.eq(NF.resolve("  ", "5"), "5", "WO-839: whitespace reverts")
	t.eq(NF.resolve("", "5", false, -INF, INF, true), "", "blank_ok: blank stays blank")
	t.eq(NF.resolve("abc", "5", false, -INF, INF, true), "5", "blank_ok: gibberish still reverts")
	t.eq(NF.resolve("25", "5"), "25", "plain number")


## WO-839: nothing is salvaged — a half expression or trailing text keeps the previous value, not its leading number.
func test_resolve_never_salvages() -> void:
	for bad in ["100+", "1920/", "12abc", "42px", "1920/0", "abc", "1e3", "(5", "5)", "--", "1,5", "$5", "1 2", "0x10", "inf", "nan", "-", "."]:
		t.eq(NF.resolve(bad, "PREV", true), "PREV", "reverts: '%s'" % bad)
		t.eq(NF.resolve(bad, "PREV", false, 0.0, 100.0), "PREV", "reverts (float, clamped): '%s'" % bad)
	t.eq(NF.resolve(".5", "9"), "0.5", "leading-dot decimal is a number")
	t.eq(NF.resolve("5.", "9"), "5", "trailing-dot decimal is a number")


func _boxed(sb: SpinBox) -> SpinBox:
	NF.spin(sb)
	return sb


## Focus-out in the running client = our sanitiser, then SpinBox's own handler (apply() is that handler).
func _typed(sb: SpinBox, text: String) -> void:
	sb.get_line_edit().text = text
	NF._sanitize(sb)
	sb.apply()


func test_spinbox_maths_and_invalid() -> void:
	var sb := _boxed(SpinBox.new())
	sb.max_value = 10000
	sb.step = 0.01
	sb.value = 5.0
	_typed(sb, "1920/2")
	t.eq(sb.value, 960.0, "maths on focus-out")
	_typed(sb, "1/3")
	t.eq(sb.value, 0.33, "float division, snapped to the step (Expression alone gives 0)")
	_typed(sb, "(2+3)*2")
	t.eq(sb.value, 10.0, "parentheses")
	_typed(sb, "abc")
	t.eq(sb.value, 10.0, "garbage keeps the previous value (Expression alone gives 0)")
	_typed(sb, "7 +")
	t.eq(sb.value, 10.0, "half an expression keeps the previous value")
	_typed(sb, "")
	t.eq(sb.value, 10.0, "blank keeps the previous value")
	for bad in ["100+", "12abc", "42px", "1920/0", "1e3", "(5", "--"]:
		_typed(sb, bad)
		t.eq(sb.value, 10.0, "WO-839: '%s' keeps the previous value" % bad)
	_typed(sb, "randi()")
	t.eq(sb.value, 10.0, "function calls are not executed")
	_typed(sb, "999999*9")
	t.eq(sb.value, 10000.0, "clamped to max")
	sb.free()


func test_spinbox_integer_and_suffix() -> void:
	var sb := _boxed(SpinBox.new())
	sb.max_value = 8000
	sb.rounded = true
	sb.suffix = "px"
	sb.value = 64
	_typed(sb, "7/2")
	t.eq(sb.value, 4.0, "rounded")
	_typed(sb, "3840/2+10  px")
	t.eq(sb.value, 1930.0, "the suffix is ignored")
	_typed(sb, "3840-64 px")
	t.eq(sb.value, 3776.0, "suffix after an expression")
	sb.free()


func test_spinbox_our_handlers_run_first() -> void:
	var sb := _boxed(SpinBox.new())
	var le := sb.get_line_edit()
	t.eq(le.get_signal_connection_list("text_submitted").size(), 1, "Enter: only ours (SpinBox's reads the raw string)")
	var conns := le.get_signal_connection_list("editing_toggled")
	t.eq(conns.size(), 2, "focus-out: ours + SpinBox's")
	t.ok(str(conns[1].callable).begins_with("SpinBox::"), "SpinBox's own handler is last")
	sb.step = 0.01
	sb.max_value = 100
	le.text = "9/2"
	le.text_submitted.emit("9/2")
	t.eq(sb.value, 4.5, "Enter: real division (SpinBox's own Expression gives 4)")
	le.text = "abc"
	le.text_submitted.emit("abc")
	t.eq(sb.value, 4.5, "Enter: garbage keeps the value")
	le.text = "7/2"
	le.editing_toggled.emit(false)
	t.eq(sb.value, 3.5, "focus-out: real division")
	sb.free()


func test_selects_on_focus_flags() -> void:
	var le := LineEdit.new()
	NF.prepare(le)
	t.ok(le.select_all_on_focus, "LineEdit: prepare() turns it on")
	le.free()
	var sb := SpinBox.new()
	sb.update_on_text_changed = true
	NF.prepare(sb)
	t.ok(sb.select_all_on_focus, "SpinBox: select on focus")
	t.ok(not sb.update_on_text_changed, "SpinBox: commits on Enter / focus-out only")
	sb.free()


func test_math_line() -> void:
	var le := LineEdit.new()
	var seen := []
	NF.math_line(le, true, 1.0, 9999.0, func(s: String) -> void: seen.append(s))
	t.ok(le.select_all_on_focus, "selects on focus")
	le.text = "100"
	le.focus_entered.emit()
	le.text = "960*2"
	le.focus_exited.emit()
	t.eq(le.text, "1920", "evaluated on focus-out")
	t.eq(seen, ["1920"], "on_change told")
	le.focus_entered.emit()
	le.text = "nonsense"
	le.text_submitted.emit("nonsense")
	t.eq(le.text, "1920", "invalid reverts")
	le.text = ""
	le.focus_exited.emit()
	t.eq(le.text, "1920", "WO-839: blank reverts")
	for bad in ["100+", "1920/", "12abc", "42px", "1920/0"]:
		le.text = bad
		le.focus_exited.emit()
		t.eq(le.text, "1920", "WO-839: '%s' reverts" % bad)
	le.free()


func test_math_line_blank_ok() -> void:
	var le := LineEdit.new()
	NF.math_line(le, true, 0.0, 9999.0, Callable(), true)
	le.text = "40"
	le.focus_entered.emit()
	le.text = ""
	le.focus_exited.emit()
	t.eq(le.text, "", "blank_ok: cleared stays cleared")
	le.focus_entered.emit()
	le.text = "7/x"
	le.text_submitted.emit("7/x")
	t.eq(le.text, "", "blank_ok: gibberish reverts to the (blank) previous value")
	le.free()
