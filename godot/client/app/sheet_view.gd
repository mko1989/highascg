extends AcceptDialog
## WO-1009 — a spreadsheet (.xlsx / .csv) from the server shown in a table inside the client (owner 09.11: "we have a
## built in reader to use as data input for lower thirds"): the server reads it with the lower-thirds reader (WO-601,
## exceljs; GET /api/media-docs/sheet, /api/project-files/<name>/sheet), so no desktop program is needed. A filter box
## narrows the rows; read-only.

const ThemeBuilder := preload("res://app/theme_builder.gd")

var data := {}  # {fileName, headers, rows, total}
var _table: Tree
var _meta: Label


## Show `data` (the server's reply) over `host`'s window.
static func show_sheet(host: Node, d: Dictionary) -> AcceptDialog:
	var v: AcceptDialog = load("res://app/sheet_view.gd").new()
	v.data = d
	host.add_child(v)
	v.popup_centered(Vector2i(1000, 640))
	return v


func _ready() -> void:
	title = str(data.get("fileName", "Spreadsheet"))
	ok_button_text = "Close"
	confirmed.connect(queue_free)
	canceled.connect(queue_free)
	var box := VBoxContainer.new()
	add_child(box)
	var filter := LineEdit.new()
	filter.placeholder_text = "Filter rows…"
	filter.clear_button_enabled = true
	filter.text_changed.connect(render)
	box.add_child(filter)
	_table = Tree.new()
	_table.hide_root = true
	_table.column_titles_visible = true
	_table.select_mode = Tree.SELECT_ROW
	_table.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_table.custom_minimum_size = Vector2(960, 520)
	box.add_child(_table)
	_meta = Label.new()
	_meta.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	box.add_child(_meta)
	render("")


## Fill the table with the rows matching `filter` (any cell, case-insensitive). → rows shown.
func render(filter: String) -> int:
	_table.clear()
	var headers: Array = data.get("headers", []) if data.get("headers") is Array else []
	var rows: Array = data.get("rows", []) if data.get("rows") is Array else []
	_table.columns = maxi(1, headers.size())
	for i in headers.size():
		_table.set_column_title(i, str(headers[i]))
		_table.set_column_expand(i, true)
		_table.set_column_clip_content(i, true)
	var root := _table.create_item()
	var f := filter.strip_edges().to_lower()
	var shown := 0
	for r in rows:
		var row: Dictionary = r
		if f != "" and not row.values().any(func(c: Variant) -> bool: return str(c).to_lower().contains(f)):
			continue
		var it := _table.create_item(root)
		for i in headers.size():
			it.set_text(i, str(row.get(str(headers[i]), "")))
		shown += 1
	var total := int(data.get("total", rows.size()))
	_meta.text = "%d of %d rows%s" % [shown, total, " (the first %d are shown)" % rows.size() if total > rows.size() else ""]
	return shown
