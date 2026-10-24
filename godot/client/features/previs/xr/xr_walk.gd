extends Node3D
## WO-741 (future development, detachable) — walk into the Previs tab's stage (MVR scene, heads and beams, LED screens)
## at 1:1 and program lights from inside it. Only with the client flag `-- --xr` (previs_stage.gd, one marked hook).
##  - Headset: Godot started with `--xr-mode on` and an OpenXR runtime running → XROrigin3D + XRCamera3D + two
##    controllers. Right trigger on a head selects it (grip held adds); on the floor it aims the selection there.
##    Left stick walks, right stick snap-turns.
##  - No headset: a first-person camera at eye height. WASD walk (shift x3), left-drag look, wheel steps. The previs's
##    own mouse picking (click a head, right-drag to aim, Point at) works through this camera unchanged.
## What it changes is what the Programmer changes: DMX leaves the box only while the Fixtures DMX output is on.

const Walk := preload("res://features/previs/xr/xr_walk_model.gd")
const NEAR_PX := 28.0

var tab: Object  ## the Previs tab: fixtures3d (hit / near), aim_drag (aim → /api/fixtures/program/aim)
var xr := false
var _cam: Camera3D
var _origin: XROrigin3D
var _left: XRController3D
var _right: XRController3D
var _pointer: Camera3D  # on the right controller, never current: its viewport centre is the controller's ray
var _yaw := 0.0
var _pitch := 0.0
var _looking := false
var _snap_armed := true


## The walk for `stage` when it sits in the Previs tab (the one with heads to program), else null (the Live tab's
## read-only 3D view never walks).
static func attach(stage: Node3D) -> Node3D:
	var p := stage.get_parent()
	while p != null and not ("fixtures3d" in p and "aim_drag" in p):
		p = p.get_parent()
	if p == null:
		return null
	var w: Node3D = load("res://features/previs/xr/xr_walk.gd").new()
	w.tab = p
	stage.add_child(w)
	return w


func _ready() -> void:
	var start := Walk.start_pose(Vector3(0, 0, 0))
	_yaw = start.yaw
	xr = _start_xr()
	if xr:
		_origin.position = Vector3(start.pos.x, 0.0, start.pos.z)
		return
	_cam = Camera3D.new()
	_cam.fov = 70
	_cam.position = start.pos
	add_child(_cam)
	_cam.current = true
	_apply()


func _start_xr() -> bool:
	var xi := XRServer.find_interface("OpenXR")
	if xi == null or not xi.is_initialized():  # initialised at startup only by --xr-mode on with a runtime present
		return false
	get_viewport().use_xr = true
	_origin = XROrigin3D.new()
	add_child(_origin)
	_cam = XRCamera3D.new()
	_origin.add_child(_cam)
	_left = XRController3D.new()
	_left.tracker = &"left_hand"
	_origin.add_child(_left)
	_right = XRController3D.new()
	_right.tracker = &"right_hand"
	_origin.add_child(_right)
	_pointer = Camera3D.new()
	_right.add_child(_pointer)
	_right.button_pressed.connect(func(b: String) -> void:
		if b == "trigger_click":
			_trigger(_right.is_button_pressed(&"grip_click")))
	_cam.current = true
	return true


## The camera the previs picks through (previs_stage.camera()).
func camera() -> Camera3D:
	return _cam


## Mouse in the 3D view → whether the walk used it (else the stage's orbit would).
func handle_input(event: InputEvent) -> bool:
	if xr:
		return false
	var mb := event as InputEventMouseButton
	if mb != null:
		if mb.button_index == MOUSE_BUTTON_LEFT:
			_looking = mb.pressed
		elif mb.pressed and mb.button_index in [MOUSE_BUTTON_WHEEL_UP, MOUSE_BUTTON_WHEEL_DOWN]:
			_cam.position = Walk.step(_cam.position, _yaw, Vector2(0, 1 if mb.button_index == MOUSE_BUTTON_WHEEL_UP else -1), 0.5)
		return true
	var mm := event as InputEventMouseMotion
	if mm != null and _looking:
		var v := Walk.look(_yaw, _pitch, mm.relative)
		_yaw = v.x
		_pitch = v.y
		_apply()
		return true
	return false


func _process(dt: float) -> void:
	if xr:
		_xr_move(dt)
		return
	if not _keys_free():
		return
	var mv := Walk.keys(Input.is_physical_key_pressed(KEY_W), Input.is_physical_key_pressed(KEY_A),
		Input.is_physical_key_pressed(KEY_S), Input.is_physical_key_pressed(KEY_D))
	if mv != Vector2.ZERO:
		_cam.position = Walk.step(_cam.position, _yaw, mv, dt, Walk.SPEED * (3.0 if Input.is_key_pressed(KEY_SHIFT) else 1.0))


## WASD walks only while the Previs tab shows and no text field has the keys (or ctrl / cmd is held: ⌘D duplicates).
func _keys_free() -> bool:
	if tab == null or not (tab as Control).is_visible_in_tree() or Input.is_key_pressed(KEY_CTRL) or Input.is_key_pressed(KEY_META):
		return false
	var focus := get_tree().root.gui_get_focus_owner()
	return not (focus is LineEdit or focus is TextEdit or focus is SpinBox)


func _xr_move(dt: float) -> void:
	var stick := _left.get_vector2(&"primary")
	if stick.length() > 0.15:
		var head_yaw := _cam.global_basis.get_euler().y
		_origin.position = Walk.step(_origin.position, head_yaw, stick, dt, Walk.SPEED * (3.0 if stick.length() > 0.95 else 1.0))
	var s := Walk.snap(_origin.rotation.y, _right.get_vector2(&"primary").x, _snap_armed)
	_origin.rotation.y = s[0]
	_snap_armed = s[1]


func _trigger(add: bool) -> void:
	var rig: Object = tab.fixtures3d
	var centre := get_viewport().get_visible_rect().size / 2.0
	var r := Walk.trigger(rig.hit(_pointer, centre), rig.near(_pointer, centre, NEAR_PX), not tab.aim_drag.sel.ids.is_empty(),
		_right.global_position, -_right.global_basis.z, add)
	if r.do == "pick":
		tab.aim_drag.sel.pick(r.id, r.add)
	elif r.do == "aim":
		tab.aim_drag.aim(r.psn)


func _apply() -> void:
	_cam.rotation = Vector3(_pitch, _yaw, 0.0)
