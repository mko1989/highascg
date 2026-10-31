extends VBoxContainer
## The Visuals tab's work area under the canvas (split out of visuals_tab.gd for WO-894/895/896): a mode bar — 3D (an orbit
## camera into the selected layer's world) and Flow (the audio → parameter graph) built in, more added with add_mode() — and
## the panel of the picked mode below it.

const Flow := preload("res://features/visuals/visuals_flow.gd")

signal mode_changed(mode: String)

var flow: Flow
var mode := "flow"
var orbit := Vector3(0.0, 0.25, 16.0)  # yaw, pitch, distance
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
	vp3.add_child(orbit_cam)
	view3d.add_child(vp3)
	view3d.gui_input.connect(_orbit_input)
	add_mode("3d", "3D", view3d, "3D: drag orbits · the wheel zooms")
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
		var b := Basis.from_euler(Vector3(-orbit.y, orbit.x, 0.0))
		orbit_cam.transform = Transform3D(b, b * Vector3(0, 0, orbit.z))


func _orbit_input(e: InputEvent) -> void:
	var mm := e as InputEventMouseMotion
	if mm and mm.button_mask & MOUSE_BUTTON_MASK_LEFT:
		orbit.x -= mm.relative.x * 0.01
		orbit.y = clampf(orbit.y + mm.relative.y * 0.01, -1.4, 1.4)
	var mb := e as InputEventMouseButton
	if mb and mb.pressed and mb.button_index in [MOUSE_BUTTON_WHEEL_UP, MOUSE_BUTTON_WHEEL_DOWN]:
		orbit.z = clampf(orbit.z * (0.9 if mb.button_index == MOUSE_BUTTON_WHEEL_UP else 1.1), 2.0, 80.0)
