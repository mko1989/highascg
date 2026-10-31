extends VBoxContainer
## WO-838 — Settings → Lockscreen (owner 30.10: "text, logo (changeable), semi-transparent bg (changeable), lock any
## input other than the set key combination, default shift+ctrl+L for both lock and unlock"). A per-machine client
## preference, kept in ui.cfg [lockscreen] like the UI scale (core/lock_model.gd) — not a server setting. Every change
## is stored at once and the overlay (app/lock_overlay.gd, autoload Lockscreen) re-reads it.

const K := preload("res://features/settings/pane_kit.gd")
const LockModel := preload("res://core/lock_model.gd")
const FilePick := preload("res://features/devices/file_pick.gd")
const BounceModel := preload("res://core/bounce_model.gd")

var _prefs := LockModel.defaults()
var _enabled: CheckBox
var _text: LineEdit
var _preview: TextureRect
var _logo_note: Label
var _bg: ColorPickerButton
var _key: Label
var _set: Button
var _key_note: Label
var _style: OptionButton
var _size: HSlider
var _size_l: Label
var _speed: HSlider
var _speed_l: Label


func _ready() -> void:
	add_theme_constant_override("separation", 8)
	K.heading(self, "Lockscreen")
	K.note(self, "Locks this client against stray input: a translucent screen with a logo and a message covers the "
		+ "window and every key, click, wheel turn and touch is swallowed — except the key combination, which locks "
		+ "and unlocks. The mouse pointer is hidden while locked. Kept on this screen only; a restart always starts unlocked.")
	_enabled = CheckBox.new()
	_enabled.text = "Lockscreen enabled"
	_enabled.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	_enabled.toggled.connect(func(on: bool) -> void: _store("enabled", on))
	add_child(_enabled)
	_style = OptionButton.new()
	_style.add_item("Logo and text", 0)
	_style.add_item("Bounce — one character, eyes change on every bounce", 1)
	_style.item_selected.connect(func(i: int) -> void:
		_store("style", LockModel.STYLES[i])
		_refresh_bounce_rows())
	_row("Style", _style)
	_size = _slider(BounceModel.SIZE_MIN, BounceModel.SIZE_MAX, 1, func(v: float) -> void: _store("bounce_size", int(v)))
	_size_l = _row("Bounce size (% of screen height)", _size, true)
	_speed = _slider(BounceModel.SPEED_MIN, BounceModel.SPEED_MAX, 0.05, func(v: float) -> void: _store("bounce_speed", BounceModel.clamp_speed(v)))
	_speed_l = _row("Bounce speed (heights per s)", _speed, true)
	_text = LineEdit.new()
	_text.custom_minimum_size.x = 320
	_text.select_all_on_focus = true  # RULES.md: focus selects the value
	_text.placeholder_text = "(no text)"
	_text.text_submitted.connect(func(_t: String) -> void: _commit_text())
	_text.focus_exited.connect(_commit_text)
	_row("Text", _text)
	_preview = TextureRect.new()
	_preview.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	_preview.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	_preview.custom_minimum_size = Vector2(64, 64)
	var logo_box := HBoxContainer.new()
	logo_box.add_theme_constant_override("separation", 10)
	logo_box.add_child(_preview)
	K.button(logo_box, "Change…", _change_logo)
	K.button(logo_box, "Reset", func() -> void:
		LockModel.clear_logos()
		_store("logo", "")
		_logo_note.text = "Default logo.")
	_row("Logo", logo_box)
	_logo_note = K.note(self, "")
	_bg = ColorPickerButton.new()
	_bg.edit_alpha = true
	_bg.custom_minimum_size = Vector2(120, 28)
	_bg.color_changed.connect(func(c: Color) -> void: _store("bg", c))
	var bg_box := HBoxContainer.new()
	bg_box.add_theme_constant_override("separation", 10)
	bg_box.add_child(_bg)
	K.button(bg_box, "Reset", func() -> void:
		_bg.color = LockModel.DEFAULT_BG
		_store("bg", LockModel.DEFAULT_BG))
	_row("Background colour and opacity", bg_box)
	var key_box := HBoxContainer.new()
	key_box.add_theme_constant_override("separation", 10)
	_key = Label.new()
	_key.custom_minimum_size.x = 140
	key_box.add_child(_key)
	_set = K.button(key_box, "Set…", _begin_capture)
	K.button(key_box, "Default", func() -> void: _store_key(LockModel.parse_chord(LockModel.DEFAULT_KEY)))
	_row("Key combination (lock and unlock)", key_box)
	_key_note = K.note(self, "")
	var r := K.row(self)
	K.button(r, "Lock now", func() -> void: Lockscreen.overlay.lock())
	_refresh()
	visibility_changed.connect(func() -> void:
		if is_visible_in_tree():
			_refresh()
		elif Lockscreen.overlay:
			Lockscreen.overlay.cancel_capture())


