extends Control
## WO-621 N1 — the operator compose windows over the Live preview (web operator-compose-tiles.js chrome): each
## PRV / PGM window gets a role-coloured outline just outside its picture and a label strip below it
## ("PRV 1 / <screen label>", web tileLabelText) — both hug the picture, not a mis-shaped cell. Drag the picture
## or the label to move it; drag any corner to resize it, the opposite corner fixed and the aspect kept (no
## drawn grips — owner 20.10; the resize cursor shows the spot). Rects are the server's operator-GUI cells (GET/POST
## /api/operator-gui/layout, fractions of the operator canvas) — a move re-composes the operator channel, so the
## picture follows the frame. Other clients' moves arrive as the `operatorGuiLayout` broadcast. The
## media-inspector cell is never drawn or touched, and is passed back unchanged so a running media preview
## survives a move.
## WO-624 E1: a Sources "Live" row dropped anywhere on the preview becomes a window (the server checks and sizes it:
## POST /api/operator-gui/cell); the ✕ at the end of a label strip removes that window (/cell/remove).
## WO-597 §D atlas: reports carry `atlas: true`; on an shm surface the server then packs each window into its own slot
## of the operator channel and answers with the slots. Each window crops its slot (a child TextureRect per window) and
## the parent hides the whole-surface picture (atlas_changed) — moves and small resizes then cost no AMCP at all.

signal atlas_changed(on: bool)
signal auto_changed(on: bool)  # WO-658: a manual move / resize / remove turns Auto off

const TM := preload("res://features/live/compose_tile_math.gd")
const CT := preload("res://features/live/compose_times_model.gd")
const P := preload("res://features/live/pgm_timer_model.gd")
const DeckModel := preload("res://features/live/deck_model.gd")
const AL := preload("res://features/live/compose_auto_layout.gd")
const OUTLINE := {"pgm": Color("#e63946"), "prv": Color("#2a9d8f")}
const STRIP := {"pgm": Color("#c92a2a"), "prv": Color("#0d9488")}
const OTHER := Color("#457b9d")
const OTHER_STRIP := Color("#2563eb")
const LABEL_H := 18.0
const GRIP := 14.0
const CLOSE_W := 18.0  # the ✕ hot zone at the right end of a label strip
const MSG_S := 4.0
const TIMES_H := 64.0  # WO-658: Auto leaves this much under a window for the Times rows (big row + bar + two small)
const OUTSIDE := Color("#161b24")  # the preview area beside the canvas — not reachable, so not black like the canvas
const CANVAS_EDGE := Color(1, 1, 1, 0.22)
const DRAG_SLOP_PX := 4.0  # a press that moves less than this is a click, not a move (does not turn Auto off)

var role := "opgui"
var cells: Array = []  # compose cells (server shape), drawn in order
var _media: Array = []  # the server's media-inspector cell(s), passed through untouched
var _drag := {}  # {i, mode: "move"|"resize", corner: Vector2i, start: Rect2 (canvas px), at: Vector2 (local px)}
var _posting := false
var _pending := false
var _msg := ""  # a refused drop / remove, drawn on the preview for MSG_S
var _msg_until := 0
var atlas := {}  # WO-597 §D: {w, h, slots: {cell id: {x, y, w, h} fractions}} while the server packs the windows
var _crops: Array[TextureRect] = []
var _asked_atlas := false
var pan := 0.0  # WO-648: px the overflowing canvas is scrolled (TM.width_fit)
var times := false  # WO-652: per-layer media / playlist times over each window (live_tab's Times toggle)
var osc: Node  # the live tab's OscMirror; its `updated` redraws while `times` is on
var auto := false  # WO-658: PGM / PRV windows tiled per screen into the visible canvas (live_tab's Auto toggle)
var _retile_timer: Timer
var _over: Control  # WO-652: the times paint here, above the atlas crops (children paint over the parent's _draw)


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_STOP
	_over = Control.new()
	_over.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_over.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_over.z_index = 1
	_over.draw.connect(_draw_over)
	add_child(_over)
	_retile_timer = Timer.new()
	_retile_timer.one_shot = true
	_retile_timer.wait_time = 0.25  # a panel drag-resize posts once it settles, not per frame
	_retile_timer.timeout.connect(_retile)
	add_child(_retile_timer)
	Ws.message.connect(_on_ws)
	visibility_changed.connect(func() -> void:
		if is_visible_in_tree():
			refresh())
	resized.connect(func() -> void:
		queue_redraw()
		_retile_soon())
	Store.changed.connect(func(path: String, _v: Variant) -> void:
		if path == "*" or path.begins_with("channelMap"):
			queue_redraw()
			_retile_soon())
	refresh()


