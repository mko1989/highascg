extends "res://e2e/e2e_scenario.gd"
## WO-741 (detachable) — the Previs tab walked at 1:1 with the client flag -- --xr, no headset: the walk camera is the
## one the previs renders and picks through, W walks, a left-drag looks, and a right-press on the floor with heads
## selected aims them (the request the Programmer's Point at sends), through the walk camera. WO-757: the Programmer panel
## the headset wears on the left wrist, held in front of the walk camera here, works by ray: a trigger on Groups opens
## its menu inside the panel, Store under it answers.
## Runs only with `node tools/e2e/run-gui-e2e.js --xr` (else one step says it was not run).

const F := preload("res://features/previs/fixtures/fixtures_3d_model.gd")
const Sel := preload("res://features/previs/fixtures/fixture_selection.gd")
const Walk := preload("res://features/previs/xr/xr_walk_model.gd")
const XrPanel := preload("res://features/previs/xr/xr_panel.gd")

var page: Control  # a member: lambdas capture locals by value
var panel: Node3D


## The trigger on `c` (a control in the panel): the ray from the walk camera through it, down and up through the walk.
func _ray_click(c: Control) -> void:
	var uv := c.get_global_rect().get_center() / Vector2(XrPanel.PX)
	var at: Vector3 = panel.quad.global_transform * Vector3((uv.x - 0.5) * XrPanel.SIZE.x, (0.5 - uv.y) * XrPanel.SIZE.y, 0.0)
	var from: Vector3 = page.stage.camera().global_position
	panel.point(from, (at - from).normalized())
	await ui.frames(1)
	page.stage.walk.trigger(true, false)
	await ui.frames(1)
	page.stage.walk.trigger(false, false)
	await ui.frames(2)


func _hold(code: Key, s: float) -> void:
	for pressed in [true, false]:
		var e := InputEventKey.new()
		e.keycode = code
		e.physical_keycode = code
		e.pressed = pressed
		Input.parse_input_event(e)  # the walk polls held keys (Input), not events
		if pressed:
			await ui.sleep(s)


func run() -> void:
	if not Config.args.has("xr"):
		await step("Not run (needs --xr)", func() -> String: return "")
		return
	await step("Previs renders through the walk camera at eye height", func() -> String:
		page = await ui.tab("Previs")
		var st: Node3D = page.stage
		if st.walk == null:
			return "no walk on the Previs stage"
		var cam: Camera3D = st.camera()
		return expect(cam == st.walk.camera() and cam.current and absf(cam.position.y - Walk.EYE) < 1e-3,
			"camera %s current=%s y=%s" % [cam, cam.current, cam.position.y])
	)
	await step("W walks upstage", func() -> String:
		var cam: Camera3D = page.stage.camera()
		var z0 := cam.position.z
		await _hold(KEY_W, 0.5)
		return expect(cam.position.z < z0 - 0.3, "z %s → %s" % [z0, cam.position.z])
	)
	await step("Left-drag looks around", func() -> String:
		var cam: Camera3D = page.stage.camera()
		var c: Vector2 = ui.screen_rect(page._svc).get_center()
		ui._move(c, 0)
		ui._button(c, MOUSE_BUTTON_LEFT, true, false)
		await ui.frames(1)
		for i in 10:
			ui._move(c + Vector2(15 * (i + 1), 0), MOUSE_BUTTON_MASK_LEFT)
			await ui.frames(1)
		ui._button(c + Vector2(150, 0), MOUSE_BUTTON_LEFT, false, false)
		await ui.frames(2)
		return expect(cam.rotation.y < -0.2, "yaw %s" % cam.rotation.y)
	)
	await step("Right-press on the floor aims the selection", func() -> String:
		var cam: Camera3D = page.stage.camera()
		var sent: Array = []
		var keep: Callable = page.aim_drag.post
		page.aim_drag.post = func(b: Dictionary) -> Dictionary:
			sent.append(b)
			return {"ok": true}
		Sel.shared().set_ids(["e2e-head"])
		var r: Rect2 = ui.screen_rect(page._svc)
		var p := r.position + Vector2(r.size.x * 0.5, r.size.y * 0.8)  # below the horizon: the floor
		ui._move(p, 0)
		ui._button(p, MOUSE_BUTTON_RIGHT, true, false)
		await ui.frames(2)
		ui._button(p, MOUSE_BUTTON_RIGHT, false, false)
		await ui.frames(2)
		page.aim_drag.post = keep
		Sel.shared().set_ids([])
		if sent.is_empty():
			return "no aim request"
		var local := (page._svc as Control).get_global_transform_with_canvas().affine_inverse() * p
		var at: Variant = F.floor_hit(cam.project_ray_origin(local), cam.project_ray_normal(local))
		var t: Array = sent[0].target
		print("[e2e] aim ", JSON.stringify(sent[0]), " camera ", cam.position)
		return expect(sent[0].ids == ["e2e-head"] and at != null and Vector2(t[0], t[1]).distance_to(Vector2(at.x, -at.z)) < 0.05,
			"sent %s, expected the floor at %s" % [JSON.stringify(sent[0]), at])
	)
	await step("The Programmer panel works by ray", func() -> String:
		var walk: Node3D = page.stage.walk
		panel = XrPanel.new()
		walk.panel = panel
		walk.add_child(panel)
		panel.global_transform = page.stage.camera().global_transform * Transform3D(Basis(), Vector3(0, 0, -0.45))
		await ui.frames(4)
		var groups: MenuButton = panel.programmer._groups
		await _ray_click(groups)
		var opened := groups.get_popup().visible
		print("[e2e] panel groups menu ", opened, " embedded ", panel.viewport.gui_embed_subwindows)
		groups.get_popup().hide()
		var keep: Variant = Store.project.get("scenes")
		Store.project["scenes"] = {"scenes": [{"id": "e2e-look", "name": "E2E look"}]}
		Store.project_changed.emit(Store.project)
		var row: Node = panel.programmer.get_parent().get_child(panel.programmer.get_index() + 1)  # WO-774: the type row is above
		var store: Button = row.get_child(0).get_child(2)
		row.status.text = ""
		await ui.frames(2)
		await _ray_click(store)
		await ui.sleep(0.5)
		var said: String = row.status.text
		var lid: String = row.look_id()
		print("[e2e] panel store on ", lid, ": ", said)
		Store.project["scenes"] = keep
		Store.project_changed.emit(Store.project)
		return expect(opened and panel.pointed() and lid == "e2e-look" and said.begins_with("Programmer is empty"),
			"groups menu %s, store said '%s'" % [opened, said])
	)
