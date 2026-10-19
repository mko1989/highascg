extends VBoxContainer
## WO-616 T10d — Verification walk (inside the Detect section, under the masks): pick a line of the tracking grid,
## Start, walk it, Stop. The server (src/tracking/verify-walk.js, GET/POST /api/tracking/verify) measures how far
## tracking put the walker off the line — the world position (fused when 2+ cameras see them) and each camera's own
## feet point — in cm, and how much of the line was walked. Accept stamps the result on every tracking camera
## (`verified`, via tracking_page) so the calibration carries when and how well it was proven.
## The line is drawn in the camera view while Detect mode is open (line()).

const ThemeBuilder := preload("res://app/theme_builder.gd")
const M := preload("res://features/previs/tracking/walk_model.gd")

const POLL_S := 0.5

signal accepted(result: Dictionary, line_name: String)
signal view_changed  # the chosen line changed → the camera view redraws it

var grid := {}
var result := {}
var _lines: Array = []
var _pick: OptionButton
var _go: Button
var _accept: Button
var _state: Label
var _timer: Timer
var _running := false


func _ready() -> void:
	add_theme_constant_override("separation", 6)
	add_child(HSeparator.new())
	var head := Label.new()
	head.text = "Verification walk"
	add_child(head)
	_pick = OptionButton.new()
	_pick.item_selected.connect(func(_i: int) -> void: view_changed.emit())
	add_child(_pick)
	var row := HBoxContainer.new()
	_go = Button.new()
	_go.text = "Start walk"
	_go.pressed.connect(_toggle)
	row.add_child(_go)
	_accept = Button.new()
	_accept.text = "Accept"
	_accept.disabled = true
	_accept.tooltip_text = "Stamp this result on the tracking cameras (when and how well the calibration was proven)."
	_accept.pressed.connect(func() -> void:
		accepted.emit(result, current_name())
		_accept.disabled = true)
	row.add_child(_accept)
	add_child(row)
	_state = Label.new()
	_state.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_state.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	_state.text = "Walk the line shown in the camera view, at a steady pace, end to end."
	add_child(_state)
	_timer = Timer.new()
	_timer.wait_time = POLL_S
	_timer.timeout.connect(_poll)
	add_child(_timer)
	set_grid(grid)


## tracking_model grid → the line choices (keeps the choice by index).
func set_grid(g: Dictionary) -> void:
	grid = g
	_lines = M.lines(g) if not g.is_empty() else []
	if _pick == null:
		return
	var keep := maxi(0, _pick.selected)
	_pick.clear()
	for l in _lines:
		_pick.add_item(l.name)
	if not _lines.is_empty():
		_pick.select(mini(keep, _lines.size() - 1))


## The chosen line {name, a: [x, y], b: [x, y], z} (PSN floor) or {}.
func line() -> Dictionary:
	var i := _pick.selected if _pick != null else 0
	return _lines[i] if i >= 0 and i < _lines.size() else {}


func current_name() -> String:
	return str(line().get("name", ""))


func _toggle() -> void:
	if _running:
		await _stop()
	else:
		await _start()


func _start() -> void:
	var l := line()
	if l.is_empty():
		return
	var res: Dictionary = await Api.post_json("/api/tracking/verify", {"action": "start", "a": l.a, "b": l.b})
	_show(res)


func _stop() -> void:
	_show(await Api.post_json("/api/tracking/verify", {"action": "stop"}))


func _poll() -> void:
	_show(await Api.get_json("/api/tracking/verify"))


func _show(res: Dictionary) -> void:
	var st: Variant = res.get("data", res)
	if not st is Dictionary or (st as Dictionary).has("error"):
		_state.text = "Verification walk: " + str((st as Dictionary).get("error", "server unreachable") if st is Dictionary else "server unreachable")
		return
	_running = st.get("running") == true
	result = st.get("result") if st.get("result") is Dictionary else {}
	_go.text = "Stop" if _running else "Start walk"
	_pick.disabled = _running
	_accept.disabled = _running or result.get("ok") != true
	_state.text = M.describe(st)
	if _running and _timer.is_stopped():
		_timer.start()
	elif not _running:
		_timer.stop()
