extends VBoxContainer
## WO-877 — the Visuals page's Show block: the looks (click recalls with the fade; right-click saves the current picture over it,
## renames or deletes; keys 1–9), Save look, the fade time, the master fader and Blackout (B).

signal recall(i: int)
signal save(i: int)  # -1 = a new look
signal rename(i: int, name: String)
signal remove(i: int)
signal fade_changed(seconds: float)
signal level_changed(v: float)
signal blackout_toggled(on: bool)

var _grid: GridContainer
var _fade: HSlider
var _fade_label: Label
var _level: HSlider
var _black: Button
var _menu: PopupMenu
var _menu_for := -1
var _name: LineEdit
var _quiet := false


func _init() -> void:
	add_theme_constant_override("separation", 6)
	_grid = GridContainer.new()
	_grid.columns = 3
	add_child(_grid)
	var save_b := Button.new()
	save_b.text = "Save look"
	save_b.tooltip_text = "Store what is on the canvas (scenes, shader, game, parameters, Flow) as a look — keys 1–9 recall"
	save_b.pressed.connect(func() -> void: save.emit(-1))
	add_child(save_b)
	_menu = PopupMenu.new()
	_menu.add_item("Save the current picture here", 0)
	_menu.add_item("Rename…", 1)
	_menu.add_item("Delete", 2)
	_menu.id_pressed.connect(_on_menu)
	add_child(_menu)
	_name = LineEdit.new()  # inline rename: replaces the grid's button row while typing
	_name.visible = false
	_name.placeholder_text = "Look name — Enter keeps it"
	_name.text_submitted.connect(func(t: String) -> void:
		_name.visible = false
		rename.emit(_menu_for, t))
	_name.focus_exited.connect(func() -> void: _name.visible = false)
	add_child(_name)
	_fade = HSlider.new()
	_fade.max_value = 10.0
	_fade.step = 0.1
	_fade.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_fade.tooltip_text = "How long a look or scene change crossfades (0 = cut)"
	_fade.value_changed.connect(func(v: float) -> void:
		_fade_label.text = "%.1f s" % v
		if not _quiet:
			fade_changed.emit(v))
	_fade_label = Label.new()
	_fade_label.custom_minimum_size.x = 48
	add_child(_row("Fade", [_fade, _fade_label]))
	_level = HSlider.new()
	_level.max_value = 1.0
	_level.step = 0.01
	_level.value = 1.0
	_level.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_level.tooltip_text = "Master: the whole picture's brightness on the canvas and on air"
	_level.value_changed.connect(func(v: float) -> void:
		if not _quiet:
			level_changed.emit(v))
	_black = Button.new()
	_black.text = "Blackout"
	_black.toggle_mode = true
	_black.tooltip_text = "Fade the picture to black and back (key B)"
	_black.toggled.connect(func(on: bool) -> void:
		if not _quiet:
			blackout_toggled.emit(on))
	add_child(_row("Master", [_level, _black]))


## The look buttons: "N name", the one on the canvas pressed. Keys 1–9 match the first nine.
func set_looks(looks: Array, showing: int) -> void:
	for c in _grid.get_children():
		c.queue_free()
	for i in looks.size():
		var b := Button.new()
		b.text = ("%d  " % (i + 1) if i < 9 else "") + str(looks[i].name)
		b.clip_text = true
		b.custom_minimum_size.x = 90
		b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		b.toggle_mode = true
		b.button_pressed = i == showing
		b.tooltip_text = "Recall (key %d) — right-click: save over, rename, delete" % (i + 1) if i < 9 else "Recall — right-click: save over, rename, delete"
		b.focus_mode = Control.FOCUS_NONE  # Space / digits stay show keys, never "press the focused look"
		b.pressed.connect(func() -> void:
			b.set_pressed_no_signal(true)
			recall.emit(i))
		b.gui_input.connect(func(e: InputEvent) -> void:
			var mb := e as InputEventMouseButton
			if mb and mb.pressed and mb.button_index == MOUSE_BUTTON_RIGHT:
				_menu_for = i
				_menu.position = Vector2i(b.get_screen_position() + mb.position)
				_menu.popup())
		_grid.add_child(b)


func set_state(fade: float, level: float, blackout: bool) -> void:
	_quiet = true
	_fade.value = fade
	_fade_label.text = "%.1f s" % fade
	_level.value = level
	_black.button_pressed = blackout
	_quiet = false


func _on_menu(id: int) -> void:
	match id:
		0:
			save.emit(_menu_for)
		1:
			_name.text = ""
			_name.visible = true
			_name.grab_focus()
		2:
			remove.emit(_menu_for)


func _row(label: String, cs: Array) -> HBoxContainer:
	var h := HBoxContainer.new()
	var l := Label.new()
	l.text = label
	l.custom_minimum_size.x = 70
	h.add_child(l)
	for c in cs:
		h.add_child(c)
	return h
