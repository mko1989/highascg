extends VBoxContainer
## WO-857 — the Programmer's console-selection rows: "Follow console selection" (the previs draws the heads the console
## has selected in their own colour — console_selection.gd) with "Take" (copies them into the Programmer's own selection
## once, on a click; the console set itself never writes it), and under them how many heads the console has.

const Con := preload("res://features/previs/fixtures/console_selection.gd")
const Sel := preload("res://features/previs/fixtures/fixture_selection.gd")

var _con: RefCounted = Con.shared()
var _check: CheckBox
var _count: Label
var _take: Button


func _ready() -> void:
	add_theme_constant_override("separation", 2)
	var row := HBoxContainer.new()
	_check = CheckBox.new()
	_check.text = "Follow console selection"
	_check.tooltip_text = "Draw the heads the lighting console has selected in the previs, in their own colour (cyan). Your own selection is never changed by it."
	_check.button_pressed = _con.follow
	_check.toggled.connect(_on_toggled)
	_check.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(_check)
	_take = Button.new()
	_take.text = "Take"
	_take.tooltip_text = "Select the console's heads here (replaces the Programmer selection once)."
	_take.pressed.connect(func() -> void: Sel.shared().set_ids(_con.ids))
	row.add_child(_take)
	add_child(row)
	_count = Label.new()
	_count.add_theme_color_override("font_color", Con.COLOR)
	_count.autowrap_mode = TextServer.AUTOWRAP_WORD
	_count.mouse_filter = Control.MOUSE_FILTER_STOP  # a Label ignores the pointer by default: no tooltip then
	add_child(_count)
	if not _con.changed.is_connected(_refresh):  # not through _enter_tree when built off-tree (tests)
		_con.changed.connect(_refresh)
	_refresh()


func _enter_tree() -> void:  # the section is re-parented when the Inspector rebuilds: listen whenever it is in the tree
	if not _con.changed.is_connected(_refresh):
		_con.changed.connect(_refresh)
	if _count != null:
		_refresh()


func _exit_tree() -> void:
	if _con.changed.is_connected(_refresh):
		_con.changed.disconnect(_refresh)


func _on_toggled(on: bool) -> void:
	_con.set_follow(on)


func _refresh() -> void:
	_check.set_pressed_no_signal(_con.follow)
	_count.text = _con.summary()
	_count.tooltip_text = _con.detail()
	_take.disabled = _con.ids.is_empty()
