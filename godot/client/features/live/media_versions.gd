extends VBoxContainer
## WO-601 / WO-592 B — media-file "Versions" (web inspector-media-file-versions.js): upload a new version — it takes
## its own file name in this file's folder (WO-921; any container, WO-775) and every look follows the rename — list
## the old ones under their names, Go back to one (its name comes back; the current file is kept), purge one (final).
## The upload streams the file (core/stream_upload.gd) — media files can be GBs.

signal changed(new_id: String)  # a new current version → the inspector reloads facts / waveform (new_id: the path now)

const Upload := preload("res://core/stream_upload.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const M := preload("res://features/live/media_versions_model.gd")

var _id := ""
var _list: VBoxContainer
var _bar: ProgressBar
var _msg: Label
var _dialog: FileDialog


func _ready() -> void:
	var head := HBoxContainer.new()
	var l := Label.new()
	l.text = "Versions"
	l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(l)
	var up := Button.new()
	up.text = "New version…"
	up.tooltip_text = "Replace this file with a new version (any format, e.g. previz .mp4 → show .mov) — it keeps its own name and every look follows"
	up.pressed.connect(_pick)
	head.add_child(up)
	add_child(head)
	_list = VBoxContainer.new()
	add_child(_list)
	_bar = ProgressBar.new()
	_bar.visible = false
	add_child(_bar)
	_msg = Label.new()
	_msg.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_msg.add_theme_color_override("font_color", ThemeBuilder.ACCENT_RED)
	add_child(_msg)


func show_entry(id: String, entry: Dictionary) -> void:
	_id = id
	_msg.text = ""
	for c in _list.get_children():
		c.queue_free()
	_list.add_child(_row("v%d" % int(entry.get("currentV", 1)), "current", M.fmt_size(float(entry.get("size", 0))), -1))
	var old: Array = (entry.get("versions", []) as Array).duplicate() if entry.get("versions") is Array else []
	old.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return int(a.v) > int(b.v))
	for v in old:
		_list.add_child(_row("v%d" % int(v.v), M.old_text(v), M.fmt_size(float(v.get("size", 0))), int(v.v)))
	if old.is_empty():
		var none := Label.new()
		none.text = "No older versions"
		none.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
		_list.add_child(none)


func _row(v: String, what: String, size: String, ver: int) -> Control:
	var r := HBoxContainer.new()
	for t in [v, what, size]:
		var l := Label.new()
		l.text = t
		if t == what:  # a long file name elides instead of widening the inspector
			l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			l.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
			l.clip_text = true
			l.tooltip_text = t
			l.mouse_filter = Control.MOUSE_FILTER_PASS
		r.add_child(l)
	if ver > 0:
		var back := Button.new()
		back.text = "Go back"
		back.tooltip_text = "Make %s current again (the current file is kept as a version)" % v
		back.pressed.connect(func() -> void: _restore(ver))
		r.add_child(back)
		var purge := Button.new()
		purge.text = "✕"
		purge.tooltip_text = "Delete this old version permanently"
		purge.pressed.connect(func() -> void: _confirm("Delete version %s permanently? This cannot be undone." % v, func() -> void: _purge(ver)))
		r.add_child(purge)
	return r


func _pick() -> void:
	if _dialog == null:
		_dialog = FileDialog.new()
		_dialog.file_mode = FileDialog.FILE_MODE_OPEN_FILE
		_dialog.access = FileDialog.ACCESS_FILESYSTEM
		_dialog.file_selected.connect(func(p: String) -> void: _confirm_upload(p))
		add_child(_dialog)
	_dialog.popup_centered_ratio(0.6)


func _confirm_upload(file_path: String) -> void:
	_confirm(M.upload_text(_id.get_file(), file_path.get_file()), func() -> void: upload(file_path))


## The path after a version change: the reply's `renamed.to` when the name (or only the extension) changed.
func _new_id(data: Variant) -> String:
	if data is Dictionary and data.get("renamed") is Dictionary:
		return str(data.renamed.get("to", _id))
	return _id


## Stream the file as the new current version (also the dev-probe entry point).
func upload(file_path: String) -> bool:
	_msg.text = ""
	_bar.value = 0
	_bar.visible = true
	var res: Dictionary = await Upload.upload(Config.origin, "/api/media/version/upload?path=%s" % _id.uri_encode(), file_path,
		func(sent: int, total: int) -> void: _bar.value = 100.0 * sent / maxf(1.0, total))
	_bar.visible = false
	if not res.ok:
		_msg.text = "%s — nothing changed" % (res.error if str(res.error) != "" else "Upload failed")
		return false
	changed.emit(_new_id(res.data))
	return true


func _restore(v: int) -> void:
	var r: Dictionary = await Api.post_json("/api/media/version/restore", {"path": _id, "v": v})
	if r.ok:
		changed.emit(_new_id(r.data))
	else:
		_msg.text = r.error


func _purge(v: int) -> void:
	var r: Dictionary = await Api.post_json("/api/media/version/purge", {"path": _id, "v": v})
	if r.ok:
		changed.emit(_id)
	else:
		_msg.text = r.error


func _confirm(text: String, cb: Callable) -> void:
	var dlg := ConfirmationDialog.new()
	dlg.dialog_text = text
	dlg.confirmed.connect(cb)
	dlg.visibility_changed.connect(func() -> void:
		if not dlg.visible:
			dlg.queue_free())
	add_child(dlg)
	dlg.popup_centered()
