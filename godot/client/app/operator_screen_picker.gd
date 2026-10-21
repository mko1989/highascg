extends Node
## WO-599 T4 — the native "Make this the operator screen" picker (replaces the WO-290 python prompt): one small
## window centred on every screen; a click posts that screen's output to POST /api/system/operator-screen (the flag
## + the operator_gui cable) and moves this window there. Esc, Cancel or 60 s with nothing clicked changes nothing.
## The server lets the pointer off the operator monitor while the prompts are up.

const ThemeBuilder := preload("res://app/theme_builder.gd")
const Placement := preload("res://app/window_placement.gd")
const M := preload("res://app/operator_screen_model.gd")

const TIMEOUT_S := 60.0
const PANEL := Vector2i(560, 220)

signal finished(result: Dictionary)  # {ok, name?, screen?, error?}

var _windows: Array[Window] = []
var _timer: Timer
var _embed_was := true


func is_open() -> bool:
	return not _windows.is_empty()


## Show the prompts. Returns false (and emits finished) when it cannot: a dialog is open, or the server failed.
func open() -> bool:
	if is_open():
		return true
	var res: Dictionary = await Api.get_json("/api/system/operator-screen")
	if not res.ok or not res.data is Dictionary:
		finished.emit({"ok": false, "error": "could not list the outputs"})
		return false
	var screens := []
	for i in DisplayServer.get_screen_count():
		screens.append(Rect2i(DisplayServer.screen_get_position(i), DisplayServer.screen_get_size(i)))
	var root := get_tree().root
	_embed_was = root.gui_embed_subwindows
	root.gui_embed_subwindows = false  # native windows, one per screen — refused while an embedded dialog shows
	if root.gui_embed_subwindows:
		finished.emit({"ok": false, "error": "close the open dialog first"})
		return false
	Api.post_json("/api/system/operator-screen", {"prompt": true})  # the pointer confine would keep the click away
	var matched := M.match_outputs(res.data.get("outputs", []), screens)
	for i in screens.size():
		_windows.append(_prompt(i, screens[i], matched[i]))
	_timer = Timer.new()
	_timer.one_shot = true
	_timer.timeout.connect(func() -> void: _close({"ok": false, "error": "timed out"}))
	add_child(_timer)
	_timer.start(TIMEOUT_S)
	return true


func _prompt(i: int, screen: Rect2i, o: Dictionary) -> Window:
	var w := Window.new()
	w.borderless = true
	w.unresizable = true
	w.always_on_top = true
	w.transient = false
	w.title = "Operator screen"
	w.theme = _theme()
	var k := Placement.ui_scale(screen.size)
	w.content_scale_factor = k
	w.size = Vector2i(Vector2(PANEL) * k)
	w.position = screen.position + (screen.size - w.size) / 2
	var bg := PanelContainer.new()
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	bg.add_theme_stylebox_override("panel", ThemeBuilder.box(ThemeBuilder.BG_PANEL, ThemeBuilder.ACCENT, 2))
	w.add_child(bg)
	var col := VBoxContainer.new()
	col.alignment = BoxContainer.ALIGNMENT_CENTER
	col.add_theme_constant_override("separation", 14)
	bg.add_child(col)
	var line := Label.new()
	line.text = M.screen_line(i, o)
	line.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	col.add_child(line)
	var make := Button.new()
	make.text = "Make this the operator screen"
	make.custom_minimum_size = Vector2(360, 56)
	make.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	make.disabled = o.is_empty() or o.get("port") == null
	if make.disabled:
		make.tooltip_text = "This output has no GPU port slot (1–4) the server can flag."
	make.pressed.connect(func() -> void: _pick(i, str(o.get("name", ""))))
	col.add_child(make)
	var cancel := Button.new()
	cancel.text = "Cancel (Esc)"
	cancel.flat = true
	cancel.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	cancel.pressed.connect(func() -> void: _close({"ok": false, "error": "cancelled"}))
	col.add_child(cancel)
	w.window_input.connect(func(e: InputEvent) -> void:
		if e is InputEventKey and e.pressed and e.keycode == KEY_ESCAPE:
			_close({"ok": false, "error": "cancelled"}))
	w.close_requested.connect(func() -> void: _close({"ok": false, "error": "cancelled"}))
	add_child(w)
	w.show()
	return w


func _theme() -> Theme:  # native windows do not inherit main.gd's theme
	var c := get_tree().current_scene as Control
	return c.theme if c != null and c.theme != null else ThemeBuilder.build()


func _pick(i: int, output: String) -> void:
	var res: Dictionary = await Api.post_json("/api/system/operator-screen", {"name": output})
	if not res.ok:
		var err: Variant = res.data.get("error") if res.data is Dictionary else null
		_close({"ok": false, "error": str(err if err != null else "the server refused %s" % output)})
		return
	var main := get_tree().root
	if main.current_screen != i:
		main.current_screen = i
	main.content_scale_factor = Placement.ui_scale(DisplayServer.screen_get_size(i), Placement.saved_scale())
	_close({"ok": true, "name": output, "screen": i})


func _close(result: Dictionary) -> void:
	if not is_open():
		return
	if not result.ok:
		Api.post_json("/api/system/operator-screen", {"prompt": false})  # confine again (a pick does it server-side)
	for w in _windows:
		w.hide()  # hidden before the embed flag goes back — Godot refuses the change while a child window shows
		w.queue_free()
	_windows.clear()
	if _timer != null:
		_timer.queue_free()
		_timer = null
	get_tree().root.gui_embed_subwindows = _embed_was
	finished.emit(result)
