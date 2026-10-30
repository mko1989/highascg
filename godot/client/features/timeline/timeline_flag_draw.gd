extends RefCounted
## WO-602 slice 5 — flags on the canvas (web timeline-canvas-render.js drawFlags / drawFlagTrails): in the ruler a
## stem + triangle in the type colour — a Companion press flag shows the bound button's 28 px thumbnail instead
## (/api/companion/button-preview/P/R/C.jpg, "P/R/C" while it loads or when there is none) — and a dashed trail
## through the tracks; the selected flag is blue and its trail solid. Thumbnails are cached per location and dropped
## when Companion reports that button changed (`companion.buttonPreview`), like the web's mtime buster.

const TM := preload("res://features/timeline/timeline_math.gd")
const F := preload("res://features/timeline/timeline_flags.gd")
const LookThumb := preload("res://features/live/look_thumb.gd")
const SEL := Color("#58a6ff")
const THUMB := 28.0
const RETRY_S := 1.2  # the jpg route subscribes on demand; its first frame can miss the 1.5 s window

static var _thumbs := {}   # "P/R/C" → Texture2D, or null when there is none
static var _pending := {}  # "P/R/C" → true while fetching
static var _redraw: Array = []  # canvases to repaint when a thumbnail lands
static var _wired := false


static func loc_key(c: Vector3i) -> String:
	return "%d/%d/%d" % [c.x, c.y, c.z]


## The Companion button chip (WO-837: in the control lane, as the ruler marker was): the 28 px thumbnail, or "P/R/C".
static func companion_chip(ci: CanvasItem, r: Rect2, f: Dictionary, on: bool, font: Font) -> void:
	var c := F.coords(f)
	var tex: Variant = thumb(c, ci)
	var img := Rect2(r.position + Vector2(1, 0), Vector2(THUMB, THUMB))
	if tex is Texture2D:
		ci.draw_texture_rect(tex, img, false)
	else:
		ci.draw_rect(img, Color("#21262d"))
		ci.draw_string(font, Vector2(img.position.x, img.get_center().y + 3), loc_key(c), HORIZONTAL_ALIGNMENT_CENTER, THUMB, 9, Color("#8b949e"))
	ci.draw_rect(r, SEL if on else F.color("companion_press"), false, 2.0)


## The ruler part — standard flags (pause / play / jump) only, drawn after the ruler background.
static func draw_markers(ci: CanvasItem, tl: Dictionary, x_at: Callable, x_max: float, sel_id: String, font: Font) -> void:
	for f in F.flags(tl):
		if not (f is Dictionary):
			continue
		var x: float = x_at.call(float(f.get("timeMs", 0)))
		if x < TM.HEADER_W - 2 or x > x_max + 2:
			continue
		if F.is_control(f):  # WO-837: companion_press / light are chips in the control lane (timeline_lane_draw.gd)
			continue
		var col := F.color(f.get("type", "pause"))
		var on := str(f.get("id", "")) == sel_id
		ci.draw_line(Vector2(x, 0), Vector2(x, TM.RULER_H - 14), SEL if on else col, 2.0 if on else 1.0)
		var tri := PackedVector2Array([Vector2(x - 6, TM.RULER_H - 2), Vector2(x + 6, TM.RULER_H - 2), Vector2(x, TM.RULER_H - 13)])
		ci.draw_colored_polygon(tri, col)
		if on:
			tri.append(tri[0])
			ci.draw_polyline(tri, SEL, 2.0)


## The trails through the tracks — drawn over the clips.
static func draw_trails(ci: CanvasItem, tl: Dictionary, x_at: Callable, size: Vector2, sel_id: String) -> void:
	for f in F.flags(tl):
		if not (f is Dictionary):
			continue
		var x: float = x_at.call(float(f.get("timeMs", 0)))
		if x < TM.HEADER_W - 2 or x > size.x + 2:
			continue
		x = roundf(x) + 0.5
		if str(f.get("id", "")) == sel_id:
			ci.draw_line(Vector2(x, TM.RULER_H), Vector2(x, size.y), Color(SEL, 0.85 * 0.7), 2.0)
		else:
			ci.draw_dashed_line(Vector2(x, TM.RULER_H), Vector2(x, size.y), Color(F.color(f.get("type", "pause")), 0.45), 1.0, 5.0, true, false)


## The cached thumbnail of a location, or null (fetching starts, `ci` repaints when it lands).
static func thumb(c: Vector3i, ci: CanvasItem = null) -> Variant:
	var k := loc_key(c)
	if _thumbs.has(k):
		return _thumbs[k]
	if ci != null and not ci in _redraw:
		_redraw.append(ci)
	if not _pending.has(k):
		_fetch(k, false)
	return null


static func _fetch(k: String, retried: bool) -> void:
	_wire()
	_pending[k] = true
	var r: Dictionary = await Api.get_bytes("/api/companion/button-preview/%s.jpg?t=%d" % [k, Time.get_ticks_msec()])
	var tex: Texture2D = LookThumb.decode(r.bytes) if r.ok else null
	if tex == null and not retried:
		await Engine.get_main_loop().create_timer(RETRY_S).timeout
		_fetch(k, true)
		return
	_pending.erase(k)
	_thumbs[k] = tex
	_repaint()


static func invalidate(k := "") -> void:
	if k == "":
		_thumbs.clear()
	else:
		_thumbs.erase(k)
	_repaint()


static func _repaint() -> void:
	_redraw = _redraw.filter(func(ci: Variant) -> bool: return is_instance_valid(ci))
	for ci in _redraw:
		(ci as CanvasItem).queue_redraw()


static func _wire() -> void:
	if _wired:
		return
	_wired = true
	Ws.on("companion.buttonPreview", func(d: Variant) -> void:
		if d is Dictionary and d.has("page"):
			var k := loc_key(Vector3i(int(d.page), int(d.get("row", 0)), int(d.get("column", 0))))
			if _thumbs.has(k):
				invalidate(k))
