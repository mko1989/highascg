extends RefCounted
## WO-825 — pure texts for Settings → GDTF library (GET /api/fixtures/library/status).


static func size(bytes: Variant) -> String:
	var b := float(bytes)
	if b >= 1073741824.0:
		return "%.1f GB" % (b / 1073741824.0)
	if b >= 1048576.0:
		return "%.0f MB" % (b / 1048576.0)
	return "%.0f kB" % (b / 1024.0)


static func library_line(st: Dictionary) -> String:
	var lib: Dictionary = st.get("library", {}) if st.get("library") is Dictionary else {}
	if lib.get("ready") != true:
		return "Not built yet. Fixtures from GDTF Share can only be patched after they are imported one by one."
	return "%d fixtures — description and thumbnail of every fixture (%s on disk). Built %s." % [int(lib.get("count", 0)),
		size(lib.get("bytes", 0)), str(lib.get("builtAt", "")).left(10)]


## "Models: 3 GB of ~11.3 GB downloaded (412 of 10487 fixtures)" — or why there is no estimate.
static func full_line(st: Dictionary) -> String:
	var f: Dictionary = st.get("full", {}) if st.get("full") is Dictionary else {}
	if f.get("error") != null and str(f.get("error")) != "":
		return "Size unknown (%s). The full library is about 12 GB for the newest revision of every fixture." % str(f.error)
	return "%s of %s downloaded (%d of %d fixtures)." % [size(f.get("doneBytes", 0)), size(f.get("bytes", 0)),
		int(f.get("doneFiles", 0)), int(f.get("files", 0))]


static func running(st: Dictionary) -> bool:
	return st.get("job") is Dictionary and (st.job as Dictionary).get("state") == "running"


static func job_line(st: Dictionary) -> String:
	if not (st.get("job") is Dictionary):
		return ""
	var j: Dictionary = st.job
	var what := "Library build" if j.get("kind") == "library" else "Model download"
	var n := int(j.get("done", 0)) + int(j.get("skipped", 0))
	var tail := " — %d failed" % int(j.get("failed", 0)) if int(j.get("failed", 0)) > 0 else ""
	match str(j.get("state", "")):
		"running":
			return "%s: %d of %d%s — %s" % [what, n, int(j.get("total", 0)), tail, str(j.get("current", ""))]
		"done":
			return "%s finished: %d fixtures (%s fetched this time)%s." % [what, n, size(j.get("bytes", 0)), tail]
		"cancelled":
			return "%s stopped at %d of %d. Start it again to continue where it left off." % [what, n, int(j.get("total", 0))]
		"error":
			return "%s stopped: %s" % [what, str(j.get("error", "unknown error"))]
	return ""


static func pending_line(st: Dictionary) -> String:
	var n := int(st.get("pending", 0))
	return "" if n == 0 else "%d fixture(s) in use still wait for their 3D models (offline) — retried automatically." % n


static func confirm_full(st: Dictionary) -> String:
	var f: Dictionary = st.get("full", {}) if st.get("full") is Dictionary else {}
	var left := float(f.get("bytes", 0)) - float(f.get("doneBytes", 0))
	return ("Download the 3D models and gobo images of every GDTF Share fixture? About %s still to fetch with this box's "
		+ "GDTF Share account; it takes hours, can be stopped and resumed, and needs that much free disk space.") % size(left)
