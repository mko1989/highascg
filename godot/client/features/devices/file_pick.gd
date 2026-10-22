extends RefCounted
## The Devices tab's file dialogs as awaitable calls (the web's download link / hidden file input): a save or open
## dialog on the local filesystem, starting in ~/Downloads (else ~), "" when cancelled; plus the text write.

const JSON_FILTER := "*.json ; JSON"


class _Wait:
	extends RefCounted
	signal done(path: String)


static func save_path(host: Node, title: String, file_name: String, filters := [JSON_FILTER]) -> String:
	return await _run(host, FileDialog.FILE_MODE_SAVE_FILE, title, file_name, filters)


static func open_path(host: Node, title: String, filters := [JSON_FILTER]) -> String:
	return await _run(host, FileDialog.FILE_MODE_OPEN_FILE, title, "", filters)


static func _run(host: Node, mode: FileDialog.FileMode, title: String, file_name: String, filters := [JSON_FILTER]) -> String:
	var dlg := FileDialog.new()
	dlg.file_mode = mode
	dlg.access = FileDialog.ACCESS_FILESYSTEM
	dlg.title = title
	dlg.filters = PackedStringArray(filters)
	dlg.current_dir = preload("res://core/platform.gd").start_dir()  # WO-686: Windows has no $HOME
	if file_name != "":
		dlg.current_file = file_name
	var w := _Wait.new()
	dlg.file_selected.connect(func(p: String) -> void: w.done.emit(p))
	dlg.canceled.connect(func() -> void: w.done.emit(""))
	host.add_child(dlg)
	dlg.popup_centered_ratio(0.6)
	var path: String = await w.done
	dlg.queue_free()
	return path


## Write `bytes` to `path`; "" on success, else the reason.
static func write_bytes(path: String, bytes: PackedByteArray) -> String:
	var f := FileAccess.open(path, FileAccess.WRITE)
	if f == null:
		return "cannot write %s (%s)" % [path, error_string(FileAccess.get_open_error())]
	f.store_buffer(bytes)
	f.close()
	return ""


## Write `text` to `path`; "" on success, else the reason.
static func write_text(path: String, text: String) -> String:
	var f := FileAccess.open(path, FileAccess.WRITE)
	if f == null:
		return "cannot write %s (%s)" % [path, error_string(FileAccess.get_open_error())]
	f.store_string(text)
	f.close()
	return ""
