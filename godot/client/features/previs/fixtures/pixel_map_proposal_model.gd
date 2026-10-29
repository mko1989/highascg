extends RefCounted
## WO-807 automatic edge proposal — pixel_map_proposal_model.gd (pure): GET /api/fixtures/pixelmap/proposal parsed into
## one shape, its state (pending | applied | available | none), the Pixel map button's tooltip line, the per-LED-wall
## grouping and row text of the review modal (pixel_map_proposal_window.gd), each wall's strips in wall pixels, and
## the notes after Accept / Dismiss. The server computes everything; nothing here decides a mapping.

const NOT_MAPPED := "Not mapped"


static func _arr(v: Variant) -> Array:
	return v if v is Array else []


static func _dict(v: Variant) -> Dictionary:
	return v if v is Dictionary else {}


## The response (or anything else) → { ok, pending, applied, at, params, walls, fixtures, mappings, mapped,
## out_of_range, skipped, last_state, error }. A failed or empty response is state "none".
static func parse(data: Variant) -> Dictionary:
	var d := _dict(data)
	var params := _dict(d.get("params"))
	var last := _dict(d.get("last"))
	var fixtures := _arr(d.get("fixtures")).filter(func(f: Variant) -> bool: return f is Dictionary)
	return {
		"ok": d.get("ok") == true,
		"pending": d.get("pending") == true,
		"applied": d.get("applied") == true,
		"at": str(d.get("at", "")) if d.get("at") != null else "",
		"params": {"inset_px": int(params.get("inset_px", 50)), "depth_px": int(params.get("depth_px", 40)),
			"threshold_m": float(params.get("threshold_m", 1.5)), "mode": str(params.get("mode", "average"))},
		"walls": _arr(d.get("walls")).filter(func(w: Variant) -> bool: return w is Dictionary),
		"fixtures": fixtures,
		"mappings": _arr(d.get("mappings")).size(),
		"mapped": int(d.get("mapped", fixtures.filter(func(f: Dictionary) -> bool: return f.get("mapped") == true).size())),
		"out_of_range": int(d.get("out_of_range", 0)),
		"skipped": _arr(d.get("walls_skipped")).filter(func(w: Variant) -> bool: return w is Dictionary),
		"last_state": str(last.get("state", "")) if last.get("state") != null else "",
		"error": str(d.get("error", "")) if d.get("error") != null else "",
	}


## "pending" (the server proposed it, nothing applied yet), "applied" (the stored mappings already hold it),
## "available" (computable but neither: dismissed earlier, or the mappings were edited since), "none" (no MVR / no
## wall bound to a running channel / no linear pixel fixture / the request failed).
static func state(p: Dictionary) -> String:
	if not p.get("ok", false) or int(p.get("mappings", 0)) == 0:
		return "none"
	if p.get("applied", false):
		return "applied"
	if p.get("pending", false):
		return "pending"
	return "available"


static func _s(n: int) -> String:
	return "" if n == 1 else "s"


## The Pixel map button's proposal line ("" = no proposal: the button keeps its plain tooltip).
static func tooltip_line(p: Dictionary) -> String:
	var n := int(p.get("mapped", 0))
	match state(p):
		"pending":
			return "%d fixture mapping%s proposed (click to review)" % [n, _s(n)]
		"applied":
			return "%d mapping%s applied from the automatic proposal (%d pixels)" % [n, _s(n), int(p.mappings)]
		"available":
			return "%d fixture mapping%s can be proposed%s (Auto proposal… in the Pixel map window)" % [n, _s(n),
				" — dismissed earlier" if p.get("last_state", "") == "dismissed" else ""]
	return ""


static func button_tooltip(base: String, p: Dictionary) -> String:
	var line := tooltip_line(p)
	return base if line == "" else "%s\n\n%s" % [line, base]


## What makes the proposal worth reading again: the project's stored proposal record, its MVR, its mapping count.
static func watch_key(project: Variant) -> String:
	var pr := _dict(project)
	var mvr: Variant = _dict(pr.get("previs")).get("mvr")
	var rec := _dict(pr.get("pixelMappingProposal"))  # pending carries every mapping: its state / sig / at say enough
	return "%s/%s/%s|%s|%d" % [rec.get("state", ""), rec.get("sig", ""), rec.get("at", ""),
		str(mvr.get("id", "?")) if mvr is Dictionary else str(mvr), _arr(pr.get("pixelMappings")).size()]


