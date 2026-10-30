extends "res://e2e/e2e_scenario.gd"
## WO-857 — the lighting console's head selection mirrored in the previs, end to end through the real UDP path:
## this scenario plays the grandMA3 Lua plugin (tools/lighting/grandma3/highascg_selection.lua): it sends the plugin's
## `HACG-SEL 1 gma3 <seq> <FIDs>` datagrams to the sandbox server's listener (127.0.0.1 only, HIGHASCG_E2E_GMA3_PORT);
## the server maps the head numbers to patch fixtures and broadcasts fixtures:console_selection; the previs draws the
## console's heads with a cyan box once "Follow console selection" is ticked, and the operator's own selection (amber)
## is never touched, except by the explicit Take button.
## Needs tools/e2e/console-selection-fixture.js (run-gui-e2e.js starts it for this scenario): project e2e_console_selection
## = seven loopback heads, MAC Quantum Profile 11..16 and Vizi Beam CMY 121 with fid 11..16 / 121.

const Con := preload("res://features/previs/fixtures/console_selection.gd")
const Sel := preload("res://features/previs/fixtures/fixture_selection.gd")
const SLUG := "e2e_console_selection"
const FOLLOW := "Follow console selection"

var udp := PacketPeerUDP.new()
var seq := 1790000000
var ids := {}  # fid → patch fixture id
var f3: Node  # the Previs tab's fixture rig
var check: CheckBox


func _in_tree(cls: String, text: String) -> Control:
	for c in ui.all(cls, null, false):
		if (c as Control).is_visible_in_tree() and ui.label_of(c) == text:
			return c
	return null


## Play the plugin: one datagram with this FID list ("11-13", "-" = nothing).
func _plugin_sends(fids: String) -> void:
	seq += 1
	udp.put_packet(("HACG-SEL 1 gma3 %d %s" % [seq, fids]).to_utf8_buffer())


## The patch ids of the heads wearing the console mark right now.
func _marked() -> Array:
	var out: Array = []
	for id in f3.get("_fx"):
		if (f3.get("_fx")[id].cmark as MeshInstance3D).visible:
			out.append(id)
	out.sort()
	return out


func _want(fids: Array) -> Array:
	var out: Array = fids.map(func(f: int) -> String: return ids[f])
	out.sort()
	return out


## Wait for the client's console set to hold exactly these head numbers.
func _client_has(heads: Array) -> String:
	var hit: Variant = await ui.wait_for(func() -> bool: return Con.shared().heads == heads, 6.0)
	return "" if hit else "the client's console set is %s, want %s (feed nodes %d, Ws open %s, ids %s)" % [Con.shared().heads, heads, 0, Ws.is_open, Con.shared().ids]


