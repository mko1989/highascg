extends VBoxContainer
## The Visuals tab's work area under the canvas (split out of visuals_tab.gd for WO-894/895/896): a mode bar — 3D (an orbit
## camera into the selected layer's world) and Flow (the audio → parameter graph) built in, more added with add_mode() — and
## the panel of the picked mode below it.

const Flow := preload("res://features/visuals/visuals_flow.gd")
const Cam := preload("res://features/visuals/visuals_camera.gd")

signal mode_changed(mode: String)
signal orbit_changed  # WO-896: the user moved the orbit, flipped "Drive output" or pressed Home (visuals_camera_ctl.gd listens)

var flow: Flow
var mode := "flow"
var orbit := Vector3(0.0, 0.25, 16.0)  # yaw, pitch, distance
var drive: CheckBox  # WO-896: "Drive output" — the orbit is also the output stage's camera
var orbit_cam: Camera3D
var vp3: SubViewport
var _bar: HBoxContainer
var _hint: Label
var _group := ButtonGroup.new()
var _modes := {}  # id → {control, hint, button}, in bar order


func _init() -> void:
	_bar = HBoxContainer.new()
	add_child(_bar)
	_hint = Label.new()
	_hint.modulate = Color(1, 1, 1, 0.6)
	_bar.add_child(_hint)
	var view3d := SubViewportContainer.new()
	view3d.stretch = true
	vp3 = SubViewport.new()
	orbit_cam = Camera3D.new()
	orbit_cam.fov = 60.0  # the output stage's (visuals_stage.gd), so the view frames like the output
	orbit_cam.far = 400.0
	vp3.add_child(orbit_cam)
	view3d.add_child(vp3)
	view3d.gui_input.connect(_orbit_input)
	view3d.size_flags_vertical = Control.SIZE_EXPAND_FILL
	var p3 := VBoxContainer.new()  # WO-896: the 3D view under its small bar
	var bar3 := HBoxContainer.new()
	drive = CheckBox.new()
	drive.text = "Drive output"
	drive.tooltip_text = "On: the output (every layer) follows this orbit and a saved look keeps the framing. Off: orbiting only moves this view"
	drive.toggled.connect(func(_on: bool) -> void: orbit_changed.emit())
	bar3.add_child(drive)
	var home := Button.new()
	home.text = "Home"
	home.tooltip_text = "Back to the straight-on view the output had before it could orbit"
	home.pressed.connect(func() -> void:
		orbit = Cam.HOME
		orbit_changed.emit())
	bar3.add_child(home)
	p3.add_child(bar3)
	p3.add_child(view3d)
	add_mode("3d", "3D", p3, "3D: drag orbits · the wheel zooms")
	flow = Flow.new()
	add_mode("flow", "Flow", flow, "Flow: right-click adds a node · drag an output dot to an input · Delete removes")


## A mode button on the bar (after the ones before it) and its panel, shown while the mode is picked.
func add_mode(id: String, label: String, control: Control, hint := "") -> void:
	var b := Button.new()
	b.text = label
	b.toggle_mode = true
	b.button_group = _group
	b.pressed.connect(func() -> void: set_mode(id))
	_bar.add_child(b)
	_bar.move_child(b, _modes.size())
	control.size_flags_vertical = Control.SIZE_EXPAND_FILL
	add_child(control)
	_modes[id] = {"control": control, "hint": hint, "button": b}
	set_mode(mode)


func set_mode(m: String) -> void:
	if not _modes.has(m):
		return
	mode = m
	for id in _modes:
		_modes[id].control.visible = id == m
		(_modes[id].button as Button).set_pressed_no_signal(id == m)
	_hint.text = _modes[m].hint
	mode_changed.emit(m)


## The 3D view looks into this world (WO-890: each layer has its own).
func look_into(w: World3D) -> void:
	if w != null and vp3.world_3d != w:
		vp3.world_3d = w


## Per frame: the orbit camera follows `orbit` while the 3D view shows.
func step() -> void:
	if mode == "3d":
		orbit_cam.transform = Cam.transform_of(orbit)


func _orbit_input(e: InputEvent) -> void:
	var was := orbit
	var mm := e as InputEventMouseMotion
	if mm and mm.button_mask & MOUSE_BUTTON_MASK_LEFT:
		orbit = Cam.clamp_pose(Vector3(orbit.x - mm.relative.x * 0.01, orbit.y + mm.relative.y * 0.01, orbit.z))
	var mb := e as InputEventMouseButton
	if mb and mb.pressed and mb.button_index in [MOUSE_BUTTON_WHEEL_UP, MOUSE_BUTTON_WHEEL_DOWN]:
		orbit = Cam.clamp_pose(Vector3(orbit.x, orbit.y, orbit.z * (0.9 if mb.button_index == MOUSE_BUTTON_WHEEL_UP else 1.1)))
	if orbit != was:
		orbit_changed.emit()
