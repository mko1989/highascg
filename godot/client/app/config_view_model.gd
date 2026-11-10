extends RefCounted
## The casparcg.config pane of the logs window (owner 10.11): pure rules for the header line, the On disk / Generated
## line diff, the "never send a config that cannot parse" check, the confirm text and the apply result wording.
## Server side: GET /api/caspar-config/current (file on disk), /generate (what the node would write), /dirty,
## /override; POST /api/caspar-config/apply { xml } is a ONE-SHOT: written and Caspar restarted, but not remembered.

const Plan := preload("res://features/devices/apply_plan_model.gd")

const MAX_DIFF_LINES := 3000  ## beyond this the LCS table is too big; fall back to "differs" without marks


## "14:03:22 today" / "2026-11-09 14:03" from the file's mtime (ms since epoch); "" when unknown.
static func written_text(mtime_ms: Variant, now_unix := -1.0) -> String:
	if not (mtime_ms is float or mtime_ms is int) or float(mtime_ms) <= 0.0:
		return ""
	var t := float(mtime_ms) / 1000.0
	var now := Time.get_unix_time_from_system() if now_unix < 0.0 else now_unix
	var d := Time.get_datetime_dict_from_unix_time(int(t))
	var nd := Time.get_datetime_dict_from_unix_time(int(now))
	var hm := "%02d:%02d:%02d" % [d.hour, d.minute, d.second]
	if d.year == nd.year and d.month == nd.month and d.day == nd.day:
		return hm + " today"
	return "%04d-%02d-%02d %s" % [d.year, d.month, d.day, hm]


## The state of the file in plain words. `dirty` = /api/caspar-config/dirty; `override` = the saved manual override
## text ("" = none: the generator is what Apply writes); `edited` = the editor holds unsent changes.
static func state_text(dirty: Variant, override: String, edited: bool) -> String:
	if edited:
		return "edited here, not applied yet"
	if override.strip_edges() != "":
		return "edited by hand: a saved manual override is what Apply writes (the generator is bypassed)"
	if not (dirty is Dictionary):
		return "state unknown"
	var d: Dictionary = dirty
	if d.get("offline_mode") == true:
		return "offline mode: nothing is applied to a running Caspar"
	var codes: Array = []
	for r in (d.get("reasons", []) as Array if d.get("reasons") is Array else []):
		if r is Dictionary:
			codes.append(str(r.get("code", "")))
	if codes.has("unwritten"):
		return "the server would generate a different config - Apply in Devices"
	if codes.has("not_restarted"):
		return "written, but Caspar was not restarted on it - Apply in Devices"
	if codes.has("running_differs"):
		return "matches what the server would generate, but the running Caspar differs - Apply in Devices"
	if codes.has("pending"):
		return "matches what the server would generate; a restart is pending - Apply in Devices"
	return "matches what the server would generate"


## Line numbers (0-based) that differ between a and b, by LCS: {"a": [..], "b": [..], "count": n, "ok": bool}.
## `count` = lines only in a plus lines only in b; ok=false when the texts are too long to diff.
static func diff(a: String, b: String) -> Dictionary:
	var la := a.split("\n")
	var lb := b.split("\n")
	if a == b:
		return {"a": [], "b": [], "count": 0, "ok": true}
	if la.size() > MAX_DIFF_LINES or lb.size() > MAX_DIFF_LINES:
		return {"a": [], "b": [], "count": -1, "ok": false}
	var n := la.size()
	var m := lb.size()
	var t: Array = []  # t[i][j] = LCS length of la[i:] and lb[j:]
	for i in n + 1:
		var row := PackedInt32Array()
		row.resize(m + 1)
		t.append(row)
	for i in range(n - 1, -1, -1):
		for j in range(m - 1, -1, -1):
			t[i][j] = t[i + 1][j + 1] + 1 if la[i] == lb[j] else maxi(t[i + 1][j], t[i][j + 1])
	var ma: Array = []
	var mb: Array = []
	var i := 0
	var j := 0
	while i < n and j < m:
		if la[i] == lb[j]:
			i += 1
			j += 1
		elif t[i + 1][j] >= t[i][j + 1]:
			ma.append(i)
			i += 1
		else:
			mb.append(j)
			j += 1
	while i < n:
		ma.append(i)
		i += 1
	while j < m:
		mb.append(j)
		j += 1
	return {"a": ma, "b": mb, "count": ma.size() + mb.size(), "ok": true}


## "3 lines differ" / "identical" / "too long to compare".
static func diff_note(d: Dictionary, other_name: String) -> String:
	if not d.get("ok", true):
		return "too long to compare line by line"
	var n := int(d.get("count", 0))
	if n == 0:
		return "identical to %s" % other_name
	return "%d line%s from %s" % [n, " differs" if n == 1 else "s differ", other_name]


