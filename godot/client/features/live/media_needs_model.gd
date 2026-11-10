extends RefCounted
## WO-1029 plan 07 C10 — the shared media library, pure. From GET /api/cluster/media-needs
## {servers:[{id,name,self,online,known}], files:[{id,size,on,needed_on:[{server,destinations:[{id,label}],looks}],
## missing_on,differs_on}], summary} this decides, per media id, what the Sources row says ("only on B", "needed on B
## (Screen 2)", "differs on B"), what the bottom "Spread (N)" button says, what the confirm dialog lists, which looks
## play black on the box that outputs them, and the progress / result lines of a spread run.
## Rules: no linked server => no markers, no button. A peer whose inventory is unknown/offline is NEVER "missing".

const AMBER_STATES := ["needed", "differs"]
const IDLE_TIP := "every linked server has the media its screens use"


static func servers(needs: Variant) -> Array:
	if needs is Dictionary and (needs as Dictionary).get("servers") is Array:
		return (needs as Dictionary).servers.filter(func(s: Variant) -> bool: return s is Dictionary)
	return []


## Linked = at least one server besides this one. Without it nothing in this feature shows.
static func linked(needs: Variant) -> bool:
	for s in servers(needs):
		if s.get("self") != true:
			return true
	return false


static func self_id(needs: Variant) -> String:
	if needs is Dictionary and str((needs as Dictionary).get("self_id", "")) != "":
		return str(needs.self_id)
	for s in servers(needs):
		if s.get("self") == true:
			return str(s.get("id", ""))
	return ""


static func server_name(needs: Variant, id: String) -> String:
	for s in servers(needs):
		if str(s.get("id", "")) == id:
			var n := str(s.get("name", ""))
			return n if n != "" else id
	return id


## A peer we may call "missing" on: online and its inventory is known (an old build / no answer is "unknown").
static func reliable(needs: Variant, id: String) -> bool:
	for s in servers(needs):
		if str(s.get("id", "")) == id:
			return s.get("online", true) != false and s.get("known", true) != false
	return false


static func key(id: String) -> String:
	return id.replace("\\", "/").strip_edges().to_upper()


static func _files(needs: Variant) -> Array:
	if needs is Dictionary and (needs as Dictionary).get("files") is Array and linked(needs):
		return (needs as Dictionary).files.filter(func(f: Variant) -> bool: return f is Dictionary)
	return []


static func _ids(v: Variant) -> Array:
	return (v as Array).map(func(x: Variant) -> String: return str(x)) if v is Array else []


static func _names(needs: Variant, ids: Array) -> String:
	return ", ".join(ids.map(func(i: Variant) -> String: return server_name(needs, str(i))))


static func _dest_text(entry: Dictionary) -> String:
	var out: Array = []
	for d in entry.get("destinations", []) if entry.get("destinations") is Array else []:
		var l := str(d.get("label", d.get("id", ""))) if d is Dictionary else str(d)
		if l != "" and not out.has(l):
			out.append(l)
	return ", ".join(out)


