extends "res://e2e/e2e_scenario.gd"
## WO-837 — a two-screen timeline and its control lane: screen dividers in the layer list, Companion + light flags
## overlapping at the zoom (they stack upward in the lane at the bottom, the lane grows), the light flag's inspector,
## a layer dragged across a divider (its screenIdx follows), and the console in Devices. Setup builds the timeline in the
## client's project (the sandbox server's console store is private to the sandbox); what is checked is what the operator
## sees and what the model holds.

const LN := preload("res://features/timeline/timeline_lane.gd")
const RW := preload("res://features/timeline/timeline_rows.gd")
const TM := preload("res://features/timeline/timeline_math.gd")

var _tl := {}


func _tab() -> Node:
	return ui.root.shell.tabs.get_node("Timeline")


func _clip(id: String, start: float, dur: float) -> Dictionary:
	return {"id": id, "startTime": start, "duration": dur, "source": {"type": "media", "value": "e2e_bars", "label": "e2e_bars"}}


func _layer(name: String, clips: Array, screen := -1) -> Dictionary:
	var l := {"id": TM.uid() + name.left(2), "name": name, "clips": clips}
	if screen >= 0:
		l["screenIdx"] = screen
	return l


func _flag(id: String, ms: float, type: String, extra := {}) -> Dictionary:
	var f := {"id": id, "timeMs": ms, "type": type, "label": ""}
	f.merge(extra, true)
	return f


## The canvas point (global) of a local point in the timeline view.
func _g(p: Vector2) -> Vector2:
	return ui.screen_rect(_tab().view).position + p


func run() -> void:
	await step("A two-screen timeline with overlapping control flags", func() -> String:
		var made: Dictionary = await post("/api/lighting/consoles", {"id": "foh", "name": "MagicQ FOH", "kind": "magicq", "host": "127.0.0.1", "port": 8000})
		if not made.ok:
			return "console POST failed: %s" % made.get("error")
		await ui.tab("Timeline")
		var tab := _tab()
		_tl = {"id": "e2e_lane", "name": "E2E control lane", "duration": 30000, "fps": 25, "sendTo": {"preview": true, "program": false, "screenIdx": null},
			"screens": [0, 1],
			"layers": [_layer("Backdrop", [_clip("c1", 0, 20000)]), _layer("Logo", [_clip("c2", 4000, 9000)]),
				_layer("Dioda A", [_clip("c3", 1000, 12000)], 0), _layer("Dioda B", [_clip("c4", 6000, 15000)], 0),
				_layer("Proj A", [_clip("c5", 2000, 18000)], 1)],
			"flags": [_flag("p1", 5000, "pause"), _flag("j1", 24000, "jump", {"jumpTimeMs": 0}),
				_flag("k1", 2000, "companion_press", {"companionPage": 1, "companionRow": 0, "companionColumn": 2}),
				_flag("k2", 2300, "companion_press", {"companionPage": 1, "companionRow": 1, "companionColumn": 2}),
				_flag("l1", 2500, "light", {"consoleId": "foh", "action": "go", "list": 1, "cue": 3}),
				_flag("l2", 2900, "light", {"consoleId": "foh", "action": "fader", "fader": 4, "level": 80}),
				_flag("l3", 14000, "light", {"consoleId": "foh", "action": "release", "list": 2}),
				_flag("l4", 20000, "light", {"consoleId": "gone", "action": "command", "command": "Go+ Sequence 1"})]}
		var root: Dictionary = tab.root()
		(root.timelines as Array).append(_tl)
		root["activeId"] = "e2e_lane"
		tab.refresh()
		await ui.frames(4)
		var lane: Dictionary = tab.view.lane()
		return expect(lane.count >= 3 and tab.view.screen_names.size() >= 1 and RW.screens(_tl) == [0, 1],
			"lane rows %s (want 3+), screens %s" % [lane.count, RW.screens(_tl)])
	)
	await step("Click a light chip: the flag page shows its console and action", func() -> String:
		var view = _tab().view
		var lane: Dictionary = view.lane()
		var chip: Dictionary = {}
		for c in lane.chips:
			if c.flag.id == "l1":
				chip = c
		var r := LN.rect(chip, int(lane.count), float(view.vp().lane_top), view._x)
		await ui.click_at(_g(r.get_center()))
		await ui.frames(4)
		if view.sel_flag != "l1":
			return "chip click selected %s, not l1" % view.sel_flag
		var found: Variant = await ui.wait_for(func() -> bool: return ui.find("Label", "Lighting console", null, true) != null, 4.0)
		return "" if found else "no Lighting console section in the Inspector"
	)
	await step("A chip drags in time", func() -> String:
		var view = _tab().view
		var lane: Dictionary = view.lane()
		var chip: Dictionary = {}
		for c in lane.chips:
			if c.flag.id == "l3":
				chip = c
		var r := LN.rect(chip, int(lane.count), float(view.vp().lane_top), view._x)
		var a := _g(r.get_center())
		var why: String = await ui.press_drag(view, a, a + Vector2(60, 0))
		if why != "":
			return why
		var l3: Dictionary = {}
		for fl in _tl.flags:
			if fl.id == "l3":
				l3 = fl
		return expect(float(l3.timeMs) > 14000.0, "l3 stayed at %s" % l3.timeMs)
	)
	await step("A layer dragged across a screen divider changes its screenIdx", func() -> String:
		var view = _tab().view
		# "Dioda B" (screen 1 in the list = S1) → onto the second screen's divider; the lane is pinned, so scroll the layers
		# to the end first (both rows must be on screen)
		view.scroll_y = float(view.vp().max_scroll)
		view.queue_redraw()
		await ui.frames(2)
		var dioda := 0
		for i in _tl.layers.size():
			if _tl.layers[i].name == "Dioda B":
				dioda = i
		var from_row := RW.row_of_layer(_tl, dioda)
		var to_row: Dictionary = {}
		for r in RW.rows(_tl):
			if r.kind == "divider" and r.screen == 1:
				to_row = r
		var a := _g(Vector2(30, TM.RULER_H - view.scroll_y + float(from_row.y) + float(from_row.h) / 2.0))
		var b := _g(Vector2(30, TM.RULER_H - view.scroll_y + float(to_row.y) + float(to_row.h) / 2.0))
		var why: String = await ui.press_drag(view, a, b, 16)
		if why != "":
			return why
		var moved: Dictionary = {}
		for l in _tl.layers:
			if l.name == "Dioda B":
				moved = l
		return expect(RW.layer_screen(moved) == 1, "Dioda B screenIdx is %s (want 1)" % moved.get("screenIdx"))
	)
	await step("Devices lists the lighting console", func() -> String:
		await ui.tab("Devices")
		var found: Variant = await ui.wait_for(func() -> bool: return ui.find("Label", "MagicQ FOH", null, true) != null, 8.0)
		return "" if found else "no MagicQ FOH row under LIGHTING CONSOLES"
	)
