extends Node
## WO-950 — the operator dock's colour picker (owner 05.11: "add a color picker/probe to available apps so users can
## easily grab a color from existing graphics etc.").
## pick(): every screen is frozen (DisplayServer.screen_get_image), composed at its place into one picture, and shown
## in ONE borderless window over all screens (one window per screen got pointer events only on the focused one — live
## 05.11), with a magnifier and the colour under the cursor; click = pick, Esc / right-click = cancel. The panel then shows the colour in every format (colour_probe_model.gd) with a copy button each, the recent
## picks (kept in user://ui.cfg) and "Pick again". "Average 5×5" reads the mean under the cursor — anti-aliased edges
## and compressed pictures are never one flat pixel. Everything stays in this client: nothing goes to the server.

const M := preload("res://app/colour_probe_model.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const Icons := preload("res://app/ui_icons.gd")
const UI_CFG := "user://ui.cfg"
const PANEL := Vector2i(400, 360)

var panel: Window
var current := Color(0.2, 0.2, 0.2)
var history: Array = []
var average := false
var _overlays: Array[Window] = []
var _embed_was := true
var _swatch: ColorRect
var _fields: Array[LineEdit] = []
var _hist_row: HBoxContainer
var _status: Label


class _Loupe:
	extends Control
	## One frozen screen + the magnifier that follows the cursor.
	const ZOOM := 12
	const GRID := 11
	var img: Image
	var tex: ImageTexture
	var owner_  # the picker (untyped: it reads .average)
	var at := Vector2i(-1, -1)

	func _ready() -> void:
		mouse_filter = Control.MOUSE_FILTER_IGNORE  # input is read in _input, not through GUI focus / hit areas
		mouse_default_cursor_shape = Control.CURSOR_CROSS

	## Every event of the overlay's viewport. Live 05.11: with one window per screen only the FOCUSED one got pointer
	## events (Godot / X11 here), so the overlay is ONE window over every screen (see pick).
	func _input(e: InputEvent) -> void:
		if e is InputEventMouseMotion:
			at = Vector2i(e.position)
			queue_redraw()
		elif e is InputEventMouseButton and e.pressed:
			if e.button_index == MOUSE_BUTTON_LEFT:
				owner_.picked(M.sample(img, Vector2i(e.position), 2 if owner_.average else 0))
			elif e.button_index == MOUSE_BUTTON_RIGHT:
				owner_.cancel()
		elif e is InputEventKey and e.pressed and e.keycode == KEY_ESCAPE:
			owner_.cancel()

	func _draw() -> void:
		draw_texture(tex, Vector2.ZERO)
		var hint := "Click a colour · Esc cancels" + (" · averaging 5×5" if owner_.average else "")
		draw_string(get_theme_default_font(), Vector2(16, 28), hint, HORIZONTAL_ALIGNMENT_LEFT, -1, 16, Color.WHITE)
		if at.x < 0:
			return
		var side := float(GRID * ZOOM)
		var o := Vector2(at) + Vector2(28, 28)  # the loupe beside the cursor, flipped at the screen edges
		if o.x + side > size.x:
			o.x = at.x - 28 - side
		if o.y + side + 40 > size.y:
			o.y = at.y - 28 - side - 40
		draw_rect(Rect2(o - Vector2(3, 3), Vector2(side, side) + Vector2(6, 46)), Color(0.08, 0.08, 0.09))
		var h := GRID / 2
		for gy in GRID:
			for gx in GRID:
				var p := at + Vector2i(gx - h, gy - h)
				var c := img.get_pixelv(p) if p.x >= 0 and p.y >= 0 and p.x < img.get_width() and p.y < img.get_height() else Color.BLACK
				draw_rect(Rect2(o + Vector2(gx, gy) * ZOOM, Vector2(ZOOM, ZOOM)), c)
		draw_rect(Rect2(o + Vector2(h, h) * ZOOM, Vector2(ZOOM, ZOOM)), Color.WHITE, false, 2.0)
		var c0 := M.sample(img, at, 2 if owner_.average else 0)
		draw_rect(Rect2(o + Vector2(0, side + 4), Vector2(36, 36)), c0)
		draw_string(get_theme_default_font(), o + Vector2(44, side + 30), M.hex(c0), HORIZONTAL_ALIGNMENT_LEFT, -1, 18, Color.WHITE)


func _ready() -> void:
	var cfg := ConfigFile.new()
	cfg.load(UI_CFG)
	history = cfg.get_value("colour_picker", "history", [])
	average = cfg.get_value("colour_picker", "average", false) == true
	if not history.is_empty():
		current = Color(str(history[0]))


func is_picking() -> bool:
	return not _overlays.is_empty()


## Freeze every screen and wait for a click (the dock's button).
func pick() -> void:
	if is_picking():
		return
	if panel != null:
		panel.hide()  # out of the frozen picture
	await get_tree().process_frame
	await get_tree().process_frame
	var root := get_tree().root
	_embed_was = root.gui_embed_subwindows
	root.gui_embed_subwindows = false  # native windows, one per screen
	if root.gui_embed_subwindows:
		_show_panel("Close the open dialog first, then pick again")
		return
	var all := Rect2i()
	var shots := []
	for i in DisplayServer.get_screen_count():
		var img := DisplayServer.screen_get_image(i)
		if img == null or img.is_empty():
			continue
		img.convert(Image.FORMAT_RGBA8)
		var r := Rect2i(DisplayServer.screen_get_position(i), img.get_size())
		all = r if shots.is_empty() else all.merge(r)
		shots.append([r, img])
	if not shots.is_empty():
		var canvas := Image.create(all.size.x, all.size.y, false, Image.FORMAT_RGBA8)
		canvas.fill(Color.BLACK)
		for s in shots:
			canvas.blit_rect(s[1], Rect2i(Vector2i.ZERO, s[0].size), s[0].position - all.position)
		_overlays.append(_overlay(all, canvas))
		Input.set_default_cursor_shape(Input.CURSOR_CROSS)
	if _overlays.is_empty():
		root.gui_embed_subwindows = _embed_was
		_show_panel("This display does not let the screen be read")


func _overlay(rect: Rect2i, img: Image) -> Window:
	var w := Window.new()
	w.borderless = true
	w.unresizable = true
	w.always_on_top = true
	w.transient = false
	w.title = "Colour picker"
	w.position = rect.position
	w.size = rect.size
	var l := _Loupe.new()
	l.img = img
	l.tex = ImageTexture.create_from_image(img)
	l.owner_ = self
	l.position = Vector2.ZERO
	l.size = Vector2(w.size)
	w.add_child(l)
	w.close_requested.connect(cancel)
	get_tree().root.add_child(w)
	w.grab_focus()
	return w


func picked(c: Color) -> void:
	current = c
	history = M.remember(history, M.hex(c))
	_save()
	_end_pick()
	_show_panel("Picked %s" % M.hex(c))


func cancel() -> void:
	_end_pick()
	_show_panel("")


func _end_pick() -> void:
	for w in _overlays:
		w.hide()  # hidden before the embed flag goes back — Godot refuses the change while a child window shows
		w.queue_free()
	_overlays.clear()
	Input.set_default_cursor_shape(Input.CURSOR_ARROW)
	get_tree().root.gui_embed_subwindows = _embed_was


func _save() -> void:
	var cfg := ConfigFile.new()
	cfg.load(UI_CFG)
	cfg.set_value("colour_picker", "history", history)
	cfg.set_value("colour_picker", "average", average)
	cfg.save(UI_CFG)


func copy(text: String) -> void:
	DisplayServer.clipboard_set(text)
	if _status != null:
		_status.text = "Copied %s" % text


func _show_panel(status: String) -> void:
	if panel == null:
		_build_panel()
	_swatch.color = current
	var f := M.formats(current)
	for i in mini(f.size(), _fields.size()):
		_fields[i].text = str(f[i][1])
	for c in _hist_row.get_children():
		c.queue_free()
	for hx in history:
		var b := Button.new()
		b.custom_minimum_size = Vector2(28, 28)
		b.tooltip_text = "%s — click to show and copy" % hx
		b.focus_mode = Control.FOCUS_NONE
		var sb := StyleBoxFlat.new()
		sb.bg_color = Color(str(hx))
		for s in ["normal", "hover", "pressed"]:
			b.add_theme_stylebox_override(s, sb)
		var colour := Color(str(hx))
		b.pressed.connect(func() -> void:
			current = colour
			_show_panel("")
			copy(M.hex(colour)))
		_hist_row.add_child(b)
	_status.text = status
	if not panel.visible:
		var scr := DisplayServer.window_get_current_screen(get_tree().root.get_window_id())
		var r := DisplayServer.screen_get_usable_rect(scr)
		panel.position = r.position + Vector2i((r.size.x - PANEL.x) / 2, r.size.y - PANEL.y - 90)
		panel.show()
	panel.grab_focus()


func _build_panel() -> void:
	panel = Window.new()
	panel.visible = false  # a Window shows when added: placed by _show_panel instead of wherever the WM puts it
	panel.title = "Colour picker"
	panel.size = PANEL
	panel.always_on_top = true
	panel.transient = false
	panel.unresizable = true
	var c := get_tree().current_scene as Control
	panel.theme = c.theme if c != null and c.theme != null else ThemeBuilder.build()  # native windows do not inherit it
	panel.close_requested.connect(panel.hide)
	var bg := PanelContainer.new()
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	bg.add_theme_stylebox_override("panel", ThemeBuilder.box(ThemeBuilder.BG_PANEL, ThemeBuilder.BORDER, 1))
	panel.add_child(bg)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 6)
	bg.add_child(v)
	var top := HBoxContainer.new()
	_swatch = ColorRect.new()
	_swatch.custom_minimum_size = Vector2(72, 72)
	top.add_child(_swatch)
	var tools := VBoxContainer.new()
	tools.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var again := Button.new()
	again.text = "  Pick a colour"
	again.icon = Icons.texture("eyedropper", 18)
	again.pressed.connect(pick)
	tools.add_child(again)
	var avg := CheckBox.new()
	avg.text = "Average 5×5 (soft edges, video)"
	avg.button_pressed = average
	avg.toggled.connect(func(on: bool) -> void:
		average = on
		_save())
	tools.add_child(avg)
	top.add_child(tools)
	v.add_child(top)
	for f in M.formats(current):
		var row := HBoxContainer.new()
		var l := Label.new()
		l.text = str(f[0])
		l.custom_minimum_size.x = 64
		l.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
		row.add_child(l)
		var le := LineEdit.new()
		le.editable = false
		le.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		row.add_child(le)
		_fields.append(le)
		var cp := Icons.button("copy", "Copy %s" % f[0])
		cp.pressed.connect(func() -> void: copy(le.text))
		row.add_child(cp)
		v.add_child(row)
	var hl := Label.new()
	hl.text = "Recent"
	hl.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	v.add_child(hl)
	_hist_row = HBoxContainer.new()
	_hist_row.add_theme_constant_override("separation", 4)
	v.add_child(_hist_row)
	_status = Label.new()
	_status.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	v.add_child(_status)
	get_tree().root.add_child(panel)
