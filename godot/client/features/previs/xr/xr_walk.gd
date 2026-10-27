extends Node3D
## WO-741 (future development, detachable) — walk into the Previs tab's stage (MVR scene, heads and beams, LED screens)
## at 1:1 and program lights from inside it. Only with the client flag `-- --xr` (previs_stage.gd, one marked hook).
##  - Headset: Godot started with `--xr-mode on` and an OpenXR runtime running → XROrigin3D + XRCamera3D + two
##    controllers. Right trigger on a head selects it (the left grip held adds); on the floor its release aims the
##    selection there; held and dragged it draws a box that selects the heads inside (WO-774). The right grip held fans
##    the selection's pan / tilt as the controller moves (xr_fan.gd, WO-774). Left stick walks, right stick snap-turns.
##    The full Programmer rides the left wrist (xr_panel.gd, WO-757): pointing at it, the trigger clicks there instead;
##    Y shows / hides it, the right stick up / down scrolls it; its type filter limits what the controller picks.
##  - No headset: a first-person camera at eye height. WASD walk (shift x3), left-drag look, wheel steps. The previs's
##    own mouse picking (click a head, right-drag to aim, Point at) works through this camera unchanged.
## What it changes is what the Programmer changes: DMX leaves the box only while the Fixtures DMX output is on.

const Walk := preload("res://features/previs/xr/xr_walk_model.gd")
const Fan := preload("res://features/previs/xr/xr_fan.gd")
const BOX_COLOR := Color(0.55, 0.85, 1.0)
const NEAR_PX := 28.0
const RAY_M := 4.0  # the drawn ray's length when it points at no panel
const SCROLL_S := 0.12  # one wheel notch per this while the stick is held
## The panel on the left controller: above the wrist, tilted to face the eyes (a first guess, tune in the headset).
const PANEL_UP := Vector3(0.0, 0.12, -0.10)
const PANEL_TILT := -50.0  # degrees about X

var tab: Object  ## the Previs tab: fixtures3d (hit / near), aim_drag (aim → /api/fixtures/program/aim)
var xr := false
var _cam: Camera3D
var _origin: XROrigin3D
var _left: XRController3D
var _right: XRController3D
var _pointer: Camera3D  # on the right controller, never current: its viewport centre is the controller's ray
var panel: Node3D  # the Programmer on the left wrist (headset only)
var _ray: MeshInstance3D
var _mirror: Camera3D  # WO-770: the headset's view on the desktop window (the XR viewport draws nothing there)
var _scroll_t := 0.0
var _yaw := 0.0
var _pitch := 0.0
var _looking := false
var _snap_armed := true
var _press := {}  # WO-774: a trigger press in the stage off the heads {from, dir, add, aim (PSN or null), box}
var _box: MeshInstance3D  # the box being dragged
var _fan: RefCounted  # WO-774: the right grip's fan (xr_fan.gd)
var _fan_p0 := Vector3.ZERO  # the right controller (room metres) when the grip went down


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
	_fan = Fan.new()
	var api: Variant = get_node("/root/Api")  # an autoload, named at runtime: the test runner compiles this file without it
	_fan.get_json = api.get_json
	_fan.post_json = api.post_json
	_right.button_pressed.connect(func(b: String) -> void:
		if b == "trigger_click":
			trigger(true, _add_held())
		elif b == "grip_click":
			_fan_p0 = _right.position  # room metres: walking with the stick meanwhile does not fan
			_fan.start())
	_right.button_released.connect(func(b: String) -> void:
		if b == "trigger_click":
			trigger(false, _add_held())
		elif b == "grip_click":
			_fan.end())
	panel = load("res://features/previs/xr/xr_panel.gd").new()  # loaded here: it needs the app's autoloads (Api, Store)
	panel.position = PANEL_UP
	panel.rotation.x = deg_to_rad(PANEL_TILT)
	_left.add_child(panel)
	_left.button_pressed.connect(func(b: String) -> void:
		if b == "by_button":
			panel.visible = not panel.visible)
	_ray = _make_ray()
	_right.add_child(_ray)
	_box = _make_box()
	add_child(_box)
	_cam.current = true
	_make_mirror()
	return true


## WO-770 — owner 25.10: "when connected there should be a window that shows whats displayed in vr". With use_xr on,
## the previs SubViewport renders to the headset only and its desktop container shows black. A second SubViewport on
## the same World3D, its camera following the headset's every frame (_process), is laid over that container.
func _make_mirror() -> void:
	var host := get_viewport().get_parent() as Control  # the previs SubViewportContainer
	if host == null:
		return
	var vp := SubViewport.new()
	vp.world_3d = get_viewport().find_world_3d()
	vp.size = Walk.mirror_px(host.size)
	vp.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	add_child(vp)
	_mirror = Camera3D.new()
	_mirror.fov = Walk.MIRROR_FOV
	vp.add_child(_mirror)
	_mirror.current = true
	var tex := TextureRect.new()
	tex.texture = vp.get_texture()
	tex.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	tex.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
	tex.mouse_filter = Control.MOUSE_FILTER_IGNORE
	(host.get_parent() if host.get_parent() is Control else host).add_child(tex)  # over the container, in its stack
	tex.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	host.resized.connect(func() -> void: vp.size = Walk.mirror_px(host.size))


func _make_ray() -> MeshInstance3D:
	var m := MeshInstance3D.new()
	var box := BoxMesh.new()
	box.size = Vector3(0.002, 0.002, 1.0)
	m.mesh = box
	var mat := StandardMaterial3D.new()
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.albedo_color = Color(0.55, 0.85, 1.0)
	m.material_override = mat
	return m


