extends "res://features/devices/slice_canvas_src.gd"
## WO-944 — the "Place outputs" canvas: the node's input (the screen destination's live picture, leased like the slice
## editor's input canvas, which this extends) with every output drawn as a frame of its own resolution. Drag a frame
## to move it; it snaps to the canvas edges and to the other outputs (Alt: no snap); arrow keys nudge the selected
## one by 1 px (Shift: 8). A frame may hang off the canvas — that part of the output is black. Free-slice outputs
## (output_place.gd kind "free") are drawn hatched and do not move here. Edits go through slice_flow.gd: no save while
## dragging, one on release.

signal picked(id: String)

const OP := preload("res://features/devices/output_place.gd")

var sel_id := ""
var _pdrag := {}  # {id, start: Vector2 (frame top-left, input px), at: Vector2 (input px)}


func frames() -> Array:
	return OP.frames(flow.slices, flow.outputs, flow.input) if flow != null else []


## The raster to fit: the input plus every frame (so a frame hanging off the canvas is still on screen).
func _extent(fs: Array) -> Vector2:
	var e: Vector2 = flow.input
	for f in fs:
		e = e.max(Vector2(f.x + f.w, f.y + f.h))
	return e


## Frames never start left of / above the canvas (clamp_pos), so the extent's origin is the canvas origin.
## Frozen while a drag runs, so the scale does not change under the mouse as the extent grows.
func _pfit(fs: Array) -> Dictionary:
	return _pdrag.fit if _pdrag.has("fit") else CM.fit(size, _extent(fs))


func _draw() -> void:
	draw_rect(Rect2(Vector2.ZERO, size), Color(0.07, 0.07, 0.08))
	if flow == null:
		return
	var fs := frames()
	var f := _pfit(fs)
	var canvas := Rect2(f.off, flow.input * f.scale)
	var rects := fs.map(func(fr: Dictionary) -> Rect2: return Rect2(f.off + Vector2(fr.x, fr.y) * f.scale, Vector2(fr.w, fr.h) * f.scale))
	for r in rects:
		draw_rect(r, Color.BLACK)  # what an output carries off the canvas: black (the picture covers the rest)
	var tex := _picture()
	if tex != null:
		draw_texture_rect(tex, canvas, false)
	else:
		draw_rect(canvas, Color(0.13, 0.13, 0.15))
	draw_rect(canvas, Color(1, 1, 1, 0.5), false, 1.0)
	var font := get_theme_default_font()
	var dest: String = flow.input_label if flow.input_label != "" else "Input (not cabled to a destination)"
	draw_string(font, canvas.position + Vector2(0, -6), "%s · canvas %d×%d" % [dest, int(flow.input.x), int(flow.input.y)],
		HORIZONTAL_ALIGNMENT_LEFT, -1, 12, ThemeBuilder.TEXT_MUTED)
	for k in fs.size():
		var fr: Dictionary = fs[k]
		var r: Rect2 = rects[k]
		var c := _color(k)
		var on: bool = fr.id == sel_id
		if fr.kind == "free":
			_hatch(r, Color(c, 0.35))
		elif on:
			draw_rect(r, Color(c, 0.10))
		var dash: bool = fr.kind == "unplaced"
		_outline(r, Color(c, 1.0 if on else 0.8), 3.0 if on else 1.5, dash)
		var tag := "%s · %d×%d" % [fr.label, int(fr.w), int(fr.h)]
		tag += {"placed": "", "unplaced": " · not placed (black)", "free": " · free slices"}[fr.kind]
		draw_string(font, r.position + Vector2(6, 16), tag, HORIZONTAL_ALIGNMENT_LEFT, maxf(r.size.x - 12.0, 1.0), 13, Color(c, 1.0))
		if fr.kind != "free":
			draw_string(font, r.position + Vector2(6, 32), "x %d  y %d" % [int(fr.x), int(fr.y)], HORIZONTAL_ALIGNMENT_LEFT,
				maxf(r.size.x - 12.0, 1.0), 12, Color(1, 1, 1, 0.8))


