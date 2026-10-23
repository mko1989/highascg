extends "res://e2e/e2e_scenario.gd"
## WO-719 — content on layers: drag a clip from Sources → Media onto the deck's "+" (new look), drop a still into the
## open look editor (second layer), close it, click the card (PRV), double-click it (TAKE). Checked three ways: the
## deck card, the stored project, and what the (simulated) Caspar is actually playing on the PRV / PGM channel.

const CLIP := "e2e_bars"
const STILL := "e2e_still"


static func _looks(d: Variant) -> Array:
	var p: Dictionary = d.get("project", d) if d is Dictionary else {}
	return (p.get("scenes", {}) as Dictionary).get("scenes", [])


static func _layer_values(look: Dictionary) -> String:
	return " ".join((look.get("layers", []) as Array).map(func(l: Dictionary) -> String:
		return str((l.get("source", {}) as Dictionary).get("value", "")).to_lower()))


func _media_tree() -> Tree:
	var sources: Array = ui.root.shell.find_children("*", "Tree", true, false).filter(func(t: Tree) -> bool:
		return ui.shown(t) and ui.tree_item(t, CLIP) != null)
	return sources[0] if not sources.is_empty() else null


## The server's channel map (GET /api/settings → buildChannelMap): it stages PRV / takes PGM, so it is the truth.
func _channel(kind: String) -> int:
	var r: Dictionary = await api("/api/settings")
	var cm: Variant = r.data.get("channelMap") if r.get("data") is Dictionary else null
	var list: Array = (cm as Dictionary).get(kind, []) if cm is Dictionary else []
	return int(list[0]) if not list.is_empty() else 0


## "" once Caspar's INFO <ch> mentions `what` (the sim answers with the stage XML of its playback state).
func _playing(ch: int, what: String) -> String:
	if ch <= 0:
		return "no channel in channelMap"
	var until := Time.get_ticks_msec() + 8000
	var xml := ""
	while Time.get_ticks_msec() < until:
		var r: Dictionary = await post("/api/amcp/raw", {"cmd": "INFO %d" % ch})
		xml = JSON.stringify(r.get("data")).to_lower()
		if xml.contains(what):
			return ""
		await ui.sleep(0.3)
	return "channel %d is not playing %s (INFO: %s)" % [ch, what, xml.left(300)]


func run() -> void:
	# Setup, not under test (02_outputs drives the GUI add): a fresh sandbox has no screen, so no PRV / PGM channel.
	# The Devices panel's own add() — the "+" handler, settings seed included — gives this scenario one when run alone.
	await step("A PGM/PRV screen exists", func() -> String:
		if await _channel("previewChannels") <= 0:
			await ui.root.shell.tabs.get_node("Devices").get("_dests").add("pgm_prv")
		var until := Time.get_ticks_msec() + 10000
		while Time.get_ticks_msec() < until:
			if await _channel("previewChannels") > 0 and await _channel("programChannels") > 0:
				return ""
			await ui.sleep(0.3)
		return "no PRV / PGM channel in the server channelMap after adding a PGM/PRV screen"
	)
	await step("Media list shows the test clips", func() -> String:
		await ui.tab("Live")
		var why: String = await ui.pick_tab("Media")
		if why != "":
			return why
		return expect(await ui.wait_for(_media_tree, 15.0) != null, "%s never appeared in Sources → Media" % CLIP)
	)
	await step("Drag the clip onto + makes a look", func() -> String:
		var tree := _media_tree()
		var plus: Control = await ui.await_control("BaseButton", "New look — or drop a media file here / on empty deck space")
		var why: String = await ui.drag_from(ui.tree_item_point(tree, ui.tree_item(tree, CLIP)), plus)
		if why != "":
			return why
		return await await_api("/api/project", func(d: Variant) -> bool:
			var looks := _looks(d)
			return looks.size() == 1 and _layer_values(looks[0]).contains(CLIP), "no look holding %s" % CLIP)
	)
	await step("Drop a still into the open look editor", func() -> String:
		var ed: Node = ui.root.shell.tabs.get_node("Live").editor
		if not await ui.wait_for(func() -> bool: return ui.shown(ed._frame), 5.0):
			return "the look editor did not open after the drop"
		var tree := _media_tree()
		var why: String = await ui.drag_from(ui.tree_item_point(tree, ui.tree_item(tree, STILL)), ed._frame)
		if why != "":
			return why
		return await await_api("/api/project", func(d: Variant) -> bool:
			var looks := _looks(d)
			return looks.size() == 1 and (looks[0].get("layers", []) as Array).size() == 2 and _layer_values(looks[0]).contains(STILL),
			"look did not gain the %s layer" % STILL)
	)
	await step("Close the editor shows the card", func() -> String:
		var why: String = await ui.click(ui.button("Close"))
		if why != "":
			return why
		return expect(await ui.await_control("Control", "Click: stage on PRV · Double-click: TAKE to PGM · Right-click: rename / transition") != null,
			"no look card on the deck")
	)
	await step("Click the card stages it on PRV", func() -> String:
		var why: String = await ui.click(ui.find("Control", "Click: stage on PRV · Double-click: TAKE to PGM · Right-click: rename / transition"))
		if why != "":
			return why
		return await _playing(await _channel("previewChannels"), CLIP)
	)
	await step("Double-click takes it to PGM", func() -> String:
		var why: String = await ui.click(ui.find("Control", "Click: stage on PRV · Double-click: TAKE to PGM · Right-click: rename / transition"), true)
		if why != "":
			return why
		return await _playing(await _channel("programChannels"), CLIP)
	)
