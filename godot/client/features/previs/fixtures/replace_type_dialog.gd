extends ConfirmationDialog
## WO-633 T2 — "Replace placeholder…": pick the real GDTF for an MVR placeholder type (Capture stub / "Dummy -") and pair
## each of its modes with a real mode (prefilled by footprint, replace_type_model.gd). OK → POST
## /api/fixtures/types/<id>/replace {to, modes}: box-level, so every later MVR patch of the rig uses the real type;
## `replaced` lets the Fixtures section re-point this project's patch. "Use placeholder again" → DELETE …/replace.

signal replaced(stub_id: String, to: String, modes: Dictionary)  # to "" = back to the placeholder
signal failed(message: String)

const R := preload("res://features/previs/fixtures/replace_type_model.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")

const KEEP := "— keep placeholder —"

var _stub: Dictionary = {}
var _targets: Array = []
var _target: OptionButton
var _grid: GridContainer
var _note: Label
var _undo: Button


func _ready() -> void:
	title = "Replace placeholder fixture type"
	ok_button_text = "Replace"
	var box := VBoxContainer.new()
	box.custom_minimum_size = Vector2(520, 0)
	box.add_theme_constant_override("separation", 8)
	_note = Label.new()
	_note.autowrap_mode = TextServer.AUTOWRAP_WORD
	_note.custom_minimum_size = Vector2(520, 0)  # a wrapping label measured at width 0 makes the dialog screen-tall
	box.add_child(_note)
	_target = OptionButton.new()
	_target.fit_to_longest_item = false
	_target.item_selected.connect(func(_i: int) -> void:
		_fill_modes(true)
		_refit.call_deferred())
	box.add_child(_target)
	_grid = GridContainer.new()
	_grid.columns = 2
	_grid.add_theme_constant_override("h_separation", 12)
	box.add_child(_grid)
	add_child(box)
	_undo = add_button("Use placeholder again", true, "clear")
	confirmed.connect(_apply)
	custom_action.connect(func(a: StringName) -> void:
		if a == &"clear":
			hide()
			_clear())


## Show for `stub` (a placeholder summary) against every imported type.
func open(types: Array, stub: Dictionary) -> void:
	_stub = stub
	_targets = R.targets(types, stub)
	var rb: Variant = stub.get("replacedBy")
	var current := str(rb.get("to", "")) if rb is Dictionary else ""
	_target.clear()
	for x in _targets:
		_target.add_item("%s · %s" % [x.get("manufacturer", "?"), x.get("name", "?")])
		if str(x.id) == current:
			_target.select(_target.item_count - 1)
	get_ok_button().disabled = _targets.is_empty()
	_note.text = ("\"%s · %s\" is a placeholder (no model, plain dimmer channels). " % [stub.get("manufacturer", "?"),
		stub.get("name", "?")] + ("Import the real GDTF first, then pick it here." if _targets.is_empty() else
		"Pick the real type; its modes are paired by channel count. Applies to every MVR patch on this box."))
	_undo.visible = current != ""  # only when there is something to undo
	_fill_modes(current == "")
	if current != "":
		_prefill((rb as Dictionary).get("modes", {}))
	popup_centered()
	_refit.call_deferred()


func _refit() -> void:  # fit the content once laid out (the default dialog size is most of the screen)
	reset_size()
	move_to_center()


func _real() -> Dictionary:
	return _targets[_target.selected] if _target.selected >= 0 and _target.selected < _targets.size() else {}


func _fill_modes(pair: bool) -> void:
	for c in _grid.get_children():
		_grid.remove_child(c)
		c.queue_free()
	var real := _real()
	var paired := R.pair_modes(_stub, real) if pair else {}
	for sm in _stub.get("modes", []):
		var l := Label.new()
		l.text = "%s · %d ch" % [sm.name, int(sm.get("footprint", 0))]
		l.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
		_grid.add_child(l)
		var o := OptionButton.new()
		o.fit_to_longest_item = false
		o.add_item(KEEP)
		o.set_item_metadata(0, "")
		for rm in real.get("modes", []):
			o.add_item("%s · %d ch" % [rm.name, int(rm.get("footprint", 0))])
			o.set_item_metadata(o.item_count - 1, str(rm.name))
			if str(rm.name) == str(paired.get(str(sm.name), "")):
				o.select(o.item_count - 1)
		o.set_meta("from", str(sm.name))
		_grid.add_child(o)


func _prefill(modes: Dictionary) -> void:
	for o in _grid.get_children():
		if o is OptionButton:
			for i in o.item_count:
				if str(o.get_item_metadata(i)) == str(modes.get(str(o.get_meta("from")), "")):
					o.select(i)


func _modes() -> Dictionary:
	var out := {}
	for o in _grid.get_children():
		if o is OptionButton:
			out[str(o.get_meta("from"))] = str(o.get_item_metadata(o.selected))
	return out


func _apply() -> void:
	var real := _real()
	if real.is_empty():
		return
	var modes := _modes()
	var res: Dictionary = await Api.post_json("/api/fixtures/types/%s/replace" % _stub.id, {"to": real.id, "modes": modes})
	if res.ok:
		replaced.emit(str(_stub.id), str(real.id), modes)
	else:
		failed.emit(str(res.data.get("error", res.error) if res.data is Dictionary else res.error))


func _clear() -> void:
	var res: Dictionary = await Api.delete_json("/api/fixtures/types/%s/replace" % _stub.id)
	if res.ok:
		replaced.emit(str(_stub.id), "", {})
	else:
		failed.emit(str(res.data.get("error", res.error) if res.data is Dictionary else res.error))