func refresh() -> void:
	var g: Dictionary = await Api.get_json("/api/operator-gui/layout")
	if g.ok and g.data is Dictionary and g.data.get("cells") is Array:
		_take(g.data.cells, true)
		_set_atlas(g.data.get("atlas"))
		if atlas.is_empty() and not cells.is_empty() and not _asked_atlas:
			_asked_atlas = true  # once per run: opt the server into atlas mode (a screen surface ignores it)
			_post()


func _take(list: Array, with_media: bool) -> void:
	if not _drag.is_empty() or _posting:
		return  # our own move is in flight — its echo would only rewind the frame
	cells = []
	if with_media:
		_media = []
	for c in list:
		if not (c is Dictionary):
			continue
		if str(c.get("role", "")) == "media":
			if with_media:
				_media.append(c)
		elif c.get("rect") is Dictionary:
			cells.append(c.duplicate(true))
	queue_redraw()
	_retile_soon()


func _on_ws(type: String, data: Variant) -> void:
	if type == "operatorGuiLayout" and data is Dictionary and data.get("cells") is Array:
		_take(data.cells, false)  # the broadcast is the persistable set (no media cell) — keep ours
		_set_atlas(data.get("atlas"))


func _set_atlas(a: Variant) -> void:
	var next := TM.atlas_of(a)
	if next == atlas:
		return
	var was := not atlas.is_empty()
	atlas = next
	if was != not atlas.is_empty():
		atlas_changed.emit(not atlas.is_empty())
	queue_redraw()


## The slot (texture px) window `i` crops in atlas mode; an empty rect when it has none (not packed yet).
func slot_px(i: int) -> Rect2:
	return TM.slot_px(atlas, str(cells[i].get("id", "#%d" % i)), canvas())


## One premultiplied crop per window, laid over its picture (below the outline ring, which sits outside it).
func _layout_crops() -> void:
	var want := cells.size() if not atlas.is_empty() else 0
	while _crops.size() < want:
		var t := TextureRect.new()
		t.mouse_filter = Control.MOUSE_FILTER_IGNORE
		t.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		t.stretch_mode = TextureRect.STRETCH_SCALE
		var m := CanvasItemMaterial.new()
		m.blend_mode = CanvasItemMaterial.BLEND_MODE_PREMULT_ALPHA
		t.material = m
		t.texture = AtlasTexture.new()
		add_child(t)
		_crops.append(t)
	while _crops.size() > want:
		_crops.pop_back().queue_free()
	for i in want:
		var t := _crops[i]
		var region := slot_px(i)
		t.visible = region.size.x > 0
		(t.texture as AtlasTexture).atlas = VideoSurfaces.texture(role)
		(t.texture as AtlasTexture).region = region
		var r := _screen(i)
		t.position = r.position
		t.size = r.size


func canvas() -> Vector2:
	var t := VideoSurfaces.texture(role)
	return Vector2(t.get_width(), t.get_height()) if t != null and t.get_width() > 0 else Vector2(1920, 1080)


## Where the preview draws the operator canvas: the full width, overflowing top / bottom (WO-648; live_tab places
## the picture here too).
func image_rect() -> Rect2:
	return TM.width_fit(size, canvas(), pan)


## WO-648: the mouse wheel scrolls the overflow (a wheel step down shows more of the canvas bottom).
func pan_by(dy: float) -> void:
	var lim := TM.pan_limit(size, canvas())
	pan = clampf(pan + dy, -lim, lim)
	queue_redraw()


## A window's picture in canvas px: the cell rect contain-fitted to the source aspect, like the server draws it
## (a cell saved at another aspect is pillar/letterboxed; the first move or resize stores the fitted rect).
func _picture(i: int) -> Rect2:
	var c: Dictionary = cells[i]
	return TM.fit(TM.to_px(c.rect, canvas()), TM.source_aspect(c, Store.get_value("channelMap", {})))


