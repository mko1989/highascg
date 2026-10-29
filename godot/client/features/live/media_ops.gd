extends RefCounted
## WO-603 slice 2 — media-tree file operations (web sources-panel-media-selection.js + lib/media-file-ops.js):
## request bodies for the existing server ops (POST /api/media/copy | move {sourceIds, targetId}, /delete {ids},
## /mkdir {path}) and their result lines. The server creates a missing target folder on copy/move, so the web's
## mkdir-before-move is not repeated here.


## The folder picker's choices: the on-disk folders (`isDir` rows — never the upper-case Caspar CLS duplicates).
static func folders(rows: Array) -> PackedStringArray:
	var out := {}
	for r in rows:
		if r is Dictionary and r.get("isDir", false) == true and str(r.get("id", "")) != "":
			out[str(r.id)] = true
	var list := PackedStringArray(out.keys())
	list.sort()
	return list


static func clean_folder(path: String) -> String:
	var parts := PackedStringArray()
	for p in path.replace("\\", "/").split("/", false):
		if p.strip_edges() != "":
			parts.append(p.strip_edges())
	return "/".join(parts)


static func join_folder(base: String, name: String) -> String:
	return clean_folder(base + "/" + name)


## POST /api/media/rename/plan body (slice 3, media_rename_dialog.gd).
static func plan_body(sel: Array, title_text: String, renumber: bool, start: float, step: float, pad: float) -> Dictionary:
	return {"ids": sel, "title": title_text, "renumber": {"start": int(start), "step": int(step), "pad": int(pad)} if renumber else null}


static func transfer_body(ids: Array, folder: String) -> Dictionary:
	return {"sourceIds": ids, "targetId": clean_folder(folder)}


static func delete_body(ids: Array) -> Dictionary:
	return {"ids": ids}


## Does deleting `sel` (files and/or folders) take `id` with it? A folder covers everything under it.
static func covers(sel: Array, id: String) -> bool:
	for v in sel:
		var s := str(v)
		if s != "" and (id == s or id.begins_with(clean_folder(s) + "/")):
			return true
	return false


## WO-603 "project only" (web filterMediaForActiveProject): rows inside the project media folder. Case-insensitive —
## Caspar's CLS rows are upper-case ("PROJECTS/DEMO/CLIP") next to the on-disk spelling.
static func in_folder(rows: Array, folder: String) -> Array:
	var f := clean_folder(folder).to_lower()
	if f == "":
		return rows
	var out := []
	for r in rows:
		var id := clean_folder(str(r.get("id", ""))).to_lower() if r is Dictionary else ""
		if id.begins_with(f + "/") or (id == f and r.get("isDir", false) == true):
			out.append(r)
	return out


## POST /api/media/gather reply → the status line.
static func gather_text(res: Dictionary) -> String:
	if not res.get("ok", false) and not (res.get("data") is Dictionary and res.data.has("moved")):
		var err: Variant = res.data.get("error") if res.get("data") is Dictionary else null
		return "✗ Gather failed: %s" % (err if err != null else res.get("error", "HTTP %s" % res.get("status", "?")))
	var d: Dictionary = res.data
	var moved: int = (d.get("moved", []) as Array).size()
	var failed: Array = d.get("failed", [])
	if failed.size() > 0:
		return "✗ Gathered %s into %s/, %d failed — first: %s" % [plural(moved), d.get("folder", ""), failed.size(), failed[0].get("error", "")]
	if moved == 0:
		return "✓ Every referenced clip is already in the project folder"
	return "✓ Gathered %s into %s/ — %d reference(s) follow" % [plural(moved), d.get("folder", ""), int(d.get("refs", 0))]


static func plural(n: int) -> String:
	return "%d file%s" % [n, "" if n == 1 else "s"]


## "✓ Moved 3 files" | "✗ Moved 1 of 3 — a.mov: <first error>" | "✗ Moved 0 of 3 — <error>" from an Api result.
static func result_text(verb: String, total: int, res: Dictionary) -> String:
	var d: Dictionary = res.data if res.get("data") is Dictionary else {}
	if not res.get("ok", false):
		return "✗ %s 0 of %d — %s" % [verb, total, res.get("error", "")]
	var errs: Array = d.get("errors", []) if d.get("errors") is Array else []
	var done := int(d.get("count", total))
	if errs.is_empty():
		return "✓ %s %s" % [verb, plural(done)]
	var first: Dictionary = errs[0] if errs[0] is Dictionary else {}
	return "✗ %s %d of %d — %s: %s" % [verb, done, total, str(first.get("id", "")).get_file(), first.get("error", "")]


