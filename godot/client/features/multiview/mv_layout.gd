extends RefCounted
## WO-600 M — multiview layout operations, ported 1:1 from client/lib/multiview-state-layout.js (defaults, API
## layout, legacy route migration), client/lib/multiview-state.js (addCell, setCanvasSize, apply body, preset
## snapshot) and the inline move / resize / drop blocks of client/components/multiview-editor.js (snapping,
## aspect lock, new-cell sizing). Pure: cells are Dictionaries in editor-canvas px; nothing here talks to the server.
## Golden: tests/golden/multiview_editor.json (tools/dev/gen-godot-golden-multiview.mjs).

const G := preload("res://features/multiview/mv_geometry.gd")
const DEFAULT_W := 1920
const DEFAULT_H := 1080
const SNAP_PX := 10.0
const MIN_W := 60.0
const MIN_H := 40.0
const DROP_LIVE_TYPES := ["route", "pgm", "prv", "decklink", "live_audio", "v4l2"]
const LIVE_AUDIO_INPUT_LAYER := 10


## web screenLabel (client/lib/screen-label.js) — custom label or "S<n>" (deck_model's fallback differs).
static func screen_label(cm: Dictionary, idx: int) -> String:
	var labels: Variant = cm.get("screenLabels")
	if labels is Array and idx >= 0 and idx < labels.size() and labels[idx]:
		return str(labels[idx])
	return "S%d" % (idx + 1)


static func _input_for_slot(cm: Dictionary, kind: String, slot: int) -> Variant:
	if slot < 1:
		return null
	for e in G._arr(cm, "inputChannels"):
		if e is Dictionary and e.get("kind") == kind and e.get("slot") != null and float(e.slot) == slot:
			return e
	if kind == "live_audio":
		var la: Variant = G._at(cm.get("liveAudioInputChannels"), slot - 1)
		return null if la == null else {"kind": kind, "slot": slot, "channel": la, "layer": LIVE_AUDIO_INPUT_LAYER, "route": "route://%s" % G._num(la)}
	var dch: Variant = G._at(cm.get("decklinkInputChannels"), slot - 1)
	if dch != null:
		return {"kind": kind, "slot": slot, "channel": dch, "layer": slot, "route": "route://%s-%d" % [G._num(dch), slot]}
	var host: Variant = cm.get("inputsCh")
	var decks: Variant = G.jint(cm.get("decklinkCount", 0))
	if host != null and slot <= maxi(0, decks if decks != null else 0):
		return {"kind": kind, "slot": slot, "channel": host, "layer": slot, "route": "route://%s-%d" % [G._num(host), slot]}
	return null


static func decklink_input_for_slot(cm: Dictionary, slot: int) -> Variant:
	return _input_for_slot(cm, "decklink", slot)


## Default layout: each screen a horizontal band, PGM left half / PRV right half; DeckLink row below when room.
static func default_layout(cm: Dictionary, cw: float = DEFAULT_W, ch: float = DEFAULT_H) -> Array:
	var cells: Array = []
	var pgm := G._arr(cm, "programChannels")
	var prv := G._arr(cm, "previewChannels")
	var sc: Variant = cm.get("screenCount")
	var screens := maxi(1, int(sc) if sc != null else 1)
	var decks := int(cm.get("decklinkCount", 0)) if cm.get("decklinkCount") != null else 0
	var active := mini(screens, maxi(pgm.size(), prv.size()))
	var cell_w := cw / 2.0
	var cell_h := floorf(ch / active) if active > 0 else ch
	for s in active:
		var y := s * cell_h
		var h := ch - y if s == active - 1 else cell_h
		var label := screen_label(cm, s)
		if G._at(pgm, s) != null:
			cells.append({"id": "pgm" if s == 0 else "pgm_%d" % s, "type": "pgm", "label": "PGM %s" % label if active > 1 else "PGM",
				"screenIdx": s, "x": 0, "y": y, "w": cell_w, "h": h})
		if G._at(prv, s) != null:
			cells.append({"id": "prv" if s == 0 else "prv_%d" % s, "type": "prv", "label": "PRV %s" % label if active > 1 else "PRV",
				"screenIdx": s, "x": cell_w, "y": y, "w": cell_w, "h": h})
	if decks > 0:
		var used_h := active * cell_h
		var bottom_h := ch - used_h
		if bottom_h >= 40:
			var dl_w := cw / mini(decks, 4)
			for i in decks:
				var e: Variant = decklink_input_for_slot(cm, i + 1)
				var lbl: String = str(e.label) if e is Dictionary and e.get("label") else "DL %d" % (i + 1)
				var route: Variant = e.get("route") if e is Dictionary else null
				cells.append({"id": "decklink_%d" % i, "type": "decklink", "label": lbl, "x": (i % 4) * dl_w, "y": used_h, "w": dl_w,
					"h": bottom_h / ceilf(decks / 4.0),
					"source": {"value": route, "type": "route", "label": e.get("label")} if route else null})
	return cells


