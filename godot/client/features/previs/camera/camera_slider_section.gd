extends VBoxContainer
## WO-1109 — the Previs Inspector's "Camera slider" fold: frame a start view (+ makes a move with A and B at the view),
## frame the end view (Set B), ▶ plays it on the operator view (camera_slider.gd), the slider scrubs it. Duration, ease
## and mode per move; Go A / Go B fly there. Saved in project.previs.camera (camera_slider_model.gd) through
## ProjectSync like the other previs sections (undo-able); a remote project sync reloads it.

const M := preload("res://features/previs/camera/camera_slider_model.gd")
const UI := preload("res://features/previs/previs_ui.gd")
const Runtime := preload("res://features/previs/camera/camera_slider.gd")

signal changed  ## the moves changed (the Previs output's camera list follows)

var runtime: Runtime
var cfg := {"moves": [], "active": ""}
var _pick := OptionButton.new()
var _name := LineEdit.new()
var _slider := HSlider.new()
var _play := Button.new()
var _dur := SpinBox.new()
var _ease := OptionButton.new()
var _mode := OptionButton.new()
var _hint := UI.caption("Frame the start view, press +, frame the end view, then Set B and ▶.")
var _needs_move: Array = []  # the rows that mean nothing without a move


func _ready() -> void:
	add_theme_constant_override("separation", 6)
	var top := HBoxContainer.new()
	_pick.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_pick.fit_to_longest_item = false
	_pick.tooltip_text = "The camera move to play"
	_pick.item_selected.connect(func(i: int) -> void:
		runtime.stop()
		cfg.active = str(_pick.get_item_metadata(i))
		runtime.t = 0.0
		_save())
	top.add_child(_pick)
	var add := UI.button("+", _add)
	add.tooltip_text = "A new move from the current view (A and B both here — then frame the end view and Set B)"
	top.add_child(add)
	var del := UI.button("✕", _delete)
	del.tooltip_text = "Delete this move"
	top.add_child(del)
	add_child(top)
	_name.placeholder_text = "Name"
	_name.tooltip_text = "The move's name (Enter)"
	_name.text_submitted.connect(func(_s: String) -> void: _rename())
	_name.focus_exited.connect(_rename)
	add_child(_name)
	var ends := HBoxContainer.new()
	for spec in [["Set A", "a", false], ["Go A", "a", true], ["Set B", "b", false], ["Go B", "b", true]]:
		var b := UI.button(spec[0], _go.bind(spec[1]) if spec[2] else _set_end.bind(spec[1]))
		b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		b.tooltip_text = ("Fly the view to the move's %s" if spec[2] else "The current view becomes the move's %s") % \
			("start" if spec[1] == "a" else "end")
		ends.add_child(b)
	add_child(ends)
	var run := HBoxContainer.new()
	_play.custom_minimum_size.x = 32
	_play.tooltip_text = "Play / stop the move on this view (orbit, pan or the wheel takes the camera back)"
	_play.pressed.connect(func() -> void:
		if runtime.playing:
			runtime.stop()
		else:
			runtime.t = _slider.value / 100.0  # from where the slider stands
			runtime.play(_current())
		_sync_play())
	run.add_child(_play)
	_slider.min_value = 0.0
	_slider.max_value = 100.0
	_slider.step = 0.1
	_slider.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_slider.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	_slider.tooltip_text = "Where the view is between A (0 %) and B (100 %) — drag to scrub"
	_slider.value_changed.connect(func(v: float) -> void:
		runtime.scrub(_current(), v / 100.0)
		_sync_play())
	run.add_child(_slider)
	add_child(run)
	var grid := GridContainer.new()
	grid.columns = 2
	_dur.min_value = M.MIN_DURATION
	_dur.max_value = M.MAX_DURATION
	_dur.step = 0.1
	_dur.custom_arrow_step = 1.0
	_dur.suffix = "s"
	_dur.select_all_on_focus = true
	_dur.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_dur.tooltip_text = "Seconds from A to B"
	_dur.value_changed.connect(func(v: float) -> void: _edit("duration_s", v))
	for i in M.EASES.size():
		_ease.add_item(M.EASE_NAMES[i])
	_ease.item_selected.connect(func(i: int) -> void: _edit("ease", M.EASES[i]))
	for i in M.MODES.size():
		_mode.add_item(M.MODE_NAMES[i])
	_mode.tooltip_text = "Once: stop at B · Ping-pong: back and forth · Loop: jump back to A"
	_mode.item_selected.connect(func(i: int) -> void: _edit("mode", M.MODES[i]))
	for row in [["Duration", _dur], ["Ease", _ease], ["Mode", _mode]]:
		var cap := UI.caption(row[0])
		cap.autowrap_mode = TextServer.AUTOWRAP_OFF  # a wrapping label in a grid column collapses to nothing
		grid.add_child(cap)
		grid.add_child(row[1])
	add_child(grid)
	add_child(_hint)
	_needs_move.append_array([del, _name, ends, run, grid])
	runtime.moved.connect(func(at: float) -> void: _slider.set_value_no_signal(at * 100.0))
	runtime.stopped.connect(_sync_play)
	Store.project_changed.connect(func(_p: Dictionary) -> void: load_cfg())
	load_cfg()