func _outline(r: Rect2, c: Color, w: float, dashed: bool) -> void:
	if not dashed:
		draw_rect(r, c, false, w)
		return
	var pts := [r.position, Vector2(r.end.x, r.position.y), r.end, Vector2(r.position.x, r.end.y), r.position]
	for i in 4:
		draw_dashed_line(pts[i], pts[i + 1], c, w, 8.0)


func _hatch(r: Rect2, c: Color) -> void:
	var step := 12.0
	var t := -r.size.y
	while t < r.size.x:
		var a := r.position + Vector2(maxf(t, 0.0), maxf(-t, 0.0))
		var b := r.position + Vector2(minf(t + r.size.y, r.size.x), minf(r.size.x - t, r.size.y))
		draw_line(a, b, c, 1.0)
		t += step


func _gui_input(event: InputEvent) -> void:
	if flow == null:
		return
	var fs := frames()
	var f := _pfit(fs)
	if event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT:
		accept_event()
		if event.pressed:
			_pick(fs, (event.position - f.off) / f.scale)
		elif not _pdrag.is_empty():
			var moved: bool = _pdrag.get("moved", false)
			_pdrag = {}
			if moved:
				flow.save()
			queue_redraw()
	elif event is InputEventMouseMotion and not _pdrag.is_empty():
		accept_event()
		var p: Vector2 = (event.position - f.off) / f.scale
		var fr: Dictionary = _frame(fs, _pdrag.id)
		var others := fs.filter(func(o: Dictionary) -> bool: return o.id != fr.id)
		var want: Vector2 = _pdrag.start + (p - _pdrag.at)
		var tol: float = OP.SNAP_PX / f.scale if not event.alt_pressed else 0.0
		var at := OP.snapped(want, fr.w, fr.h, flow.input, others, tol)
		if at != Vector2i(fr.x, fr.y):
			place(_pdrag.id, at.x, at.y, false)
			_pdrag.moved = true
	elif event is InputEventKey and event.pressed and sel_id != "":
		var step := 8 if event.shift_pressed else 1
		var d: Vector2i = {KEY_LEFT: Vector2i(-step, 0), KEY_RIGHT: Vector2i(step, 0), KEY_UP: Vector2i(0, -step),
			KEY_DOWN: Vector2i(0, step)}.get(event.keycode, Vector2i.ZERO)
		var fr: Dictionary = _frame(fs, sel_id)
		if d != Vector2i.ZERO and fr.get("kind", "free") != "free":
			accept_event()
			var at := OP.clamp_pos(Vector2(fr.x + d.x, fr.y + d.y), flow.input)
			place(sel_id, at.x, at.y)


func _pick(fs: Array, p: Vector2) -> void:
	grab_focus()
	for k in range(fs.size() - 1, -1, -1):  # topmost (last drawn) first
		var fr: Dictionary = fs[k]
		if Rect2(fr.x, fr.y, fr.w, fr.h).has_point(p):
			select_output(fr.id)
			if fr.kind != "free":
				_pdrag = {"id": fr.id, "start": Vector2(fr.x, fr.y), "at": p, "fit": CM.fit(size, _extent(fs))}
			return
	select_output("")


func select_output(id: String) -> void:
	sel_id = id
	var idx: Array = OP.slices_of(flow.slices, id) if id != "" else []
	flow.select(idx[0] if not idx.is_empty() else -1)  # the Inspector shows the output's slice
	picked.emit(id)
	queue_redraw()


## Put output `id` at (x, y) — the canvas drag, the arrow keys and the editor's X / Y fields all land here.
func place(id: String, x: int, y: int, commit := true) -> void:
	var o: Dictionary = flow.output(id)
	if str(o.id) != id:
		return
	var before: int = flow.slices.size()
	flow.slices = OP.placed(flow.slices, o, x, y)
	var idx := OP.slices_of(flow.slices, id)
	flow.sel = idx[0] if not idx.is_empty() else -1
	flow.changed.emit("list" if flow.slices.size() != before else "geometry")
	if commit:
		flow.save()
	queue_redraw()


func _frame(fs: Array, id: String) -> Dictionary:
	for fr in fs:
		if fr.id == id:
			return fr
	return {}
