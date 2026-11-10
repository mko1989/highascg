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
		if not on.has(sid):  # used there AND absent there; a file the server already holds is no notice
			needed_lines.append("needed on %s%s" % [server_name(needs, sid), " (%s)" % dest if dest != "" else ""])
		var looks: Array = n.get("looks", []) if n.get("looks") is Array else []
		var users: Array = looks.map(func(l: Variant) -> String: return _look_name(l))
		for tl in n.get("timelines", []) if n.get("timelines") is Array else []:
			users.append("timeline " + str(tl))
		if not users.is_empty():
			tips.append("%s: used by %s" % [server_name(needs, sid), ", ".join(users)])
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
	var ts: Variant = (((needs as Dictionary).get("summary") as Dictionary).get("to_send") if (needs as Dictionary).get("summary") is Dictionary else null)
	if ts is Dictionary and (ts as Dictionary).has("files"):  # the server's own count of what a default spread copies
		n = int(ts.files)
		b = float(ts.get("bytes", b))
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
					var box := str(m.get("server_name", "")) if str(m.get("server_name", "")) != "" else server_name(needs, str(m.server))
					var arr: Array = by_box.get(box, [])
					by_box[box] = arr
					arr.append(str(m.get("file", "")).get_file() + (" (%s)" % str(m.screen) if str(m.get("screen", "")) != "" else ""))
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


## --- progress ----------------------------------------------------------------------------------------------------
static func bytes_text(b: float) -> String:
	if b >= 1073741824.0:
		return "%.1f GB" % (b / 1073741824.0)
	if b >= 1048576.0:
		return "%.0f MB" % (b / 1048576.0)
	if b >= 1024.0:
		return "%.0f KB" % (b / 1024.0)
	return "%d B" % int(b)


