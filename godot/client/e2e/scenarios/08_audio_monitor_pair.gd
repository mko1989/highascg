extends "res://e2e/e2e_scenario.gd"
## WO-801 — the headphone pair picker on the PRV master strip (Audio tab). The sandbox has a PGM/PRV screen
## (tools/e2e/run-gui-e2e.js) and the first step turns audio preview on for PRV 1, so the PRV master carries the
## picker: HP Mix + one entry per stereo pair. A pick
## posts POST /api/audio/monitor-source {pair}; whatever the (simulated) Caspar answers, the picker must show what the
## server stored (`monitorPair` in /api/audio/mixer, absent = mix) and the footer says what happened.


func _picker() -> OptionButton:
	for o in ui.all("OptionButton"):
		if (o as OptionButton).item_count > 0 and (o as OptionButton).get_item_text(0) == "HP Mix":
			return o
	return null


static func _stored(d: Variant) -> String:
	return str(d.get("monitorPair", "mix")) if d is Dictionary else "mix"


func _shown_pair(o: OptionButton) -> String:
	var t := o.get_item_text(o.selected) if o != null and o.selected >= 0 else ""
	return "mix" if t == "HP Mix" else t.trim_prefix("HP ")


func run() -> void:
	await step("PRV master shows the headphone pair picker", func() -> String:
		# Setup, not under test: the headphone output (audio preview) on PRV 1 — set here, after the scenarios that reset
		# audio routing (Start fresh, project loads).
		var res: Dictionary = await post("/api/settings", {"audioRouting": {"audioPreview": {"enabled": true, "deviceName": "sc60mon"}}})
		if not res.ok:
			return "enable audio preview: %s" % res.get("error")
		await ui.tab("Audio")
		var found: Variant = await ui.wait_for(func() -> bool: return _picker() != null, 8.0)
		if not found:
			return "no HP pair picker on the Audio tab (is audioPreviewCh in the channel map?)"
		var o := _picker()
		await ui.reveal(o)
		var it: Array = ui.items(o)
		var why := expect(it.size() >= 5 and it.has("HP 1+2") and it.has("HP 3+4"), "picker items %s" % [it])
		return why if why != "" else expect(_shown_pair(o) == "mix", "a fresh box listens to the mix, picker shows %s" % _shown_pair(o))
	)
	await step("Pick HP 3+4 — the picker follows the server", func() -> String:
		var o := _picker()
		var why: String = await ui.choose(o, "HP 3+4", true, func() -> void: await ui.shot("%s_list_open" % name))
		if why != "":
			return why
		var said: Variant = await ui.wait_for(func() -> bool:
			return ui.find("Label", "Headphones:", null, false) != null, 6.0)
		if not said:
			return "no Headphones: status after the pick"
		var stored := _stored((await api("/api/audio/mixer")).get("data"))
		var status := ui.find("Label", "Headphones:", null, false) as Label
		print("[e2e] monitor pair: server stored %s, footer \"%s\"" % [stored, status.text])
		await ui.frames(3)
		return expect(_shown_pair(_picker()) == stored, "picker shows %s but the server stored %s" % [_shown_pair(_picker()), stored])
	)
	await step("Back to HP Mix", func() -> String:
		var o := _picker()
		if _shown_pair(o) != "mix":
			var why: String = await ui.choose(o, "HP Mix")
			if why != "":
				return why
		return await await_api("/api/audio/mixer", func(d: Variant) -> bool: return _stored(d) == "mix", "mixer still has a monitorPair")
	)
