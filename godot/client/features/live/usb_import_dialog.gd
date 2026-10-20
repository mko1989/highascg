extends AcceptDialog
## WO-608 — Import from USB (web usb-import-modal.js): pick a removable drive the SERVER sees, browse it, tick
## files ("Select media in folder" ticks the media ones), Import copies them into the open project's media
## folder (the node resolves the target when no targetSubdir is sent), live progress (usb:copy-progress +
## /api/usb/import-status every 400 ms), Cancel copy, Safely eject. Drives refresh on usb:attached/detached.

signal imported

const ThemeBuilder := preload("res://app/theme_builder.gd")
const M := preload("res://features/live/usb_import_model.gd")
const Kit := preload("res://features/settings/pane_kit.gd")

static var _shown: AcceptDialog

var _drives: Array = []
var _drive := ""
var _rel := ""
var _selected := {}  # rel → true
var _note: Label
var _pick: OptionButton
var _crumbs: HBoxContainer
var _tree: Tree
var _summary: Label
var _prog_box: VBoxContainer
var _bar: ProgressBar
var _prog_line: Label
var _error: Label
var _poll: Timer


## One per app; reopening raises it and re-reads the drives.
static func show_import(host: Node, on_imported: Callable) -> void:
	if _shown == null or not is_instance_valid(_shown):
		_shown = new()
		_shown.imported.connect(on_imported)
		host.get_tree().root.add_child(_shown)
	var d: Variant = _shown
	d.fetch_drives()
	_shown.popup_centered()


func _init() -> void:
	title = "Import from USB"
	ok_button_text = "Close"
	exclusive = false
	size = Vector2i(760, 640)
	var body := VBoxContainer.new()
	body.custom_minimum_size = Vector2(720, 540)
	add_child(body)
	_note = Kit.note(body, "")
	_note.custom_minimum_size.x = 700  # autowrap measures at 1 px otherwise
	var row := Kit.row(body)
	var l := Label.new()
	l.text = "Drive"
	row.add_child(l)
	_pick = OptionButton.new()
	_pick.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_pick.item_selected.connect(func(i: int) -> void:
		_drive = str(_pick.get_item_metadata(i))
		_rel = ""
		_selected.clear()
		_update_summary()
		_browse())
	row.add_child(_pick)
	Kit.button(row, "↻", func() -> void: fetch_drives()).tooltip_text = "Refresh drive list"
	_crumbs = HBoxContainer.new()
	body.add_child(_crumbs)
	_tree = Tree.new()
	_tree.hide_root = true
	_tree.columns = 2
	_tree.set_column_expand(1, false)
	_tree.set_column_custom_minimum_width(1, 90)
	_tree.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_tree.item_edited.connect(_on_edited)
	_tree.item_selected.connect(_on_selected)
	body.add_child(_tree)
	var acts := Kit.row(body)
	Kit.button(acts, "Select media in folder", _select_media)
	_summary = Label.new()
	_summary.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	acts.add_child(_summary)
	_prog_box = VBoxContainer.new()
	_prog_box.visible = false
	body.add_child(_prog_box)
	_bar = ProgressBar.new()
	_prog_box.add_child(_bar)
	var pr := Kit.row(_prog_box)
	_prog_line = Label.new()
	_prog_line.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_prog_line.clip_text = true
	pr.add_child(_prog_line)
	Kit.button(pr, "Cancel copy", func() -> void: Api.post_json("/api/usb/import-cancel", {}))
	_error = Label.new()
	_error.add_theme_color_override("font_color", ThemeBuilder.ERROR)
	_error.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_error.custom_minimum_size.x = 700
	body.add_child(_error)
	add_button("Safely eject", false, "eject")
	add_button("Import", false, "import")
	custom_action.connect(func(a: StringName) -> void:
		if a == &"import":
			_run_import()
		elif a == &"eject":
			_eject())
	_poll = Timer.new()
	_poll.wait_time = 0.4
	_poll.timeout.connect(_poll_status)
	add_child(_poll)
	_update_summary()


func _ready() -> void:
	Ws.message.connect(_on_ws)


func _say_error(text: String) -> void:
	_error.text = text
	_error.visible = text != ""


func fetch_drives() -> void:
	_say_error("")
	var r: Dictionary = await Api.get_json("/api/usb/drives")
	if not r.ok or not (r.data is Dictionary):
		_say_error(str(r.data.get("error", r.error)) if r.data is Dictionary else r.error)
		return
	var note: Variant = r.data.get("platformNote")
	_drives = r.data.get("drives", []) if r.data.get("drives") is Array else []
	_note.text = str(note) if note != null else (M.EMPTY_HINT if _drives.is_empty() else "")
	_note.visible = _note.text != ""
	_pick.clear()
	_pick.add_item("No USB / removable volume detected" if _drives.is_empty() else "Select drive…")
	_pick.set_item_metadata(0, "")
	var keep := false
	for d in _drives:
		_pick.add_item(M.drive_label(d))
		_pick.set_item_metadata(_pick.item_count - 1, str(d.get("id", "")))
		if str(d.get("id", "")) == _drive:
			_pick.select(_pick.item_count - 1)
			keep = true
	if not keep:
		_drive = ""
		_rel = ""
		_selected.clear()
		_update_summary()
	_browse()