## The next / previous marked line after `from` (wraps); -1 when none.
static func jump(marks: Array, from: int, forward: bool) -> int:
	if marks.is_empty():
		return -1
	if forward:
		for m in marks:
			if int(m) > from:
				return int(m)
		return int(marks[0])
	for k in range(marks.size() - 1, -1, -1):
		if int(marks[k]) < from:
			return int(marks[k])
	return int(marks[marks.size() - 1])


## Cheap parse check before anything is sent. → {ok, error, line}. Needs well-formed XML (tags nest and close),
## a <configuration> root and at least one <channel> inside a non-empty <channels>.
static func sanity(xml: String) -> Dictionary:
	if xml.strip_edges() == "":
		return _bad("the config is empty", 1)
	var p := XMLParser.new()
	var err := p.open_buffer(xml.to_utf8_buffer())
	if err != OK:
		return _bad("cannot read the text (error %d)" % err, 1)
	var stack: Array = []
	var root := ""
	var in_channels := 0
	var channel_count := 0
	while true:
		err = p.read()
		if err == ERR_FILE_EOF:
			break
		if err != OK:
			return _bad("not well-formed XML", p.get_current_line() + 1)
		var kind := p.get_node_type()
		if kind == XMLParser.NODE_ELEMENT:
			var name := p.get_node_name()
			if stack.is_empty():
				if root != "":
					return _bad("more than one root element (<%s>)" % name, p.get_current_line() + 1)
				root = name
				if name != "configuration":
					return _bad("the root element must be <configuration>, found <%s>" % name, p.get_current_line() + 1)
			if name == "channels" and stack.size() == 1:
				in_channels += 1
			elif name == "channel" and stack.size() == 2 and stack[1] == "channels":
				channel_count += 1
			if not p.is_empty():
				stack.append(name)
		elif kind == XMLParser.NODE_ELEMENT_END:
			var closing := p.get_node_name()
			if stack.is_empty() or stack[stack.size() - 1] != closing:
				var expect: String = "<%s>" % stack[stack.size() - 1] if not stack.is_empty() else "nothing open"
				return _bad("</%s> closes %s" % [closing, expect], p.get_current_line() + 1)
			stack.pop_back()
	if root == "":
		return _bad("no root element", 1)
	if not stack.is_empty():
		return _bad("<%s> is never closed" % stack[stack.size() - 1], xml.count("\n") + 1)
	if in_channels == 0:
		return _bad("no <channels> element", 1)
	if channel_count == 0:
		return _bad("<channels> has no <channel>", 1)
	return {"ok": true, "error": "", "line": 0}


static func _bad(why: String, line: int) -> Dictionary:
	return {"ok": false, "error": "line %d: %s" % [line, why], "line": line}


## The confirm before an edited config is sent. `keep` = the "keep as manual override" box; `override_set` = a manual
## override is already saved on the server.
static func confirm_text(server: String, keep: bool, override_set: bool) -> String:
	var later: String
	if keep:
		later = "It is also saved as the manual override, so the next Apply from Devices writes THIS text again " \
			+ "and the generator (including its DeckLink / keyer fixes) is bypassed until the override is cleared."
	elif override_set:
		later = "A manual override is already saved on the server: the next Apply from Devices writes that override, " \
			+ "not this edit and not the generated config."
	else:
		later = "This edit is a one-shot and is NOT remembered: the next Apply from Devices REPLACES it with the " \
			+ "generated config."
	return "Write this config to %s and restart Caspar?\n\nThe screens go blank for a few seconds. What is on air is " \
		% server + "saved before the restart and put back by the server afterwards.\n\n" + later


## One line for the result of POST /api/caspar-config/apply.
static func result_text(res: Dictionary) -> String:
	if not res.get("ok", false):
		var e: Variant = res.data.get("error") if res.get("data") is Dictionary else null
		var d: Variant = res.data.get("detail") if res.get("data") is Dictionary else null
		var msg := str(e) if e != null and str(e) != "" else str(res.get("error", "failed"))
		return "FAILED: " + msg + ((" - " + str(d)) if d != null and str(d) != "" else "")
	var data: Dictionary = res.data if res.get("data") is Dictionary else {}
	if data.get("ok") == false:
		return "FAILED: " + str(data.get("error", "the server reported a failure"))
	var out := "Applied. Caspar restarted." if data.get("restartSent") == true else "Applied. The file was written; Caspar was not restarted."
	var back := Plan.restored_or_reason(data.get("restored"), data.get("restored_reason"))
	if back != "":
		out += " " + back + "."
	if data.get("layoutOk") == false:
		out += " The screen layout did not verify: " + str(data.get("layoutProblem", "check Devices")) + "."
	return out
