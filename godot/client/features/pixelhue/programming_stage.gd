extends Control
## WO-1039 — one Programming canvas (a screen's PGM or PVW), a port of Studio's public/program-stage.js: the screen
## inside a 20 % canvas margin, its layers back to front with their names and source names, the selected layer's
## corner handles (a group member: one frame around the pair). Press selects; drag moves, a corner resizes
## (aspect-locked layers proportionally), snapping to screen / layer edges and centres (hold Alt to place freely).
## Right-click or Escape during a drag cancels it. Sources dropped into empty space add a layer at the drop point;
## dropped onto a layer they swap its source (hold Shift to add instead). Arrow keys nudge (Shift = 10 px),
## Delete clears. A locked PGM is select-only. No autoloads: the panel listens to the signals and sends.

signal select_layer(id: int)
## Live position while dragging (only when it changed): the panel queues it to the switcher.
signal preview(layer: Dictionary, window: Dictionary, grouped: bool)
## Release (changed), or a cancelled drag that already streamed: send `window` as the final position.
signal commit(layer: Dictionary, window: Dictionary, grouped: bool)
## A source key dropped: `layer` = the layer under it ({} = empty space / Shift), `point` = screen-local px.
signal dropped(key: String, point: Dictionary, layer: Dictionary)
signal locked_hit()
signal nudge(dx: int, dy: int, step: int)
signal clear_pressed()