func _screen(i: int) -> Rect2:
	var ir := image_rect()
	var p := _picture(i)
	var k := ir.size.x / canvas().x
	return Rect2(ir.position + p.position * k, p.size * k)




func label_text(c: Dictionary) -> String:
	var r := str(c.get("role", ""))
	if r in ["pgm", "prv"]:
		var mi := int(c.get("mainIndex", 0))
		var cm: Variant = Store.get_value("channelMap", {})
		var labels: Variant = (cm as Dictionary).get("screenLabels") if cm is Dictionary else null
		var sl := str(labels[mi]) if labels is Array and mi >= 0 and mi < labels.size() and str(labels[mi]) != "" else "S%d" % (mi + 1)
		return "%s %d / %s" % [r.to_upper(), mi + 1, sl]
	return str(c.get("label", c.get("id", r)))


func _draw() -> void:
	var font := get_theme_default_font()
	var ir := image_rect()
	for bar in TM.outside(size, ir):
		draw_rect(bar, OUTSIDE)
	_layout_crops()  # atlas mode: the panel's black shows around the crops (the NO SIGNAL label stays visible)
	draw_rect(ir.grow(0.5), CANVAS_EDGE, false, 1.0)  # the canvas edge: windows move and resize up to it
	for i in cells.size():
		var c: Dictionary = cells[i]
		var r := _screen(i)
		var k := str(c.get("role", ""))
		draw_rect(r.grow(1.0), OUTLINE.get(k, OTHER), false, 2.0)  # 2 px ring whose inner edge is the picture edge
		var strip := Rect2(r.position.x - 2.0, r.end.y + 2.0, r.size.x + 4.0, LABEL_H)
		draw_rect(strip, STRIP.get(k, OTHER_STRIP))
		var line := TextLine.new()
		line.add_string(label_text(c), font, 11)
		line.width = maxf(0.0, strip.size.x - 12.0 - CLOSE_W)
		line.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
		line.draw(get_canvas_item(), strip.position + Vector2(6, (LABEL_H - line.get_size().y) / 2.0), Color.WHITE)
		var x := TextLine.new()
		x.add_string("✕", font, 11)
		var xr := _close_rect(r)
		x.draw(get_canvas_item(), xr.position + (xr.size - x.get_size()) / 2.0, Color(1, 1, 1, 0.85))
	_over.queue_redraw()
	if _msg != "" and Time.get_ticks_msec() < _msg_until:
		var m := TextLine.new()
		m.add_string(_msg, font, 13)
		m.width = ir.size.x - 16.0
		m.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
		var at := Vector2(ir.position.x + 8.0, minf(ir.end.y, size.y) - m.get_size().y - 10.0)
		draw_rect(Rect2(at - Vector2(6, 4), m.get_size() + Vector2(12, 8)), Color(0, 0, 0, 0.75))
		m.draw(get_canvas_item(), at, Color("#fbbf24"))


## WO-652: text on the transparent preview under the label strip (owner 21.10: "under the label not on the screen"),
## outlined to stay readable; the top running layer big.
func _draw_over() -> void:
	if not times:
		return
	for i in cells.size():
		if str(cells[i].get("role", "")) in ["pgm", "prv"]:
			_draw_times(_screen(i), cells[i], get_theme_default_font())


func _draw_times(r: Rect2, c: Dictionary, font: Font) -> void:
	var ci := _over.get_canvas_item()
	var y := r.end.y + 2.0 + LABEL_H + 3.0
	for row in _time_rows(c):
		var big: bool = row.top
		var line := TextLine.new()
		var t := CT.time_text(row)
		line.add_string(row.label + ("   " + t if t != "" else ""), font, 20 if big else 12)
		line.width = maxf(0.0, r.size.x)
		line.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
		if y + line.get_size().y > size.y:
			return
		var col: Color = P.COLORS[P.tier(CT.remaining(row))].fill if row.running else Color(1, 1, 1, 0.8)
		var at := Vector2(r.position.x, y)
		line.draw_outline(ci, at, 4 if big else 3, Color(0, 0, 0, 0.85))
		line.draw(ci, at, col)
		y += line.get_size().y + 1.0
		if row.running:
			_over.draw_rect(Rect2(at.x, y, r.size.x * CT.progress(row), 3.0 if big else 2.0), col)
			y += 4.0


