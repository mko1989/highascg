extends VBoxContainer
## WO-1072 — "Match console positions": pick the lighting console's heads CSV (MagicQ: Patch → View Heads → File →
## Print Window → Create CSV, with head number, DMX and X / Y / Z), see how the console's rig sits against ours, then
## move the whole project onto it (POST /api/fixtures/console-match; the server does the fit and writes the project, the
## client reloads it as a remote sync). "Take head positions" also puts every matched head exactly where the console
## has it. Nothing is written before one of the two buttons.

const FilePick := preload("res://features/devices/file_pick.gd")
const M := preload("res://features/previs/fixtures/console_match_model.gd")

var _csv := ""
var _status: Label
var _move: Button
var _heads: Button


func _ready() -> void:
	add_theme_constant_override("separation", 4)
	var pick := Button.new()
	pick.text = "Choose the console's CSV…"
	pick.tooltip_text = "MagicQ: Patch → View Heads → File → Print Window → Create CSV, with head number, DMX and X / Y / Z."
	pick.pressed.connect(_pick)
	add_child(pick)
	_status = Label.new()
	_status.autowrap_mode = TextServer.AUTOWRAP_WORD
	_status.text = "Compares the console's head positions with this project. Nothing changes until you press Move."
	add_child(_status)
	var row := HBoxContainer.new()
	_move = Button.new()
	_move.text = "Move project to match"
	_move.tooltip_text = "Moves the scene, all fixtures, the tracking stage, cameras, PTZ, LED walls and marks by the one offset shown."
	_move.pressed.connect(func() -> void: _send("shift"))
	row.add_child(_move)
	_heads = Button.new()
	_heads.text = "Take head positions"
	_heads.tooltip_text = "Moves the project the same way, then puts every matched head exactly where the console has it."
	_heads.pressed.connect(func() -> void: _send("heads"))
	row.add_child(_heads)
	add_child(row)
	var out := Button.new()
	out.text = "Export our positions for the console…"
	out.tooltip_text = "Saves a CSV of this project's head positions. MagicQ: Patch → View Chans → Import Heads → Vis only puts its heads there; patch and programming stay."
	out.pressed.connect(_export)
	add_child(out)
	_enable(false)


func _enable(on: bool) -> void:
	_move.disabled = not on
	_heads.disabled = not on


func _pick() -> void:
	var path: String = await FilePick.open_path(self, "The console's heads CSV", ["*.csv ; CSV", "*.txt ; Text"])
	if path == "":
		return
	_csv = FileAccess.get_file_as_string(path)
	if _csv == "":
		_status.text = "That file is empty or cannot be read."
		_enable(false)
		return
	await _send("")


func _export() -> void:
	var raw: Dictionary = await Api.get_json("/api/fixtures/console-match/export")
	var res: Dictionary = M.answer(raw)  # WO-1106 B24: the server's fields are in the wrapper's `data`
	if not res.get("ok", false):
		_status.text = str(res.get("error", "The server did not answer."))
		return
	var path: String = await FilePick.save_path(self, "Save the positions CSV", "highascg-positions.csv", ["*.csv ; CSV"])
	if path == "":
		return
	var err: String = FilePick.write_bytes(path, str(res.get("csv", "")).to_utf8_buffer())
	_status.text = err if err != "" else "%d head positions saved to %s. On the console: Patch → View Chans → Import Heads → Vis only." % [int(res.get("heads", 0)), path]


func _send(apply: String) -> void:
	_enable(false)
	var body := {"csv": _csv}
	if apply != "":
		body["apply"] = apply
	var raw: Dictionary = await Api.post_json("/api/fixtures/console-match", body)
	var res: Dictionary = M.answer(raw)  # WO-1106 B24
	_status.text = M.summary(res)
	_enable(M.can_apply(res) and apply == "")
