extends Control
## WO-621 N1 — the operator compose windows over the Live preview (web operator-compose-tiles.js chrome): each
## PRV / PGM window gets a role-coloured outline just outside its picture and a label strip below it
## ("PRV 1 / <screen label>", web tileLabelText) — both hug the picture, not a mis-shaped cell. Drag the picture
## or the label to move it; drag the bottom-right corner to resize it, aspect kept (no drawn grip — owner 20.10;
## the resize cursor shows the spot). Rects are the server's operator-GUI cells (GET/POST
## /api/operator-gui/layout, fractions of the operator canvas) — a move re-composes the operator channel, so the
## picture follows the frame. Other clients' moves arrive as the `operatorGuiLayout` broadcast. The
## media-inspector cell is never drawn or touched, and is passed back unchanged so a running media preview
## survives a move.

const TM := preload("res://features/live/compose_tile_math.gd")
const OUTLINE := {"pgm": Color("#e63946"), "prv": Color("#2a9d8f")}
const STRIP := {"pgm": Color("#c92a2a"), "prv": Color("#0d9488")}
const OTHER := Color("#457b9d")
const OTHER_STRIP := Color("#2563eb")
const LABEL_H := 18.0
const GRIP := 14.0

var role := "opgui"
var cells: Array = []  # compose cells (server shape), drawn in order
var _media: Array = []  # the server's media-inspector cell(s), passed through untouched
var _drag := {}  # {i, mode: "move"|"resize", start: Rect2 (canvas px), at: Vector2 (local px)}
var _posting := false
var _pending := false


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_STOP
	Ws.message.connect(_on_ws)
	visibility_changed.connect(func() -> void:
		if is_visible_in_tree():
			refresh())
	resized.connect(queue_redraw)
	Store.changed.connect(func(path: String, _v: Variant) -> void:
		if path == "*" or path.begins_with("channelMap"):
			queue_redraw())
	refresh()


func refresh() -> void:
	var g: Dictionary = await Api.get_json("/api/operator-gui/layout")
	if g.ok and g.data is Dictionary and g.data.get("cells") is Array:
		_take(g.data.cells, true)


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


func _on_ws(type: String, data: Variant) -> void:
	if type == "operatorGuiLayout" and data is Dictionary and data.get("cells") is Array:
		_take(data.cells, false)  # the broadcast is the persistable set (no media cell) — keep ours


func canvas() -> Vector2:
	var t := VideoSurfaces.texture(role)
	return Vector2(t.get_width(), t.get_height()) if t != null and t.get_width() > 0 else Vector2(1920, 1080)


## Where the preview draws the operator canvas (the TextureRect's keep-aspect-centred fit).
func image_rect() -> Rect2:
	var c := canvas()
	var s := minf(size.x / c.x, size.y / c.y)
	var d := c * s
	return Rect2((size - d) / 2.0, d)


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


## The invisible corner hot zone that resizes.
func _grip(r: Rect2) -> Rect2:
	return Rect2(r.end - Vector2(GRIP, GRIP) * 0.5, Vector2(GRIP, GRIP))


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
	for i in cells.size():
		var c: Dictionary = cells[i]
		var r := _screen(i)
		var k := str(c.get("role", ""))
		draw_rect(r.grow(1.0), OUTLINE.get(k, OTHER), false, 2.0)  # 2 px ring whose inner edge is the picture edge
		var strip := Rect2(r.position.x - 2.0, r.end.y + 2.0, r.size.x + 4.0, LABEL_H)
		draw_rect(strip, STRIP.get(k, OTHER_STRIP))
		var line := TextLine.new()
		line.add_string(label_text(c), font, 11)
		line.width = maxf(0.0, strip.size.x - 12.0)
		line.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
		line.draw(get_canvas_item(), strip.position + Vector2(6, (LABEL_H - line.get_size().y) / 2.0), Color.WHITE)


## [index, mode] under a local point: the corner zone first (it overhangs the corner), then picture + label strip.
func _pick(p: Vector2) -> Array:
	for i in range(cells.size() - 1, -1, -1):
		if _grip(_screen(i)).has_point(p):
			return [i, "resize"]
	var rects := []
	for i in cells.size():
		rects.append(_screen(i).grow(2.0))
	var i := TM.hit(rects, p, LABEL_H + 2.0)
	return [i, "move"] if i >= 0 else [-1, ""]


func _has_point(p: Vector2) -> bool:
	return not _drag.is_empty() or _pick(p)[0] >= 0


func _gui_input(e: InputEvent) -> void:
	var mb := e as InputEventMouseButton
	if mb != null and mb.button_index == MOUSE_BUTTON_LEFT:
		if mb.pressed:
			var hit := _pick(mb.position)
			if hit[0] >= 0:
				_drag = {"i": hit[0], "mode": hit[1], "start": _picture(hit[0]), "at": mb.position}
				accept_event()
		elif not _drag.is_empty():
			_drag = {}
			_post()
			accept_event()
		return
	var mm := e as InputEventMouseMotion
	if mm == null:
		return
	if _drag.is_empty():
		var hit := _pick(mm.position)
		mouse_default_cursor_shape = Control.CURSOR_FDIAGSIZE if hit[1] == "resize" else Control.CURSOR_MOVE
		return
	var d: Vector2 = (mm.position - _drag.at) * (canvas().x / image_rect().size.x)
	var start: Rect2 = _drag.start
	var r := TM.moved(start, d, canvas()) if _drag.mode == "move" else TM.resized(start, d, canvas())
	cells[_drag.i].rect = TM.to_frac(r, canvas())
	queue_redraw()
	_post()
	accept_event()


## POST the whole cell set; while one is in flight, the latest state goes out right after it (no queue build-up).
func _post() -> void:
	if _posting:
		_pending = true
		return
	_posting = true
	await Api.post_json("/api/operator-gui/layout", {"cells": cells.duplicate(true) + _media.duplicate(true)})
	_posting = false
	if _pending:
		_pending = false
		_post()
