extends "res://e2e/e2e_scenario.gd"
## WO-866 — the Visuals Inspector page's Audio controls, driven with real mouse drags:
##  1. the Kick sensitivity slider shows the box's value and a drag reaches the box (GET /api/audio/parts-sensitivity);
##  2. the Sync slider is stored in the project (`project.visuals.sync`) and its label follows.


func _project(d: Variant) -> Dictionary:
	return d.get("project", d) if d is Dictionary else {}


func _slider(tip_start: String) -> HSlider:
	for c in ui.all("HSlider", null, false):
		if (c as Control).is_visible_in_tree() and (c as Control).tooltip_text.begins_with(tip_start):
			return c
	return null


## Drag the grabber from its value to `frac` of the track.
func _drag_to(s: HSlider, frac: float) -> String:
	await ui.reveal(s)
	var r: Rect2 = ui.screen_rect(s)
	var at := func(f: float) -> Vector2: return Vector2(r.position.x + r.size.x * f, r.position.y + r.size.y * 0.5)
	var from := (s.value - s.min_value) / (s.max_value - s.min_value)
	return await ui.press_drag(s, at.call(from), at.call(frac))


func run() -> void:
	var kick: HSlider
	await step("1 Kick sensitivity drag reaches the box", func() -> String:
		await ui.tab("Visuals")
		await ui.frames(10)
		kick = _slider("How easily a kick")
		if kick == null:
			return "no Kick sensitivity slider on the Visuals Inspector page"
		var r0: Dictionary = await api("/api/audio/parts-sensitivity")
		if not r0.get("ok"):
			return "GET parts-sensitivity failed: %s" % r0
		if absf(kick.value - float(r0.data.sensitivity.kick)) > 1e-6:
			return "slider %.2f, box %.2f before the drag" % [kick.value, r0.data.sensitivity.kick]
		var why: String = await _drag_to(kick, 0.9)
		if why != "":
			return why
		if kick.value < 0.8:
			return "the slider sits at %.2f after the drag" % kick.value
		var want := kick.value
		return await await_api("/api/audio/parts-sensitivity", func(d: Variant) -> bool:
			return absf(float(d.sensitivity.kick) - want) < 1e-6 and float(d.sensitivity.snare) == 0.5,
			"the box never got kick %.2f (snare untouched)" % want)
	)
	await step("2 Sync drag is stored in the project", func() -> String:
		var sync := _slider("Sync")
		if sync == null:
			return "no Sync slider"
		var why: String = await _drag_to(sync, 0.2)
		if why != "":
			return why
		if sync.value > -150.0:
			return "Sync sits at %d ms after the drag" % int(sync.value)
		var want := sync.value
		var label: Control = ui.find("Label", "%+d ms" % int(want), sync.get_parent())
		if label == null:
			return "no '%+d ms' label next to the slider" % int(want)
		return await await_api("/api/project", func(d: Variant) -> bool:
			var v: Variant = _project(d).get("visuals")
			return v is Dictionary and float(v.get("sync", 0)) == want, "project.visuals.sync never became %d" % int(want), 15.0)
	)
	await step("3 Reset both (the sandbox keeps the defaults)", func() -> String:
		var why: String = await _drag_to(_slider("Sync"), 0.5)
		if why != "":
			return why
		await post("/api/audio/parts-sensitivity", {"kick": 0.5, "snare": 0.5, "hats": 0.5})
		return expect(absf(_slider("Sync").value) < 6.0, "Sync back near 0")
	)