## The look on this window's bus and its OSC channel (PGM: the bank-resolved channel; PRV: bank-less).
func _time_rows(c: Dictionary) -> Array:
	var mi := int(c.get("mainIndex", 0))
	var pgm := str(c.get("role", "")) == "pgm"
	var cm: Dictionary = Store.get_value("channelMap", {}) if Store.get_value("channelMap") is Dictionary else {}
	var live: Dictionary = Store.get_value("scene.live", {}) if Store.get_value("scene.live") is Dictionary else {}
	var ps: Dictionary = Store.project.get("scenes", {}) if Store.project.get("scenes") is Dictionary else {}
	var looks := {}
	for s in ps.get("scenes", []):
		if s is Dictionary:
			looks[str(s.get("id", ""))] = s
	var id := str(DeckModel.resolve_bus_look_ids(mi, live, cm, looks, ps).get("pgm" if pgm else "prv", ""))
	var ch: Variant
	var bank: Variant = null
	if pgm:
		var res := P.resolve_pgm(cm, Store.get_value("scene"), mi)
		ch = res.channel
		bank = res.bank
	else:
		var prv: Array = cm.get("previewChannels", []) if cm.get("previewChannels") is Array else []
		ch = prv[mi] if mi < prv.size() else null
		var staged := DeckModel._live_scene_id(live, int(ch)) if ch != null else ""
		if looks.has(staged):
			id = staged  # the deck blanks a PRV that holds the PGM look; its times still show
	if not looks.has(id) or osc == null:
		return []
	return CT.rows(looks[id], osc.channels.get(str(ch)), bank, pgm, Time.get_unix_time_from_system() * 1000.0)


## WO-658 Auto: one PGM (top) + PRV (bottom) window per screen, tiled into what the panel shows of the canvas.
func set_auto(on: bool) -> void:
	auto = on
	_retile()


func _retile_soon() -> void:
	if auto and _retile_timer != null:
		_retile_timer.start()


func _retile() -> void:
	var ir := image_rect()
	if not auto or not _drag.is_empty() or not is_visible_in_tree() or ir.size.x <= 0.0:
		return
	var cm: Dictionary = Store.get_value("channelMap", {}) if Store.get_value("channelMap") is Dictionary else {}
	var res: Array = cm.get("programResolutions", []) if cm.get("programResolutions") is Array else []
	var mains := []
	for mi in DeckModel.screen_count(cm):
		var r: Dictionary = res[mi] if mi < res.size() and res[mi] is Dictionary else {}
		var ar := float(r.get("w", 16)) / maxf(1.0, float(r.get("h", 9)))
		mains.append({"main": mi, "prv": DeckModel.preview_bus_available(cm, mi), "aspect": ar})
	var k := canvas().x / ir.size.x
	if AL.apply(cells, AL.tile(mains, AL.visible_view(size, ir, canvas()), canvas(), (LABEL_H + 6.0 + (TIMES_H if times else 0.0)) * k)):
		queue_redraw()
		_post()


func _manual() -> void:
	if auto:
		auto = false
		auto_changed.emit(false)


## A wheel step over the preview → pan; also called for wheels that miss the windows (live_tab's stack).
func wheel(mb: InputEventMouseButton) -> bool:
	if mb == null or not mb.pressed or not mb.button_index in [MOUSE_BUTTON_WHEEL_UP, MOUSE_BUTTON_WHEEL_DOWN]:
		return false
	pan_by(-40.0 if mb.button_index == MOUSE_BUTTON_WHEEL_DOWN else 40.0)
	_retile_soon()
	return true


func _close_rect(picture: Rect2) -> Rect2:
	return TM.close_rect(picture, LABEL_H, CLOSE_W)


func _flash(text: String) -> void:
	_msg = text
	_msg_until = Time.get_ticks_msec() + int(MSG_S * 1000)
	queue_redraw()
	get_tree().create_timer(MSG_S + 0.05).timeout.connect(queue_redraw)


