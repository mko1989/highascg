extends VBoxContainer
## WO-1091 — a tracking camera's pose on the Calibrate page (tracking_page.gd; the pose spin boxes moved here from the
## page): a state line, Aim at stage / Unlock pose… / Show in 3D, then X / Y / Z / pitch / yaw / roll / fov / lens.
## While the camera is not solved its pose is the operator's rough guess: these boxes, Aim at stage, or the Camera view
## (drag = look around, shift+drag = move, shift+wheel = dolly, ctrl+wheel = lens). A solved camera is locked: its pose
## changes only by solving, or after Unlock pose… (the first change then drops the solve; the clicked points stay, so
## Solve brings it back).

const A := preload("res://features/previs/tracking/aim_model.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")

## [label, key, min, max, step]
const POSE := [["X m (stage left +)", "pos_x", -200, 200, 0.01], ["Y m (upstage +)", "pos_y", -200, 200, 0.01],
	["Z m (height)", "pos_z", -20, 100, 0.01], ["Pitch °", "pitch", -89, 89, 0.1], ["Yaw °", "yaw", -180, 180, 0.1],
	["Roll °", "roll", -180, 180, 0.1], ["FOV h °", "fov", A.FOV_MIN, A.FOV_MAX, 0.1], ["Lens k1", "lens_k1", -1, 1, 0.001],
	["Lens k2", "lens_k2", -1, 1, 0.001]]
const FROM := {"objects": "the stage objects' facing", "room": "the room's free side", "grid": "the grid (no stage objects)"}

signal show_3d  ## previs_tab: the 3D view with the tracking cameras' frustums and coverage, framed on them

var page: Node  # tracking_page.gd: entry(), data, objects, room, unlocked, aim_pose()
var _pose := {}
var _state: Label
var _aim: Button
var _unlock: Button
var _confirm: ConfirmationDialog
var _note := ""
var _note_for := ""  # the camera id the note is about (switching cameras drops it)


func _init(p: Node) -> void:
	page = p


func _ready() -> void:
	add_theme_constant_override("separation", 4)
	_state = Label.new()
	_state.autowrap_mode = TextServer.AUTOWRAP_WORD
	_state.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	add_child(_state)
	var row := HBoxContainer.new()
	_aim = _button("Aim at stage", aim_at_stage)
	_aim.tooltip_text = "Put this camera in front of the stage, framing the whole tracking grid — the audience side comes from the LED walls' facing, else the room, else the grid."
	row.add_child(_aim)
	_unlock = _button("Unlock pose…", func() -> void: _confirm.popup_centered())
	row.add_child(_unlock)
	var s3 := _button("Show in 3D", func() -> void: show_3d.emit())
	s3.tooltip_text = "The 3D view with each tracking camera's view on the stage (frustum, footprint, coverage)."
	row.add_child(s3)
	add_child(row)
	_confirm = ConfirmationDialog.new()
	_confirm.dialog_text = "Move this solved camera by hand? The first change drops its solve; the clicked points stay, so Solve brings it back."
	_confirm.confirmed.connect(func() -> void:
		page.unlocked = true
		page.changed.emit()
		refresh())
	add_child(_confirm)
	var g := GridContainer.new()
	g.columns = 2
	for f in POSE:
		var l := Label.new()
		l.text = f[0]
		l.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
		g.add_child(l)
		var sb: SpinBox = page._spin(f[2], f[3], f[4])
		var key: String = f[1]
		sb.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		sb.value_changed.connect(func(v: float) -> void:
			var cam: Dictionary = (page.entry().get("cam", {}) as Dictionary).duplicate()
			if not cam.is_empty():
				cam[key] = v
				_note = ""
				page.aim_pose(cam, true))
		_pose[key] = sb
		g.add_child(sb)
	add_child(g)
	refresh()


## Does the Camera view aim this camera (Calibrate mode, the camera free to move)?
func aim_on() -> bool:
	return page.mode == "calibrate" and A.can_aim(page.entry(), page.unlocked)


func aim_at_stage() -> void:
	var ce: Dictionary = page.entry()
	if not A.can_aim(ce, page.unlocked):
		return
	var r := A.stage_pose(page.data.grid, page.objects, page.room, ce.raster)
	_note_for = str(ce.get("id", ""))
	_note = "Aimed at the stage (audience side from %s)%s." % [FROM.get(r.from, r.from),
		" — the room is too small to frame it from inside" if r.get("outside_room", false) else ""]
	page.aim_pose(r.cam, true)


## Fields ← the shown camera (no signals).
func refresh() -> void:
	if _state == null:
		return
	var ce: Dictionary = page.entry()
	if ce.is_empty():
		return
	var free := A.can_aim(ce, page.unlocked)
	var rms := float(ce.get("rms", -1.0))
	if not free:
		_state.text = "Solved (RMS %.2f px) — the pose is locked: it changes by solving. Unlock pose… to move it by hand." % rms
	elif rms >= 0.0:
		_state.text = "Unlocked — the next change drops the solve (Solve again to restore it)."
	else:
		_state.text = "Not calibrated — rough pose: Aim at stage, or in the view drag = look around · shift+drag = move · shift+wheel = dolly · ctrl+wheel = lens."
	if _note != "" and free and _note_for == str(ce.get("id", "")):
		_state.text = _note + "\n" + _state.text
	_aim.disabled = not free
	_unlock.visible = rms >= 0.0 and not page.unlocked
	for k in _pose:
		var sb: SpinBox = _pose[k]
		sb.editable = free
		if not sb.get_line_edit().has_focus():
			sb.set_value_no_signal(float(ce.cam[k]))


func _button(text: String, cb: Callable) -> Button:
	var b := Button.new()
	b.text = text
	b.pressed.connect(cb)
	return b
