extends "res://e2e/scenarios/03_looks_layers.gd"
## WO-836 part 3 — the look flow checked ON AIR: a throwaway real Caspar (tools/e2e/air-fixture.js, 2 channels, PGM 1 / PRV 2)
## behind the sandbox, the GUI clicked like an operator, and the picture verified with Caspar PRINT (e2e_probe.gd) plus a
## screenshot probe of the client. Runs only with `node tools/e2e/run-gui-e2e.js --air --e2e=12_air_print` (the release
## runner does); otherwise one step says it was not run. Never aims at the box's Caspar: the AMCP port is the sandbox's own.
##  PGM / PRV black → click the card: PRV shows the bars, PGM still black → TAKE: PGM shows them → FTB: PGM black again.
## Helpers (_media_tree, _channel, _playing, _cards) come from 03_looks_layers.

const P := preload("res://e2e/e2e_probe.gd")

var probe := P.new()
var pgm := 0
var prv := 0


func _dir() -> String:
	return OS.get_environment("HIGHASCG_E2E_SANDBOX").path_join("media")


func _black(ch: int, label: String) -> String:
	var got := {}
	return await probe.await_print(self, ch, _dir(), func(s: Dictionary, _i: Image) -> String:
		return "" if P.is_black(s) else "not black (%s)" % P.fmt(s), label, got, 30.0)


func _bars(ch: int, label: String) -> String:
	var got := {}
	var why: String = await probe.await_print(self, ch, _dir(), func(s: Dictionary, i: Image) -> String:
		if P.is_black(s):
			return "still black"
		return P.native_still_why(i), label, got, 60.0)
	if why == "":
		var s: Dictionary = got.stats
		print("[e2e] %s on channel %d (print %d): %s" % [label, ch, got.prints, P.fmt(s)])
		if s.alpha_nonzero < 0.95:
			return "the picture's alpha plane is not opaque (%s)" % P.fmt(s)
	return why


func run() -> void:
	if OS.get_environment("HIGHASCG_E2E_AIR") == "":
		await step("Not run (needs --air: a throwaway Caspar)", func() -> String: return "")
		return
	await step("PRINT probe separates bars from black and refuses a crop past the frame", func() -> String:
		return P.self_test()
	)
	await step("A PGM/PRV screen on the throwaway Caspar", func() -> String:
		var until := Time.get_ticks_msec() + 20000
		while Time.get_ticks_msec() < until and (pgm <= 0 or prv <= 0):
			pgm = await _channel("programChannels")
			prv = await _channel("previewChannels")
			await ui.sleep(0.3)
		if pgm <= 0 or prv <= 0:
			return "no PGM / PRV channel in the channel map (pgm %d, prv %d)" % [pgm, prv]
		var r: Dictionary = await post("/api/amcp/raw", {"cmd": "INFO"})
		return expect(r.ok and JSON.stringify(r.get("data")).contains("720p2500"), "the server is not talking to the throwaway Caspar (INFO: %s)" % JSON.stringify(r.get("data")).left(200))
	)
	await step("PGM and PRV print black before anything is taken", func() -> String:
		var why := await _black(pgm, "pgm_before")
		return why if why != "" else await _black(prv, "prv_before")
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
	await step("Drop a still into the open look editor, close it", func() -> String:
		var ed: Node = ui.root.shell.tabs.get_node("Live").editor
		if not await ui.wait_for(func() -> bool: return ui.shown(ed._frame), 5.0):
			return "the look editor did not open after the drop"
		var tree := _media_tree()
		var why: String = await ui.drag_from(ui.tree_item_point(tree, ui.tree_item(tree, STILL)), ed._frame, Vector2(0.06, 0.08))
		if why != "":
			return why
		why = await await_api("/api/project", func(d: Variant) -> bool:
			var looks := _looks(d)
			return looks.size() == 1 and (looks[0].get("layers", []) as Array).size() == 2 and _layer_values(looks[0]).contains(STILL),
			"look did not gain the %s layer" % STILL)
		if why != "":
			return why
		why = await ui.click(ui.button("Close"))
		return why if why != "" else expect(not _cards().is_empty() or await ui.wait_for(func() -> bool: return not _cards().is_empty(), 5.0) != null, "no look card on the deck")
	)
	await step("Screenshot: the look card shows a coloured picture, the + tile does not", func() -> String:
		await ui.frames(3)
		var card: Control = _cards()[0]
		var plus: Control = ui.button("New look — or drop a media file here / on empty deck space")
		var cr: Rect2 = ui.screen_rect(card)
		var thumb := Rect2i(int(cr.position.x) + 8, int(cr.position.y) + 8, int(cr.size.x) - 16, int(cr.size.y * 0.5))
		var pr: Rect2 = ui.screen_rect(plus)
		var blank := Rect2i(int(pr.position.x) + 8, int(pr.position.y) + 8, int(pr.size.x) - 16, int(pr.size.y * 0.35))  # above the "+" glyph
		var good := -1.0
		var bad := -1.0
		var until := Time.get_ticks_msec() + 12000  # the thumbnail is fetched after the card appears
		while Time.get_ticks_msec() < until:
			await RenderingServer.frame_post_draw
			var img: Image = ui.vp().get_texture().get_image()
			good = P.saturated(img, thumb)
			bad = P.saturated(img, blank)
			if good >= 0.3:
				break
			await ui.sleep(0.4)
		return expect(good >= 0.3 and bad >= 0.0 and bad < 0.02, "card thumbnail colour share %.2f (want ≥ 0.30), the empty + tile %.2f (want < 0.02)" % [good, bad])
	)
	await step("Click the card: PRV prints the still's bars, PGM stays black", func() -> String:
		var why: String = await ui.click(ui.find("Control", "Click: stage on PRV · Double-click: TAKE to PGM · Right-click: rename / transition"))
		if why != "":
			return why
		why = await _playing(prv, CLIP)
		if why != "":
			return why
		why = await _bars(prv, "prv_staged")
		return why if why != "" else await _black(pgm, "pgm_while_staged")
	)
	await step("Double-click TAKE: PGM prints the bars", func() -> String:
		var why: String = await ui.click(ui.find("Control", "Click: stage on PRV · Double-click: TAKE to PGM · Right-click: rename / transition"), true)
		if why != "":
			return why
		why = await _playing(pgm, CLIP)
		return why if why != "" else await _bars(pgm, "pgm_taken")
	)
	await step("FTB: PGM and PRV print black again", func() -> String:
		var why: String = await ui.click(ui.button("Fade to black (PGM + PRV), then clear"))
		if why != "":
			return why
		why = await _black(pgm, "pgm_after_ftb")
		return why if why != "" else await _black(prv, "prv_after_ftb")
	)