## The modal's head line.
static func summary(p: Dictionary) -> String:
	var n := int(p.get("mapped", 0))
	var what := "%d fixture%s · %d pixel%s · %d LED wall%s" % [n, _s(n), int(p.get("mappings", 0)),
		_s(int(p.get("mappings", 0))), _arr(p.get("walls")).size(), _s(_arr(p.get("walls")).size())]
	var oor := int(p.get("out_of_range", 0))
	if oor > 0:
		what += " · %d out of range" % oor
	var when := time_label(str(p.get("at", "")))
	match state(p):
		"pending":
			return "Proposed: %s%s — not applied yet" % [what, "" if when == "" else " (computed %s)" % when]
		"applied":
			return "Applied: %s — the saved pixel map already holds this proposal" % what
		"available":
			return "Not applied: %s%s" % [what, " — dismissed earlier" if p.get("last_state", "") == "dismissed" else ""]
	if p.get("error", "") != "":
		return "No proposal: %s" % p.error
	return "No proposal — it needs an MVR with an LED wall bound to a running channel and a linear pixel fixture near it."


## The read-only settings the server used.
static func params_line(p: Dictionary) -> String:
	var q := _dict(p.get("params"))
	return "Inset %d px from the edge · depth %d px · fixtures within %s m · %s colour" % [int(q.get("inset_px", 50)),
		int(q.get("depth_px", 40)), _num(float(q.get("threshold_m", 1.5))), str(q.get("mode", "average"))]


static func _num(v: float) -> String:
	return str(snappedf(v, 0.01)).trim_suffix(".0")


## "2026-10-29T13:29:17.896Z" → "2026-10-29 13:29 UTC".
static func time_label(iso: String) -> String:
	if iso.length() < 16 or iso[10] != "T":
		return iso
	return "%s %s UTC" % [iso.substr(0, 10), iso.substr(11, 5)]


## GET /api/fixtures/pixelmap/pixels → {fixture id: "U18 @ 421"} (sACN: "sACN 5 @ 1").
static func addresses(pixels: Variant) -> Dictionary:
	var out := {}
	for f in _arr(_dict(pixels).get("fixtures")):
		if f is Dictionary and f.get("universe") != null:
			out[str(f.get("id", ""))] = "%s%d @ %d" % ["sACN " if f.get("protocol") == "sacn" else "U", int(f.universe),
				int(f.get("address", 0))]
	return out


## One group per wall in the server's order, then the fixtures not mapped: [{ wall (Dictionary, {} = not mapped),
## title, fixtures }]. Rows are ordered by edge, then name (natural order: "… 99" before "… 1000").
static func groups(p: Dictionary) -> Array:
	var out: Array = []
	var by := {}
	for w in _arr(p.get("walls")):
		var g := {"wall": w, "title": wall_title(w), "fixtures": []}
		by[str(w.get("id", ""))] = g
		out.append(g)
	var rest: Array = []
	for f in _arr(p.get("fixtures")):
		var g: Variant = by.get(str(f.get("wall", ""))) if f.get("mapped") == true else null
		if g is Dictionary:
			(g.fixtures as Array).append(f)
		else:
			rest.append(f)
	for g in out:
		(g.fixtures as Array).sort_custom(_row_before)
	if not rest.is_empty():
		rest.sort_custom(_row_before)
		out.append({"wall": {}, "title": "%s (%d)" % [NOT_MAPPED, rest.size()], "fixtures": rest})
	return out


static func _row_before(a: Dictionary, b: Dictionary) -> bool:
	var ea := str(a.get("edge", ""))
	var eb := str(b.get("edge", ""))
	if ea != eb:
		return ea < eb
	return str(a.get("name", "")).naturalnocasecmp_to(str(b.get("name", ""))) < 0


## "LED wall 1 · channel 1 · 1024 × 1792 px at 0, 0 · 4 × 7 m"
static func wall_title(w: Dictionary) -> String:
	var r := _dict(w.get("rect"))
	var sz := _arr(w.get("size_m"))
	var t := "%s · channel %d · %d × %d px at %d, %d" % [str(w.get("name", w.get("id", "?"))), int(w.get("channelNo", 0)),
		int(r.get("w", 0)), int(r.get("h", 0)), int(r.get("x", 0)), int(r.get("y", 0))]
	if sz.size() >= 2:
		t += " · %s × %s m" % [_num(float(sz[0])), _num(float(sz[1]))]
	var notes := _arr(w.get("notes"))
	if not notes.is_empty():
		t += " · " + "; ".join(notes.map(func(n: Variant) -> String: return str(n)))
	return t