## Row state of one file: {state: here | elsewhere | needed | differs | unknown, text, tip, amber, grey, on_here}.
## `elsewhere` = only on other linked servers (listed greyed, draggable). needed/differs win over elsewhere's text.
static func row_state(needs: Variant, f: Dictionary) -> Dictionary:
	var me := self_id(needs)
	var on := _ids(f.get("on"))
	var here := on.has(me)
	var out := {"state": "here", "text": "", "tip": "", "amber": false, "grey": not here, "on_here": here}
	var parts: Array = []
	var tips: Array = []
	var differs := _ids(f.get("differs_on")).filter(func(s: String) -> bool: return reliable(needs, s))
	var needed_lines: Array = []
	for n in f.get("needed_on", []) if f.get("needed_on") is Array else []:
		if not (n is Dictionary) or not reliable(needs, str(n.get("server", ""))):
			continue
		var sid := str(n.server)
		var dest := _dest_text(n)
		needed_lines.append("needed on %s%s" % [server_name(needs, sid), " (%s)" % dest if dest != "" else ""])
		var looks: Array = n.get("looks", []) if n.get("looks") is Array else []
		if not looks.is_empty():
			tips.append("%s: used by %s" % [server_name(needs, sid), ", ".join(looks.map(func(l: Variant) -> String: return _look_name(l)))])
	if not needed_lines.is_empty():
		out.state = "needed"
		parts.append("; ".join(needed_lines))
	if not differs.is_empty():
		if out.state == "here":
			out.state = "differs"
		parts.append("differs on %s" % _names(needs, differs))
	if out.state == "here" and not here:
		out.state = "elsewhere"
		parts.append("on %s" % _names(needs, on))
	if out.state == "here":
		for s in servers(needs):
			if s.get("self") != true and not reliable(needs, str(s.get("id", ""))):
				out.state = "unknown"  # no marker: only a quiet tooltip that its inventory is unknown
				tips.append("%s: media not known (offline or older build)" % server_name(needs, str(s.get("id", ""))))
				break
	out.text = " · ".join(parts)
	out.amber = out.state in AMBER_STATES
	if out.state == "needed" and not here:
		out.grey = true
	if f.get("size") != null and float(f.get("size", 0)) > 0.0:
		tips.append(bytes_text(float(f.size)))
	out.tip = "\n".join(tips)
	return out


static func _look_name(l: Variant) -> String:
	return str(l.get("name", l.get("id", ""))) if l is Dictionary else str(l)


## media key -> row_state, for the files the library knows. Empty when nothing is linked.
static func states(needs: Variant) -> Dictionary:
	var out := {}
	for f in _files(needs):
		out[key(str(f.get("id", "")))] = row_state(needs, f)
	return out


## Library rows that only another server has, in GET /api/media row shape (so they flow through the tree like local ones).
## `have` = ids already in the local list. The row carries remote = true and on_text for the greyed render.
static func remote_rows(needs: Variant, have: Array) -> Array:
	var seen := {}
	for r in have:
		if r is Dictionary:
			seen[key(str(r.get("id", "")))] = true
	var out: Array = []
	var me := self_id(needs)
	var more: Array = _files(needs).duplicate()  # referenced files this box lacks, then the rest of the library
	if linked(needs) and (needs as Dictionary).get("elsewhere") is Array:
		more.append_array((needs as Dictionary).elsewhere.filter(func(f: Variant) -> bool: return f is Dictionary))
	for f in more:
		var id := str(f.get("id", ""))
		if id == "" or seen.has(key(id)) or _ids(f.get("on")).has(me) or _ids(f.get("on")).is_empty():
			continue
		seen[key(id)] = true
		out.append({"id": id, "type": type_of(str(f.get("path", ""))), "remote": true, "size": f.get("size", 0), "on": _ids(f.get("on"))})
	return out


## GET /api/media types from the file extension (the shared list has no probe data).
static func type_of(path: String) -> String:
	var ext := path.get_extension().to_lower()
	if ext in ["png", "jpg", "jpeg", "tga", "tif", "tiff", "bmp", "gif", "webp"]:
		return "STILL"
	if ext in ["wav", "mp3", "flac", "aac", "ogg", "m4a", "aif", "aiff"]:
		return "AUDIO"
	return "MOVIE"


## --- the button --------------------------------------------------------------------------------------------------
## Files a spread would copy: missing on at least one reliable server. [{id, size, to: [server ids]}].
static func plan(needs: Variant) -> Array:
	var out: Array = []
	for f in _files(needs):
		var newer := _ids(f.get("newer_on"))  # a copy that is NEWER there is never overwritten without `overwrite`
		var to := (_ids(f.get("missing_on")) + _ids(f.get("differs_on")).filter(func(s: String) -> bool: return not newer.has(s))).filter(func(s: String) -> bool: return reliable(needs, s))
		if not to.is_empty() and not _ids(f.get("on")).is_empty() and f.get("spreadable") != false:
			out.append({"id": str(f.get("id", "")), "size": float(f.get("size", 0)), "to": to,
				"replaces": _ids(f.get("differs_on")).filter(func(s: String) -> bool: return to.has(s))})
	return out