## From the project (first build, a project load, a remote sync).
func load_cfg() -> void:
	cfg = M.of_project(Store.project)
	runtime.update_move(_playing_move())
	_refresh()
	changed.emit()


func _current() -> Dictionary:
	return M.find(cfg, str(cfg.active))


## The move the runtime plays, as it is now (gone: {} → it stops).
func _playing_move() -> Dictionary:
	return M.find(cfg, str(runtime.move.get("id", ""))) if not runtime.move.is_empty() else {}


func _add() -> void:
	runtime.stop()
	var m := M.new_move(cfg, runtime.stage.view_pose())
	cfg.moves.append(m)
	cfg.active = m.id
	runtime.t = 0.0
	_save()


func _delete() -> void:
	var id := str(cfg.active)
	if str(runtime.move.get("id", "")) == id:
		runtime.stop()
	cfg.moves = cfg.moves.filter(func(m: Dictionary) -> bool: return str(m.id) != id)
	cfg.active = ""
	runtime.t = 0.0
	_save()


func _rename() -> void:
	var m := _current()
	var n := _name.text.strip_edges()
	if m.is_empty() or n == "" or n == str(m.name):
		_name.text = str(m.get("name", ""))
		return
	_edit("name", n)


func _set_end(which: String) -> void:
	var m := _current()
	if m.is_empty():
		return
	runtime.stop()
	m[which] = runtime.stage.view_pose()
	runtime.t = 0.0 if which == "a" else 1.0
	_save()


func _go(which: String) -> void:
	var m := _current()
	if m.is_empty():
		return
	runtime.stop()
	var o := M.orbit_of(m[which])
	runtime.stage.camera().fov = float(o.fov)
	runtime.stage.fly_to_preset("", {"yaw": o.yaw, "pitch": o.pitch, "dist": o.dist, "target": o.target})
	runtime.move = m
	runtime.t = 0.0 if which == "a" else 1.0
	_refresh()


func _edit(key: String, v: Variant) -> void:
	var m := _current()
	if m.is_empty() or m.get(key) == v:
		return
	m[key] = v
	_save()


func _save() -> void:
	cfg = M.normalize(cfg)
	if not Store.project.is_empty():  # no project loaded: nothing to save into
		var pv: Dictionary = Store.project.get("previs") if Store.project.get("previs") is Dictionary else {}
		pv["camera"] = cfg.duplicate(true)
		Store.project["previs"] = pv
		ProjectSync.mark_dirty()
	runtime.update_move(_playing_move())
	_refresh()
	changed.emit()


func _refresh() -> void:
	var m := _current()
	_pick.clear()
	for mv in cfg.moves:
		_pick.add_item(str(mv.name))
		_pick.set_item_metadata(_pick.item_count - 1, str(mv.id))
		if str(mv.id) == str(cfg.active):
			_pick.select(_pick.item_count - 1)
	_pick.visible = not cfg.moves.is_empty()
	if not _name.has_focus():
		_name.text = str(m.get("name", ""))
	for c in _needs_move:
		(c as Control).visible = not m.is_empty()
	_hint.visible = m.is_empty()
	if m.is_empty():
		return
	_dur.set_value_no_signal(float(m.duration_s))
	_ease.select(M.EASES.find(m.ease))
	_mode.select(M.MODES.find(m.mode))
	_slider.set_value_no_signal((runtime.t if str(runtime.move.get("id", "")) == str(m.id) else 0.0) * 100.0)
	_sync_play()


func _sync_play() -> void:
	_play.text = "■" if runtime.playing else "▶"
