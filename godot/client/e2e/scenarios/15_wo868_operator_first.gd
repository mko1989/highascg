extends "res://e2e/e2e_scenario.gd"
## WO-868 — "Operator GUI first" from the Caspar server page: with a PGM/PRV screen and an Operator GUI destination,
## the check's confirm lists what moves (GUI 3 → 1, PGM 1 → 2, PRV 2 → 3); after OK the server's channel map has the
## operator GUI on channel 1 and the generated casparcg.config opens with its shm channel. Turning it off restores the
## legacy order. Run with --air for the full apply (a throwaway Caspar on its own AMCP port; the sandbox writes the
## config, never restarts anything); without it the sandbox is in offline mode and the switch skips the config write.

const OF := preload("res://features/devices/operator_first_model.gd")

var gui_id := ""
var _before: Array = []
var _found := ""
var _confirm_text := ""


static func _dests(d: Variant) -> Array:
	return (d.get("screenDestinations", {}) as Dictionary).get("destinations", []) if d is Dictionary else []


func _has_mode(d: Variant, mode: String) -> bool:
	for x in _dests(d):
		if str(x.get("mode")) == mode:
			return true
	return false


func _add(type_label: String, mode: String) -> String:
	var why: String = await ui.choose(ui.find("OptionButton", "Destination type to add"), type_label)
	if why == "":
		why = await ui.click(ui.button("Add destination"))
	if why != "":
		return why
	return await await_api("/api/device-view", func(d: Variant) -> bool: return _has_mode(d, mode), "no %s destination on the server" % mode)


func _tab() -> Node:
	return ui.root.shell.tabs.get_node("Devices")


## Click an empty spot of the device view (the rear panel's background) → the Caspar server page in the Inspector.
func _open_server() -> String:
	var tab := _tab()
	var area: Control = tab._rear if tab._rear.visible else tab._nodes
	var r: Rect2 = ui.screen_rect(area)
	for f in [Vector2(0.98, 0.96), Vector2(0.5, 0.97), Vector2(0.03, 0.96), Vector2(0.98, 0.5)]:
		await ui.click_at(r.position + r.size * f)
		await ui.frames(3)
		if tab._server.is_open:
			break
	if not tab._server.is_open:
		return "the server page did not open from a background click"
	return expect(await ui.await_control("CheckBox", OF.TEXT, null, 10.0) != null, "no \"%s\" check on the server page" % OF.TEXT)


func _dialog() -> ConfirmationDialog:
	for d in ui.all("ConfirmationDialog", null, false):
		if (d as Window).visible:
			return d
	return null


## Toggle the check, wait for the confirm, keep its text, press OK; "" or why not.
func _toggle_and_confirm(want_on: bool) -> String:
	var why: String = await ui.click(ui.find("CheckBox", OF.TEXT))
	if why != "":
		return why
	var dlg: ConfirmationDialog = await ui.wait_for(func() -> Variant: return _dialog(), 15.0)
	if dlg == null:
		return "no confirm after the click (status: %s)" % str(_tab().get("_status_text"))
	_confirm_text = dlg.dialog_text
	await ui.shot("%s_confirm_%s" % [name, "on" if want_on else "off"])
	why = await ui.click(dlg.get_ok_button())
	if why != "":
		return why
	return await await_api("/api/system/operator-first", func(d: Variant) -> bool: return d is Dictionary and d.get("enabled") == want_on,
		"switch did not reach enabled=%s" % want_on, 90.0)


func _map() -> Dictionary:
	var s: Dictionary = (await api("/api/settings")).get("data", {})
	return s.get("channelMap", {}) if s is Dictionary else {}


func _xml() -> String:
	var r: Dictionary = await api("/api/caspar-config/generate")
	return str(r.get("data", "")) if not (r.get("data") is Dictionary) else JSON.stringify(r.data)


func run() -> void:
	await step("Open Devices", func() -> String:
		await ui.tab("Devices")
		return expect(await ui.await_control("OptionButton", "Destination type to add") != null, "no destination type select"))
	await step("A PGM/PRV screen", func() -> String:
		if _has_mode((await api("/api/device-view")).get("data"), "pgm_prv"):
			return ""
		return await _add("PGM/PRV", "pgm_prv"))
	await step("Add an Operator GUI destination", func() -> String:
		if _has_mode((await api("/api/device-view")).get("data"), "operator_gui"):
			return ""
		return await _add("Operator GUI", "operator_gui"))
	await step("Off: the operator GUI comes after PGM/PRV", func() -> String:
		var why := await await_api("/api/system/operator-first", func(d: Variant) -> bool:
			_before = (d.get("channels", {}) as Dictionary).get("before", []) if d is Dictionary else []
			return d.get("enabled") == false and d.get("refusals", []).is_empty() and not _before.is_empty(), "GET /api/system/operator-first not ready", 15.0)
		if why != "":
			return why
		var m := await _map()
		return expect(int(m.get("operatorGuiCh", 0)) > 1 and int((m.get("programChannels", [0]) as Array)[0]) == 1,
			"legacy map expected (GUI > 1, PGM1 = 1): %s" % JSON.stringify(m).left(300)))
	await step("Open the Caspar server page", func() -> String: return await _open_server())
	await step("The check is off and explains itself", func() -> String:
		var cb: CheckBox = await ui.wait_for(func() -> Variant:
			var c: CheckBox = ui.find("CheckBox", OF.TEXT)
			return c if c != null and not c.disabled else null, 15.0)
		if cb == null:
			return "the check never became enabled"
		return expect(not cb.button_pressed and ui.find("Label", OF.HINT_OFF) != null, "check state / hint wrong"))
	await step("Turn it on (confirm lists the moves)", func() -> String:
		var gui_before := 0
		for r in _before:
			if str(r.get("role")) == "operator_gui":
				gui_before = int(r.get("ch"))
		var why := await _toggle_and_confirm(true)
		if why != "":
			return why
		return expect(_confirm_text.contains("Operator GUI: %d → 1" % gui_before) and _confirm_text.contains("1 → 2"),
			"confirm text lacks the moves: " + _confirm_text.left(300)))
	await step("On: channel 1 is the operator GUI in the map and the config", func() -> String:
		var m := await _map()
		if int(m.get("operatorGuiCh", 0)) != 1 or int((m.get("programChannels", [0]) as Array)[0]) != 2:
			return "map after the switch: " + JSON.stringify(m).left(300)
		var xml := await _xml()
		return expect(xml.contains("Caspar channel 1: Operator GUI channel") and xml.contains("Caspar channel 2: Screen 1 program output"),
			"generated config does not open with the GUI channel: " + xml.left(400)))
	await step("The page shows it on", func() -> String:
		var cb: CheckBox = await ui.wait_for(func() -> Variant:
			var c: CheckBox = ui.find("CheckBox", OF.TEXT)
			return c if c != null and c.button_pressed else null, 10.0)
		return expect(cb != null and ui.find("Label", OF.HINT_ON) != null, "check not shown on / hint missing"))
	await step("Turn it off again: legacy order", func() -> String:
		var why := await _toggle_and_confirm(false)
		if why != "":
			return why
		var m := await _map()
		return expect(int((m.get("programChannels", [0]) as Array)[0]) == 1 and int(m.get("operatorGuiCh", 0)) > 1,
			"map after off: " + JSON.stringify(m).left(300)))