static func total_bytes(items: Array) -> float:
	var sum := 0.0
	for i in items:
		sum += float(i.size) * (i.to as Array).size()
	return sum


## {visible, text, disabled, tip, count, bytes}. Not visible at all without linked servers.
static func button(needs: Variant, running := false) -> Dictionary:
	if not linked(needs):
		return {"visible": false, "text": "", "disabled": true, "tip": "", "count": 0, "bytes": 0.0}
	var items := plan(needs)
	var n := items.size()
	var b := total_bytes(items)
	var tip := IDLE_TIP if n == 0 else "Copy %d file%s (%s) to the servers that need them" % [n, "" if n == 1 else "s", bytes_text(b)]
	return {"visible": true, "text": "Spread (%d)" % n, "disabled": n == 0 or running, "tip": tip, "count": n, "bytes": b}


## Confirm text: what goes where, sizes, and what is skipped and why.
static func confirm_text(needs: Variant) -> String:
	var items := plan(needs)
	var per := {}  # server id -> [names, bytes]
	for i in items:
		for s in i.to:
			if not per.has(s):
				per[s] = [[], 0.0]
			per[s][0].append(str(i.id).get_file())
			per[s][1] += float(i.size)
	var lines: Array = ["Copy %d file%s (%s) between the linked servers:" % [items.size(), "" if items.size() == 1 else "s", bytes_text(total_bytes(items))], ""]
	for s in per:
		var names: Array = per[s][0]
		var shown := names.slice(0, 6)
		lines.append("To %s (%s):  %s%s" % [server_name(needs, str(s)), bytes_text(per[s][1]), ", ".join(shown),
			"" if names.size() <= 6 else " … and %d more" % (names.size() - 6)])
	var skipped := skipped_lines(needs)
	if not skipped.is_empty():
		lines.append("")
		lines.append_array(skipped)
	var replaced := items.filter(func(i: Dictionary) -> bool: return not (i.replaces as Array).is_empty()).size()
	lines.append("")
	lines.append(("%d older copy%s will be replaced. " % [replaced, "" if replaced == 1 else "ies"] if replaced > 0 else "") + "Nothing is deleted. Clips copy one at a time.")
	return "\n".join(lines)


## Why some things are not copied: differing files, servers whose media is unknown, servers offline.
static func skipped_lines(needs: Variant) -> Array:
	var out: Array = []
	var differs := {}
	for f in _files(needs):
		for s in _ids(f.get("newer_on")):
			if reliable(needs, s):
				differs[str(f.get("id", ""))] = true
	if not differs.is_empty():
		out.append("Not copied: %d file%s differ and are NEWER on the other server — nothing is overwritten." % [differs.size(), "" if differs.size() == 1 else "s"])
	for s in servers(needs):
		if s.get("self") == true:
			continue
		if s.get("online", true) == false:
			out.append("Skipped: %s is offline." % server_name(needs, str(s.get("id", ""))))
		elif s.get("known", true) == false:
			out.append("Skipped: %s — its media is not known (older build)." % server_name(needs, str(s.get("id", ""))))
	return out