static func _fix(v: float) -> float:
	return G.jround(v * 1000000.0) / 1000000.0


## Editor cells → the normalised 0–1 layout POST /api/multiview/apply expects.
static func cells_to_api_layout(cells: Array, cw: float, ch: float) -> Array:
	cw = cw if cw else 1.0
	ch = ch if ch else 1.0
	var out: Array = []
	for c in cells:
		var src: Variant = c.get("source")
		var label: Variant = c.get("label")
		if src:
			label = src.get("label") if src is Dictionary and src.get("label") else (src.get("value") if src is Dictionary else null)
		var value: Variant = src.get("value") if src is Dictionary else null
		out.append({"id": c.get("id"), "type": c.get("type"), "label": label, "x": _fix(float(c.x) / cw), "y": _fix(float(c.y) / ch),
			"w": _fix(float(c.w) / cw), "h": _fix(float(c.h) / ch), "source": value if value else null, "aspectLocked": c.get("aspectLocked") != false})
	return out


## Full /api/multiview/apply body for multiviewer n from a project.multiview slice (null when it has no cells).
static func apply_body(n: int, mv: Dictionary) -> Variant:
	var cells: Array = mv.get("cells") if mv.get("cells") is Array else []
	if cells.is_empty():
		return null
	return {"n": n, "layout": cells_to_api_layout(cells, float(mv.get("canvasWidth", DEFAULT_W)), float(mv.get("canvasHeight", DEFAULT_H))),
		"showOverlay": mv.get("showOverlay") != false, "bgColor": mv.get("bgColor") if mv.get("bgColor") else "#000000",
		"showTimersUnderLabels": bool(mv.get("showTimersUnderLabels", false)), "timerScale": timer_scale(mv.get("timerScale")),
		"highlightTopTimer": mv.get("highlightTopTimer") != false}


static func timer_scale(v: Variant) -> float:
	var n := float(v) if (v is int or v is float) else (float(v) if v is String and v.is_valid_float() else 0.0)
	return clampf(n if n else 100.0, 50.0, 300.0)


## web migrateLegacyInputRoute — legacy shared-host routes (route://inputsCh-N) → per-slot routes.
static func migrate_legacy_input_route(cm: Dictionary, value: String) -> String:
	var val := value.strip_edges()
	var p: Variant = G.parse_route(val)
	var host: Variant = cm.get("inputsCh")
	if p == null or host == null or float(p.channel) != float(host):
		return val
	if p.layer != null and p.layer >= 1 and p.layer <= 8:
		for kind in ["decklink", "live_audio"]:
			var e: Variant = _input_for_slot(cm, kind, p.layer)
			if e is Dictionary and e.get("route") != null:
				return str(e.route)
	return val


## web migratePreviewRouteSources — old PRV cells used route://N-11; legacy shared-host DeckLink routes.
static func migrate_preview_route_sources(cells: Array, cm: Dictionary) -> Array:
	var out: Array = []
	for c in cells:
		var s: Variant = c.get("source")
		var val: Variant = s.get("value") if s is Dictionary and s.get("value") != null else s
		if not (val is String) or not val.begins_with("route://"):
			out.append(c)
			continue
		var migrated := migrate_legacy_input_route(cm, val)
		var nxt := migrated
		var m := RegEx.create_from_string("^(\\d+)-11$").search(val.trim_prefix("route://"))
		if m and migrated == val:
			nxt = "route://" + m.get_string(1)
		if nxt == val:
			out.append(c)
			continue
		var cc: Dictionary = c.duplicate(true)
		if s is Dictionary:
			cc.source = s.duplicate(true)
			cc.source.value = nxt
		else:
			cc.source = {"value": nxt, "type": "route", "label": c.get("label") if c.get("label") else "Preview"}
		out.append(cc)
	return out


