extends RefCounted
## WO-1008 — app/view_focus.gd (a view full screen with the Inspector floating, hideable) and the previs camera's
## middle-drag pan (previs_stage.gd pan()).

const ViewFocus := preload("res://app/view_focus.gd")
const InspectorPanel := preload("res://app/inspector_panel.gd")
const PrevisStage := preload("res://features/previs/previs_stage.gd")
var t


func test_full_screen_floats_the_inspector_and_puts_it_back() -> void:
	var was: Variant = InspectorPanel.current
	var was_chrome := ViewFocus.chrome
	var shell := VBoxContainer.new()
	shell.size = Vector2(1600, 900)
	var header := Control.new()
	shell.add_child(header)
	var cols := HSplitContainer.new()
	cols.size_flags_vertical = Control.SIZE_EXPAND_FILL
	shell.add_child(cols)
	var sources := Control.new()
	cols.add_child(sources)
	var right := HSplitContainer.new()
	right.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	cols.add_child(right)
	var tabs := TabContainer.new()
	tabs.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	right.add_child(tabs)
	var insp: Control = InspectorPanel.new()
	insp.custom_minimum_size.x = 400
	right.add_child(insp)
	var page := VBoxContainer.new()
	page.name = "Previs"
	tabs.add_child(page)
	var host := Control.new()
	host.size_flags_vertical = Control.SIZE_EXPAND_FILL
	page.add_child(host)
	ViewFocus.chrome = [header, sources]
	t.root.add_child(shell)
	var focus: Node = ViewFocus.new()
	var btn: Button = focus.setup(page, host)
	page.add_child(btn)
	await t.process_frame
	await t.process_frame
	btn.button_pressed = true
	await t.process_frame
	await t.process_frame
	t.ok(focus.on, "the button turns full screen on")
	t.ok(not header.visible and not sources.visible and not tabs.tabs_visible, "header, Sources and the tab strip hidden")
	t.ok(insp.get_parent() != right and host.is_ancestor_of(insp), "the Inspector floats over the view")
	t.ok(not insp._footer.visible, "without its footer sections")
	var fl: Control = focus._float
	t.ok(fl.position.x + fl.size.x <= host.size.x and fl.position.x > host.size.x / 2.0, "against the view's right edge")
	t.ok(fl.size.y > host.size.y - 20.0, "the view's height")
	focus.set_shown(false)
	t.ok(not fl.visible and focus._reopen.visible, "Hide leaves the corner Inspector button")
	focus._reopen.pressed.emit()
	t.ok(fl.visible and not focus._reopen.visible, "the corner button brings it back")
	btn.button_pressed = false
	await t.process_frame
	t.ok(header.visible and sources.visible and tabs.tabs_visible, "the chrome comes back")
	t.eq(insp.get_parent(), right, "the Inspector is back in its column")
	t.eq(insp.get_index(), 1, "on the right of the tabs")
	t.ok(insp._footer.visible and not fl.visible, "footer back, float gone")
	shell.queue_free()
	ViewFocus.chrome = was_chrome
	InspectorPanel.current = was if is_instance_valid(was) else null


func test_middle_drag_pans_the_stage_camera() -> void:
	var sv := SubViewport.new()
	sv.size = Vector2i(1000, 500)
	sv.own_world_3d = true
	t.root.add_child(sv)
	var st: Node3D = PrevisStage.new()
	sv.add_child(st)
	await t.process_frame
	st._yaw = 0.0
	st._pitch = 0.0
	st._dist = 10.0
	st._update_camera()
	var t0: Vector3 = st._target
	var press := InputEventMouseButton.new()
	press.button_index = MOUSE_BUTTON_MIDDLE
	press.pressed = true
	st.handle_input(press)
	var mm := InputEventMouseMotion.new()
	mm.relative = Vector2(100, 0)
	st.handle_input(mm)
	t.eq(st._yaw, 0.0, "middle drag does not orbit")
	var d: Vector3 = st._target - t0
	t.ok(d.x < -0.1 and absf(d.y) < 1e-4 and absf(d.z) < 1e-4, "drag right → the view point moves left (stage follows the mouse): %s" % d)
	var per_px := 2.0 * 10.0 * tan(deg_to_rad(50.0) * 0.5) / 500.0
	t.ok(absf(d.x + 100.0 * per_px) < 1e-3, "one pixel of drag = one pixel of picture at the orbit point")
	mm.relative = Vector2(0, 50)
	st.handle_input(mm)
	t.ok(st._target.y - t0.y > 0.1, "drag down → the view point moves up")
	press.pressed = false
	st.handle_input(press)
	var at: Vector3 = st._target
	st.handle_input(mm)
	t.eq(st._target, at, "released: no more panning")
	sv.queue_free()