## A labelled row; `with_value` adds a trailing value label and returns it.
func _row(label: String, c: Control, with_value := false) -> Label:
	var row := HBoxContainer.new()
	var l := Label.new()
	l.text = label
	l.custom_minimum_size.x = 280
	row.add_child(l)
	row.add_child(c)
	var v: Label = null
	if with_value:
		v = Label.new()
		v.custom_minimum_size.x = 60
		row.add_child(v)
	add_child(row)
	return v


func _slider(lo: float, hi: float, step: float, on_change: Callable) -> HSlider:
	var s := HSlider.new()
	s.min_value = lo
	s.max_value = hi
	s.step = step
	s.custom_minimum_size.x = 240
	s.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	s.value_changed.connect(on_change)
	return s


## Size and speed only matter (and only show their value) in the Bounce style; the logo rows are for the plain one.
func _refresh_bounce_rows() -> void:
	var bounce: bool = _prefs.style == "bounce"
	for c in [_size, _speed]:
		(c as Control).get_parent().modulate.a = 1.0 if bounce else 0.45
	_size_l.text = "%d %%" % int(_size.value)
	_speed_l.text = "× %.2f" % _speed.value


## Show what is stored (LockModel.load_prefs) in every control.
func _refresh() -> void:
	_prefs = LockModel.load_prefs()
	_enabled.set_pressed_no_signal(_prefs.enabled)
	if not _text.has_focus():
		_text.text = _prefs.text
	_bg.color = _prefs.bg
	_style.select(maxi(0, LockModel.STYLES.find(_prefs.style)))
	_size.set_value_no_signal(_prefs.bounce_size)
	_speed.set_value_no_signal(_prefs.bounce_speed)
	_refresh_bounce_rows()
	_key.text = _prefs.key
	_preview.texture = LockModel.fit_texture(LockModel.logo_image(_prefs), 64, 128)
	_logo_note.text = ("Custom logo: " + str(_prefs.logo).get_file()) if str(_prefs.logo) != "" else "Default logo."


func _store(key: String, value: Variant) -> void:
	LockModel.save_pref(key, value)
	_prefs[key] = value
	if _size_l != null:
		_refresh_bounce_rows()
	if Lockscreen.overlay:
		Lockscreen.overlay.reload()


func _commit_text() -> void:
	if _text.text != _prefs.text:
		_store("text", _text.text)


func _change_logo() -> void:
	var path: String = await FilePick.open_path(self, "Lockscreen logo", [LockModel.LOGO_FILTER])
	if path == "":
		return
	var r := LockModel.import_logo(path)
	if not r.ok:
		_logo_note.text = str(r.error)
		return
	_store("logo", r.path)
	_refresh()


func _begin_capture() -> void:
	var o: Node = Lockscreen.overlay
	if o == null:
		return
	if _set.text != "Set…":  # pressed again while recording: cancel
		o.cancel_capture()
		return
	_set.text = "Press the combination…"
	_key_note.text = "Press the new key combination (with Ctrl, Shift, Alt or Meta). Esc alone cancels."
	if not o.capture_note.is_connected(_on_note):
		o.capture_note.connect(_on_note)
		o.capture_finished.connect(_on_captured)
	o.begin_capture()


func _on_note(text: String) -> void:
	_key_note.text = text


func _on_captured(chord: Dictionary) -> void:
	_set.text = "Set…"
	if chord.is_empty():
		return
	_store_key(chord)


func _store_key(chord: Dictionary) -> void:
	var s := LockModel.chord_string(chord)
	_store("key", s)
	_key.text = s
	_key_note.text = "Locks and unlocks with %s." % s
