extends RefCounted
## WO-1009 — the open project's documents on the server (GET / POST / DELETE /api/project-files; the project media
## folder, src/media/project-files.js): MVR scenes, .glb models, PDFs and Excel sheets. Pure helpers + the calls the
## Files dialog (app/project_files_dialog.gd), the previs MVR Import… and the previs Models list share.

const Upload := preload("res://core/stream_upload.gd")

const EXTS := ["mvr", "glb", "pdf", "xls", "xlsx"]
const KIND_TEXT := {"mvr": "MVR scene", "model": "3D model", "pdf": "PDF", "sheet": "Spreadsheet"}
const EVENT_PATH := "projectFiles"  # WS change path after an upload / delete


## A Sources document (GET /api/media-docs id) on the server.
static func doc_url(id: String) -> String:
	return "/api/media-docs/file?id=" + id.uri_encode()


static func filters() -> PackedStringArray:
	return PackedStringArray(["*.mvr, *.glb, *.pdf, *.xls, *.xlsx ; Show files (MVR, GLB, PDF, Excel)"])


static func accepts(path: String) -> bool:
	return EXTS.has(path.get_extension().to_lower())


static func url(name: String) -> String:
	return "/api/project-files/" + name.uri_encode()


static func size_text(n: int) -> String:
	if n < 1024:
		return "%d B" % n
	if n < 1048576:
		return "%.0f KB" % (n / 1024.0)
	return "%.1f MB" % (n / 1048576.0) if n < 1073741824 else "%.2f GB" % (n / 1073741824.0)


## The project's files ([{name, kind, size, mtime}]) or null when the server could not say.
static func list() -> Variant:
	var res: Dictionary = await Api.get_json("/api/project-files")
	if not res.ok or not (res.data is Dictionary):
		return null
	return (res.data as Dictionary).get("files", [])


## Upload local `paths` (other kinds are skipped) one by one; `line(text)` reports progress. → summary text.
static func upload(paths: PackedStringArray, line: Callable) -> String:
	var ok := []
	var bad := []
	var skipped := []
	for p in paths:
		if not accepts(p):
			skipped.append(p.get_file())
			continue
		var res: Dictionary = await Upload.upload(Config.origin, "/api/project-files", p, func(sent: int, total: int) -> void:
			line.call("Uploading %s… %d%%" % [p.get_file(), int(100.0 * sent / maxf(1.0, total))]))
		if res.ok and res.data is Dictionary and not (res.data.get("saved", []) as Array).is_empty():
			ok.append(str(res.data.saved[0].name))
		else:
			bad.append("%s (%s)" % [p.get_file(), res.data.get("error", res.error) if res.data is Dictionary else res.error])
	var parts := []
	if not ok.is_empty():
		parts.append("✓ Added " + ", ".join(ok))
	if not bad.is_empty():
		parts.append("✗ Failed: " + ", ".join(bad))
	if not skipped.is_empty():
		parts.append("Skipped (not MVR / GLB / PDF / Excel): " + ", ".join(skipped))
	return "  ".join(parts)


## The file's bytes ({ok, bytes, error}).
static func fetch(name: String) -> Dictionary:
	return await Api.get_bytes(url(name))


## Open `name` with this machine's own viewer (a copy in user://project-files). "" or the reason it did not open.
static func open(name: String) -> String:
	return await open_from(url(name), name)


## The same for any server path (a Sources document: /api/media-docs/file?id=…).
static func open_from(path: String, name: String) -> String:
	var res: Dictionary = await Api.get_bytes(path)
	if not res.ok:
		return "Could not fetch %s: %s" % [name, res.error]
	var dir := OS.get_user_data_dir().path_join("project-files")
	DirAccess.make_dir_recursive_absolute(dir)
	var dest := dir.path_join(name)
	var f := FileAccess.open(dest, FileAccess.WRITE)
	if f == null:
		return "Could not write %s" % dest
	f.store_buffer(res.bytes)
	f.close()
	var err := OS.shell_open(dest)
	return "" if err == OK else "No program on this machine opens %s (%s)" % [name.get_extension().to_upper(), error_string(err)]
