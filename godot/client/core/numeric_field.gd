extends RefCounted
## RULES.md "Input fields": (1) focus — Tab, Shift+Tab or a click — selects the whole value of a text / number field,
## so typing replaces it; (2) number fields evaluate + - * / and parentheses on Enter or focus-out, an invalid
## expression keeps the previous value, the result is clamped / rounded like a typed number.
##
## install() applies both to EVERY LineEdit / SpinBox the tree ever gains (one place, no per-site calls). Fields that
## are not SpinBoxes but hold numbers (plain LineEdits) opt into the maths with math_line(). evaluate() / resolve()
## are pure. Godot's own SpinBox maths is not enough: it runs the text through Expression (int division: "1/3" = 0;
## garbage = 0 instead of the old value; "randi()" is executed), so spin() puts a sanitising step in front of it.
##
## WO-839 (RULES.md "Input fields" 3): a commit yields the correct value (a number or a COMPLETE expression, clamped /
## rounded) or the previous value — never a salvaged prefix, never 0, never an empty field. "100+", "12abc", "42px",
## "1920/0", "abc" and "" all revert. The one exception is a field that explicitly means "blank = unset / preset"
## (blank_ok); gibberish still reverts there.

const MI := preload("res://core/math_input.gd")


## A + - * / ( ) expression or plain number → float, or null when it is not one (empty, garbage, 1/0, anything with
## letters — nothing but digits, operators, parentheses, "." and whitespace ever reaches the evaluator).
static func evaluate(text: String) -> Variant:
	var v := MI.evaluate(text)
	return null if is_nan(v) else v


## The field text a commit leaves behind: the evaluated `text` clamped to lo..hi (rounded when as_int); an invalid
## expression → `previous`; an empty field → `previous` too, unless `blank_ok` (blank = unset) where it stays empty.
static func resolve(text: String, previous: String, as_int := false, lo := -INF, hi := INF, blank_ok := false) -> String:
	var t := text.strip_edges()
	if t == "":
		return "" if blank_ok else previous
	var v: Variant = evaluate(t)  # also plain numbers; not Godot's is_valid_float (it accepts "1e3", web does not)
	if v == null:
		return previous
	return fmt(clampf(float(v), lo, hi), as_int)


static func fmt(v: float, as_int := false) -> String:
	if as_int or (is_equal_approx(v, roundf(v)) and absf(v) < 1e15):
		return str(roundi(v))
	return str(v)


## Whole-tree setup: every existing and future LineEdit selects its text on focus, every SpinBox gets spin().
static func install(tree: SceneTree) -> void:
	if tree.has_meta("numeric_field_installed"):
		return
	tree.set_meta("numeric_field_installed", true)
	tree.node_added.connect(prepare)
	_walk(tree.root)


static func _walk(n: Node) -> void:
	prepare(n)
	for c in n.get_children(true):
		_walk(c)


static func prepare(n: Node) -> void:
	if n is SpinBox:
		spin(n)
	elif n is LineEdit:
		(n as LineEdit).select_all_on_focus = true


## SpinBox: select on focus + maths. text_submitted hands SpinBox the ORIGINAL string (rewriting the field is not
## enough), so its handler is replaced by sanitise + apply(); editing_toggled (focus-out) reads the field, so ours is
## just re-connected ahead of SpinBox's. update_on_text_changed is switched off: it applied half-typed text on every
## keystroke ("1920/" → 0), the opposite of "commit on Enter / focus-out, invalid keeps the old value".
static func spin(sb: SpinBox) -> void:
	sb.select_all_on_focus = true
	sb.update_on_text_changed = false
	if sb.has_meta("numeric_field"):
		return
	sb.set_meta("numeric_field", true)
	var le := sb.get_line_edit()
	for c in le.get_signal_connection_list("text_submitted"):
		le.disconnect("text_submitted", c.callable)
	le.text_submitted.connect(func(_t: String) -> void:
		_sanitize(sb)
		sb.apply())
	var own: Array[Callable] = []
	for c in le.get_signal_connection_list("editing_toggled"):
		own.append(c.callable)
	for cb in own:
		le.editing_toggled.disconnect(cb)
	le.editing_toggled.connect(func(on: bool) -> void:
		if not on:
			_sanitize(sb))
	for cb in own:
		le.editing_toggled.connect(cb)


static func _sanitize(sb: SpinBox) -> void:
	var le := sb.get_line_edit()
	var t := le.text
	if sb.prefix != "":
		t = t.trim_prefix(sb.prefix)
	if sb.suffix != "":
		t = t.trim_suffix(sb.suffix)
	t = t.strip_edges()
	var v: Variant = evaluate(t)
	le.text = fmt(sb.value) if v == null else fmt(float(v))


## A plain LineEdit that holds a number: select on focus (install() does that too) + maths on Enter / focus-out.
## Call it right after LineEdit.new(), BEFORE the site connects its own commit handlers, so they read the result from
## le.text. `on_change(new_text)` runs when the maths rewrote the field (state kept from text_changed needs it).
## `blank_ok`: an empty field is a real state ("clear = back to the preset") and stays empty instead of reverting.
static func math_line(le: LineEdit, as_int := true, lo := -INF, hi := INF, on_change := Callable(), blank_ok := false) -> LineEdit:
	le.select_all_on_focus = true
	var prev := [le.text]
	le.focus_entered.connect(func() -> void: prev[0] = le.text)
	var fix := func() -> void:
		var before := le.text
		le.text = resolve(before, prev[0], as_int, lo, hi, blank_ok)
		prev[0] = le.text
		if le.text != before and on_change.is_valid():
			on_change.call(le.text)
	le.text_submitted.connect(func(_t: String) -> void: fix.call())
	le.focus_exited.connect(fix)
	return le
