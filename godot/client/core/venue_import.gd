extends RefCounted
## WO-1098 — the venue importer's client side (server: /api/venue-import, src/media/venue-import-job.js): an OBJ with its
## .mtl and pictures (loose files, a folder, or one .zip; a SketchUp .skp only for its pictures) → a venue .glb in the
## project folder, then used as the MVR scene's Venue model. Pure helpers + the calls the Files window makes.

const Upload := preload("res://core/stream_upload.gd")

const EXTS := ["obj", "mtl", "zip", "skp", "jpg", "jpeg", "png"]
const EVENT_PATH := "venueImport"  # WS change path while a conversion runs
const HELP := "From SketchUp: File → Export → 3D Model → OBJ (with 'Export texture maps'); upload the .obj, .mtl and texture folder, or a zip of them."
const SKP_ONLY := "SketchUp files are used for their textures only; export OBJ for the geometry"


static func is_part(path: String) -> bool:
	return EXTS.has(path.get_extension().to_lower())


## Does this pick / drop start a venue import? (an .obj, a .zip, a folder holding an .obj, or a .skp alone)
static func starts_import(entries: Array) -> bool:
	for e in entries:
		if str(e[1]).get_extension().to_lower() in ["obj", "zip", "skp"]:
			return true
	return false


## Local paths (files and folders) → [[absolute path, path to send (folder kept)]]: a folder is walked (its name kept as
## the first part, so "Hilton/tex/a.jpg"); an .obj brings along its .mtl files and the "<name>/" picture folder SketchUp
## writes beside it. Kinds outside EXTS are left out; nothing twice.
static func expand(paths: PackedStringArray) -> Array:
	var out := []
	var seen := {}
	var add := func(abs_path: String, rel: String) -> void:
		if is_part(abs_path) and not seen.has(abs_path):
			seen[abs_path] = true
			out.append([abs_path, rel])
	for p in paths:
		if DirAccess.dir_exists_absolute(p):
			for f in _walk(p, p.get_file(), 0):
				add.call(f[0], f[1])
			continue
		add.call(p, p.get_file())
		if p.get_extension().to_lower() != "obj":
			continue
		var dir := p.get_base_dir()
		for n in DirAccess.get_files_at(dir):
			if n.get_extension().to_lower() == "mtl":
				add.call(dir.path_join(n), n)
		var tex := dir.path_join(p.get_file().get_basename())
		if DirAccess.dir_exists_absolute(tex):
			for f in _walk(tex, tex.get_file(), 0):
				add.call(f[0], f[1])
	return out


static func _walk(dir: String, rel: String, depth: int) -> Array:
	var out := []
	if depth > 8:
		return out
	for n in DirAccess.get_files_at(dir):
		if not n.begins_with("."):
			out.append([dir.path_join(n), rel + "/" + n])
	for d in DirAccess.get_directories_at(dir):
		if not d.begins_with("."):
			out.append_array(_walk(dir.path_join(d), rel + "/" + d, depth + 1))
	return out


## Upload `entries` (expand()) into one staging session and start the conversion. `line(text)` reports progress.
## → {ok, error?, job?}
static func upload_and_start(entries: Array, line: Callable) -> Dictionary:
	var session := ""
	var i := 0
	for e in entries:
		i += 1
		var q := "?session=" + session if session != "" else ""
		var res: Dictionary = await Upload.upload(Config.origin, "/api/venue-import/files" + q, str(e[0]), func(sent: int, total: int) -> void:
			line.call("Uploading %d/%d %s… %d%%" % [i, entries.size(), str(e[1]).get_file(), int(100.0 * sent / maxf(1.0, total))]), {"path": str(e[1])})
		if res.data is Dictionary and str(res.data.get("session", "")) != "":
			session = str(res.data.session)
		if not res.ok and not (res.data is Dictionary and int(res.get("status", 0)) == 415):
			return {"ok": false, "error": "%s: %s" % [str(e[1]), res.data.get("error", res.error) if res.data is Dictionary else res.error]}
	if session == "":
		return {"ok": false, "error": "nothing to import"}
	var st: Dictionary = await Api.post_json("/api/venue-import/start", {"session": session})
	if not st.ok:
		return {"ok": false, "error": st.data.get("error", st.error) if st.data is Dictionary else str(st.error)}
	return {"ok": true, "job": st.data}


static func cancel() -> void:
	await Api.post_json("/api/venue-import/cancel", {})


## The job (GET /api/venue-import snapshot) as one status line; a finished one adds its report.
static func job_text(j: Dictionary) -> String:
	match str(j.get("state", "idle")):
		"running":
			return "Converting… %s" % str(j.get("text", ""))
		"error":
			return "✗ Venue import failed: %s" % str(j.get("error", ""))
		"cancelled":
			return "Venue import cancelled."
		"done":
			var r: Dictionary = j.get("report", {}) if j.get("report") is Dictionary else {}
			return "✓ %s — %s\nUse it as the Venue model: Previs ▸ MVR scene ▸ Venue model." % [str(j.get("name", "")), report_text(r)]
	return ""


## The import report in one paragraph: triangles in → out, pieces, materials, pictures found / missing, units, axis, size.
static func report_text(r: Dictionary) -> String:
	if r.is_empty():
		return ""
	var tri: Dictionary = r.get("triangles", {})
	var nodes: Dictionary = r.get("nodes", {})
	var mats: Dictionary = r.get("materials", {})
	var units: Dictionary = r.get("units", {})
	var size: Array = (r.get("bounds", {}) as Dictionary).get("size", [0, 0, 0])
	var found := (r.get("textures", []) as Array).filter(func(x: Variant) -> bool: return x is Dictionary and str(x.get("how", "")) != "placeholder (ignored)").size()
	var missing := (r.get("missingTextures", []) as Array).size()
	var parts := [
		"%s → %s triangles" % [_n(int(tri.get("in", 0))), _n(int(tri.get("out", 0)))],
		"%d → %d pieces" % [int(nodes.get("in", 0)), int(nodes.get("out", 0))],
		"%d materials" % int(mats.get("in", 0)),
		"%d pictures%s" % [found, (", %d missing" % missing) if missing > 0 else ""],
		"units %s (%s), %s up" % [str(units.get("unit", "?")), str(units.get("source", "")), str(r.get("up", "?")).to_upper()],
		"%.1f × %.1f × %.1f m" % [float(size[0]), float(size[2]), float(size[1])] if size.size() == 3 else "",
	]
	return ", ".join(parts.filter(func(s: String) -> bool: return s != ""))


static func _n(v: int) -> String:
	var s := str(v)
	var out := ""
	while s.length() > 3:
		out = " " + s.right(3) + out
		s = s.left(s.length() - 3)
	return s + out
