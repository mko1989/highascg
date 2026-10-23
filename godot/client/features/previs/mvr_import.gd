extends RefCounted
## WO-612 — Import…: a .mvr from this machine (POST /api/stage/mvr; the server parses it and keeps it in projects/_mvr).
## WO-643: the same file again is said, not re-imported; a new version of the shown scene is asked first. Out of
## mvr_section.gd for the 500-line limit (WO-706); `done(cfg, fresh)` gets the scene settings to save — fresh = a scene
## new to this project (not a version of the shown one).

const Upload := preload("res://core/stream_upload.gd")
const FilePick := preload("res://features/devices/file_pick.gd")
const M := preload("res://features/previs/mvr_model.gd")
const PaneKit := preload("res://features/settings/pane_kit.gd")


static func run(host: Node, cur: Dictionary, status: Label, done: Callable) -> void:
	var path: String = await FilePick.open_path(host, "Import an MVR scene", ["*.mvr ; MVR scene"])
	if path == "":
		return
	var check := M.import_check(cur, M.file_id(FileAccess.get_file_as_bytes(path)), M.file_name(path))
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
		PaneKit.confirm(host, check[1], func() -> void: _upload(path, cur, status, done, false))
	else:
		_upload(path, cur, status, done, true)


static func _upload(path: String, cur: Dictionary, status: Label, done: Callable, fresh: bool) -> void:
	status.text = "Uploading %s…" % path.get_file()
	var res: Dictionary = await Upload.upload(Config.origin, "/api/stage/mvr", path, func(sent: int, total: int) -> void:
		status.text = "Uploading %s… %d%%" % [path.get_file(), int(100.0 * sent / maxf(1.0, total))])
	if not res.ok or not (res.data is Dictionary):
		status.text = "Import failed: %s" % (res.data.get("error", res.error) if res.data is Dictionary else res.error)
		return
	done.call(M.import_cfg(cur, str(res.data.id), str(res.data.name)), fresh)