## [index, mode, corner] under a local point: the corner zones first (they overhang the corners), then picture +
## label strip.
func _pick(p: Vector2) -> Array:
	for i in range(cells.size() - 1, -1, -1):
		if _close_rect(_screen(i)).has_point(p):
			return [i, "remove", Vector2i.ZERO]
	for i in range(cells.size() - 1, -1, -1):
		var c := TM.corner_at(_screen(i), p, GRIP)
		if c != Vector2i.ZERO:
			return [i, "resize", c]
	var rects := []
	for i in cells.size():
		rects.append(_screen(i).grow(2.0))
	var i := TM.hit(rects, p, LABEL_H + 2.0)
	return [i, "move", Vector2i.ZERO] if i >= 0 else [-1, "", Vector2i.ZERO]


func _has_point(p: Vector2) -> bool:
	if get_viewport() != null and get_viewport().gui_is_dragging():
		return TM.droppable(get_viewport().gui_get_drag_data())  # a Live source can land anywhere on the canvas
	return not _drag.is_empty() or _pick(p)[0] >= 0


func _can_drop_data(_at: Vector2, data: Variant) -> bool:
	return TM.droppable(data)


func _drop_data(at: Vector2, data: Variant) -> void:
	var ir := image_rect()
	var f := ((at - ir.position) / ir.size).clamp(Vector2.ZERO, Vector2.ONE)
	var item := {}
	for k in ["type", "value", "label", "resolution"]:
		if (data as Dictionary).has(k):
			item[k] = data[k]
	var res: Dictionary = await Api.post_json("/api/operator-gui/cell", {"item": item, "at": {"x": f.x, "y": f.y}})
	if not res.ok:
		_flash(str(res.get("error", res.get("status"))))


func _gui_input(e: InputEvent) -> void:
	var mb := e as InputEventMouseButton
	if wheel(mb):
		accept_event()
		return
	if mb != null and mb.button_index == MOUSE_BUTTON_LEFT:
		if mb.pressed:
			var hit := _pick(mb.position)
			if hit[1] == "remove":
				accept_event()
				_manual()
				_remove(str(cells[hit[0]].get("id", "")))
				return
			if hit[0] >= 0:
				_drag = {"i": hit[0], "mode": hit[1], "corner": hit[2], "start": _picture(hit[0]), "at": mb.position}
				accept_event()
		elif not _drag.is_empty():
			var moved: bool = _drag.get("moved", false)
			_drag = {}
			if moved:  # a plain click (select, focus) must not silently turn Auto off — owner 22.10
				_manual()
				_post()
			accept_event()
		return
	var mm := e as InputEventMouseMotion
	if mm == null:
		return
	if _drag.is_empty():
		var hit := _pick(mm.position)
		var c: Vector2i = hit[2]
		mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND if hit[1] == "remove" else Control.CURSOR_MOVE if c == Vector2i.ZERO else \
			(Control.CURSOR_FDIAGSIZE if c.x == c.y else Control.CURSOR_BDIAGSIZE)  # ↘↖ vs ↗↙
		return
	if not _drag.get("moved", false) and mm.position.distance_to(_drag.at) < DRAG_SLOP_PX:
		return
	_drag.moved = true
	var d: Vector2 = (mm.position - _drag.at) * (canvas().x / image_rect().size.x)
	var start: Rect2 = _drag.start
	var r := TM.moved(start, d, canvas()) if _drag.mode == "move" else TM.resized(start, d, canvas(), _drag.corner)
	cells[_drag.i].rect = TM.to_frac(r, canvas())
	queue_redraw()
	_post()
	accept_event()


func _remove(id: String) -> void:
	var res: Dictionary = await Api.post_json("/api/operator-gui/cell/remove", {"id": id})
	if not res.ok:
		_flash(str(res.get("error", res.get("status"))))


## POST the whole cell set; while one is in flight, the latest state goes out right after it (no queue build-up).
func _post() -> void:
	if _posting:
		_pending = true
		return
	_posting = true
	var res: Dictionary = await Api.post_json("/api/operator-gui/layout", {"cells": cells.duplicate(true) + _media.duplicate(true), "atlas": true})
	_posting = false
	if res.ok and res.data is Dictionary and res.data.has("atlas"):
		_set_atlas(res.data.atlas)
	if _pending:
		_pending = false
		_post()
