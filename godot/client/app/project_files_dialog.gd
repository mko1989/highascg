extends AcceptDialog
## WO-1009 — the header "Files" window: the open project's documents (core/project_files.gd) — MVR scenes, .glb models,
## PDFs and Excel sheets kept in the project folder on the server (so they travel with the show). Add files… or drop
## files from the desktop on this window; Open shows one in this machine's own viewer; Save copy… downloads it; Remove
## deletes it (asked). MVR and .glb files are used from the Previs (MVR scene → Import…, Models).

const PF := preload("res://core/project_files.gd")
const FilePick := preload("res://features/devices/file_pick.gd")
const PaneKit := preload("res://features/settings/pane_kit.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")

var _list: ItemList
var _status: Label
var _open: Button
var _save: Button
var _remove: Button
var _files: Array = []


func _ready() -> void:
	title = "Project files"
	ok_button_text = "Close"
	min_size = Vector2i(560, 380)
	var v := VBoxContainer.new()
	add_child(v)
	var hint := Label.new()
	hint.text = "MVR, GLB, PDF and Excel files kept with this show (its project folder on the server). Drop files here to add them."
	hint.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	hint.custom_minimum_size.x = 560  # a wrapping label without a width measures one word per line (window too tall)
	hint.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	v.add_child(hint)
	_list = ItemList.new()
	_list.select_mode = ItemList.SELECT_MULTI
	_list.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_list.custom_minimum_size.y = 220
	_list.max_columns = 1
	_list.multi_selected.connect(func(_i: int, _on: bool) -> void: _sync())
	_list.item_activated.connect(func(_i: int) -> void: _open_selected())
	v.add_child(_list)
	var row := HBoxContainer.new()
	v.add_child(row)
	for spec in [["Add files…", _pick], ["Open", _open_selected], ["Save copy…", _save_selected], ["Remove", _ask_remove]]:
		var b := Button.new()
		b.text = spec[0]
		b.pressed.connect(spec[1])
		row.add_child(b)
		match spec[0]:
			"Open": _open = b
			"Save copy…": _save = b
			"Remove": _remove = b
	_open.tooltip_text = "Open in this computer's own viewer (double-click does the same)"
	_status = Label.new()
	_status.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_status.custom_minimum_size.x = 560
	_status.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	v.add_child(_status)
	get_tree().root.files_dropped.connect(_on_dropped)
	Ws.on("change", func(d: Variant) -> void:
		if visible and d is Dictionary and str(d.get("path")) in [PF.EVENT_PATH, "project.activated"]:
			refresh())
	_sync()


func open() -> void:
	popup_centered(Vector2i(640, 440))
	refresh()


func refresh() -> void:
	var files: Variant = await PF.list()
	_files = files if files is Array else []
	_list.clear()
	for f in _files:
		_list.add_item("%s   ·   %s   ·   %s" % [f.name, PF.KIND_TEXT.get(str(f.kind), str(f.kind)), PF.size_text(int(f.size))])
	if files == null:
		_status.text = "The server did not answer."
	elif _files.is_empty() and _status.text == "":
		_status.text = "No files yet."
	_sync()


func _selected() -> Array:
	return Array(_list.get_selected_items()).map(func(i: int) -> String: return str(_files[i].name))


func _sync() -> void:
	var n := _list.get_selected_items().size()
	_open.disabled = n != 1
	_save.disabled = n != 1
	_remove.disabled = n == 0


func _pick() -> void:
	var dlg := FileDialog.new()
	dlg.file_mode = FileDialog.FILE_MODE_OPEN_FILES
	dlg.access = FileDialog.ACCESS_FILESYSTEM
	dlg.title = "Add files to the project"
	dlg.filters = PF.filters()
	dlg.current_dir = preload("res://core/platform.gd").start_dir()
	dlg.files_selected.connect(func(paths: PackedStringArray) -> void:
		dlg.queue_free()
		_add(paths))
	dlg.canceled.connect(dlg.queue_free)
	add_child(dlg)
	dlg.popup_centered_ratio(0.6)


## Desktop drops land in the main window: only those over this window add files (the Sources column takes its own).
func _on_dropped(paths: PackedStringArray) -> void:
	if visible and Rect2(Vector2(position), Vector2(size)).has_point(get_tree().root.get_mouse_position()):
		_add(paths)


func _add(paths: PackedStringArray) -> void:
	_status.text = await PF.upload(paths, func(t: String) -> void: _status.text = t)
	refresh()


func _open_selected() -> void:
	var names := _selected()
	if names.size() == 1:
		_status.text = "Opening %s…" % names[0]
		var err: String = await PF.open(names[0])
		_status.text = err if err != "" else "Opened %s" % names[0]


func _save_selected() -> void:
	var names := _selected()
	if names.size() != 1:
		return
	var path: String = await FilePick.save_path(self, "Save a copy", names[0], ["*.%s" % names[0].get_extension()])
	if path == "":
		return
	var res: Dictionary = await PF.fetch(names[0])
	var err: String = FilePick.write_bytes(path, res.bytes) if res.ok else str(res.error)
	_status.text = "✓ Saved %s" % path if err == "" else "✗ %s" % err


func _ask_remove() -> void:
	var names := _selected()
	if names.is_empty():
		return
	PaneKit.confirm(self, "Remove %s from this project?" % ", ".join(names), func() -> void:
		for n: String in names:
			var res: Dictionary = await Api.delete_json(PF.url(n))
			if not res.ok:
				_status.text = "✗ Could not remove %s: %s" % [n, res.error]
		refresh())
