extends VBoxContainer
## WO-608 — Settings → Variables (web variables-panel.js): every Companion variable the server publishes, searchable,
## filtered by prefix, live (GET /api/variables once, then WS `variable_update`). Click a row to copy its
## $(highascg:key) reference.

const K := preload("res://features/settings/pane_kit.gd")
const M := preload("res://features/settings/variables_model.gd")

var _vars := {}
var _search: LineEdit
var _prefix := ""
var _tree: Tree
var _count: Label
var _dirty := false
var _shown: Array = []
var _note_until := 0


func _ready() -> void:
	add_theme_constant_override("separation", 8)
	size_flags_vertical = Control.SIZE_EXPAND_FILL
	var top := K.row(self)
	_search = LineEdit.new()
	_search.placeholder_text = "Search variables…"
	_search.custom_minimum_size.x = 320
	_search.clear_button_enabled = true
	_search.text_changed.connect(func(_t: String) -> void: _render())
	top.add_child(_search)
	var group := ButtonGroup.new()
	for c in M.CATEGORIES:
		var b := Button.new()
		b.text = c[0]
		b.toggle_mode = true
		b.button_group = group
		b.button_pressed = c[1] == ""
		b.pressed.connect(func() -> void:
			_prefix = c[1]
			_render())
		top.add_child(b)
	_count = K.note(top, "")
	_count.autowrap_mode = TextServer.AUTOWRAP_OFF  # in a row a wrapping label collapses to one character wide
	_tree = Tree.new()
	_tree.columns = 2
	_tree.hide_root = true
	_tree.column_titles_visible = true
	_tree.set_column_title(0, "Variable key")
	_tree.set_column_title(1, "Value")
	_tree.set_column_expand_ratio(0, 1)
	_tree.set_column_expand_ratio(1, 1)
	_tree.custom_minimum_size.y = 560
	_tree.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_tree.item_mouse_selected.connect(func(_p: Vector2, _b: int) -> void: _copy_selected())
	_tree.item_activated.connect(_copy_selected)
	add_child(_tree)
	K.note(self, "Click a row to copy its reference for Companion buttons.")
	Ws.message.connect(_on_ws)
	var t := Timer.new()  # variable_update can arrive many times a second — redraw at most 2×/s
	t.wait_time = 0.5
	t.timeout.connect(func() -> void:
		if _dirty and is_visible_in_tree():
			_render())
	add_child(t)
	t.start()
	visibility_changed.connect(func() -> void:
		if is_visible_in_tree():
			refresh())


func refresh() -> void:
	var r: Dictionary = await Api.get_json("/api/variables")
	if r.ok and r.data is Dictionary:
		_vars = r.data
	_render()


func _on_ws(type: String, data: Variant) -> void:
	if type == "variable_update" and data is Dictionary:
		_vars.merge(data, true)
		_dirty = true
	elif type == "state" and data is Dictionary and data.get("variables") is Dictionary:
		_vars = data.variables.duplicate()
		_dirty = true


## Same key list → values updated in place (keeps scroll + selection while variables tick); else rebuilt.
func _render() -> void:
	_dirty = false
	var keys := M.filtered(_vars, _search.text, _prefix)
	var root := _tree.get_root()
	if root == null or keys != _shown:
		_tree.clear()
		root = _tree.create_item()
		for k in keys:
			var it := _tree.create_item(root)
			it.set_text(0, M.clip(k))
			it.set_metadata(0, M.clip(k))
		_shown = keys
	var it := root.get_first_child()
	for k in keys:
		var d := M.display(_vars[k])
		it.set_text(1, d.text)
		it.set_tooltip_text(1, d.tip)
		it = it.get_next()
	if Time.get_ticks_msec() >= _note_until:
		_count.text = "%d of %d" % [keys.size(), _vars.size()]


func _copy_selected() -> void:
	var it := _tree.get_selected()
	if it == null:
		return
	DisplayServer.clipboard_set(str(it.get_metadata(0)))
	_count.text = "Copied %s" % str(it.get_metadata(0))
	_note_until = Time.get_ticks_msec() + 2000
