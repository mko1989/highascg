extends RefCounted
## WO-601 — lower-third data sheet ("roster"), pure port of client/lib/lower-third-roster-import.js (golden-tested):
## column-mapping guess, row → {title, subtitle}, row filter, normalize. Parsing the file (xlsx/csv) is the
## server's (POST /api/lower-thirds/roster/import runs the same lib) — Godot has no xlsx reader.
## Stored as `source.lowerThirdRoster = {fileName, importedAt, headers, mapping{firstName,surname,subtitle}, rows}`.

const UNSAFE_KEYS := ["__proto__", "constructor", "prototype"]
const MAP_FIELDS := [["firstName", "First name"], ["surname", "Surname"], ["subtitle", "Title / role"]]


static func _cell(v: Variant) -> String:
	return "" if v == null else str(v).strip_edges()


static func _collapse(s: String) -> String:
	return RegEx.create_from_string("\\s+").sub(s, " ", true).strip_edges()


static func _safe_header(k: Variant, i: int) -> String:
	var s := _cell(k)
	if s == "":
		s = "Column %d" % (i + 1)
	return "Column %d" % (i + 1) if s in UNSAFE_KEYS else s


## guessRosterMapping: first header equal to or containing each needle, needles in order.
static func guess_mapping(headers: Array) -> Dictionary:
	var pick := func(needles: Array) -> String:
		for n in needles:
			for h in headers:
				var low := str(h).strip_edges().to_lower()
				if low == n or low.contains(n):
					return str(h)
		return ""
	return {
		"firstName": pick.call(["first name", "firstname", "first", "name", "given"]),
		"surname": pick.call(["surname", "last name", "lastname", "last", "family"]),
		"subtitle": pick.call(["title", "role", "job", "position", "subtitle"]),
	}


## mapRowToLowerThirdConfig
static func map_row(row: Dictionary, mapping: Dictionary) -> Dictionary:
	var parts: Array[String] = []
	for k in ["firstName", "surname"]:
		if str(mapping.get(k, "")) != "":
			parts.append(_cell(row.get(mapping[k])))
	var sub := _cell(row.get(mapping.subtitle)) if str(mapping.get("subtitle", "")) != "" else ""
	return {"title": _collapse(" ".join(parts)), "subtitle": sub}


## filterRosterRows: case-insensitive substring over every cell; blank filter = all rows.
static func filter_rows(roster: Dictionary, query: String) -> Array:
	var rows: Array = roster.get("rows", []) if roster.get("rows") is Array else []
	var q := query.strip_edges().to_lower()
	if q == "":
		return rows
	return rows.filter(func(r: Dictionary) -> bool:
		for v in r.values():
			if str(v if v != null else "").to_lower().contains(q):
				return true
		return false)


## Columns the picker shows: the mapped ones, else the first four headers.
static func show_cols(roster: Dictionary) -> Array:
	var m: Dictionary = roster.get("mapping", {}) if roster.get("mapping") is Dictionary else {}
	var cols: Array = [m.get("firstName", ""), m.get("surname", ""), m.get("subtitle", "")].filter(func(c: Variant) -> bool: return str(c if c != null else "") != "")
	return cols if not cols.is_empty() else (roster.get("headers", []) as Array).slice(0, 4)


## normalizeLowerThirdRoster → {} when there is nothing (web: null).
static func normalize(raw: Variant) -> Dictionary:
	if not (raw is Dictionary):
		return {}
	var headers: Array = []
	var hs: Array = raw.get("headers", []) if raw.get("headers") is Array else []
	for i in hs.size():
		headers.append(_safe_header(hs[i], i))
	var rows: Array = []
	for r in (raw.get("rows", []) if raw.get("rows") is Array else []):
		if r is Dictionary:
			var o := {}
			for k in r:
				o[_safe_header(k, 0)] = _cell(r[k])
			rows.append(o)
	if headers.is_empty() and rows.is_empty():
		return {}
	var mapping: Dictionary = (raw.mapping as Dictionary).duplicate() if raw.get("mapping") is Dictionary else guess_mapping(headers)
	return {"fileName": _cell(raw.get("fileName")) if _cell(raw.get("fileName")) != "" else "import", "importedAt": str(raw.get("importedAt", "")),
		"headers": headers if not headers.is_empty() else (rows[0] as Dictionary).keys(), "mapping": mapping, "rows": rows}