func run() -> void:
	await step("Load the project; the plugin listener is up", func() -> String:
		var port := int(OS.get_environment("HIGHASCG_E2E_GMA3_PORT"))
		if port <= 0:
			return "no HIGHASCG_E2E_GMA3_PORT (run via tools/e2e/run-gui-e2e.js)"
		udp.set_dest_address("127.0.0.1", port)
		var res: Dictionary = await post("/api/project/load", {"slug": SLUG, "broadcastProject": true})
		if not res.ok:
			return "load %s: %s" % [SLUG, res.error]
		var why := await await_api("/api/fixtures/console-selection", func(d: Variant) -> bool:
			return d is Dictionary and d.get("listener") is Dictionary and d.listener.get("listening") == true and int(d.listener.get("port", 0)) == port,
			"the grandMA3 listener is not up on %d" % port, 15.0)
		if why != "":
			return why
		await ui.wait_for(func() -> bool: return (Store.project.get("fixtures", {}).get("patch", []) as Array).size() == 7, 15.0)
		var patch: Array = Store.project.get("fixtures", {}).get("patch", [])
		for f in patch:
			ids[int(f.get("fid", 0))] = str(f.id)
		return expect(ids.size() == 7 and ids.has(11) and ids.has(121), "patch has fids %s" % [ids.keys()])
	)
	await step("Previs 3D draws the seven heads", func() -> String:
		var tab: Control = await ui.tab("Previs")
		var b3d: BaseButton = ui.button("3D")
		if b3d != null and not b3d.button_pressed:
			await ui.click(b3d)
		f3 = tab.get("fixtures3d")
		var ok: Variant = await ui.wait_for(func() -> bool: return (f3.get("_fx") as Dictionary).size() == 7, 30.0)
		if not ok:
			return "%d heads drawn, want 7" % (f3.get("_fx") as Dictionary).size()
		tab.stage.frame_box(f3.bounds(), tab.builder.front_yaw())  # F, on the heads only: a close view for the screenshots
		await ui.frames(10)
		return ""
	)
	await step("The Programmer has the Follow console selection row, off", func() -> String:
		check = _in_tree("BaseButton", FOLLOW) as CheckBox
		for fold in ["▸ Lighting", "▸ Programmer"]:  # a fold closed in this client's ui.cfg
			var f: Control = _in_tree("BaseButton", fold)
			if check == null and f != null:
				await ui.reveal(f)
				await ui.click(f)
				check = _in_tree("BaseButton", FOLLOW) as CheckBox
		if check == null:
			return "no \"%s\" box in the Previs Inspector" % FOLLOW
		await ui.reveal(check)
		return expect(not check.button_pressed and not Con.shared().follow, "Follow console selection starts off")
	)
	await step("The plugin sends heads 11-13: counted, mapped, but nothing drawn while Follow is off", func() -> String:
		_plugin_sends("11-13")
		var why := await await_api("/api/fixtures/console-selection", func(d: Variant) -> bool:
			return (d.selection.heads as Array).map(func(h: Variant) -> int: return int(h)) == [11, 12, 13] and d.selection.ids.size() == 3 and d.selection.source == "gma3", "the server did not take the datagram")
		if why == "":
			why = await _client_has([11, 12, 13])
		if why != "":
			return why
		await ui.frames(5)
		var row: Label = _in_tree("Label", "gma3: 3 heads") as Label
		return expect(row != null, "the Programmer row does not say \"gma3: 3 heads\"") + expect(_marked().is_empty(), "heads are marked while Follow is off: %s" % [_marked()])
	)
	await step("Tick Follow console selection: heads 11, 12, 13 get the console mark", func() -> String:
		var why: String = await ui.click(check)
		if why != "":
			return why
		await ui.frames(4)
		return expect(Con.shared().follow and check.button_pressed, "the box did not turn on") \
			+ expect(_marked() == _want([11, 12, 13]), "marked %s, want %s" % [_marked(), _want([11, 12, 13])]) \
			+ expect(Sel.shared().ids.is_empty(), "the console set wrote the Programmer selection: %s" % [Sel.shared().ids])
	)
	await step("The operator's own pick and the console's set live side by side", func() -> String:
		Sel.shared().pick(ids[15], false)
		_plugin_sends("11,12,121")
		var why := await _client_has([11, 12, 121])
		if why != "":
			return why
		await ui.frames(4)
		return expect(_marked() == _want([11, 12, 121]), "marked %s, want %s" % [_marked(), _want([11, 12, 121])]) \
			+ expect(Sel.shared().ids == [ids[15]], "the own selection became %s" % [Sel.shared().ids])
	)
	await step("A head number nothing is patched under is reported, not drawn", func() -> String:
		_plugin_sends("12,999")
		var why := await _client_has([12, 999])
		if why != "":
			return why
		await ui.frames(4)
		var row: Label = _in_tree("Label", "gma3: 2 heads") as Label
		return expect(Con.shared().unmatched == [999], "unmatched %s" % [Con.shared().unmatched]) \
			+ expect(row != null and row.tooltip_text.contains("999"), "the row's tooltip does not name head 999") \
			+ expect(_marked() == _want([12]), "marked %s, want only head 12" % [_marked()])
	)
	await step("Take copies the console set into the own selection once", func() -> String:
		var take: BaseButton = _in_tree("BaseButton", "Take") as BaseButton
		if take == null:
			return "no Take button"
		await ui.reveal(take)
		var why: String = await ui.click(take)
		if why != "":
			return why
		_plugin_sends("13")
		why = await _client_has([13])
		if why != "":
			return why
		return expect(Sel.shared().ids == [ids[12]], "own selection is %s, want only head 12's fixture (taken before the change)" % [Sel.shared().ids])
	)
	await step("The plugin's empty selection clears the marks", func() -> String:
		_plugin_sends("-")
		var why := await _client_has([])
		if why != "":
			return why
		await ui.frames(4)
		return expect(_marked().is_empty(), "still marked: %s" % [_marked()]) + expect(Sel.shared().ids == [ids[12]], "the own selection moved")
	)
	Sel.shared().set_ids([])
	Con.shared().set_follow(false)