## Row cells: name, universe @ address, edge, distance, pixel spacing, pixels mapped, warning.
static func row_cells(f: Dictionary, addr: Dictionary) -> Array:
	var mapped: bool = f.get("mapped") == true
	var rects := _arr(f.get("rects"))
	var spacing := ""
	if mapped and f.get("spacing_px") != null:
		spacing = "%d px" % int(f.spacing_px)
		if f.get("spacing_m") != null:
			spacing += " (%s m)" % str(snappedf(float(f.spacing_m), 0.001))
	return [
		str(f.get("name", f.get("fixtureId", "?"))),
		str(addr.get(str(f.get("fixtureId", "")), "—")),
		str(f.get("edge", "—")) if f.get("edge") != null else "—",
		("%s m" % str(snappedf(float(f.distance_m), 0.01))) if f.get("distance_m") != null else "—",
		spacing if spacing != "" else "—",
		("%d / %d px" % [rects.size(), int(f.get("pixels", rects.size()))]) if mapped else "0 / %d px" % int(f.get("pixels", 0)),
		str(f.get("warning", "")) if f.get("warning") != null else "",
	]


## A wall's strips in wall-local pixels (rects are in the channel raster; the wall starts at rect.x / rect.y).
static func strips(wall: Dictionary, fixtures: Array) -> Array:
	var r := _dict(wall.get("rect"))
	var origin := Vector2(float(r.get("x", 0)), float(r.get("y", 0)))
	var out: Array = []
	for f in fixtures:
		for q in _arr(f.get("rects")):
			if q is Dictionary:
				out.append(Rect2(Vector2(float(q.get("x", 0)), float(q.get("y", 0))) - origin,
					Vector2(float(q.get("w", 0)), float(q.get("h", 0)))))
	return out


## The wall (w × h px) letterboxed into a box: { scale, offset } (offset centres it).
static func fit(wall_px: Vector2, box: Vector2) -> Dictionary:
	if wall_px.x <= 0 or wall_px.y <= 0 or box.x <= 0 or box.y <= 0:
		return {"scale": 0.0, "offset": Vector2.ZERO}
	var s := minf(box.x / wall_px.x, box.y / wall_px.y)
	return {"scale": s, "offset": (box - wall_px * s) * 0.5}


## The "walls skipped" lines (a wall whose channel is not running / not a screen destination).
static func skipped_lines(p: Dictionary) -> Array:
	return _arr(p.get("skipped")).map(func(w: Dictionary) -> String:
		return "%s skipped: %s" % [str(w.get("name", w.get("id", "?"))), str(w.get("reason", "?"))])


## POST …/accept result → note text and whether it is an error.
static func accept_note(res: Dictionary) -> Dictionary:
	var d := _dict(res.get("data"))
	if res.get("ok", false):
		var kept := int(d.get("kept", 0))
		return {"text": "Accepted: %d pixel mapping%s for %d fixture%s saved%s." % [int(d.get("accepted", 0)),
			_s(int(d.get("accepted", 0))), int(d.get("fixtures", 0)), _s(int(d.get("fixtures", 0))),
			"" if kept == 0 else ", %d other mapping%s kept" % [kept, _s(kept)]], "bad": false}
	var why := str(d.get("error", res.get("error", "?")))
	var errs := _arr(d.get("errors"))
	if not errs.is_empty():
		why += " (%d error%s, first: %s)" % [errs.size(), _s(errs.size()), str(_dict(errs[0]).get("error", errs[0]))]
	return {"text": "Not accepted: %s" % why, "bad": true}


static func dismiss_note(res: Dictionary) -> Dictionary:
	if not res.get("ok", false):
		return {"text": "Not dismissed: %s" % str(res.get("error", "?")), "bad": true}
	return {"text": "Dismissed — it will not be proposed again for this rig." if _dict(res.get("data")).get("dismissed") == true
		else "Nothing pending to dismiss.", "bad": false}
