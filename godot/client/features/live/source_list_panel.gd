extends VBoxContainer
## WO-623 C — one flat Sources list (Templates / Timelines): filter + rows of [kind pill | label], each row dragging the
## web payload {type, value, label} onto the look editor, the deck (new look) or a timeline. Rows come from a
## `provider(filter) -> Array` of source_lists_model.gd rows; `empty_text` shows when there are none.

const ThemeBuilder := preload("res://app/theme_builder.gd")
const Icons := preload("res://app/ui_icons.gd")
const UI_CFG := "user://ui.cfg"

signal row_clicked(payload: Dictionary, kind: String)  # WO-606: Shader Live auditions a clicked shader
signal row_context(payload: Dictionary, kind: String)  # right-click (WO-606: shader rows → Edit shader…)

var provider: Callable
var empty_text := "No items"
## WO-661: [[id, title], …] — rows whose "group" matches go under a collapsible header (Templates tab); [] = flat.
var groups: Array = []
## group id → ⚠ tooltip: a warning icon on that header and its rows (Shaders while Caspar runs without GPU).
var group_warning := {}
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
	_tree.allow_rmb_select = true
	_tree.item_collapsed.connect(_on_collapsed)
	_tree.item_mouse_selected.connect(func(_at: Vector2, button: int) -> void:
		var it := _tree.get_selected()
		if it == null or not (it.get_metadata(0) is Dictionary):
			return
		if button == MOUSE_BUTTON_LEFT:
			row_clicked.emit(it.get_metadata(0), str(it.get_metadata(1)))
		elif button == MOUSE_BUTTON_RIGHT:
			row_context.emit(it.get_metadata(0), str(it.get_metadata(1))))
	add_child(_tree)


func rebuild() -> void:
	if _tree == null or not provider.is_valid():
		return
	var rows: Array = provider.call(_filter.text)
	var key := JSON.stringify([rows, group_warning])
	if key == _key:  # web renderKey: nothing visible changed
		return
	_key = key
	_tree.clear()
	var root := _tree.create_item()
	if groups.is_empty():
		for r in rows:
			_row(root, r, "")
	else:
		var closed := _closed()
		for g in groups:
			var mine := rows.filter(func(r: Dictionary) -> bool: return r.get("group", "") == g[0])
			if mine.is_empty():
				continue
			var warn := str(group_warning.get(g[0], ""))
			var head := _tree.create_item(root)
			head.set_meta("group", g[0])
			head.set_text(1, "%s  %d" % [g[1], mine.size()])
			head.set_selectable(0, false)
			head.set_selectable(1, false)
			if warn != "":
				head.set_icon(0, Icons.texture("warning"))
				head.set_tooltip_text(0, warn)
				head.set_tooltip_text(1, warn)
			for r in mine:
				_row(head, r, warn)
			head.collapsed = _filter.text.strip_edges() == "" and closed.has(g[0])  # a filter opens every group
	_empty.text = empty_text
	_empty.visible = rows.is_empty()


func _row(parent: TreeItem, r: Dictionary, warn: String) -> void:
	var it := _tree.create_item(parent)
	it.set_text(0, str(r.pill))
	it.set_custom_color(0, ThemeBuilder.ACCENT if r.pill == "FX" else ThemeBuilder.TEXT_MUTED)
	it.set_text(1, str(r.text))
	var tip := str(r.tip) if warn == "" else "%s\n\n%s" % [r.tip, warn]  # no ⚠ glyph in the UI font
	if warn != "":
		it.set_icon(0, Icons.texture("warning", 12))
	it.set_tooltip_text(0, tip)
	it.set_tooltip_text(1, tip)
	it.set_metadata(0, r.payload)
	it.set_metadata(1, str(r.get("kind", "")))


## Collapsed groups, remembered in ui.cfg [sources] (per panel name) like the web's localStorage.
func _closed() -> Array:
	var cfg := ConfigFile.new()
	cfg.load(UI_CFG)
	var v: Variant = cfg.get_value("sources", "%s_closed" % name, [])
	return v if v is Array else []


func _on_collapsed(it: TreeItem) -> void:
	if not it.has_meta("group") or _filter.text.strip_edges() != "":
		return
	var closed := _closed()
	var g := str(it.get_meta("group"))
	closed.erase(g)
	if it.collapsed:
		closed.append(g)
	var cfg := ConfigFile.new()
	cfg.load(UI_CFG)
	cfg.set_value("sources", "%s_closed" % name, closed)
	cfg.save(UI_CFG)


func _drag(at: Vector2) -> Variant:
	var it := _tree.get_item_at_position(at)
	if it == null or not (it.get_metadata(0) is Dictionary):
		return null
	var p: Dictionary = it.get_metadata(0)
	var l := Label.new()
	l.text = str(p.get("label", p.get("value", "")))
	set_drag_preview(l)
	return p.duplicate()