## web MultiviewState.addCell — rounded rect, quarter-canvas default size, live types aspect-locked.
static func add_cell(opts: Dictionary, cw: float, ch: float, now_ms: int = 0) -> Dictionary:
	var t: Variant = opts.get("type")
	var al: Variant = opts.get("aspectLocked")
	return {"id": opts.id if opts.get("id") else "cell_" + _base36(now_ms if now_ms else Time.get_ticks_msec()),
		"type": t if t else "media", "label": opts.label if opts.get("label") else "Cell",
		"x": G.jround(float(opts.get("x", 0)) if opts.get("x") != null else 0.0),
		"y": G.jround(float(opts.get("y", 0)) if opts.get("y") != null else 0.0),
		"w": G.jround(float(opts.w) if opts.get("w") != null else G.jround(cw / 4.0)),
		"h": G.jround(float(opts.h) if opts.get("h") != null else G.jround(ch / 4.0)),
		"source": opts.source if opts.get("source") else null, "aspectLocked": al if al != null else G.LIVE_TYPES.has(t)}


static func _base36(n: int) -> String:
	var digits := "0123456789abcdefghijklmnopqrstuvwxyz"
	var s := ""
	while true:
		s = digits[n % 36] + s
		n /= 36
		if n == 0:
			return s
	return s


## web setCanvasSize — rescales cells in place so the normalised (applied) layout is unchanged. Returns [w, h].
static func rescale(cells: Array, ow: float, oh: float, w: Variant, h: Variant) -> Array:
	var nw := maxf(1.0, floorf(float(w)) if (w is int or w is float) else 0.0)
	var nh := maxf(1.0, floorf(float(h)) if (h is int or h is float) else 0.0)
	if nw == ow and nh == oh:
		return [ow, oh]
	if ow > 0 and oh > 0:
		for c in cells:
			c.x = float(c.x) * nw / ow
			c.y = float(c.y) * nh / oh
			c.w = float(c.w) * nw / ow
			c.h = float(c.h) * nh / oh
	return [nw, nh]


## Topmost cell under (x, y) in canvas px.
static func cell_at(cells: Array, x: float, y: float) -> Variant:
	for i in range(cells.size() - 1, -1, -1):
		var c: Dictionary = cells[i]
		if x >= float(c.x) and x <= float(c.x) + float(c.w) and y >= float(c.y) and y <= float(c.y) + float(c.h):
			return c
	return null


static func _snap(val: float, cands: Array, threshold: float) -> float:
	var best_diff := threshold
	var best := val
	for c in cands:
		var d := absf(val - c)
		if d < best_diff:
			best_diff = d
			best = c
	return best


static func _cands(cells: Array, id: Variant, cw: float, ch: float) -> Array:
	var xs: Array = [0.0, cw]
	var ys: Array = [0.0, ch]
	for o in cells:
		if o.get("id") == id:
			continue
		xs.append_array([float(o.x), float(o.x) + float(o.w)])
		ys.append_array([float(o.y), float(o.y) + float(o.h)])
	return [xs, ys]


static func _snap_axis(raw: float, size: float, cands: Array, th: float) -> float:
	var a := _snap(raw, cands, th)
	var b := _snap(raw + size, cands, th) - size
	if absf(a - raw) <= absf(b - raw):
		return a if absf(a - raw) < th else raw
	return b if absf(b - raw) < th else raw


## Move drag: start rect + pointer delta (canvas px), either edge snaps to canvas edges / other cells (10 view px).
static func drag_move(start: Dictionary, dx: float, dy: float, cells: Array, cw: float, ch: float, scale: float) -> Dictionary:
	var cd := _cands(cells, start.get("id"), cw, ch)
	var th := SNAP_PX / scale
	return {"x": _snap_axis(float(start.x) + dx, float(start.w), cd[0], th), "y": _snap_axis(float(start.y) + dy, float(start.h), cd[1], th)}


