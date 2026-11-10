extends RefCounted
## WO-1029 C10 — the text and decisions of a spread RUN (split out of media_needs_model.gd for the 500-line limit):
## explicit "Send…" of selected files, free-space / skip reasons, progress with bytes + ETA, the result line, outcomes
## of POST /api/cluster/media-spread. Server shapes: linking-review/MEDIA-SHAPES.md (final).

const M := preload("res://features/live/media_needs_model.gd")

## --- explicit send (selected local files to chosen servers; WO-1029 owner 10.11) ---------------------------------
## Servers a file can be sent to: linked, online, inventory known (an unknown box is asked nothing it cannot answer).
static func send_targets(needs: Variant) -> Array:
	return M.servers(needs).filter(func(s: Dictionary) -> bool: return s.get("self") != true and M.reliable(needs, str(s.get("id", ""))))


## The selected ids that can go: real files (a folder row or "" never), once each.
static func sendable(ids: Array) -> Array:
	var out: Array = []
	for i in ids:
		var s := str(i)
		if s != "" and not out.has(s):
			out.append(s)
	return out


## GET /api/cluster/media-library items -> media key -> {size, on}. The whole shared library, so a file no look
## references still has a size and a known "already there" before anything is sent.
static func library_index(items: Array) -> Dictionary:
	var out := {}
	for it in items:
		if it is Dictionary and str(it.get("id", "")) != "":
			out[M.key(str(it.id))] = {"size": float(it.get("size", 0)), "on": M._ids(it.get("on"))}
	return out


## Size of a local file: the library index, else the needs answer, else the /api/media row's fileSize.
static func size_of(needs: Variant, id: String, rows: Array = [], lib := {}) -> float:
	var l: Variant = lib.get(M.key(id))
	if l is Dictionary and float(l.size) > 0.0:
		return float(l.size)
	for f in M._files(needs):
		if M.key(str(f.get("id", ""))) == M.key(id) and float(f.get("size", 0)) > 0.0:
			return float(f.size)
	for r in rows:
		if r is Dictionary and M.key(str(r.get("id", ""))) == M.key(id):
			for k in ["fileSize", "size"]:
				if r.get(k) != null and float(r.get(k)) > 0.0:
					return float(r.get(k))
	return 0.0


## True when the inventory shows `target` already holds this file (the server still compares size + mtime).
static func already_there(needs: Variant, id: String, target: String, lib := {}) -> bool:
	var l: Variant = lib.get(M.key(id))
	if l is Dictionary:
		return (l.on as Array).has(target)
	for f in M._files(needs):
		if M.key(str(f.get("id", ""))) == M.key(id):
			return M._ids(f.get("on")).has(target) and not M._ids(f.get("differs_on")).has(target)
	return false


static func send_body(ids: Array, to: Array) -> Dictionary:
	return {"files": ids, "to": to}


## "Copy 1 file (34.2 GB) to highascg5867, same folder: TESTOWE/. The original stays here."
static func send_confirm(needs: Variant, ids: Array, to: Array, rows: Array = [], lib := {}) -> String:
	var total := 0.0
	var folders := {}
	var there: Array = []
	for i in ids:
		total += size_of(needs, str(i), rows, lib)
		folders[str(i).get_base_dir() + "/" if str(i).get_base_dir() != "" else "the media root"] = true
		for s in to:
			if already_there(needs, str(i), str(s), lib):
				there.append("%s on %s" % [str(i).get_file(), M.server_name(needs, str(s))])
	var boxes := M._names(needs, to)
	var text := "Copy %d file%s (%s) to %s, same folder%s: %s. The originals stay here." % [ids.size(), "" if ids.size() == 1 else "s",
		M.bytes_text(total * to.size()) if total > 0.0 else "size unknown", boxes, "" if folders.size() == 1 else "s", ", ".join(folders.keys())]
	if not there.is_empty():
		text += "\n\nAlready there, skipped: " + ", ".join(there.slice(0, 6)) + (" …" if there.size() > 6 else "")
	return text


## "~12 min left" from bytes done in `elapsed` seconds; "" while the rate is not trustworthy yet.
static func eta_text(done: float, total: float, elapsed: float) -> String:
	if elapsed < 5.0 or done <= 0.0 or total <= done:
		return ""
	var left := (total - done) / (done / elapsed)
	if left < 90.0:
		return "~%d s left" % int(ceil(left))
	if left < 5400.0:
		return "~%d min left" % int(ceil(left / 60.0))
	return "~%.1f h left" % (left / 3600.0)


static func run_of(status: Variant) -> Dictionary:
	if status is Dictionary:
		var r: Variant = (status as Dictionary).get("run")
		if r is Dictionary:
			return r
		if (status as Dictionary).get("files") is Array:
			return status
	return {}


static func is_running(status: Variant) -> bool:
	return status is Dictionary and (status as Dictionary).get("running") == true


