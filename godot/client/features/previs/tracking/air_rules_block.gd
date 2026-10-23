extends VBoxContainer
## WO-712 R4 — "On air" rules in the Zones section: when look X goes on program → do Y (zone_model.normalize_air;
## project.previs.tracking.zones.on_air, run by the server's src/tracking/air-rules.js). X is a look id or a look name
## (a name also matches a linked playout server's look, R3b `air` exchange); Y is one zone action. They run on the
## server with the "zones" duty; a look that is already on air when the server starts fires nothing.

const Z := preload("res://features/previs/tracking/zone_model.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")

signal changed(rules: Array)  # the new on_air list → zones_section persists the slice

var rules := []
var _rows: VBoxContainer
var _state: Label


func _ready() -> void:
	add_theme_constant_override("separation", 4)
	var head := Label.new()
	head.text = "On air → do"
	head.tooltip_text = "When a look goes on program here, or on a linked playout server, run an action."
	add_child(head)
	_rows = VBoxContainer.new()
	add_child(_rows)
	var add := Button.new()
	add.text = "Add rule"
	add.pressed.connect(func() -> void:
		rules.append(Z.new_air_rule(rules))
		_emit())
	add_child(add)
	_state = Label.new()
	_state.autowrap_mode = TextServer.AUTOWRAP_WORD
	_state.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	add_child(_state)
	set_rules(rules)


## zones_section → the stored list. Rows are rebuilt only when rules come or go, so a field being typed in keeps focus.
func set_rules(src: Variant) -> void:
	rules = Z.normalize_air(src)
	if _rows == null:
		return
	if _rows.get_child_count() != rules.size():
		for c in _rows.get_children():
			_rows.remove_child(c)
			c.queue_free()
		for i in rules.size():
			_rows.add_child(_row(i))
	var errs := []
	for i in rules.size():
		var r: Dictionary = rules[i]
		var row := _rows.get_child(i)
		var when: LineEdit = row.get_child(0)
		var act: LineEdit = row.get_child(1)
		if not when.has_focus():
			when.text = r.when
		if not act.has_focus():
			act.text = r.do
		(row.get_child(2) as CheckBox).set_pressed_no_signal(r.enabled)
		var why := Z.action_error(r.do, true)
		act.add_theme_color_override("font_color", ThemeBuilder.ERROR if why != "" else ThemeBuilder.TEXT)
		if why != "":
			errs.append("%s: %s" % [r.when if r.when != "" else r.id, why])
	_state.text = "\n".join(errs) if not errs.is_empty() else (
		"No rules." if rules.is_empty() else "A look already on air when the server starts fires nothing.")


func _row(i: int) -> HBoxContainer:
	var row := HBoxContainer.new()
	var when := _line(func(v: String) -> void: _edit(i, "when", v.strip_edges()))
	when.placeholder_text = "look name or id"
	var act := _line(func(v: String) -> void: _edit(i, "do", v.strip_edges()))
	act.placeholder_text = "e.g. fixtures:look-2"
	act.tooltip_text = Z.AIR_HINT
	var on := CheckBox.new()
	on.tooltip_text = "Enabled"
	on.toggled.connect(func(v: bool) -> void: _edit(i, "enabled", v))
	var del := Button.new()
	del.text = "×"
	del.tooltip_text = "Delete this rule"
	del.pressed.connect(func() -> void:
		if i < rules.size():
			rules.remove_at(i)
			_emit())
	for c in [when, act, on, del]:
		row.add_child(c)
	return row


func _edit(i: int, key: String, v: Variant) -> void:
	if i >= rules.size() or rules[i][key] == v:
		return
	rules[i][key] = v
	_emit()


func _emit() -> void:
	changed.emit(rules.duplicate(true))
	set_rules(rules)


func _line(cb: Callable) -> LineEdit:
	var e := LineEdit.new()
	e.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	e.text_submitted.connect(cb)
	e.focus_exited.connect(func() -> void: cb.call(e.text))
	return e
