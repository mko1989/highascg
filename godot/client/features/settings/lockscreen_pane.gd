extends VBoxContainer
## WO-838 — Settings → Lockscreen (owner 30.10: "text, logo (changeable), semi-transparent bg (changeable), lock any
## input other than the set key combination, default shift+ctrl+L for both lock and unlock"). A per-machine client
## preference, kept in ui.cfg [lockscreen] like the UI scale (core/lock_model.gd) — not a server setting. Every change
## is stored at once and the overlay (app/lock_overlay.gd, autoload Lockscreen) re-reads it.

const K := preload("res://features/settings/pane_kit.gd")
const LockModel := preload("res://core/lock_model.gd")
const FilePick := preload("res://features/devices/file_pick.gd")

var _prefs := LockModel.defaults()
var _enabled: CheckBox
var _text: LineEdit
var _preview: TextureRect
var _logo_note: Label
var _bg: ColorPickerButton
var _key: Label
var _set: Button
var _key_note: Label


func _ready() -> void:
	add_theme_constant_override("separation", 8)
	K.heading(self, "Lockscreen")
	K.note(self, "Locks this client against stray input: a translucent screen with a logo and a message covers the "
		+ "window and every key, click, wheel turn and touch is swallowed — except the key combination, which locks "
		+ "and unlocks. Kept on this screen only; a restart always starts unlocked.")
	_enabled = CheckBox.new()
	_enabled.text = "Lockscreen enabled"
	_enabled.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	_enabled.toggled.connect(func(on: bool) -> void: _store("enabled", on))
	add_child(_enabled)
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


func _row(label: String, c: Control) -> void:
	var row := HBoxContainer.new()
	var l := Label.new()
	l.text = label
	l.custom_minimum_size.x = 280
	row.add_child(l)
	row.add_child(c)
	add_child(row)


## Show what is stored (LockModel.load_prefs) in every control.
func _refresh() -> void:
	_prefs = LockModel.load_prefs()
	_enabled.set_pressed_no_signal(_prefs.enabled)
	if not _text.has_focus():
		_text.text = _prefs.text
	_bg.color = _prefs.bg
	_key.text = _prefs.key
	_preview.texture = LockModel.fit_texture(LockModel.logo_image(_prefs), 64, 128)
	_logo_note.text = ("Custom logo: " + str(_prefs.logo).get_file()) if str(_prefs.logo) != "" else "Default logo."


func _store(key: String, value: Variant) -> void:
	LockModel.save_pref(key, value)
	_prefs[key] = value
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
