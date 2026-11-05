extends "res://e2e/e2e_scenario.gd"
## WO-959 — one tick button for Test card (header) and Border (deck column header): the label opens the options, the
## tick switches it; the toolbar's "Screens" lists every screen with an eye, and a hidden screen can still be made a
## look-preset destination.

const Destinations := preload("res://features/live/destinations.gd")
const DeckHidden := preload("res://features/live/deck_hidden.gd")
const BorderSwitch := preload("res://features/live/border_switch.gd")


func _tick_of(label_btn: Control) -> CheckBox:
	var tb: Node = label_btn.get_parent().get_parent() if label_btn != null else null
	return tb.get("tick") if tb != null else null


func _test_dialog() -> Window:
	for w in ui.root.find_children("*", "Window", true, false):
		if (w as Window).title == "LED test card":
			return w
	return null


static func _has_pgm_prv(d: Variant) -> bool:
	for x in ((d.get("screenDestinations", {}) as Dictionary).get("destinations", []) if d is Dictionary else []):
		if str(x.get("mode")) == "pgm_prv":
			return true
	return false


func run() -> void:
	await step("A PGM/PRV screen (the border route needs one)", func() -> String:
		await ui.tab("Devices")
		if _has_pgm_prv((await api("/api/device-view")).get("data")):
			return ""
		var why: String = await ui.choose(await ui.await_control("OptionButton", "Destination type to add", null, 10.0), "PGM/PRV")
		if why == "":
			why = await ui.click(ui.button("Add destination"))
		if why != "":
			return why
		return await await_api("/api/device-view", func(d: Variant) -> bool: return _has_pgm_prv(d), "no PGM/PRV destination on the server"))
	await step("Open Live", func() -> String:
		await ui.tab("Live")
		return expect(await ui.await_control("Button", "Border ▾", null, 15.0) != null, "no Border tick button in a column header"))
	await step("A show on the server (the border slot lives in the project)", func() -> String:
		var why: String = await ui.click(ui.button("New project"))
		if why == "":
			why = await ui.click(await ui.await_control("BaseButton", "Start fresh", null, 3.0))
		if why != "":
			return why
		return await await_api("/api/project", func(d: Variant) -> bool:
			var p: Variant = d.get("project", d) if d is Dictionary else null
			return p is Dictionary and p.get("scenes") is Dictionary, "no project on the server", 10.0))
	await step("Test card: the label opens the options, not the switch", func() -> String:
		var lbl: Control = ui.find("Button", "Test card ▾")
		if lbl == null:
			return "no Test card tick button in the header"
		var tick := _tick_of(lbl)
		var was: bool = tick.button_pressed
		var why: String = await ui.click(lbl)
		if why != "":
			return why
		var dlg: Variant = await ui.wait_for(func() -> Variant:
			var d := _test_dialog()
			return d if d != null and d.visible else null, 5.0)
		if dlg == null:
			return "the options dialog did not open"
		(dlg as Window).hide()
		return expect(tick.button_pressed == was, "the label click switched the test card"))
	await step("Border: the tick sends the switch (no Inspector page)", func() -> String:
		var tick := _tick_of(ui.find("Button", "Border ▾"))
		if tick == null:
			return "no tick on the Border button"
		var why: String = await ui.click(tick)
		if why != "":
			return why
		# The slot is adopted only from an ok POST /api/scene/global-border reply. The offline sandbox's route map has
		# 0 screens, so there the server refuses and the deck must say so (the live server's reply: WO-959 §3).
		var res: Variant = await ui.wait_for(func() -> Variant:
			if BorderSwitch.is_on(0):
				return "on"
			return "refused" if ui.find("Label", "Border on failed: ", null, false) != null else null, 10.0)
		if res == null:
			return "neither on nor a failure notice after the tick"
		return expect(ui.find("Label", "Global border — ", null, false) == null, "the tick opened the Inspector page"))
	await step("Border: the label opens the options", func() -> String:
		var why: String = await ui.click(ui.find("Button", "Border ▾"))
		if why != "":
			return why
		return expect(await ui.await_control("Label", "Global border — ", null, 5.0, false) != null, "the border Inspector page did not open"))
	await step("Screens: hide screen 1 with its eye in the menu", func() -> String:
		Destinations.set_only([])
		var why: String = await ui.click(ui.find("Button", "Screens ▾"))
		if why != "":
			return why
		var eye: Control = await ui.await_control("Button", "Shown in this deck — click to hide its column (its looks stay on the show)", null, 5.0)
		if eye == null:
			return "no eye next to the screen in the Screens menu"
		why = await ui.click(eye)
		if why != "":
			return why
		return expect(await ui.wait_for(func() -> bool: return DeckHidden.is_hidden(0), 3.0) == true and ui.find("Button", "Border ▾") == null,
			"screen 1's column is still in the deck"))
	await step("Screens: the hidden screen can still be made a destination", func() -> String:
		var dest: Control = await ui.await_control("Button", "Destination for look presets: click to highlight / unhighlight — a preset saves and recalls the highlighted screens", null, 5.0)
		if dest == null:
			return "the menu row for screen 1 is gone"
		var why: String = await ui.click(dest)
		if why != "":
			return why
		if not await ui.wait_for(func() -> bool: return Destinations.selected() == [0], 3.0):
			return "screen 1 is not highlighted: %s" % [Destinations.selected()]
		return expect(ui.find("Button", "Screens · 1 hidden, 1 selected ▾") != null, "the toolbar caption does not say a hidden screen is selected"))
	await step("Screens: Show all brings the column back, still a destination", func() -> String:
		var why: String = await ui.click(ui.find("Button", "Show all"))
		if why != "":
			return why
		var back: Variant = await ui.await_control("Button", "Border ▾", null, 5.0)
		var ok: bool = back != null and Destinations.selected() == [0]
		Destinations.set_only([])
		return expect(ok, "column not back or destination lost"))
