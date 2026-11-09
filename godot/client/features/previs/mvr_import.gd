extends RefCounted
## WO-612 — Import…: a .mvr from this machine (POST /api/stage/mvr; the server parses it and keeps it in projects/_mvr).
## WO-643: the same file again is said, not re-imported; a new version of the shown scene is asked first. Out of
## mvr_section.gd for the 500-line limit (WO-706); `done(cfg, fresh)` gets the scene settings to save — fresh = a scene
## new to this project (not a version of the shown one).
## WO-1009: when the project folder holds .mvr files (header Files; an Import… from this computer also keeps its file
## there), Import… first offers them — the server imports the stored file, nothing is uploaded again.

const Upload := preload("res://core/stream_upload.gd")
const FilePick := preload("res://features/devices/file_pick.gd")
const M := preload("res://features/previs/mvr_model.gd")
const PaneKit := preload("res://features/settings/pane_kit.gd")
const PF := preload("res://core/project_files.gd")
const FROM_DISK := -2


class _Choice:
	extends RefCounted
	signal done(id: int)
	var sent := false

	func send(id: int) -> void:
		if not sent:
			sent = true
			done.emit(id)


static func run(host: Control, cur: Dictionary, status: Label, done: Callable) -> void:
	var files: Variant = await PF.list()
	var mvrs: Array = (files if files is Array else []).filter(func(f: Dictionary) -> bool: return str(f.kind) == "mvr")
	var pick := FROM_DISK
	if not mvrs.is_empty():
		pick = await _menu(host, mvrs)
		if pick == -1:
			return
	if pick >= 0:
		await _from_project(host, str(mvrs[pick].name), cur, status, done)
		return
	var path: String = await FilePick.open_path(host, "Import an MVR scene", ["*.mvr ; MVR scene"])
	if path == "":
		return
	var check := M.import_check(cur, M.file_id(FileAccess.get_file_as_bytes(path)), M.file_name(path))
	_after_check(host, check, func(fresh: bool) -> void: _upload(path, cur, status, done, fresh))


## The project's MVR files, then "From this computer…" → the row index, FROM_DISK, or -1 (closed).
static func _menu(host: Control, mvrs: Array) -> int:
	var pm := PopupMenu.new()
	for i in mvrs.size():
		pm.add_item("From the project: " + str(mvrs[i].name), i)
	pm.add_separator()
	pm.add_item("From this computer…", 1000)
	var c := _Choice.new()
	pm.id_pressed.connect(func(id: int) -> void: c.send(FROM_DISK if id == 1000 else id))
	pm.popup_hide.connect(func() -> void: (func() -> void: c.send(-1)).call_deferred())
	host.add_child(pm)
	pm.popup(Rect2i(Vector2i(host.get_global_mouse_position()), Vector2i.ZERO))
	var id: int = await c.done
	pm.queue_free()
	return id


## "same" → said, nothing imported; "version" → asked first; else straight on. `go(fresh)`.
static func _after_check(host: Node, check: Array, go: Callable) -> void:
	if check[0] == "same":
		var d := AcceptDialog.new()
		d.title = "Already imported"
		d.dialog_text = check[1]
		d.visibility_changed.connect(func() -> void:
			if not d.visible:
				d.queue_free())
		host.add_child(d)
		d.popup_centered()
	elif check[0] == "version":
		PaneKit.confirm(host, check[1], func() -> void: go.call(false))
	else:
		go.call(true)


## WO-1009: an .mvr from the project folder — its bytes only for the same / version check; the server imports its copy.
static func _from_project(host: Node, name: String, cur: Dictionary, status: Label, done: Callable) -> void:
	status.text = "Reading %s…" % name
	var got: Dictionary = await PF.fetch(name)
	if not got.ok:
		status.text = "Import failed: %s" % got.error
		return
	status.text = ""
	_after_check(host, M.import_check(cur, M.file_id(got.bytes), M.file_name(name)), func(fresh: bool) -> void:
		status.text = "Importing %s…" % name
		var res: Dictionary = await Api.post_json(PF.url(name) + "/mvr", {}, 600.0)
		if not res.ok or not (res.data is Dictionary):
			status.text = "Import failed: %s" % (res.data.get("error", res.error) if res.data is Dictionary else res.error)
			return
		done.call(M.import_cfg(cur, str(res.data.id), str(res.data.name)), fresh))


static func _upload(path: String, cur: Dictionary, status: Label, done: Callable, fresh: bool) -> void:
	status.text = "Uploading %s…" % path.get_file()
	var res: Dictionary = await Upload.upload(Config.origin, "/api/stage/mvr", path, func(sent: int, total: int) -> void:
		status.text = "Uploading %s… %d%%" % [path.get_file(), int(100.0 * sent / maxf(1.0, total))])
	if not res.ok or not (res.data is Dictionary):
		status.text = "Import failed: %s" % (res.data.get("error", res.error) if res.data is Dictionary else res.error)
		return
	done.call(M.import_cfg(cur, str(res.data.id), str(res.data.name)), fresh)
