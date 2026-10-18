extends VBoxContainer
## WO-601 — lower-third "Data sheet" (web inspector-lower-third-roster.js): import Excel / CSV (parsed by the
## server), map columns to First name / Surname / Title, search, click a row → Title + Subtitle. Emits the roster
## to persist (`source.lowerThirdRoster`) and the picked row; the lower-third section applies both.

signal roster_changed(roster: Dictionary)
signal row_picked(title: String, subtitle: String)

const R := preload("res://features/live/lt_roster_model.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")

var _roster: Dictionary = {}
var _filter := ""
var _selected := -1
var _body: VBoxContainer
var _meta: Label
var _mapping: HBoxContainer
var _search: LineEdit
var _table: Tree
var _dialog: FileDialog


func setup(roster: Variant) -> void:
	_roster = R.normalize(roster)


func _ready() -> void:
	var tog := Button.new()
	tog.flat = true
	tog.alignment = HORIZONTAL_ALIGNMENT_LEFT
	add_child(tog)
	_body = VBoxContainer.new()
	_body.visible = not _roster.is_empty()
	add_child(_body)
	tog.text = ("▾ " if _body.visible else "▸ ") + "Data sheet"
	tog.pressed.connect(func() -> void:
		_body.visible = not _body.visible
		tog.text = ("▾ " if _body.visible else "▸ ") + "Data sheet")
	var bar := HBoxContainer.new()
	var imp := Button.new()
	imp.text = "Import Excel / CSV"
	imp.pressed.connect(_open_dialog)
	bar.add_child(imp)
	_meta = _muted("")
	bar.add_child(_meta)
	_body.add_child(bar)
	_mapping = HBoxContainer.new()
	_body.add_child(_mapping)
	_search = LineEdit.new()
	_search.placeholder_text = "Filter rows…"
	_search.text_changed.connect(func(t: String) -> void:
		_filter = t
		_render_table())
	_body.add_child(_search)
	_table = Tree.new()
	_table.hide_root = true
	_table.column_titles_visible = true
	_table.custom_minimum_size = Vector2(320, 180)
	_table.item_selected.connect(_on_pick)
	_body.add_child(_table)
	_render()


func _open_dialog() -> void:
	if _dialog == null:
		_dialog = FileDialog.new()
		_dialog.file_mode = FileDialog.FILE_MODE_OPEN_FILE
		_dialog.access = FileDialog.ACCESS_FILESYSTEM
		_dialog.filters = PackedStringArray(["*.xlsx, *.csv, *.txt ; Spreadsheets"])
		_dialog.file_selected.connect(func(p: String) -> void: import_file(p))
		add_child(_dialog)
	_dialog.popup_centered_ratio(0.6)


## Read a local file and let the server parse it (same lib as the web).
func import_file(path: String) -> bool:
	var bytes := FileAccess.get_file_as_bytes(path)
	if bytes.is_empty():
		_meta.text = "Cannot read %s" % path.get_file()
		return false
	_meta.text = "Importing…"
	var res: Dictionary = await Api.post_json("/api/lower-thirds/roster/import", {"fileName": path.get_file(), "dataBase64": Marshalls.raw_to_base64(bytes)})
	if not (res.ok and res.data is Dictionary and res.data.get("ok") == true and res.data.get("roster") is Dictionary):
		_meta.text = "Import failed: %s" % (str(res.data.get("error", "")) if res.data is Dictionary else str(res.get("error", "")))
		return false
	_roster = R.normalize(res.data.roster)
	_filter = ""
	_selected = -1
	_search.text = ""
	_body.visible = true
	roster_changed.emit(_roster.duplicate(true))
	_render()
	return true


func _render() -> void:
	for c in _mapping.get_children():
		c.queue_free()
	if _roster.is_empty():
		_mapping.add_child(_muted("Import a spreadsheet to map columns to Title and Subtitle."))
	else:
		var m: Dictionary = _roster.mapping
		var headers: Array = _roster.headers
		for f in R.MAP_FIELDS:
			var o := OptionButton.new()
			o.add_item("— %s —" % f[1])
			for h in headers:
				o.add_item(str(h))
			o.select(headers.find(str(m.get(f[0], ""))) + 1)
			var key: String = f[0]
			o.item_selected.connect(func(i: int) -> void:
				_roster.mapping[key] = "" if i == 0 else str(headers[i - 1])
				roster_changed.emit(_roster.duplicate(true))
				_render_table())
			_mapping.add_child(o)
	_render_table()


func _render_table() -> void:
	_table.clear()
	var rows: Array = _roster.get("rows", []) if _roster.get("rows") is Array else []
	if rows.is_empty():
		_table.columns = 1
		_table.set_column_title(0, "No rows loaded")
		return
	var visible_rows := R.filter_rows(_roster, _filter)
	_meta.text = "%s · %d/%d rows" % [_roster.get("fileName", "Sheet"), visible_rows.size(), rows.size()]
	var cols := R.show_cols(_roster)
	_table.columns = maxi(1, cols.size())
	for i in cols.size():
		_table.set_column_title(i, str(cols[i]))
	var root := _table.create_item()
	for row in visible_rows:
		var it := _table.create_item(root)
		var src_index := rows.find(row)
		it.set_metadata(0, src_index)
		for i in cols.size():
			it.set_text(i, str(row.get(cols[i], "")))
		if src_index == _selected:
			it.select(0)


func _on_pick() -> void:
	var it := _table.get_selected()
	if it == null:
		return
	_selected = int(it.get_metadata(0))
	var mapped := R.map_row(_roster.rows[_selected], _roster.mapping)
	row_picked.emit(mapped.title, mapped.subtitle)


func _muted(text: String) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	return l