## --- looks -------------------------------------------------------------------------------------------------------
## look name (and id when the answer gives one) -> tooltip "Media missing on B: a.mov, b.mov". Only reliable servers.
static func look_tips(needs: Variant) -> Dictionary:
	var per := {}  # look -> {server name -> [clip names]}
	if needs is Dictionary and (needs as Dictionary).get("looks") is Array and linked(needs):  # the server's own per-look list
		var out := {}
		for l in (needs as Dictionary).looks:
			var by_box := {}
			for m in l.get("missing", []) if l is Dictionary and l.get("missing") is Array else []:
				if m is Dictionary and reliable(needs, str(m.get("server", ""))):
					var arr: Array = by_box.get(server_name(needs, str(m.server)), [])
					by_box[server_name(needs, str(m.server))] = arr
					arr.append(str(m.get("file", "")).get_file())
			if by_box.is_empty():
				continue
			var parts: Array = []
			for box in by_box:
				parts.append("%s: %s" % [box, ", ".join(by_box[box])])
			var tip := "Media missing on the box that outputs this screen — " + "; ".join(parts)
			for k in [str(l.get("name", "")), str(l.get("id", ""))]:
				if k != "":
					out[k] = tip
		return out
	for f in _files(needs):
		for n in f.get("needed_on", []) if f.get("needed_on") is Array else []:
			if not (n is Dictionary) or not reliable(needs, str(n.get("server", ""))):
				continue
			for l in n.get("looks", []) if n.get("looks") is Array else []:
				for k in [_look_name(l), str(l.get("id", "")) if l is Dictionary else ""]:
					if str(k) == "":
						continue
					var m: Dictionary = per.get(k, {})
					per[k] = m
					var box := server_name(needs, str(n.server))
					var arr: Array = m.get(box, [])
					m[box] = arr
					if not arr.has(str(f.get("id", "")).get_file()):
						arr.append(str(f.get("id", "")).get_file())
	var out := {}
	for k in per:
		var parts: Array = []
		for box in per[k]:
			parts.append("%s: %s" % [box, ", ".join(per[k][box])])
		out[k] = "Media missing on the box that outputs this screen — " + "; ".join(parts)
	return out


## One-line notice for a take answer carrying media_missing: [{id, server}] (server = id; name when given).
static func take_notice(data: Variant, needs: Variant = null) -> String:
	if not (data is Dictionary) or not ((data as Dictionary).get("media_missing") is Array):
		return ""
	var by_box := {}
	for m in (data as Dictionary).media_missing:
		if not (m is Dictionary):
			continue
		var sid := str(m.get("server_name", m.get("server", "")))
		if needs != null and str(m.get("server_name", "")) == "":
			sid = server_name(needs, str(m.get("server", "")))
		var arr: Array = by_box.get(sid, [])
		by_box[sid] = arr
		arr.append(str(m.get("id", "")).get_file())
	if by_box.is_empty():
		return ""
	var parts: Array = []
	for box in by_box:
		parts.append("%s on %s" % [", ".join(by_box[box]), box if box != "" else "another server"])
	return "⚠ Media missing: " + "; ".join(parts) + " — Spread copies it"


## --- explicit send (selected local files to chosen servers; WO-1029 owner 10.11) ---------------------------------
## Servers a file can be sent to: linked, online, inventory known (an unknown box is asked nothing it cannot answer).
static func send_targets(needs: Variant) -> Array:
	return servers(needs).filter(func(s: Dictionary) -> bool: return s.get("self") != true and reliable(needs, str(s.get("id", ""))))


## The selected ids that can go: real files (a folder row or "" never), once each.
static func sendable(ids: Array) -> Array:
	var out: Array = []
	for i in ids:
		var s := str(i)
		if s != "" and not out.has(s):
			out.append(s)
	return out


## Size of a local file: the library answer's size (files / elsewhere) when it lists it, else the row's own.
static func size_of(needs: Variant, id: String, rows: Array = []) -> float:
	for f in _files(needs):
		if key(str(f.get("id", ""))) == key(id) and float(f.get("size", 0)) > 0.0:
			return float(f.size)
	for r in rows:
		if r is Dictionary and key(str(r.get("id", ""))) == key(id):
			return float(r.get("size", 0)) if r.get("size") != null else 0.0
	return 0.0


## True when the inventory shows `target` already holds this file (same size, not differing).
static func already_there(needs: Variant, id: String, target: String) -> bool:
	for f in _files(needs):
		if key(str(f.get("id", ""))) == key(id):
			return _ids(f.get("on")).has(target) and not _ids(f.get("differs_on")).has(target)
	return false


static func send_body(ids: Array, to: Array) -> Dictionary:
	return {"files": ids, "to": to}


