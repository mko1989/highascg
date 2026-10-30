extends CanvasLayer
## WO-838 — the lockscreen: a top-most overlay (translucent background, logo, text) and the input gate behind it.
## While locked EVERY input event is swallowed in _input — the first stage Godot runs (before the GUI, shortcuts,
## focus navigation and _unhandled_*) — except the lock/unlock chord, so views, menus and focused text fields never see
## it. This node is kept LAST in the root's children: _input runs in reverse tree order, so it answers before
## Timeline/Devices/Undo `_input` handlers. Embedded dialogs and popups are Windows that get events before the root's
## `_input`: they are hidden on lock (and re-shown on unlock) so they can neither be used nor drawn over the overlay.
## The chord is also polled (Input.is_key_pressed) so it works when such a window had the keyboard focus.
## Not covered: Input.is_key_pressed polling by code (previs fly-through) and extra OS windows (the dock bubble).

const LockModel := preload("res://core/lock_model.gd")

signal state_changed(locked: bool)
signal capture_note(text: String)  # why a recorded chord was refused
signal capture_finished(chord: Dictionary)  # {} = cancelled

const LAYER := 128
const LOGO_H := 200  # px the logo is resampled to (at most LOGO_MAX_W wide)
const LOGO_MAX_W := 600
const SCAN_S := 0.25  # while locked: how often a window opened by an async reply is hidden again

var prefs := LockModel.defaults()
var _locked := false
var _capturing := false
var _poll_down := false
var _scan := 0.0
var _hidden: Array[Window] = []  # dialogs hidden by the lock, shown again on unlock
var _focus: Control = null
var _root: Control
var _bg: ColorRect
var _logo: TextureRect
var _label: Label
var _chord := {}


func _ready() -> void:
	layer = LAYER
	process_mode = Node.PROCESS_MODE_ALWAYS
	_root = Control.new()
	_root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_root.mouse_filter = Control.MOUSE_FILTER_STOP
	_root.mouse_default_cursor_shape = Control.CURSOR_ARROW
	add_child(_root)
	_bg = ColorRect.new()
	_bg.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_root.add_child(_bg)
	var centre := CenterContainer.new()
	centre.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	centre.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_root.add_child(centre)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 24)
	box.mouse_filter = Control.MOUSE_FILTER_IGNORE
	centre.add_child(box)
	_logo = TextureRect.new()
	_logo.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	_logo.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	_logo.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_logo.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	box.add_child(_logo)
	_label = Label.new()
	_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_label.add_theme_font_size_override("font_size", 56)
	_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	box.add_child(_label)
	reload()
	_root.visible = false


func is_locked() -> bool:
	return _locked


## Re-read the stored prefs (Settings → Lockscreen changed one) and redraw.
func reload() -> void:
	prefs = LockModel.load_prefs()
	_chord = LockModel.parse_chord(str(prefs.key))
	if _bg == null:
		return
	_bg.color = prefs.bg
	_label.text = str(prefs.text)
	_label.visible = str(prefs.text) != ""
	_logo.texture = LockModel.fit_texture(LockModel.logo_image(prefs), LOGO_H, LOGO_MAX_W)
	_logo.custom_minimum_size = Vector2(_logo.texture.get_size() / _scale()) if _logo.texture else Vector2.ZERO
	if _locked and not prefs.enabled:
		unlock()


func _scale() -> float:
	return maxf(1.0, get_window().content_scale_factor if get_window() else 1.0)


func lock() -> void:
	if _locked or not prefs.enabled:
		return
	cancel_capture()
	_locked = true
	var vp := get_viewport()
	var f := vp.gui_get_focus_owner()
	_focus = f
	if f:
		f.release_focus()
	vp.gui_cancel_drag()
	_hidden.clear()
	_hide_windows()
	get_parent().move_child(self, -1)  # last child → first _input
	_root.visible = true
	state_changed.emit(true)


func unlock() -> void:
	if not _locked:
		return
	_locked = false
	_root.visible = false
	for w in _hidden:
		if is_instance_valid(w):
			w.show()
	_hidden.clear()
	if is_instance_valid(_focus) and _focus.is_visible_in_tree():
		_focus.grab_focus.call_deferred()
	_focus = null
	state_changed.emit(false)


func toggle() -> void:
	if _locked:
		unlock()
	else:
		lock()


## Settings "Set…": the next key chord is recorded (never reaches the app); Esc alone cancels.
func begin_capture() -> void:
	_capturing = true


func cancel_capture() -> void:
	if _capturing:
		_capturing = false
		capture_finished.emit({})


func _hide_windows() -> void:
	for w: Window in get_tree().root.find_children("*", "Window", true, false):
		if w.visible and w.is_embedded() and not _hidden.has(w):
			w.hide()
			if not (w is Popup):  # menus / pickers are transient; dialogs come back as they were
				_hidden.append(w)


func _input(event: InputEvent) -> void:
	var k := event as InputEventKey
	if _capturing:
		if k:
			_record(k)
			get_viewport().set_input_as_handled()
		return  # the mouse stays live so the Set… button can be pressed again to cancel
	if k and prefs.enabled and LockModel.event_matches(_chord, k):
		if k.pressed and not k.echo:
			_poll_down = true  # _process must not toggle this same stroke again
			toggle()
		get_viewport().set_input_as_handled()  # the chord (and its auto-repeat) is never typed into a field
	elif _locked:
		get_viewport().set_input_as_handled()


func _record(k: InputEventKey) -> void:
	if not k.pressed or k.echo:
		return
	match LockModel.capture_verdict(int(k.keycode), k.ctrl_pressed, k.shift_pressed, k.alt_pressed, k.meta_pressed):
		"wait":
			return
		"cancel":
			_capturing = false
			capture_note.emit("Cancelled.")
			capture_finished.emit({})
		"reject":
			capture_note.emit("Add Ctrl, Shift, Alt or Meta — a bare key would lock the client on every press.")
		"ok":
			_capturing = false
			_poll_down = true  # the keys still held would read as the new chord pressed (→ lock) in _process
			capture_finished.emit(LockModel.chord_from_event(k))


func _process(delta: float) -> void:
	if _chord.is_empty() or not prefs.enabled or _capturing:
		return
	var down: bool = Input.is_key_pressed(int(_chord.keycode)) and Input.is_key_pressed(KEY_CTRL) == _chord.ctrl \
		and Input.is_key_pressed(KEY_SHIFT) == _chord.shift and Input.is_key_pressed(KEY_ALT) == _chord.alt \
		and Input.is_key_pressed(KEY_META) == _chord.meta
	if down and not _poll_down:
		toggle()  # the chord went to an embedded window's focus instead of _input
	_poll_down = down
	if _locked:
		_scan += delta
		if _scan >= SCAN_S:
			_scan = 0.0
			_hide_windows()
