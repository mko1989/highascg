extends VBoxContainer
## WO-837 — the light flag's part of the flag page (timeline_flag_inspector.gd embeds it while the flag's type is
## "Light cue"): the console (from Devices > Lighting consoles), the action (go / fader / release / command) and the
## fields that action needs. Number fields follow RULES.md: focus selects, + - * / evaluate on Enter / leaving, gibberish
## reverts (core/numeric_field.gd math_line). The fader is the one text field that holds a number: "2.10" is page 2,
## fader 10, which a number would turn into 2.1, so it takes digits with at most one dot and reverts anything else.
## It never mutates the flag itself: `patch` carries the changes, the flag page applies them.

signal patch(changes: Dictionary)

const LF := preload("res://features/timeline/timeline_light.gd")
const LightFetch := preload("res://features/timeline/timeline_light_fetch.gd")
const NF := preload("res://core/numeric_field.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")

var _flag: Dictionary = {}
var _syncing := false
var _console: OptionButton
var _console_ids: Array = []
var _action: OptionButton
var _info: Label
var _hint: Label
var _rows := {}    # field → [label, LineEdit]
var _edits := {}   # field → LineEdit


func _ready() -> void:
	add_theme_constant_override("separation", 4)
	var head := Label.new()
	head.text = "Lighting console"
	head.add_theme_color_override("font_color", ThemeBuilder.ACCENT)
	add_child(head)
	var g := GridContainer.new()
	g.columns = 2
	g.add_theme_constant_override("h_separation", 10)
	add_child(g)
	_console = OptionButton.new()
	_console.fit_to_longest_item = false
	_console.clip_text = true
	_console.item_selected.connect(func(i: int) -> void:
		if not _syncing:
			patch.emit({"consoleId": _console_ids[i] if _console_ids[i] != "" else null}))
	_row(g, "Console", _console)
	_action = OptionButton.new()
	for l in LF.ACTION_LABELS:
		_action.add_item(l)
	_action.item_selected.connect(func(i: int) -> void:
		if not _syncing:
			patch.emit(LF.action_patch(_flag, LF.ACTIONS[i])))
	_row(g, "Action", _action)
	_field(g, "list", "List / playback", "Cue list or playback number", true, 0, 99999, false)
	_field(g, "cue", "Cue (optional)", "Go to this cue; empty = just Go. Decimals allowed (2.5)", false, 0, 99999, true)
	_field(g, "fader", "Fader", "Fader number, or page.fader (2.10 = page 2, fader 10)", false, 0, 0, false)
	_field(g, "level", "Level (%)", "0-100 %", false, 0, 100, false)
	_field(g, "command", "Command", "A command line for the console (grandMA3, Eos, MagicQ)", false, 0, 0, false)
	_info = _muted()
	add_child(_info)
	_hint = _muted()
	_hint.add_theme_color_override("font_color", ThemeBuilder.WARN)
	add_child(_hint)


## The flag was selected: show it, and refresh the consoles list.
func show_flag(f: Dictionary) -> void:
	bind(f)
	await LightFetch.fetch()  # consoles added in Devices since the tab was shown
	if is_instance_valid(self) and is_same(_flag, f):
		refresh()


func bind(f: Dictionary) -> void:
	_flag = f
	refresh()


## Re-read the flag (after a patch, a drag, a console list update) without emitting.
func refresh() -> void:
	if _flag.is_empty() or _console == null:
		return
	_syncing = true
	_console.clear()
	_console_ids = [""]
	_console.add_item("— choose —")
	for c in LF.consoles:
		if c is Dictionary:
			_console_ids.append(str(c.get("id", "")))
			_console.add_item("%s (%s)" % [str(c.get("name", c.get("id", ""))), str(c.get("kind", ""))])
	var id := str(_flag.get("consoleId", ""))
	if id != "" and not id in _console_ids:
		_console_ids.append(id)
		_console.add_item("%s (missing)" % id)
	_console.select(maxi(0, _console_ids.find(id)))
	var action := LF.action_of(_flag)
	_action.select(LF.ACTIONS.find(action))
	for k in _rows:
		var on: bool = k in LF.FIELDS[action]
		for c in _rows[k]:
			(c as Control).visible = on
		if on and not (_edits[k] as LineEdit).has_focus():
			_edits[k].text = _shown(k)
	var con := LF.console(id)
	_info.text = "%s · %s:%s" % [str(con.kind), str(con.host), str(int(con.port))] if not con.is_empty() else ""
	_info.visible = _info.text != ""
	_hint.text = LF.problem(_flag)
	_hint.visible = _hint.text != ""
	_syncing = false


func _shown(k: String) -> String:
	var v: Variant = _flag.get(k)
	return "" if v == null else LF.num_str(v) if k != "command" and k != "fader" else str(v)


func _field(g: GridContainer, key: String, label: String, tip: String, as_int: bool, lo: float, hi: float, blank_ok: bool) -> void:
	var le := LineEdit.new()
	le.tooltip_text = tip
	le.custom_minimum_size.x = 130
	if key in ["list", "cue", "level"]:
		NF.math_line(le, as_int, lo, hi, Callable(), blank_ok)  # BEFORE our own handlers: they read the result
	le.text_submitted.connect(func(_t: String) -> void: _commit(key))
	le.focus_exited.connect(func() -> void: _commit(key))
	_edits[key] = le
	_rows[key] = _row(g, label, le)


## Commit one field: the value the server accepts, or the field goes back to the flag's.
func _commit(key: String) -> void:
	if _syncing or _flag.is_empty():
		return
	var le: LineEdit = _edits[key]
	var t := le.text.strip_edges()
	var v: Variant = null
	match key:
		"list":
			v = LF.parse_num(t)
		"cue":
			v = null if t == "" else LF.parse_num(t)
			if t == "":
				if _flag.get("cue") != null:
					patch.emit({"cue": null})
				return
		"fader":
			v = LF.parse_fader(t)
		"level":
			v = LF.parse_level(float(NF.evaluate(t))) if t != "" and NF.evaluate(t) != null else null
		"command":
			v = LF.clean_command(t)
			if v == "" and t != "":
				v = null
	if v == null:
		le.text = _shown(key)  # gibberish reverts (RULES.md)
		return
	le.text = str(v) if key in ["command", "fader"] else LF.num_str(v)
	if _flag.get(key) == null or str(_flag.get(key)) != str(v):
		patch.emit({key: v})


func _row(g: GridContainer, label: String, c: Control) -> Array:
	var l := Label.new()
	l.text = label
	l.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	g.add_child(l)
	c.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	g.add_child(c)
	return [l, c]


func _muted() -> Label:
	var l := Label.new()
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	l.add_theme_font_size_override("font_size", 12)
	l.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	return l
