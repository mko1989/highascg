extends VBoxContainer
## WO-608 — one settings pane (web settings-modal-templates.js .settings-pane): headings, notes and rows bound to a
## settings path. A change patches that path (Settings autosaves after 600 ms, web parity); hydrate() re-reads every
## row from the Settings mirror. Deviation: text fields commit on Enter / leaving the field, not per keystroke — the web
## autosaves half-typed values, and a half-typed CasparCG media path that happens to exist gets symlinked.

const ThemeBuilder := preload("res://app/theme_builder.gd")
const M := preload("res://features/settings/settings_model.gd")

const LABEL_W := 280

var target: Container = self  # rows go here (a sub-group whose visibility the pane toggles)
var _hydrators: Array[Callable] = []


func _init() -> void:
	add_theme_constant_override("separation", 8)


func hydrate() -> void:
	for h in _hydrators:
		h.call()


func on_hydrate(c: Callable) -> void:
	_hydrators.append(c)


func heading(text: String) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", 18)
	l.add_theme_color_override("font_color", ThemeBuilder.ACCENT)
	target.add_child(l)
	return l


func note(text: String) -> Label:
	var l := Label.new()
	l.text = text
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	l.add_theme_font_size_override("font_size", 13)
	l.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	target.add_child(l)
	return l


## items: [[value, label], …]; an unknown stored value shows the first item.
func option(label: String, path: String, items: Array, fallback: String) -> OptionButton:
	var ob := OptionButton.new()
	for it in items:
		ob.add_item(str(it[1]))
	ob.item_selected.connect(func(i: int) -> void: Settings.patch(M.nest(path, items[i][0])))
	_hydrators.append(func() -> void:
		var v := str(Settings.get_setting(path, fallback))
		var at := 0
		for i in items.size():
			if str(items[i][0]) == v:
				at = i
		ob.select(at))
	_row(label, ob)
	return ob


func check(label: String, path: String, fallback: bool) -> CheckBox:
	var c := CheckBox.new()
	c.text = label
	c.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	c.toggled.connect(func(on: bool) -> void: Settings.patch(M.nest(path, on)))
	_hydrators.append(func() -> void: c.set_pressed_no_signal(M.is_on(Settings.get_setting(path), fallback)))
	target.add_child(c)
	return c


func text(label: String, path: String, placeholder := "") -> LineEdit:
	var le := LineEdit.new()
	le.placeholder_text = placeholder
	le.custom_minimum_size.x = 320
	var commit := func() -> void:
		var v := le.text.strip_edges()
		var cur: Variant = Settings.get_setting(path)
		if v != (str(cur) if cur != null else ""):
			Settings.patch(M.nest(path, v))
	le.text_submitted.connect(func(_t: String) -> void: commit.call())
	le.focus_exited.connect(commit)
	_hydrators.append(func() -> void:
		if not le.has_focus():
			var cur: Variant = Settings.get_setting(path)
			le.text = str(cur) if cur != null else "")
	_row(label, le)
	return le


## view: stored value → shown number (e.g. the transition's auto duration resolved to frames).
func number(label: String, path: String, lo: int, hi: int, fallback: int, view := Callable()) -> SpinBox:
	var sb := SpinBox.new()
	sb.min_value = lo
	sb.max_value = hi
	sb.step = 1
	sb.rounded = true
	sb.value_changed.connect(func(v: float) -> void: Settings.patch(M.nest(path, int(v))))
	_hydrators.append(func() -> void:
		if sb.get_line_edit().has_focus():
			return
		var cur: Variant = Settings.get_setting(path)
		var n := int(cur) if (cur is int or cur is float or (cur is String and (cur as String).is_valid_int())) else fallback
		sb.set_value_no_signal(view.call(cur) if view.is_valid() else n))
	_row(label, sb)
	return sb


func group() -> VBoxContainer:
	var g := VBoxContainer.new()
	g.add_theme_constant_override("separation", 8)
	target.add_child(g)
	return g


func _row(label: String, c: Control) -> void:
	var row := HBoxContainer.new()
	var l := Label.new()
	l.text = label
	l.custom_minimum_size.x = LABEL_W
	row.add_child(l)
	row.add_child(c)
	target.add_child(row)
