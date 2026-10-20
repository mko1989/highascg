extends VBoxContainer
## WO-623 C — one flat Sources list (Templates / Timelines): filter + rows of [kind pill | label], each row dragging the
## web payload {type, value, label} onto the look editor, the deck (new look) or a timeline. Rows come from a
## `provider(filter) -> Array` of source_lists_model.gd rows; `empty_text` shows when there are none.

const ThemeBuilder := preload("res://app/theme_builder.gd")

var provider: Callable
var empty_text := "No items"
var _filter: LineEdit
var _tree: Tree
var _empty: Label
var _key := ""


func _ready() -> void:
	add_theme_constant_override("separation", 4)
	_filter = LineEdit.new()
	_filter.placeholder_text = "Filter…"
	_filter.text_changed.connect(func(_t: String) -> void: rebuild())
	add_child(_filter)
	_empty = Label.new()
	_empty.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	_empty.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_empty.visible = false
	add_child(_empty)
	_tree = Tree.new()
	_tree.hide_root = true
	_tree.columns = 2
	_tree.set_column_expand(0, false)
	_tree.set_column_custom_minimum_width(0, 34)
	_tree.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_tree.set_drag_forwarding(_drag, Callable(), Callable())
	add_child(_tree)


func rebuild() -> void:
	if _tree == null or not provider.is_valid():
		return
	var rows: Array = provider.call(_filter.text)
	var key := JSON.stringify(rows)
	if key == _key:  # web renderKey: nothing visible changed
		return
	_key = key
	_tree.clear()
	var root := _tree.create_item()
	for r in rows:
		var it := _tree.create_item(root)
		it.set_text(0, str(r.pill))
		it.set_custom_color(0, ThemeBuilder.ACCENT if r.pill == "FX" else ThemeBuilder.TEXT_MUTED)
		it.set_text(1, str(r.text))
		it.set_tooltip_text(0, str(r.tip))
		it.set_tooltip_text(1, str(r.tip))
		it.set_metadata(0, r.payload)
	_empty.text = empty_text
	_empty.visible = rows.is_empty()


func _drag(at: Vector2) -> Variant:
	var it := _tree.get_item_at_position(at)
	if it == null or not (it.get_metadata(0) is Dictionary):
		return null
	var p: Dictionary = it.get_metadata(0)
	var l := Label.new()
	l.text = str(p.get("label", p.get("value", "")))
	set_drag_preview(l)
	return p.duplicate()
