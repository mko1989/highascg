extends Control
## WO-807 phase 2 — the pixel map editor's picture (pixel_map_window.gd): one Caspar channel's live surface
## (VideoSurfaces role, held only while `set_on(true)` and shown, like tracking_view.gd) letterboxed into the control,
## with the regions of that channel drawn over it in channel pixels. Drag on empty picture = draw a region; drag a
## region = move it; drag the selected region's corner handle = resize; wheel = zoom at the pointer; right-drag = pan.
## Every edit snaps to whole channel pixels (pixel_map_model.gd). The sizes are shown in channel pixels.

const P := preload("res://features/previs/fixtures/pixel_map_model.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const HANDLE := 7.0  # view px

signal drawn(rect: Rect2i)  # a new region (the window names it)
signal edited(index: int, before: Dictionary)  # regions[index] moved / resized (already written into it)
signal picked(index: int)  # -1 = nothing selected

var raster := Vector2i(1920, 1080)
var channel := 0
var role := ""
var regions: Array = []  # shared with the window (pixel_map_model.gd regions)
var selected := -1
var colours := {}  # region id → Color (the live colour of a pixel mapped to it)
var _held := ""
var _on := false
var _zoom := 1.0
var _pan := Vector2.ZERO
var _drag := ""  # "draw" | "move" | "size" | "pan"
var _from := Vector2.ZERO  # raster point where the drag began
var _press_at := Vector2.ZERO  # view point where it began (WO-843: a click is judged by pointer travel, not rect size)
var _start := Rect2i()
var _rect := Rect2i()  # the rect being drawn


func _ready() -> void:
	clip_contents = true
	focus_mode = Control.FOCUS_CLICK
	visibility_changed.connect(_hold)
	set_process(false)


func set_on(on: bool) -> void:
	_on = on
	_hold()


func set_channel(ch: int, r: String, size_px: Vector2i) -> void:
	channel = ch
	role = r
	raster = size_px if size_px.x > 0 and size_px.y > 0 else Vector2i(1920, 1080)
	_zoom = 1.0
	_pan = Vector2.ZERO
	_hold()
	queue_redraw()


func _hold() -> void:
	var want := role if _on and is_visible_in_tree() else ""
	if want == _held:
		return
	if _held != "":
		VideoSurfaces.release(_held, self)
	_held = want
	if want != "":
		VideoSurfaces.acquire(want, self)
	set_process(want != "")


func _exit_tree() -> void:
	VideoSurfaces.release_all(self)


func _process(_d: float) -> void:
	queue_redraw()  # the surface texture updates in place


func _scale() -> float:
	return minf(size.x / raster.x, size.y / raster.y) * _zoom


func _origin() -> Vector2:
	return (size - Vector2(raster) * _scale()) / 2.0 + _pan


func to_view(p: Vector2) -> Vector2:
	return _origin() + p * _scale()


func to_raster(p: Vector2) -> Vector2:
	return (p - _origin()) / _scale()


func _view_rect(r: Rect2i) -> Rect2:
	return Rect2(to_view(Vector2(r.position)), Vector2(r.size) * _scale())


func _gui_input(e: InputEvent) -> void:
	var mb := e as InputEventMouseButton
	if mb != null:
		if mb.pressed and mb.button_index in [MOUSE_BUTTON_WHEEL_UP, MOUSE_BUTTON_WHEEL_DOWN]:
			var at := to_raster(mb.position)
			_zoom = clampf(_zoom * (1.2 if mb.button_index == MOUSE_BUTTON_WHEEL_UP else 1.0 / 1.2), 1.0, 64.0)
			_pan += mb.position - to_view(at)  # keep the raster point under the pointer
			accept_event()
			queue_redraw()
		elif mb.button_index == MOUSE_BUTTON_RIGHT:
			_drag = "pan" if mb.pressed else ""
			accept_event()
		elif mb.button_index == MOUSE_BUTTON_LEFT:
			if mb.pressed:
				_press(mb.position)
			else:
				_release(mb.position)
			accept_event()
		return
	var mm := e as InputEventMouseMotion
	if mm == null or _drag == "":
		return
	var p := to_raster(mm.position)
	match _drag:
		"pan":
			_pan += mm.relative
		"draw":
			_rect = P.snap_rect(_from, p, raster)
		"move", "size":
			var g: Dictionary = regions[selected]
			var before: Dictionary = g.duplicate()
			var r := P.move_rect(_start, p - _from, raster) if _drag == "move" else P.resize_rect(_start, p, raster)
			g.merge(P.make_region(str(g.id), channel, r), true)
			if g != before:
				edited.emit(selected, before)
	accept_event()
	queue_redraw()


func _press(at: Vector2) -> void:
	grab_focus()
	var p := to_raster(at)
	_from = p
	_press_at = at
	if selected >= 0 and selected < regions.size() and int(regions[selected].channelNo) == channel:
		var r := _view_rect(P.to_rect(regions[selected]))
		if at.distance_to(r.end) <= HANDLE * 1.5:
			_drag = "size"
			_start = P.to_rect(regions[selected])
			return
	var i := P.hit(regions, channel, p)
	if i >= 0:
		select(i)
		_drag = "move"
		_start = P.to_rect(regions[i])
		return
	select(-1)
	_drag = "draw"
	_rect = P.snap_rect(p, p, raster)


func _release(at: Vector2) -> void:
	var was := _drag
	_drag = ""
	if was == "draw" and P.drag_draws(_press_at, at):
		drawn.emit(_rect)  # a click without a drag draws nothing, at any zoom (WO-843)
	queue_redraw()


func select(i: int) -> void:
	if i == selected:
		return
	selected = i
	picked.emit(i)
	queue_redraw()


func _draw() -> void:
	draw_rect(Rect2(Vector2.ZERO, size), ThemeBuilder.BG_DARK)
	var font := get_theme_default_font()
	var img := Rect2(_origin(), Vector2(raster) * _scale())
	var tex: Texture2D = VideoSurfaces.texture(_held) if _held != "" else null
	if tex != null and tex.get_width() > 1:
		draw_texture_rect(tex, img, false)
	else:
		draw_rect(img, ThemeBuilder.BG_ELEVATED)
		draw_string(font, img.position + Vector2(16, 28), "no picture from %s" % (role if role != "" else "—"),
			HORIZONTAL_ALIGNMENT_LEFT, -1, 15, ThemeBuilder.TEXT_MUTED)
	var labels: Array = []  # [view rect, text, colour]; the selected region's first
	for i in regions.size():
		var g: Dictionary = regions[i]
		if int(g.channelNo) != channel:
			continue
		var sel := i == selected
		var vr := _view_rect(P.to_rect(g))
		var c: Variant = colours.get(str(g.id))
		if c is Color:
			draw_rect(Rect2(vr.position, Vector2(minf(vr.size.x, 14.0), minf(vr.size.y, 14.0))), c)
		draw_rect(vr, ThemeBuilder.ACCENT_HOVER if sel else ThemeBuilder.WARN, false, 2.5 if sel else 1.5)
		var l := [vr, "%s  %s" % [g.id, P.size_label(P.to_rect(g))], ThemeBuilder.ACCENT_HOVER if sel else ThemeBuilder.WARN]
		if sel:
			labels.push_front(l)
			draw_rect(Rect2(vr.end - Vector2(HANDLE, HANDLE), Vector2(HANDLE, HANDLE) * 2.0), ThemeBuilder.ACCENT_HOVER)
		else:
			labels.append(l)
	# WO-807: an auto proposal packs hundreds of regions edge to edge — every label drawn made an unreadable smear.
	# A label that would land on one already drawn is skipped (the selected one always wins; the list names them all).
	var taken := {}
	for l in labels:
		_label(font, l[0], l[1], l[2], taken)
	if _drag == "draw":
		var vr := _view_rect(_rect)
		draw_rect(vr, ThemeBuilder.ACCENT, false, 1.5)
		_label(font, vr, P.size_label(_rect), ThemeBuilder.ACCENT)


## `taken` (P.label_cells keys already under a label) makes it skip a label that would overlap one drawn before.
func _label(font: Font, vr: Rect2, text: String, col: Color, taken = null) -> void:
	var at := vr.position + Vector2(vr.size.x + 4.0, 13.0) if vr.size.y < 18.0 else vr.position + Vector2(18.0, 14.0)
	if taken is Dictionary:
		var box := Rect2(at - Vector2(0.0, 12.0), Vector2(font.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, 13).x, 15.0))
		var cells := P.label_cells(box)
		for k in cells:
			if taken.has(k):
				return
		for k in cells:
			taken[k] = true
	draw_string_outline(font, at, text, HORIZONTAL_ALIGNMENT_LEFT, -1, 13, 3, ThemeBuilder.BG_DARK)
	draw_string(font, at, text, HORIZONTAL_ALIGNMENT_LEFT, -1, 13, col)