func _browse() -> void:
	_tree.clear()
	for c in _crumbs.get_children():
		c.queue_free()
	if _drive == "":
		return
	_say_error("")
	var r: Dictionary = await Api.get_json("/api/usb/browse?driveId=%s&path=%s" % [_drive.uri_encode(), _rel.uri_encode()])
	if not r.ok or not (r.data is Dictionary):
		_say_error(str(r.data.get("error", r.error)) if r.data is Dictionary else r.error)
		return
	for c in M.crumbs(_rel):
		var b := Button.new()
		b.flat = true
		b.text = c[0]
		var to: String = c[1]
		b.pressed.connect(func() -> void:
			_rel = to
			_browse())
		_crumbs.add_child(b)
	var root := _tree.create_item()
	if _rel != "":
		var up := _tree.create_item(root)
		up.set_text(0, "📁 ..")
		up.set_metadata(0, {"dir": true, "rel": M.parent_rel(_rel)})
	for e in r.data.get("entries", []):
		var it := _tree.create_item(root)
		var rel := str(e.get("rel", ""))
		if e.get("isDirectory", false):
			it.set_text(0, "📁 " + str(e.get("name", "")))
			it.set_metadata(0, {"dir": true, "rel": rel})
		else:
			it.set_cell_mode(0, TreeItem.CELL_MODE_CHECK)
			it.set_editable(0, true)
			it.set_text(0, str(e.get("name", "")))
			it.set_checked(0, _selected.has(rel))
			it.set_metadata(0, {"dir": false, "rel": rel, "name": str(e.get("name", ""))})
			it.set_text(1, M.format_size(e.get("size")))


func _on_selected() -> void:  # a folder row opens on click (web: folder buttons)
	var it := _tree.get_selected()
	if it != null and it.get_metadata(0) is Dictionary and it.get_metadata(0).dir:
		_rel = str(it.get_metadata(0).rel)
		_browse()


func _on_edited() -> void:
	var it := _tree.get_edited()
	var m: Dictionary = it.get_metadata(0)
	if it.is_checked(0):
		_selected[m.rel] = true
	else:
		_selected.erase(m.rel)
	_update_summary()


func _select_media() -> void:
	var root := _tree.get_root()
	if root == null:
		return
	for it in root.get_children():
		var m: Dictionary = it.get_metadata(0)
		if not m.dir and M.is_media(str(m.name)):
			it.set_checked(0, true)
			_selected[m.rel] = true
	_update_summary()


func _update_summary() -> void:
	_summary.text = M.summary(_selected.size())


func _run_import() -> void:
	if _drive == "":
		_say_error("Select a drive first")
		return
	if _selected.is_empty():
		_say_error("Select at least one file")
		return
	_say_error("")
	_show_progress({"active": true, "phase": "copying", "progress": 0, "message": "Starting…"})
	var r: Dictionary = await Api.post_json("/api/usb/import", {"driveId": _drive, "items": _selected.keys()})
	if not r.ok or (r.data is Dictionary and r.data.get("error") != null and not r.data.get("ok", false)):
		_say_error(str(r.data.get("error", r.error)) if r.data is Dictionary else r.error)
		return
	_poll.start()
	_poll_status()


func _poll_status() -> void:
	var r: Dictionary = await Api.get_json("/api/usb/import-status")
	if r.ok and r.data is Dictionary:
		_show_progress(r.data)


func _show_progress(st: Dictionary) -> void:
	var p := M.progress(st)
	_prog_box.visible = p.show
	_bar.value = p.pct
	_prog_line.text = p.line
	if p.error != "":
		_say_error(p.error)
	if (p.done or p.error != "") and not _poll.is_stopped():
		_poll.stop()
		if p.done:
			imported.emit()


func _on_ws(type: String, data: Variant) -> void:
	match type:
		"usb:attached", "usb:detached":
			if visible:
				fetch_drives()
		"usb:copy-progress":
			if data is Dictionary:
				if str(data.get("phase", "")) == "complete":
					_poll_status()  # the status read ends the poll and emits `imported` once
				else:
					_show_progress(data)


func _eject() -> void:
	if _drive == "":
		_say_error("Select a drive")
		return
	_say_error("")
	var r: Dictionary = await Api.post_json("/api/usb/eject", {"driveId": _drive})
	if not r.ok or (r.data is Dictionary and r.data.get("error") != null):
		_say_error(str(r.data.get("error", r.error)) if r.data is Dictionary else r.error)
		return
	_selected.clear()
	_drive = ""
	await fetch_drives()
	_note.text = str(r.data.get("message", "You can remove the device.")) if r.data is Dictionary else "You can remove the device."
	_note.visible = true
