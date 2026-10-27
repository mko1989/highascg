extends Node3D
## WO-757 (detachable, WO-741 step 3) — the full Programmer inside the headset: programmer_section.gd itself (list,
## All / None, Release, Delete, groups, intensity, colour, wheels, CTO, pan / tilt, Point at, zoom, gobos) and under it
## Store / Recall to a look (xr_looks_row.gd), drawn into a SubViewport on a quad and worked with the right controller's
## ray (xr_walk.gd): pointing moves the mouse, the trigger clicks (held: drags a slider), the left grip held = ctrl
## (adds in the list; WO-774: it was the right grip, which now fans), the right stick scrolls. Its popups (colour picker,
## Groups menu, dialogs) are embedded, so they draw on the quad too. One shared selection (fixture_selection.gd):
## picking a head in the stage selects it here. WO-774: above it the type filter (xr_type_row.gd).

const Programmer := preload("res://features/previs/fixtures/programmer_section.gd")
const LooksRow := preload("res://features/previs/xr/xr_looks_row.gd")
const TypeRow := preload("res://features/previs/xr/xr_type_row.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const Walk := preload("res://features/previs/xr/xr_walk_model.gd")
const SIZE := Walk.PANEL_SIZE
const PX := Walk.PANEL_PX

var viewport: SubViewport
var programmer: VBoxContainer
var types: HBoxContainer  # WO-774: the type filter
var quad: MeshInstance3D
var hit_at := Vector3.ZERO  # where the ray last met the panel (world)
var _at := Vector2(-1, -1)  # last pointed pixel (-1 = off the panel)
var _mask := 0
var _euro := {}  # the pointer's smoothing (Walk.euro); emptied when the ray leaves the panel
var _press_at := Vector2(-1, -1)  # where the trigger went down: the pointer stays there within PRESS_SLOP_PX


func _ready() -> void:
	viewport = SubViewport.new()
	viewport.size = PX
	viewport.gui_embed_subwindows = true
	viewport.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	add_child(viewport)
	var panel := PanelContainer.new()
	panel.theme = _theme()
	panel.size = Vector2(PX)
	viewport.add_child(panel)
	var scroll := ScrollContainer.new()
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	panel.add_child(scroll)
	var box := VBoxContainer.new()
	box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	box.add_theme_constant_override("separation", 10)
	scroll.add_child(box)
	types = TypeRow.new()
	box.add_child(types)
	programmer = Programmer.new()
	programmer.mirror = true
	box.add_child(programmer)
	box.add_child(LooksRow.new())
	quad = MeshInstance3D.new()
	var mesh := QuadMesh.new()
	mesh.size = SIZE
	quad.mesh = mesh
	var mat := StandardMaterial3D.new()
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.cull_mode = BaseMaterial3D.CULL_DISABLED
	mat.albedo_texture = viewport.get_texture()
	quad.material_override = mat
	add_child(quad)


## The app theme (a SubViewport stops theme inheritance) with the list's selected rows in accent: the default
## unfocused highlight is a faint grey that does not show through the headset lenses (WO-771: a head picked in the
## stage looked unselected in the list).
func _theme() -> Theme:
	var root_theme := get_tree().root.theme
	var t: Theme = root_theme.duplicate() if root_theme != null else ThemeBuilder.build()
	var lit := ThemeBuilder.box(ThemeBuilder.ACCENT.darkened(0.35), ThemeBuilder.ACCENT, 1)
	for style in ["selected", "selected_focus"]:
		t.set_stylebox(style, "ItemList", lit)
	return t


## The ray this frame → a mouse move on the panel; whether it points at the panel (the trigger then clicks here, not
## in the stage). Off the panel with nothing held, the pointer leaves it. The pixel is smoothed (Walk.euro, owner 27.10:
## "too sensitive") and, while the trigger is held, kept at the press point until the ray moves PRESS_SLOP_PX away.
func point(from: Vector3, dir: Vector3, dt := 1.0 / 72.0) -> bool:
	var uv: Variant = Walk.panel_uv(quad.global_transform, SIZE, from, dir, _mask != 0) if is_visible_in_tree() else null
	if uv == null:
		_at = Vector2(-1, -1)
		_euro = {}
		return false
	var px: Vector2 = Walk.euro(_euro, (uv as Vector2) * Vector2(PX), dt).clamp(Vector2.ZERO, Vector2(PX))
	if _press_at.x >= 0.0:
		if px.distance_to(_press_at) < Walk.PRESS_SLOP_PX:
			px = _press_at
		else:
			_press_at = Vector2(-1, -1)  # a real drag: follow from here on
	var at_uv := px / Vector2(PX)
	hit_at = quad.global_transform * Vector3((at_uv.x - 0.5) * SIZE.x, (0.5 - at_uv.y) * SIZE.y, 0.0)
	if px != _at:
		var e := InputEventMouseMotion.new()
		e.relative = px - _at if _at.x >= 0.0 else Vector2.ZERO
		_at = px
		_push(e)
	return true


func pointed() -> bool:
	return _at.x >= 0.0


## WO-774: the GDTF type the controller picks (box and trigger), "" = all.
func type_filter() -> String:
	return types.type_id() if types != null else ""


## Trigger (left button) or another button, at the pointed pixel; `ctrl` = the left grip held.
func press(pressed: bool, ctrl := false, button := MOUSE_BUTTON_LEFT) -> void:
	if pressed and not pointed():
		return
	var bit := 1 << (button - 1)
	var held := button in [MOUSE_BUTTON_LEFT, MOUSE_BUTTON_RIGHT, MOUSE_BUTTON_MIDDLE]  # wheel notches are not held
	if held and not pressed and _mask & bit == 0:
		return
	var e := InputEventMouseButton.new()
	e.button_index = button
	e.pressed = pressed
	e.ctrl_pressed = ctrl
	if held:
		_mask = _mask | bit if pressed else _mask & ~bit
		_press_at = _at if pressed else Vector2(-1, -1)
	_push(e)


## One wheel notch per call (up = positive).
func scroll(up: bool) -> void:
	if not pointed():
		return
	var b := MOUSE_BUTTON_WHEEL_UP if up else MOUSE_BUTTON_WHEEL_DOWN
	press(true, false, b)
	press(false, false, b)


func _push(e: InputEventMouse) -> void:
	e.position = _at
	e.global_position = _at
	e.button_mask = _mask
	viewport.push_input(e, true)