## WO-774: the dragged box — an outline and a faint fill, drawn over everything, in world coordinates.
func _make_box() -> MeshInstance3D:
	var m := MeshInstance3D.new()
	m.top_level = true
	m.mesh = ImmediateMesh.new()
	var mat := StandardMaterial3D.new()
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.vertex_color_use_as_albedo = true
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.no_depth_test = true
	mat.cull_mode = BaseMaterial3D.CULL_DISABLED
	m.material_override = mat
	m.visible = false
	return m


func _draw_box(pts: PackedVector3Array) -> void:
	var im := _box.mesh as ImmediateMesh
	im.clear_surfaces()
	_box.visible = pts.size() > 2
	if not _box.visible:
		return
	var mid := Vector3.ZERO
	for v in pts:
		mid += v
	mid /= pts.size()
	im.surface_begin(Mesh.PRIMITIVE_TRIANGLES)
	im.surface_set_color(Color(BOX_COLOR, 0.12))
	for i in pts.size() - 1:
		for v in [mid, pts[i], pts[i + 1]]:
			im.surface_add_vertex(v)
	im.surface_end()
	im.surface_begin(Mesh.PRIMITIVE_LINE_STRIP)
	im.surface_set_color(BOX_COLOR)
	for v in pts:
		im.surface_add_vertex(v)
	im.surface_end()


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
	if _mirror != null:
		_mirror.global_transform = _cam.global_transform
	_point(dt)
	_drag()
	if _fan.active:
		_fan.move(Walk.fan_move(_fan_p0, _right.position, _cam.basis))
	var stick := _left.get_vector2(&"primary")
	if stick.length() > 0.15:
		var head_yaw := _cam.global_basis.get_euler().y
		_origin.position = Walk.step(_origin.position, head_yaw, stick, dt, Walk.SPEED * (3.0 if stick.length() > 0.95 else 1.0))
	var s := Walk.snap(_origin.rotation.y, _right.get_vector2(&"primary").x, _snap_armed)
	_origin.rotation.y = s[0]
	_snap_armed = s[1]


## The right controller's ray on the panel (a mouse move there), drawn to the panel or RAY_M; the stick scrolls it.
func _point(dt: float) -> void:
	var from := _right.global_position
	var dir := -_right.global_basis.z
	var on: bool = panel.point(from, dir, dt)
	var length := maxf(from.distance_to(panel.hit_at), 0.01) if on else RAY_M
	_ray.scale = Vector3(1, 1, length)
	_ray.position = Vector3(0, 0, -length / 2.0)
	var y := _right.get_vector2(&"primary").y
	_scroll_t -= dt
	if on and absf(y) > 0.5 and _scroll_t <= 0.0:
		panel.scroll(y > 0.0)
		_scroll_t = SCROLL_S


## Trigger down / up (`add` = the left grip held): on the panel it clicks (and drags) there. In the stage a press on a
## head picks it at once; elsewhere the press waits for its release — dragged, a box select; not, the floor aim it
## always was (WO-774: the aim moved from the press to the release so a drag can be a box instead).
func trigger(pressed: bool, add: bool) -> void:
	var on_panel: bool = panel != null and panel.pointed()
	if panel != null and (on_panel or not pressed):
		panel.press(pressed, add)
	if pressed and not on_panel:
		_trigger(add)
	elif not pressed:
		_release(add)


func _trigger(add: bool) -> void:
	var rig: Object = tab.fixtures3d
	var centre := get_viewport().get_visible_rect().size / 2.0
	var only := _only_type()
	var from := _right.global_position
	var dir := -_right.global_basis.z
	var r := Walk.trigger(rig.hit(_pointer, centre, only), rig.near(_pointer, centre, NEAR_PX, only),
		not tab.aim_drag.sel.ids.is_empty(), from, dir, add)
	if r.do == "pick":
		tab.aim_drag.sel.pick(r.id, r.add)
		return
	_press = {"from": from, "dir": dir, "add": add, "aim": r.get("psn"), "box": false}


## WO-774: a stage press dragged past Walk.BOX_MIN_DEG becomes a box, drawn while the trigger is held.
func _drag() -> void:
	if _press.is_empty():
		return
	var dir := -_right.global_basis.z
	if not _press.box:
		_press.box = Walk.dragged(Walk.view_angles(Walk.view_frame(_press.dir), dir))
	if _press.box:
		_draw_box(Walk.box_outline(_press.from, _press.dir, dir))


func _release(add: bool) -> void:
	if _press.is_empty():
		return
	var p := _press
	_press = {}
	if _box != null:
		_box.visible = false
	var sel: RefCounted = tab.aim_drag.sel
	if p.box:
		var ids := Walk.box_pick(p.from, p.dir, -_right.global_basis.z, tab.fixtures3d.heads(), _only_type())
		sel.set_ids(Walk.box_select(sel.ids, ids, add or p.add))
	elif p.aim != null:
		tab.aim_drag.aim(p.aim)


## WO-774: the panel's type filter ("" = all types).
func _only_type() -> String:
	return str(panel.type_filter()) if panel != null and panel.has_method("type_filter") else ""


## WO-774: the add modifier is the left grip (the right grip fans).
func _add_held() -> bool:
	return _left != null and _left.is_button_pressed(&"grip_click")


func _apply() -> void:
	_cam.rotation = Vector3(_pitch, _yaw, 0.0)
