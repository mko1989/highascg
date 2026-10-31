extends VBoxContainer
## WO-877 — the Visuals page's Show block: the looks (click recalls with the fade; right-click saves the current picture over it,
## renames or deletes; keys 1–9), Save look, the fade time, the master fader and Blackout (B). WO-878: Auto — the next look
## every N bars and/or on a drop — and "on the beat" (a picked look waits for the next beat). WO-879: Tap (T) — the
## operator's tempo when the music's beat cannot be locked — and Audio, the detector's beat again.

const Auto := preload("res://features/visuals/visuals_autopilot.gd")
const Playlist := preload("res://features/visuals/visuals_playlist.gd")

signal recall(i: int)
signal save(i: int)  # -1 = a new look
signal rename(i: int, name: String)
signal remove(i: int)
signal fade_changed(seconds: float)
signal level_changed(v: float)
signal blackout_toggled(on: bool)
signal auto_changed(cfg: Dictionary)
signal tapped(auto: bool)  # false = a tap, true = back to the music's beat

var _grid: GridContainer
var _fade: HSlider
var _fade_label: Label
var _level: HSlider
var _black: Button
var _menu: PopupMenu
var _menu_for := -1
var _name: LineEdit
var _quiet := false
var _auto: OptionButton
var _pl_ids := []  # WO-895: the visual playlists offered after the bar counts in Auto
var _drops: CheckBox
var _quant: CheckBox
var _auto_note: Label
var _tap: Button
var _audio: Button


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
	_auto = OptionButton.new()
	for b in Auto.BARS:
		_auto.add_item("Off" if b == 0 else "Every %d bars" % b)
	_auto.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_auto.tooltip_text = ("Go to the next look by itself every N bars of the music's beat (120 BPM when no tempo is locked)"
		+ " — or run a visual playlist (Visuals ▸ Visual playlist): each entry for its hold")
	_auto.item_selected.connect(func(_i: int) -> void: _emit_auto())
	_drops = CheckBox.new()
	_drops.text = "Drops"
	_drops.tooltip_text = "Also go to the next look on every drop"
	_drops.toggled.connect(func(_on: bool) -> void: _emit_auto())
	add_child(_row("Auto", [_auto, _drops]))
	_quant = CheckBox.new()
	_quant.text = "Picked looks land on the beat"
	_quant.tooltip_text = "A look you pick waits for the next beat (at once while no tempo is locked)"
	_quant.toggled.connect(func(_on: bool) -> void: _emit_auto())
	add_child(_quant)
	_tap = Button.new()
	_tap.text = "Tap"
	_tap.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_tap.tooltip_text = "Tap the beat (key T): two or more taps set the tempo and take over the beat, one more re-phases it"
	_tap.button_down.connect(func() -> void: tapped.emit(false))  # on the press, not the release: the beat is the press
	_audio = Button.new()
	_audio.text = "Audio"
	_audio.toggle_mode = true
	_audio.button_pressed = true
	_audio.tooltip_text = "The beat follows the music (pressed) — click to leave the tapped tempo"
	_audio.pressed.connect(func() -> void:
		_audio.set_pressed_no_signal(true)
		tapped.emit(true))
	add_child(_row("Tempo", [_tap, _audio]))
	_auto_note = Label.new()
	_auto_note.modulate = Color(1, 1, 1, 0.6)
	add_child(_auto_note)
	for c in [save_b, _black, _drops, _quant, _tap, _audio]:  # clicked, they would keep the focus and take Space / B from the show keys
		c.focus_mode = Control.FOCUS_NONE


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
		var drag := func(_at: Vector2) -> Variant:  # WO-895: a look dragged into a visual playlist
			var pv := Label.new()
			pv.text = str(looks[i].name)
			b.set_drag_preview(pv)
			return Playlist.look_drag(looks[i], i)
		b.set_drag_forwarding(drag, Callable(), Callable())
		b.gui_input.connect(func(e: InputEvent) -> void:
			var mb := e as InputEventMouseButton
			if mb and mb.pressed and mb.button_index == MOUSE_BUTTON_RIGHT:
				_menu_for = i
				_menu.position = Vector2i(b.get_screen_position() + mb.position)
				_menu.popup())
		_grid.add_child(b)


func set_state(fade: float, level: float, blackout: bool, auto := {}) -> void:
	_quiet = true
	var a := Auto.cfg_of(auto)
	var pl := _pl_ids.find(a.playlist)
	_auto.select(Auto.BARS.size() + pl if pl >= 0 else Auto.BARS.find(a.bars))
	_drops.disabled = pl >= 0  # a playlist entry's own hold says when it ends
	_drops.button_pressed = a.drops
	_quant.button_pressed = a.quantise
	_fade.value = fade
	_fade_label.text = "%.1f s" % fade
	_level.value = level
	_black.button_pressed = blackout
	_quiet = false


## The line under Auto: the tempo and what comes next.
func set_auto_note(text: String) -> void:
	_auto_note.text = text


## WO-879: is the beat tapped (Audio released) or the music's?
func set_tapped(on: bool) -> void:
	_audio.set_pressed_no_signal(not on)


## WO-895: the visual playlists, offered in Auto after the bar counts ("Visual playlist · name").
func set_playlists(pls: Array) -> void:
	_pl_ids = pls.map(func(p: Dictionary) -> String: return str(p.id))
	while _auto.item_count > Auto.BARS.size():
		_auto.remove_item(_auto.item_count - 1)
	for p in pls:
		_auto.add_item("Visual playlist · %s" % p.name)


func _emit_auto() -> void:
	if not _quiet:
		var s := maxi(0, _auto.selected)
		var pl: String = _pl_ids[s - Auto.BARS.size()] if s >= Auto.BARS.size() else ""
		_drops.disabled = pl != ""
		auto_changed.emit({"bars": Auto.BARS[s] if pl == "" else 0, "drops": _drops.button_pressed,
			"quantise": _quant.button_pressed, "playlist": pl})


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
