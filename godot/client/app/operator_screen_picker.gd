extends Node
## WO-599 T4 — the native "Make this the operator screen" picker (replaces the WO-290 python prompt): one small
## window centred on every screen; a click posts that screen's output to POST /api/system/operator-screen (the flag
## + the operator_gui cable) and moves this window there. Esc, Cancel or 60 s with nothing clicked changes nothing.
## The server lets the pointer off the operator monitor while the prompts are up.
## WO-638 boot mode (open_boot): asked once per machine boot while Caspar is held — the stacked screens are laid out
## first, every prompt counts down from 120 s and names the default; Esc / timeout settle on the default, and the
## answer also moves the destination cables onto the other screens (server: boot-screen-assignment.js).

const ThemeBuilder := preload("res://app/theme_builder.gd")
const Placement := preload("res://app/window_placement.gd")
const M := preload("res://app/operator_screen_model.gd")

const TIMEOUT_S := 60.0
const PANEL := Vector2i(560, 220)

signal finished(result: Dictionary)  # {ok, name?, screen?, error?}

var _windows: Array[Window] = []
var _timer: Timer
var _embed_was := true
var _boot := {}  # WO-638: non-empty in boot mode ({timeoutS, defaultName})
var _counts: Array[Label] = []
var _busy := false  # a pick is on its way — a second click / the timer must not post again


func is_open() -> bool:
	return not _windows.is_empty()


## WO-638: the once-per-boot question. Lays the stacked screens out first, then opens the prompts in boot mode.
func open_boot(boot: Dictionary) -> bool:
	if is_open():
		return true
	_boot = boot.duplicate()
	var prep: Dictionary = await Api.post_json("/api/system/operator-screen", {"boot": "prepare"})
	if prep.ok and prep.data is Dictionary and prep.data.get("spread", false):
		await get_tree().create_timer(1.0).timeout  # let the RandR change reach DisplayServer
	return await open()


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
	_outputs = res.data.get("outputs", [])
	var matched := M.match_outputs(_outputs, screens)
	for i in screens.size():
		_windows.append(_prompt(i, screens[i], matched[i]))
	_timer = Timer.new()
	_timer.one_shot = true
	if _boot.is_empty():
		_timer.timeout.connect(func() -> void: _close({"ok": false, "error": "timed out"}))
		add_child(_timer)
		_timer.start(TIMEOUT_S)
	else:
		_timer.timeout.connect(func() -> void: _pick(-1, "", "timeout"))
		add_child(_timer)
		_timer.start(float(_boot.get("timeoutS", 120)))
	return true


func _process(_d: float) -> void:
	if _boot.is_empty() or _timer == null or _counts.is_empty():
		return
	var line := M.boot_countdown(int(ceil(_timer.time_left)), str(_boot.get("defaultName", "")))
	for l in _counts:
		l.text = line


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
	if not _boot.is_empty():
		var count := Label.new()
		count.text = M.boot_countdown(int(_boot.get("timeoutS", 120)), str(_boot.get("defaultName", "")))
		count.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		count.modulate = Color(1, 1, 1, 0.7)
		col.add_child(count)
		_counts.append(count)
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
	cancel.text = "Cancel (Esc)" if _boot.is_empty() else "Use %s now (Esc)" % str(_boot.get("defaultName", "the default"))
	cancel.flat = true
	cancel.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	cancel.pressed.connect(_dismiss)
	col.add_child(cancel)
	w.window_input.connect(func(e: InputEvent) -> void:
		if e is InputEventKey and e.pressed and e.keycode == KEY_ESCAPE:
			_dismiss())
	w.close_requested.connect(_dismiss)
	add_child(w)
	w.show()
	return w


func _theme() -> Theme:  # native windows do not inherit main.gd's theme
	var c := get_tree().current_scene as Control
	return c.theme if c != null and c.theme != null else ThemeBuilder.build()


## Esc / Cancel: a plain prompt changes nothing; the boot question settles on the default at once.
func _dismiss() -> void:
	if _boot.is_empty():
		_close({"ok": false, "error": "cancelled"})
	else:
		_pick(-1, "", "now")


## i = -1 / output "" (boot mode only): the default — the server picks it and names the output; `how` says why.
func _pick(i: int, output: String, how := "") -> void:
	if _busy:
		return
	_busy = true
	var res: Dictionary
	if _boot.is_empty():
		res = await Api.post_json("/api/system/operator-screen", {"name": output})
	else:
		var b := {"boot": "resolve", "how": how}
		if output != "":
			b["name"] = output
		_timer.paused = true
		res = await Api.post_json("/api/system/operator-screen", b)
		if res.ok and res.data is Dictionary:
			# The server re-laid X out before answering: screen indices may have moved — find the output by name.
			output = str(res.data.get("name", output))
			await get_tree().create_timer(1.0).timeout
			var fresh: Dictionary = await Api.get_json("/api/system/operator-screen")
			if fresh.ok and fresh.data is Dictionary:
				_outputs = fresh.data.get("outputs", _outputs)
			i = _screen_of(output)
	if not res.ok:
		var err: Variant = res.data.get("error") if res.data is Dictionary else null
		_close({"ok": false, "error": str(err if err != null else "the server refused %s" % output)})
		return
	var main := get_tree().root
	if i >= 0 and main.current_screen != i:
		main.current_screen = i
	if i >= 0:
		main.content_scale_factor = Placement.ui_scale(DisplayServer.screen_get_size(i), Placement.saved_scale())
	_close({"ok": true, "name": output, "screen": i})


var _outputs := []  # the last GET's outputs (boot mode: the operator screen is looked up by output name)


func _screen_of(output: String) -> int:
	var screens := []
	for k in DisplayServer.get_screen_count():
		screens.append(Rect2i(DisplayServer.screen_get_position(k), DisplayServer.screen_get_size(k)))
	var matched := M.match_outputs(_outputs, screens)
	for k in matched.size():
		if str((matched[k] as Dictionary).get("name", "")) == output:
			return k
	return -1


func _close(result: Dictionary) -> void:
	if not is_open():
		return
	if not result.ok:
		Api.post_json("/api/system/operator-screen", {"prompt": false})  # confine again (a pick does it server-side)
	for w in _windows:
		w.hide()  # hidden before the embed flag goes back — Godot refuses the change while a child window shows
		w.queue_free()
	_windows.clear()
	_counts.clear()
	_boot = {}
	_busy = false
	if _timer != null:
		_timer.queue_free()
		_timer = null
	get_tree().root.gui_embed_subwindows = _embed_was
	finished.emit(result)
