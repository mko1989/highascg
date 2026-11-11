extends Control
## WO-1039 — the Screens output-mapping canvas: one tile per mapped output, drag to move with edge snapping (Alt =
## free), scaled to fit. Geometry lives in screens_model.gd; this only draws and turns the mouse into those calls.
## `changed` fires while dragging (tiles moved), `dropped` once on release (the panel grows the window and redraws).

signal changed
signal dropped

const M := preload("res://features/pixelhue/screens_model.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const MARGIN := 6.0

var draft: Dictionary = {}
var names: Dictionary = {}  # output id → name
var _drag := -1
var _before: Dictionary = {}
var _start := Vector2.ZERO
var _hover := -1


func _init() -> void:
	custom_minimum_size = Vector2(320, 260)
	size_flags_horizontal = Control.SIZE_EXPAND_FILL
	size_flags_vertical = Control.SIZE_EXPAND_FILL
	mouse_filter = Control.MOUSE_FILTER_STOP


func set_data(d: Dictionary, output_names: Dictionary) -> void:
	draft = d
	names = output_names
	queue_redraw()


func _avail() -> Vector2:
	return Vector2(maxf(1.0, size.x - 2 * MARGIN), maxf(1.0, size.y - 2 * MARGIN))


func view_scale() -> float:
	if draft.is_empty():
		return 1.0
	return M.fit_scale(int(draft.window.width), int(draft.window.height), _avail())


func _draw() -> void:
	if draft.is_empty():
		return
	var s := view_scale()
	var origin := Vector2(MARGIN, MARGIN)
	var win := Rect2(origin, Vector2(int(draft.window.width), int(draft.window.height)) * s)
	draw_rect(win, Color(0.08, 0.09, 0.11))
	draw_rect(win, ThemeBuilder.TEXT_MUTED, false, 1.0)
	var font := get_theme_default_font()
	var fs := 13
	for i in (draft.outputs as Array).size():
		var o: Dictionary = draft.outputs[i]
		var r := M.tile_view_rect(o.pos, s, origin)
		var hot := i == _drag or i == _hover
		draw_rect(r, Color(0.25, 0.45, 0.75, 0.75 if hot else 0.5))
		draw_rect(r, Color(0.6, 0.8, 1.0) if hot else Color(0.4, 0.6, 0.9), false, 2.0 if hot else 1.0)
		var label := "%s · %d × %d" % [str(names.get(int(o.id), "Output %d" % int(o.id))), int(o.pos.width), int(o.pos.height)]
		draw_string(font, r.position + Vector2(6, 4 + fs), label, HORIZONTAL_ALIGNMENT_LEFT, maxf(0.0, r.size.x - 8), fs, Color(1, 1, 1))


func _others(except: int) -> Array:
	var r: Array = []
	for i in (draft.outputs as Array).size():
		if i != except:
			r.append(draft.outputs[i].pos)
	return r


func _gui_input(event: InputEvent) -> void:
	if draft.is_empty():
		return
	var s := view_scale()
	var origin := Vector2(MARGIN, MARGIN)
	if event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT:
		if event.pressed:
			_drag = M.hit_test(draft.outputs, event.position, s, origin)
			if _drag >= 0:
				_before = (draft.outputs[_drag].pos as Dictionary).duplicate()
				_start = event.position
				accept_event()
		elif _drag >= 0:
			_drag = -1
			accept_event()
			queue_redraw()
			dropped.emit()
	elif event is InputEventMouseMotion:
		if _drag >= 0:
			var delta: Vector2 = (event.position - _start) / s
			draft.outputs[_drag].pos = M.drag_pos(_before, delta, draft.window, _others(_drag), s, event.alt_pressed)
			queue_redraw()
			changed.emit()
		else:
			var h := M.hit_test(draft.outputs, event.position, s, origin)
			if h != _hover:
				_hover = h
				queue_redraw()