## "Copy 1 file (34.2 GB) to highascg5867, same folder: TESTOWE/. The original stays here."
static func send_confirm(needs: Variant, ids: Array, to: Array, rows: Array = []) -> String:
	var total := 0.0
	var folders := {}
	var there: Array = []
	for i in ids:
		total += size_of(needs, str(i), rows)
		folders[str(i).get_base_dir() + "/" if str(i).get_base_dir() != "" else "the media root"] = true
		for s in to:
			if already_there(needs, str(i), str(s)):
				there.append("%s on %s" % [str(i).get_file(), server_name(needs, str(s))])
	var boxes := _names(needs, to)
	var text := "Copy %d file%s (%s) to %s, same folder%s: %s. The originals stay here." % [ids.size(), "" if ids.size() == 1 else "s",
		bytes_text(total * to.size()) if total > 0.0 else "size unknown", boxes, "" if folders.size() == 1 else "s", ", ".join(folders.keys())]
	if not there.is_empty():
		text += "\n\nAlready there, skipped: " + ", ".join(there.slice(0, 6)) + (" …" if there.size() > 6 else "")
	return text


## Free-space refusal (a 400 / failed row): "Not enough space on B: needs 34.2 GB, 8.0 GB free".
static func space_text(needs: Variant, d: Dictionary) -> String:
	if d.get("needed") == null or d.get("available") == null:
		return ""
	var box := server_name(needs, str(d.get("server", ""))) if str(d.get("server", "")) != "" else "the target"
	return "Not enough space on %s: needs %s, %s free" % [box, bytes_text(float(d.needed)), bytes_text(float(d.available))]


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


## --- progress ----------------------------------------------------------------------------------------------------
static func bytes_text(b: float) -> String:
	if b >= 1073741824.0:
		return "%.1f GB" % (b / 1073741824.0)
	if b >= 1048576.0:
		return "%.0f MB" % (b / 1048576.0)
	if b >= 1024.0:
		return "%.0f KB" % (b / 1024.0)
	return "%d B" % int(b)


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
			cur = "%s → %s" % [str(f.get("id", "")).get_file(), server_name(needs, str(f.get("to", "")))]
			if float(f.get("bytes", 0)) > 0.0:  # a multi-GB file: its own bytes, not only the run's
				cur += " (%s / %s)" % [bytes_text(float(f.get("done_bytes", 0))), bytes_text(float(f.bytes))]
	var line := "Spreading %d of %d" % [mini(done + (1 if cur != "" else 0), files.size()), files.size()]
	if cur != "":
		line += " · " + cur
	if float(run.get("bytes", 0)) > 0.0 and files.size() > 1:
		line += " · %s / %s" % [bytes_text(float(run.get("done_bytes", 0))), bytes_text(float(run.bytes))]
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
			return "Spreading · %s → %s%s" % [str(f.get("id", "")).get_file(), server_name(needs, str(f.get("to", ""))),
				" (%s)" % str(f.state) if str(f.get("state", "")) != "" else ""]
	return ""


static func finishes(d: Variant) -> bool:
	return d is Dictionary and str((d as Dictionary).get("phase", (d as Dictionary).get("event", (d as Dictionary).get("type", "")))) == "done"


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
				skips.append("%s → %s: %s" % [str(f.get("id", "")).get_file(), server_name(needs, str(f.get("to", ""))), str(f.get("error", "skipped"))])
			"failed":
				fails.append("%s → %s: %s" % [str(f.get("id", "")).get_file(), server_name(needs, str(f.get("to", ""))), str(f.get("error", "failed"))])
	if n_done == 0 and fails.is_empty() and not files.is_empty() and skips.size() > 0:
		return {"ok": true, "text": "Nothing copied — " + str(skips[0]), "tip": "\n".join(skips)}
	var text := "✓ Spread: %d cop%s (%s)" % [n_done, "y" if n_done == 1 else "ies", bytes_text(bytes)]
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
	var space := space_text(null, d)
	return {"how": "refused", "run_id": "", "error": space if space != "" else str(d.get("error", "HTTP %d" % status))}