## The in-place progress line from a status answer (or the run in a 409): "Spreading 2 of 5 · a.mov → B · 1.2 / 4.0 GB".
static func progress_line(status: Variant, needs: Variant = null, elapsed := 0.0) -> String:
	var run := run_of(status)
	var files: Array = run.get("files", []) if run.get("files") is Array else []
	if files.is_empty():
		return "Spreading media…"
	var done := 0
	var cur := ""
	for f in files:
		var st := str(f.get("state", ""))
		if st in ["done", "failed", "skipped"]:
			done += 1
		elif st == "copying" and cur == "":
			cur = "%s → %s" % [str(f.get("id", "")).get_file(), M.server_name(needs, str(f.get("to", "")))]
			if float(f.get("bytes", 0)) > 0.0:  # a multi-GB file: its own bytes, not only the run's
				cur += " (%s / %s)" % [M.bytes_text(float(f.get("done_bytes", 0))), M.bytes_text(float(f.bytes))]
			if f.get("throttle_kbps") is int or f.get("throttle_kbps") is float:  # null = idle, no limit
				cur += " · rate-limited while on air"
	var line := "Spreading %d of %d" % [mini(done + (1 if cur != "" else 0), files.size()), files.size()]
	if cur != "":
		line += " · " + cur
	if float(run.get("bytes", 0)) > 0.0 and files.size() > 1:
		line += " · %s / %s" % [M.bytes_text(float(run.get("done_bytes", 0))), M.bytes_text(float(run.bytes))]
	var eta := eta_text(float(run.get("done_bytes", 0)), float(run.get("bytes", 0)), elapsed)
	return line + (" · " + eta if eta != "" else "")


## An event on `cluster:media` ({phase|type|event: start | file | done, ...}) -> a line, "" if it says nothing.
static func event_line(d: Variant, needs: Variant = null) -> String:
	if not (d is Dictionary):
		return ""
	var e := str(d.get("phase", d.get("event", d.get("type", ""))))
	match e:
		"start":
			return "Spreading media…"
		"file":
			var f: Dictionary = d.get("file") if d.get("file") is Dictionary else d
			return "Spreading · %s → %s%s" % [str(f.get("id", "")).get_file(), M.server_name(needs, str(f.get("to", ""))),
				" (%s)" % str(f.state) if str(f.get("state", "")) != "" else ""]
	return ""


## Fold a `cluster:media` event into the run snapshot: start = the run, file = that row (+ run done_bytes), done = the run.
static func apply_event(snap: Dictionary, d: Dictionary) -> Dictionary:
	var out := snap.duplicate(true)
	match str(d.get("event", "")):
		"start", "done":
			return (d.get("run") as Dictionary).duplicate(true) if d.get("run") is Dictionary else out
		"file":
			var files: Array = out.get("files", []) if out.get("files") is Array else []
			var i := int(d.get("index", -1))
			if d.get("file") is Dictionary and i >= 0 and i < files.size():
				files[i] = d.file
				out["files"] = files
			if d.get("done_bytes") != null:
				out["done_bytes"] = d.done_bytes
	return out


static func finishes(d: Variant) -> bool:
	return d is Dictionary and str((d as Dictionary).get("phase", (d as Dictionary).get("event", (d as Dictionary).get("type", "")))) == "done"


## Why a row was skipped: its `error`; "already there" may also arrive in `reason` (not missing / differs).
static func skip_reason(f: Dictionary) -> String:
	var e := str(f.get("error", ""))
	var r := str(f.get("reason", ""))
	return e if e != "" else (r if r not in ["", "missing", "differs"] else "skipped")


## Final one-liner + failure list. {ok, text, tip}. Skipped (differs, no space) are counted, failures listed.
static func result(status: Variant, needs: Variant = null) -> Dictionary:
	var run := run_of(status)
	var files: Array = run.get("files", []) if run.get("files") is Array else []
	var n_done := 0
	var n_skip := 0
	var fails: Array = []
	var skips: Array = []
	var bytes := 0.0
	for f in files:
		match str(f.get("state", "")):
			"done":
				n_done += 1
				bytes += float(f.get("bytes", 0))
			"skipped":
				n_skip += 1
				skips.append("%s → %s: %s" % [str(f.get("id", "")).get_file(), M.server_name(needs, str(f.get("to", ""))), skip_reason(f)])
			"failed":
				fails.append("%s → %s: %s" % [str(f.get("id", "")).get_file(), M.server_name(needs, str(f.get("to", ""))), str(f.get("error", "failed"))])
	if n_done == 0 and fails.is_empty() and not files.is_empty() and skips.size() > 0:
		return {"ok": true, "text": "Nothing copied — " + str(skips[0]), "tip": "\n".join(skips)}
	if str(run.get("state", "")) == "cancelled":
		return {"ok": true, "text": "Spread cancelled — %d copied (%s)" % [n_done, M.bytes_text(bytes)], "tip": "\n".join(fails)}
	var text := "✓ Spread: %d cop%s (%s)" % [n_done, "y" if n_done == 1 else "ies", M.bytes_text(bytes)]
	if n_skip > 0:
		text += ", %d skipped" % n_skip
	if not fails.is_empty():
		text = "✗ Spread: %d copied, %d failed" % [n_done, fails.size()] + (", %d skipped" % n_skip if n_skip > 0 else "")
	return {"ok": fails.is_empty(), "text": text, "tip": "\n".join(fails)}


## POST /api/cluster/media-spread answer -> {how: started | attached | refused, run_id, error}.
static func start_outcome(status: int, data: Variant) -> Dictionary:
	var d: Dictionary = data if data is Dictionary else {}
	if status == 202 or (status == 200 and d.has("run_id")):
		return {"how": "started", "run_id": str(d.get("run_id", ""))}
	if status == 409:
		var run := run_of(d)
		return {"how": "attached", "run_id": str(d.get("run_id", run.get("id", run.get("run_id", ""))))}
	var why: Array = []  # 400 "nothing to send": the skipped rows say why
	for k in d.get("skipped", []) if d.get("skipped") is Array else []:
		if k is Dictionary:
			why.append("%s: %s" % [str(k.get("id", "")).get_file(), skip_reason({"error": k.get("reason", "")})])
	var err := str(d.get("error", "HTTP %d" % status))
	return {"how": "refused", "run_id": "", "error": err + (" — " + ", ".join(why.slice(0, 3)) if not why.is_empty() else "")}
