extends "res://e2e/e2e_scenario.gd"
## WO-864 — grabbing a rear-panel cable with the pointer (owner 30.10): a drag on the cable's body swings it with both
## plugs in; a drag that starts on a plug (within cable_grab.gd END_PX of the port dot, outside the dot itself) pulls
## it out — let go in empty space removes the cable (Ctrl+Z restores it), let go on another port moves it there.
## Real mouse events through the viewport; the server's device graph is the truth.

var dest := ""
var edge := ""
var tab: Node
var layer: Control


func _edges(d: Variant) -> Array:
	return ((d as Dictionary).get("graph", {}) as Dictionary).get("edges", []) if d is Dictionary else []


func _sink_of(d: Variant) -> String:
	for e in _edges(d):
		if str(e.get("sourceId")) == "dst_in_" + dest:
			return str(e.get("sinkId"))
	return ""


## The cable's id and its drawn ends once the layer has laid it (global px).
func _laid() -> bool:
	return bool(await ui.wait_for(func() -> bool:
		for id in layer.get("_ends"):
			edge = id
			return layer.get("_ropes").has(id)
		return false, 8.0))


func _to_global(local: Vector2) -> Vector2:
	return layer.get_global_transform() * local


## Press at `a`, move to `b` in steps with the button held, run `held` (checks while holding), then release at `b`.
func _pull(a: Vector2, b: Vector2, held: Callable) -> String:
	ui._move(a, 0)
	await ui.frames(1)
	ui._button(a, MOUSE_BUTTON_LEFT, true, false)
	await ui.frames(1)
	for i in range(1, 21):
		ui._move(a.lerp(b, i / 20.0), MOUSE_BUTTON_MASK_LEFT)
		await ui.frames(1)
	await ui.sleep(0.3)
	var why: String = await held.call()
	await ui.shot("%s_held" % name)
	ui._button(b, MOUSE_BUTTON_LEFT, false, false)
	await ui.frames(3)
	return why


func run() -> void:
	await step("A destination cabled to P1", func() -> String:
		await ui.tab("Devices")
		tab = ui.root.shell.tabs.get_node("Devices")
		layer = tab.get("_cables")
		var why: String = await ui.choose(ui.find("OptionButton", "Destination type to add"), "PGM only")
		if why == "":
			why = await ui.click(ui.button("Add destination"))
		if why != "":
			return why
		why = await await_api("/api/device-view", func(d: Variant) -> bool:
			var ds: Array = d.get("screenDestinations", {}).get("destinations", [])
			dest = str(ds[0].id) if not ds.is_empty() else ""
			return dest != "", "no destination")
		if why != "":
			return why
		var r: Dictionary = await post("/api/device-view", {"addEdge": {"sourceId": "dst_in_" + dest, "sinkId": "gpu_p1"}})
		if not r.ok:
			return "addEdge: %s" % r.get("error")
		await tab.refresh()
		return expect(await _laid(), "the cable never hung on the rear panel")
	)
	await step("Dragging the body swings it, both plugs stay in", func() -> String:
		var pts: PackedVector2Array = layer.get("_ropes")[edge].points_owned()[0]
		var a := _to_global(pts[pts.size() / 2])
		var b := a + Vector2(-60, 140)
		var why: String = await _pull(a, b, func() -> String:
			var held: PackedVector2Array = layer.get("_ropes")[edge].points_owned()[0]
			var near := INF
			for p in held:
				near = minf(near, _to_global(p).distance_to(b))
			if near > 12.0:
				return "the rope did not follow the pointer (nearest point %.0f px away)" % near
			return expect(not tab.get("_gesture").armed(), "a body drag lifted a plug"))
		if why != "":
			return why
		return expect(_sink_of((await api("/api/device-view")).data) == "gpu_p1", "the cable changed after a body drag")
	)
	await step("A click on the plugged socket still opens its port page", func() -> String:
		var a := _to_global(layer.get("_ends")[edge][1]) + Vector2(0, 11)
		await ui.click_at(a)
		var ok := bool(await ui.wait_for(func() -> bool: return ui.field("Rear port") != null, 4.0))
		return expect(ok and _sink_of((await api("/api/device-view")).data) == "gpu_p1" and tab.get("_gesture").regrab.is_empty(),
			"no port page (or the click moved the cable)")
	)
	await step("Pulling the plug into empty space removes the cable", func() -> String:
		var ends: Array = layer.get("_ends")[edge]
		var a := _to_global(ends[1]) + Vector2(0, 11)  # on the plug boot, just outside the dot (12 px, hit rect + 3)
		var why: String = await _pull(a, a + Vector2(-220, 260), func() -> String:
			return expect(not tab.get("_gesture").regrab.is_empty() and layer.hidden_id == edge,
				"the plug did not come out (regrab %s, hidden %s)" % [tab.get("_gesture").regrab, layer.hidden_id]))
		if why != "":
			return why
		return await await_api("/api/device-view", func(d: Variant) -> bool: return _sink_of(d) == "", "the cable is still there")
	)
	await step("Ctrl+Z puts it back", func() -> String:
		var said: String = tab.get("_bar").get("_status").text if tab.get("_bar").get("_status") is Label else ""
		ui._move(Vector2(900, 700), 0)
		ui._key(KEY_Z, 0, true)
		var why := await await_api("/api/device-view", func(d: Variant) -> bool: return _sink_of(d) == "gpu_p1", "undo did not restore it")
		if why == "":
			await tab.refresh()
			why = expect(await _laid(), "the restored cable never hung again")
		return why if why != "" or said == "" else expect(said.contains("Ctrl+Z"), "status after the pull: %s" % said)
	)
	await step("Pulling the plug onto P2 moves the cable there", func() -> String:
		var ends: Array = layer.get("_ends")[edge]
		var a := _to_global(ends[1]) + Vector2(0, 11)
		var p2: Control = tab.get("_anchors")["gpu_p2"]
		var why: String = await _pull(a, p2.get_global_rect().get_center(), func() -> String: return "")
		if why != "":
			return why
		return await await_api("/api/device-view", func(d: Variant) -> bool: return _sink_of(d) == "gpu_p2", "the cable did not move to P2")
	)