## Resize drag on handle n/s/e/w/ne/nw/se/sw: snapping, 60×40 minimum, aspect-lock solver.
static func drag_resize(handle: String, start: Dictionary, dx: float, dy: float, cells: Array, cw: float, ch: float, scale: float,
		cm: Dictionary, timers: bool) -> Dictionary:
	var cd := _cands(cells, start.get("id"), cw, ch)
	var th := SNAP_PX / scale
	var sx := float(start.x)
	var sy := float(start.y)
	var sw := float(start.w)
	var sh := float(start.h)
	var x := sx
	var y := sy
	var w := sw
	var h := sh
	if handle.contains("e"):
		w = maxf(MIN_W, _snap(sx + sw + dx, cd[0], th) - sx)
	if handle.contains("w"):
		w = maxf(MIN_W, sw + (sx - _snap(sx + dx, cd[0], th)))
		x = sx + sw - w
	if handle.contains("s"):
		h = maxf(MIN_H, _snap(sy + sh + dy, cd[1], th) - sy)
	if handle.contains("n"):
		h = maxf(MIN_H, sh + (sy - _snap(sy + dy, cd[1], th)))
		y = sy + sh - h
	if start.get("aspectLocked"):
		var ratio := G.source_ratio(start, cm)
		var ov: Variant = G.overlay_type(start, cm)
		var horiz := handle.contains("e") or handle.contains("w")
		var solved := G.solve_dims(w, h, ratio, "width" if horiz else "height", ov, timers, cw, ch)
		if horiz:
			h = solved.h
		else:
			w = solved.w
		if handle.contains("w"):
			x = sx + sw - w
		if handle.contains("n"):
			y = sy + sh - h
	return {"x": x, "y": y, "w": w, "h": h}


## New cell from a Sources drop at (x, y) canvas px: quarter canvas, live types solved to the source aspect
## (data.resolution "W×H"), centred on the pointer and clamped into the canvas. Null when outside the canvas.
static func drop_cell(data: Dictionary, x: float, y: float, cw: float, ch: float, timers: bool) -> Variant:
	if x < 0 or x > cw or y < 0 or y > ch:
		return null
	var rt: Variant = data.get("routeType") if data.get("routeType") else data.get("type")
	var route_type: String = str(rt) if rt else "media"
	var w := G.jround(cw / 4.0)
	var h := G.jround(ch / 4.0)
	var ratio := 16.0 / 9.0
	var m := RegEx.create_from_string("(?i)(\\d+)[×x](\\d+)").search(str(data.get("resolution", "")) if data.get("resolution") else "")
	if m:
		ratio = float(m.get_string(1)) / float(m.get_string(2))
	if DROP_LIVE_TYPES.has(route_type):
		var s := G.solve_dims(w, w, ratio, "width", route_type, timers, cw, ch)
		w = s.w
		h = s.h
		if h > ch:
			s = G.solve_dims(w, ch, ratio, "height", route_type, timers, cw, ch)
			w = s.w
			h = s.h
	var label: Variant = data.get("label") if data.get("label") else data.get("value")
	return {"type": rt, "label": label, "x": maxf(0.0, minf(cw - w, x - w / 2.0)), "y": maxf(0.0, minf(ch - h, y - h / 2.0)), "w": w, "h": h,
		"source": {"value": data.get("value"), "type": data.get("type") if data.get("type") else "media", "label": label}, "aspectLocked": true}


## web resolveMvCellSourceChannel (WO-271) — a cell's live source channel against the CURRENT map (identity first).
static func mv_cell_source_channel(c: Dictionary, parsed: Variant, cm: Dictionary) -> Variant:
	if not (parsed is Dictionary):
		return null
	var inputs := G._arr(cm, "inputChannels")
	if str(c.get("type", "")) == "decklink":
		var slot: Variant = null
		var idm := RegEx.create_from_string("decklink_(\\d+)").search(str(c.get("id", "")))
		if idm:
			slot = int(idm.get_string(1)) + 1
		if slot == null:
			var lm := RegEx.create_from_string("(?i)decklink\\s*(\\d+)").search(str(c.get("label", "")))
			if lm:
				slot = int(lm.get_string(1))
		if slot == null and parsed.layer != null:
			slot = parsed.layer
		for e in inputs:
			if e is Dictionary and e.get("kind") == "decklink" and slot != null and e.get("slot") != null and float(e.slot) == float(slot):
				if e.get("channel") != null:
					return int(e.channel)
				break
	var label := str(c.get("label", "") if c.get("label") != null else "").strip_edges().to_lower()
	if label != "":
		for e in inputs:
			if e is Dictionary and str(e.get("label", "") if e.get("label") != null else "").strip_edges().to_lower() == label:
				if e.get("channel") != null:
					return int(e.channel)
				break
	var known: Array = []
	for k in ["programChannels", "previewChannels"]:
		known.append_array(G._arr(cm, k))
	for e in inputs:
		if e is Dictionary:
			known.append(e.get("channel"))
	return int(parsed.channel) if G._has_num(known, parsed.channel) else null