const G := preload("res://features/pixelhue/programming_geometry.gd")
const M := preload("res://features/pixelhue/programming_model.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const SNAP_PX := 10.0

var screen: Dictionary = {}
var scene := M.PVW
var layers: Array = []  # the state's own layer dictionaries of this screen + scene (windows edited in place)
var selected_id: Variant = null
var locked := false
var busy := false
var roam := true
var bkg_texture: Texture2D
var _drag: Dictionary = {}
var _drop_hover := false
var _drop_target: Variant = null


func _init() -> void:
	focus_mode = Control.FOCUS_ALL
	mouse_filter = Control.MOUSE_FILTER_STOP
	custom_minimum_size = Vector2(120, 60)
	size_flags_horizontal = Control.SIZE_EXPAND_FILL
	size_flags_vertical = Control.SIZE_EXPAND_FILL
	clip_contents = true


func setup(scr: Dictionary, sc: int, ls: Array, sel: Variant, is_locked: bool, is_roam: bool) -> void:
	screen = scr
	scene = sc
	layers = ls
	selected_id = sel
	locked = is_locked
	roam = is_roam
	queue_redraw()


func dragging() -> bool:
	return not _drag.is_empty()


func view() -> Dictionary:
	return G.view_of(screen, size)


func _layer(id: Variant) -> Dictionary:
	for l in layers:
		if l.get("id") == id:
			return l
	return {}


# ---- input ----

func _gui_input(e: InputEvent) -> void:
	if screen.is_empty():
		return
	if e is InputEventMouseButton:
		var mb := e as InputEventMouseButton
		if mb.button_index == MOUSE_BUTTON_LEFT and mb.pressed:
			press(mb.position)
			accept_event()
		elif mb.button_index == MOUSE_BUTTON_LEFT and not mb.pressed and dragging():
			finish(false)
			accept_event()
		elif mb.button_index == MOUSE_BUTTON_RIGHT and mb.pressed and dragging():
			finish(true)
			accept_event()
	elif e is InputEventMouseMotion and dragging():
		move((e as InputEventMouseMotion).position, (e as InputEventMouseMotion).alt_pressed)
		accept_event()
	elif e is InputEventKey and e.pressed:
		var k := e as InputEventKey
		if k.keycode == KEY_ESCAPE and dragging():
			finish(true)
			accept_event()
			return
		var dirs := {KEY_LEFT: Vector2i(-1, 0), KEY_RIGHT: Vector2i(1, 0), KEY_UP: Vector2i(0, -1), KEY_DOWN: Vector2i(0, 1)}
		if dirs.has(k.keycode) and selected_id != null and not _layer(selected_id).is_empty():
			var d: Vector2i = dirs[k.keycode]
			nudge.emit(d.x, d.y, 10 if k.shift_pressed else 1)
			accept_event()
		elif k.keycode in [KEY_DELETE, KEY_BACKSPACE] and selected_id != null and not _layer(selected_id).is_empty():
			clear_pressed.emit()
			accept_event()


## Press at a control point: select the layer under it and start a move / resize (not on a locked PGM).
func press(p: Vector2) -> void:
	if is_inside_tree():
		grab_focus()
	if busy:
		return
	var h := G.hit(layers, selected_id, p, view())
	if h.is_empty():
		return
	var layer := _layer(h.id)
	selected_id = layer.id
	select_layer.emit(int(layer.id))
	queue_redraw()
	if locked:
		return
	var group := G.group_of(layers, layer)
	var before := G.target_window(layers, layer)
	_drag = {"layer": layer, "group": group, "before": before, "start": p, "handle": str(h.handle), "ratio": G.keep_ratio(layers, layer),
		"share": G.group_share(group) if not group.is_empty() else 0.0, "next": {}, "published": false,
		"originals": [G.copy(group.a.window), G.copy(group.b.window)] if not group.is_empty() else []}


func move(p: Vector2, free := false) -> void:
	if _drag.is_empty():
		return
	var v := view()
	var s: float = v.scale if float(v.scale) > 0.0 else 1.0
	var d := _drag
	var next := G.move_window(d.before, (p.x - d.start.x) / s, (p.y - d.start.y) / s, d.handle, d.ratio)
	if not free:
		next = G.snap_window(next, screen, _others(), SNAP_PX / s, d.handle, d.ratio)
	if not roam:
		next = G.clamp_to_screen(next, screen)
	var prev: Dictionary = d.next if not d.next.is_empty() else d.before
	var changed := not G.same(next, prev)
	_apply(next)
	d.next = next
	if changed:
		d.published = true
		preview.emit(d.layer, next, not d.group.is_empty())
	queue_redraw()


func _others() -> Array:
	var skip: Array = [_drag.layer.id]
	if not _drag.group.is_empty():
		skip = [_drag.group.a.id, _drag.group.b.id]
	var out: Array = []
	for l in layers:
		if not (l.get("id") in skip):
			out.append(l.window)
	return out


func _apply(w: Dictionary) -> void:
	if not _drag.group.is_empty():
		var parts := G.split_window(w, _drag.group.orient, _drag.share)
		_drag.group.a.window = parts[0]
		_drag.group.b.window = parts[1]
	else:
		_drag.layer.window = G.copy(w)


## Release (cancel = false) or cancel: a cancelled drag puts the original back and, when positions already
## streamed to the switcher, sends the original as the final position.
func finish(cancel: bool) -> void:
	if _drag.is_empty():
		return
	var d := _drag
	_drag = {}
	var grouped: bool = not d.group.is_empty()
	var next: Dictionary = d.next if not d.next.is_empty() else d.before
	if cancel:
		if grouped:
			d.group.a.window = d.originals[0]
			d.group.b.window = d.originals[1]
		else:
			d.layer.window = G.copy(d.before)
		if d.published:
			commit.emit(d.layer, d.before, grouped)
		queue_redraw()
		return
	if not G.same(d.before, next):
		commit.emit(d.layer, next, grouped)
	queue_redraw()


func _notification(what: int) -> void:
	if what == NOTIFICATION_DRAG_END or what == NOTIFICATION_MOUSE_EXIT:
		if _drop_hover:
			_drop_hover = false
			_drop_target = null
			queue_redraw()
	elif what == NOTIFICATION_VISIBILITY_CHANGED and not is_visible_in_tree() and dragging():
		finish(true)


# ---- drop from the source list ----

static func drag_key(data: Variant) -> String:
	return str(data.get(M.DRAG_KEY, "")) if data is Dictionary else ""


func _can_drop_data(at: Vector2, data: Variant) -> bool:
	if drag_key(data) == "" or busy or screen.is_empty():
		return false
	_drop_hover = true
	var h := {} if Input.is_key_pressed(KEY_SHIFT) or locked else G.hit(layers, null, at, view())
	_drop_target = h.get("id")
	queue_redraw()
	return true


func _drop_data(at: Vector2, data: Variant) -> void:
	drop_at(at, drag_key(data), Input.is_key_pressed(KEY_SHIFT))


func drop_at(at: Vector2, key: String, add := false) -> void:
	_drop_hover = false
	_drop_target = null
	queue_redraw()
	if key == "" or busy:
		return
	if locked:
		locked_hit.emit()
		return
	var h := {} if add else G.hit(layers, null, at, view())
	dropped.emit(key, G.to_screen(at, view()), _layer(h.id) if not h.is_empty() else {})


# ---- drawing ----

func _draw() -> void:
	draw_rect(Rect2(Vector2.ZERO, size), ThemeBuilder.BG_DARK)
	if screen.is_empty():
		return
	var v := view()
	var c := G.canvas_of(screen)
	draw_rect(G.to_view(G.win(-c.mx, -c.my, c.width, c.height), v), ThemeBuilder.BG_PANEL)
	var frame := G.to_view(G.win(0, 0, screen.width, screen.height), v)
	draw_rect(frame, ThemeBuilder.BG_ELEVATED)
	if bkg_texture != null:
		draw_texture_rect(bkg_texture, frame, false)
	draw_rect(frame, ThemeBuilder.ERROR if locked else ThemeBuilder.BORDER, false, 1.0)
	var font := get_theme_default_font()
	for l in G.by_zorder(layers):
		var r := G.to_view(l.window, v)
		var sel: bool = selected_id != null and l.get("id") == selected_id
		var grouped := not G.parse_group(l.get("name")).is_empty()
		var col := ThemeBuilder.WARN if grouped else ThemeBuilder.ACCENT
		var a := 1.0 if l.get("enabled", true) != false else 0.5
		draw_rect(r, Color(col, 0.22 * a))
		var edge := ThemeBuilder.SUCCESS if _drop_target != null and l.get("id") == _drop_target else (ThemeBuilder.ACCENT_HOVER if sel else Color(col, 0.8 * a))
		draw_rect(r, edge, false, 2.0 if sel or edge == ThemeBuilder.SUCCESS else 1.0)
		if font != null and r.size.y > 14.0 and r.size.x > 24.0:
			var src := str(l.get("sourceName", "")) if str(l.get("sourceName", "")) != "" else "Source %s" % str(l.get("sourceId", ""))
			_text(font, r.position + Vector2(4, 13), str(l.get("name", "")), r.size.x - 8.0, ThemeBuilder.TEXT)
			if r.size.y > 30.0:
				_text(font, r.position + Vector2(4, 27), src, r.size.x - 8.0, ThemeBuilder.TEXT_MUTED)
	var sl := _layer(selected_id)
	if not sl.is_empty():
		var tr := G.to_view(G.target_window(layers, sl), v)
		if not G.group_of(layers, sl).is_empty():
			draw_rect(tr, ThemeBuilder.ACCENT_HOVER, false, 2.0)
		if not locked:
			for h in G.HANDLES:
				var p := G.corner(tr, h)
				draw_rect(Rect2(p - Vector2(G.HANDLE_PX, G.HANDLE_PX) / 2.0, Vector2(G.HANDLE_PX, G.HANDLE_PX)), ThemeBuilder.ACCENT_HOVER)
	if locked and font != null:
		draw_string(font, Vector2(6, size.y - 6), "PGM locked", HORIZONTAL_ALIGNMENT_LEFT, -1, 11, ThemeBuilder.ERROR)
	if _drop_hover:
		draw_rect(Rect2(Vector2.ONE, size - Vector2(2, 2)), ThemeBuilder.SUCCESS, false, 2.0)
	if has_focus():
		draw_rect(Rect2(Vector2.ZERO, size), Color(ThemeBuilder.ACCENT, 0.5), false, 1.0)


func _text(font: Font, at: Vector2, text: String, width: float, col: Color) -> void:
	var t := text
	while t.length() > 1 and font.get_string_size(t, HORIZONTAL_ALIGNMENT_LEFT, -1, 11).x > width:
		t = t.substr(0, t.length() - 2) + "…"
	if font.get_string_size(t, HORIZONTAL_ALIGNMENT_LEFT, -1, 11).x <= width:
		draw_string(font, at, t, HORIZONTAL_ALIGNMENT_LEFT, -1, 11, col)
