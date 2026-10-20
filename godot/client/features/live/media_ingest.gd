extends RefCounted
## WO-603 slice 1 — desktop drops on the on-box client: `Window.files_dropped` gives local paths, the server copies
## them (POST /api/media/ingest-local {paths, folder}; folders walked server side) and reports over WS
## `media:ingest-progress`. Pure helpers; media_panel.gd owns the wiring.

const EVENT := "media:ingest-progress"


## The folder a drop on a tree item targets: a folder row is itself, a file row its parent folder, nothing → "" (the
## server's default: the active project's media folder, else the root).
static func folder_for(meta: Variant) -> String:
	if not (meta is Dictionary):
		return ""
	if (meta as Dictionary).has("folder"):
		return str(meta.folder)
	var id := str((meta as Dictionary).get("value", "")) if str(meta.get("type", "")) == "media" else ""
	var cut := id.rfind("/")
	return id.substr(0, cut) if cut > 0 else ""


static func request(paths: PackedStringArray, folder: String) -> Dictionary:
	return {"paths": Array(paths), "folder": folder}


## One status line for a progress / result state, "" when there is nothing to show.
static func status_text(st: Dictionary) -> String:
	match str(st.get("phase", "")):
		"copying":
			var total := float(st.get("bytesTotal", 0))
			var pct := int(round(100.0 * float(st.get("bytesDone", 0)) / total)) if total > 0.0 else 0
			var n := int(st.get("fileTotal", 0))
			var i := mini(int(st.get("fileIndex", 0)) + 1, n)
			var rel := str(st.get("fileRel", ""))
			return "Copying %d/%d · %d%%%s" % [i, n, pct, ("  " + rel.get_file()) if rel != "" else ""]
		"complete":
			return "✓ " + str(st.get("message", "Imported"))
		"error", "cancelled":
			return "✗ %s%s" % [st.get("message", "Ingest failed"), (": " + str(st.error)) if str(st.get("error", "")) not in ["", "Cancelled"] else ""]
	return ""


static func busy(st: Dictionary) -> bool:
	return bool(st.get("active", false))


## Off-box client (the server refuses a local-path ingest, 403): the same drop as HTTP uploads — one per file, its
## target folder in the `path` field. A dropped folder lands as a folder of that name (subfolders kept), like the
## server-side walk and the web WO-591 drop. → [{file, path}]
static func upload_plan(paths: PackedStringArray, folder: String) -> Array:
	var out: Array = []
	for p in paths:
		if DirAccess.dir_exists_absolute(p):
			_walk(p, join(folder, p.trim_suffix("/").get_file()), out)
		elif FileAccess.file_exists(p):
			out.append({"file": p, "path": folder})
	return out


static func _walk(dir: String, target: String, out: Array) -> void:
	var d := DirAccess.open(dir)
	if d == null:
		return
	d.include_hidden = false
	var files := d.get_files()
	files.sort()
	for f in files:
		out.append({"file": dir.path_join(f), "path": target})
	var dirs := d.get_directories()
	dirs.sort()
	for sub in dirs:
		_walk(dir.path_join(sub), join(target, sub), out)


static func join(folder: String, name: String) -> String:
	return name if folder == "" else folder + "/" + name


## Upload progress line: "Uploading 2/5 · 40%  clip.mov".
static func upload_text(index: int, total: int, sent: int, size: int, file: String) -> String:
	var pct := int(round(100.0 * sent / size)) if size > 0 else 0
	return "Uploading %d/%d · %d%%  %s" % [index + 1, total, pct, file.get_file()]


## Web createDownloadPoller line for GET /api/ingest/download-status; "" while there is nothing to report.
static func download_text(st: Dictionary) -> String:
	if st.get("active", false):
		var p: Variant = st.get("progress")
		return "%s%s" % [st.get("message", "Working…") if str(st.get("message", "")) != "" else "Working…", (" %d%%" % int(round(float(p)))) if p != null and float(p) > 0 else ""]
	if str(st.get("error", "")) not in ["", "<null>"] and st.get("error") != null:
		return "✗ " + str(st.error)
	return "✓ " + (str(st.message) if str(st.get("message", "")) != "" else "Done")