## The media tree as a flat, parent-first list (web sources-panel-media.js renderMediaTree): on-disk folder rows first,
## folders merged case-insensitively under their on-disk spelling — a Caspar CLS id (PROJECTS/AIRPORT/CLIP) files
## into projects/airport instead of a second upper-case folder. A filter hides folder rows (folders then come from
## the matching files only).
## Entries: {kind: "dir", key, parent, label, folder} | {kind: "file", parent, label, row}; key/parent = lower-case path.
static func tree_entries(rows: Array, filter := "") -> Array:
	var out: Array = []
	var disk := {"": ""}  # lower-case key → on-disk spelling (from the folder rows even when they are filtered out)
	var shown := {"": true}
	var f := filter.strip_edges().to_lower()
	var walk := func(parts: PackedStringArray, depth: int, emit: bool) -> String:
		var key := ""
		for i in depth:
			var parent := key
			key = parts[i].to_lower() if key == "" else key + "/" + parts[i].to_lower()
			if not disk.has(key):
				disk[key] = parts[i] if parent == "" else str(disk[parent]) + "/" + parts[i]
			if emit and not shown.has(key):
				shown[key] = true
				out.append({"kind": "dir", "key": key, "parent": parent, "label": str(disk[key]).get_file(), "folder": disk[key]})
		return key
	for pass_dirs in [true, false]:
		for r in rows:
			if not (r is Dictionary) or (r.get("isDir", false) == true) != pass_dirs:
				continue
			var id := str(r.get("id", ""))
			if id == "" or (not pass_dirs and f != "" and not id.to_lower().contains(f)):
				continue
			var parts := id.split("/", false)
			var key: String = walk.call(parts, parts.size() - (0 if pass_dirs else 1), not pass_dirs or f == "")
			if not pass_dirs:
				out.append({"kind": "file", "parent": key, "label": parts[parts.size() - 1], "row": r})
	return out


## Drag payload (web sources-panel-helpers.js dragstart): a row that is part of a multi-selection drags them all as
## {type:"multi", items:[…]} in tree order; otherwise the one row {type, value, label}. `row` metadata is dropped.
static func drag_payload(dragged: Dictionary, selected: Array) -> Dictionary:
	var strip := func(m: Dictionary) -> Dictionary:
		var d := m.duplicate()
		d.erase("row")
		return d
	var in_sel := selected.any(func(m: Variant) -> bool: return m is Dictionary and str(m.get("value", "")) == str(dragged.get("value", "")))
	if in_sel and selected.size() > 1:
		return {"type": "multi", "items": selected.map(func(m: Dictionary) -> Dictionary: return strip.call(m))}
	return strip.call(dragged)


## Web sources-panel-media.js folder drop: the media ids a drag payload moves into `folder` — media items only
## (single or multi), and nothing when every one of them already sits inside that folder.
static func folder_drop_ids(data: Variant, folder: String) -> Array:
	if not data is Dictionary:
		return []
	var d: Dictionary = data
	var items: Array = d.items if d.get("type") == "multi" and d.get("items") is Array else [d]
	var ids: Array = []
	for it in items:
		if it is Dictionary and it.get("type") == "media" and str(it.get("value", "")) != "":
			ids.append(str(it.value))
	var movable := ids.any(func(v: String) -> bool: return not v.begins_with(folder + "/") and v != folder)
	return ids if movable else []


## WO-759 — the media tree's quick-look column from the GET /api/media row (server probe fields: codec,
## resolution, fps, durationMs): "HAP · 3840×1792 · 25 fps · 00:01:03"; a still shows codec + size only.
const CODEC_LABELS := {"hap": "HAP", "prores": "ProRes", "mjpeg": "JPG", "jpeg": "JPG", "png": "PNG", "notchlc": "NotchLC",
	"h264": "H.264", "hevc": "H.265", "dvvideo": "DV", "rawvideo": "RAW", "vp9": "VP9", "av1": "AV1", "tiff": "TIFF"}


static func quick_info(row: Dictionary) -> String:
	var parts := PackedStringArray()
	var codec := str(row.get("codec", "")).strip_edges().to_lower()
	if codec != "" and codec != "<null>":
		parts.append(CODEC_LABELS.get(codec, codec.to_upper()))
	var res := str(row.get("resolution", "")).strip_edges()
	if res != "" and res != "<null>":
		parts.append(res)
	if str(row.get("type", "")) == "STILL":
		return " · ".join(parts)
	var fps := float(row.get("fps", 0)) if row.get("fps") != null else 0.0
	if fps > 0.0 and str(row.get("type", "")) != "AUDIO":
		parts.append(("%d fps" % int(fps)) if is_equal_approx(fps, roundf(fps)) else ("%.2f fps" % fps))
	var ms := float(row.get("durationMs", 0)) if row.get("durationMs") != null else 0.0
	if ms > 0.0:
		parts.append(hms(ms))
	return " · ".join(parts)


## WO-818 — NotchLC rows are marked in the media tree: stock Caspar decodes them on the CPU (ffmpeg's notchlc decoder);
## the HighAsCG build decodes them on the GPU (WO-820).
## The probed codec decides; the file name ("…notchlc…") only when nothing was probed.
const NOTCHLC_TIP := "NotchLC: the HighAsCG Caspar build decodes it on the GPU. Stock CasparCG decodes it on the CPU, far heavier than HAP.\nOn a stock Caspar, transcode it to HAP in HighAsCG before using it on air."


static func is_notchlc(row: Dictionary) -> bool:
	var codec := str(row.get("codec", "")).strip_edges().to_lower() if row.get("codec") != null else ""
	if codec != "":
		return codec == "notchlc"
	return str(row.get("id", row.get("label", ""))).get_file().to_lower().contains("notchlc")


## hh:mm:ss, rounded down to the second (a 63.32 s clip is 00:01:03).
static func hms(ms: float) -> String:
	var s := int(floor(ms / 1000.0))
	return "%02d:%02d:%02d" % [s / 3600, (s / 60) % 60, s % 60]
