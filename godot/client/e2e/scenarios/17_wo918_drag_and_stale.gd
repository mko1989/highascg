extends "res://e2e/e2e_scenario.gd"
## WO-918 — F19: press-drag-release from a destination's output dot onto a GPU port cables it (no second click);
## F12 / F24: a look editor and the Live status line do not survive New project.

var dest := ""
var tab: Node


func _sink_of(d: Variant) -> String:
	var edges: Array = ((d as Dictionary).get("graph", {}) as Dictionary).get("edges", []) if d is Dictionary else []
	for e in edges:
		if str(e.get("sourceId")) == "dst_in_" + dest:
			return str(e.get("sinkId"))
	return ""


func run() -> void:
	await step("A destination exists", func() -> String:
		await ui.tab("Devices")
		tab = ui.root.shell.tabs.get_node("Devices")
		# the release suite runs every scenario on one sandbox: take the destination THIS step adds, not the first one
		var had := {}
		for x in (await api("/api/device-view")).get("data", {}).get("screenDestinations", {}).get("destinations", []):
			had[str(x.id)] = true
		var why: String = await ui.choose(ui.find("OptionButton", "Destination type to add"), "PGM only")
		if why == "":
			why = await ui.click(ui.button("Add destination"))
		if why != "":
			return why
		return await await_api("/api/device-view", func(d: Variant) -> bool:
			for x in d.get("screenDestinations", {}).get("destinations", []):
				if not had.has(str(x.id)):
					dest = str(x.id)
			return dest != "", "no new destination")
	)
	await step("F19: dragging the output dot onto a free GPU port cables it", func() -> String:
		await tab.refresh()
		await ui.sleep(1.0)  # the rear panel and the cards lay their dots out a frame or two after the reload
		var anchors: Dictionary = tab.get("_anchors")
		var key := "dst_in_" + dest + "#pgm"
		if not anchors.has(key):
			key = "dst_in_" + dest

		# scenario 16 leaves P1 cabled (mapping node → Output 1): drop on a port nothing feeds yet
		var busy := {}
		for e in (await api("/api/device-view")).get("data", {}).get("graph", {}).get("edges", []):
			busy[str(e.get("sinkId"))] = true
		var port := ""
		for p in ["gpu_p1", "gpu_p2", "gpu_p3", "gpu_p0"]:
			if anchors.has(p) and not busy.has(p):
				port = p
				break
		if not anchors.has(key) or port == "":
			return "no anchors %s / a free gpu port (%s, busy %s)" % [key, anchors.keys(), busy.keys()]
		var a: Vector2 = (anchors[key] as Control).get_global_rect().get_center()
		var b: Vector2 = (anchors[port] as Control).get_global_rect().get_center()
		ui._move(a, 0)
		await ui.frames(1)
		ui._button(a, MOUSE_BUTTON_LEFT, true, false)
		await ui.frames(1)
		for i in range(1, 21):
			ui._move(a.lerp(b, i / 20.0), MOUSE_BUTTON_MASK_LEFT)
			await ui.frames(1)
		ui._button(b, MOUSE_BUTTON_LEFT, false, false)
		await ui.frames(3)
		var why := await await_api("/api/device-view", func(d: Variant) -> bool: return _sink_of(d) == port, "the drag did not cable " + port)
		if why != "":
			return why
		return expect(bool(await ui.wait_for(func() -> bool: return not tab.get("_gesture").armed() and not tab.get("_gesture").busy, 6.0)), "still armed after the drop")
	)
	await step("F19: a plain click on the dot still arms click-click mode", func() -> String:
		await tab.refresh()
		await ui.sleep(1.0)  # the rear panel and the cards lay their dots out a frame or two after the reload
		var anchors: Dictionary = tab.get("_anchors")
		var key := "dst_in_" + dest + "#pgm"
		if not anchors.has(key):
			key = "dst_in_" + dest
		var a: Vector2 = (anchors[key] as Control).get_global_rect().get_center()
		await ui.click_at(a)
		var ok := bool(await ui.wait_for(func() -> bool: return tab.get("_gesture").armed(), 3.0))
		tab.get("_gesture").cancel()
		return expect(ok, "a click no longer arms the cable")
	)
	await step("F12/F24: New look opens the editor and says so", func() -> String:
		await ui.tab("Live")
		var live: Node = ui.root.shell.tabs.get_node("Live")
		await ui.sleep(1.0)
		var why: String = await ui.click(ui.button("+", live.deck))
		if why != "":
			return why
		var ok := bool(await ui.wait_for(func() -> bool: return live.editor.visible, 4.0))
		return expect(ok and live._action.text != live.ACTION_HINT, "editor %s, status '%s'" % [live.editor.visible, live._action.text])
	)
	await step("F12/F24: New project closes the editor and clears the status line", func() -> String:
		var live: Node = ui.root.shell.tabs.get_node("Live")
		var why: String = await ui.click(ui.button("New project"))
		if why == "":
			why = await ui.click(await ui.await_control("BaseButton", "Start fresh", null, 3.0))
		if why != "":
			return why
		var ok := bool(await ui.wait_for(func() -> bool: return not live.editor.visible and live._action.text == live.ACTION_HINT, 6.0))
		return expect(ok, "editor visible=%s status='%s'" % [live.editor.visible, live._action.text])
	)
