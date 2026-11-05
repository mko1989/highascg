extends "res://e2e/e2e_scenario.gd"
## WO-965 — a media file dropped into the look editor opens the new layer's Inspector page (owner 05.11: "droping a
## media into looks editor should auto open the layers inspector"). Both ways in: onto the deck's "+" (a new look
## opens in the editor) and onto the open editor's frame (a second layer). The page must still be showing a moment
## later — not covered again by the media file's own page from the drag.

const InspectorPanel := preload("res://app/inspector_panel.gd")
const CLIP := "e2e_bars"
const STILL := "e2e_still"


func _media_tree() -> Tree:
	var t: Array = ui.root.shell.find_children("*", "Tree", true, false).filter(func(x: Tree) -> bool:
		return ui.shown(x) and ui.tree_item(x, CLIP) != null)
	return t[0] if not t.is_empty() else null


func _ed() -> Node:
	return ui.root.shell.tabs.get_node("Live").editor


## "" when the editor's layer page is in the Inspector, still after `hold` seconds, on layer `want` (index).
func _layer_page_shown(want: int, hold := 1.5) -> String:
	var ed := _ed()
	if not await ui.wait_for(func() -> bool: return InspectorPanel.current.showing(ed._page) and int(ed._sel) == want, 5.0):
		return "the layer Inspector did not open (selected %d, want %d)" % [int(ed._sel), want]
	await ui.sleep(hold)
	return expect(InspectorPanel.current.showing(ed._page), "the layer Inspector opened, then something covered it")


func run() -> void:
	await step("A PGM/PRV screen exists", func() -> String:
		var r: Dictionary = await api("/api/settings")
		var cm: Variant = r.data.get("channelMap") if r.get("data") is Dictionary else null
		if cm is Dictionary and not ((cm as Dictionary).get("previewChannels", []) as Array).is_empty():
			return ""
		await ui.root.shell.tabs.get_node("Devices").get("_dests").add("pgm_prv")
		return await await_api("/api/settings", func(d: Variant) -> bool:
			return d is Dictionary and d.get("channelMap") is Dictionary and not (d.channelMap.get("previewChannels", []) as Array).is_empty(),
			"no PRV channel", 10.0))
	await step("Sources → Media", func() -> String:
		await ui.tab("Live")
		var why: String = await ui.pick_tab("Media")
		if why != "":
			return why
		return expect(await ui.wait_for(_media_tree, 15.0) != null, "%s not in Sources → Media" % CLIP))
	await step("A look with the clip, open in the editor", func() -> String:
		var tree := _media_tree()
		var plus: Control = await ui.await_control("BaseButton", "New look — or drop a media file here / on empty deck space")
		var why: String = await ui.drag_from(ui.tree_item_point(tree, ui.tree_item(tree, CLIP)), plus)
		if why != "":
			return why
		var id: Variant = await ui.wait_for(func() -> Variant:
			var looks: Variant = (Store.project.get("scenes", {}) as Dictionary).get("scenes", []) if Store.project.get("scenes") is Dictionary else []
			return str(looks[0].get("id")) if looks is Array and not looks.is_empty() else null, 8.0)
		if id == null:
			return "no look after the drop on +"
		_ed().open(str(id), 0)
		return expect(await ui.wait_for(func() -> bool: return ui.shown(_ed()._frame), 8.0) == true, "the look editor did not open"))
	await step("Select the still in Sources (its own page), drop it into the frame → the new layer's page", func() -> String:
		var tree := _media_tree()
		await ui.click_at(ui.tree_item_point(tree, ui.tree_item(tree, STILL)))
		await ui.sleep(0.5)
		var why: String = await ui.drag_from(ui.tree_item_point(tree, ui.tree_item(tree, STILL)), _ed()._frame, Vector2(0.06, 0.08))
		if why != "":
			return why
		if not await ui.wait_for(func() -> bool: return (_ed()._layers() as Array).size() == 2, 8.0):
			return "the still did not become a second layer"
		return await _layer_page_shown(1))
	await step("With the Layer presets tab in front, a drop still brings the new layer's page forward", func() -> String:
		var ip: Node = InspectorPanel.current
		var k := -1
		for i in ip._tabs.size():
			if (ip._tabs[i] as Button).text == "Layer presets":
				k = i
		if k < 0:
			return "no Layer presets tab"
		ip.show_tab(k)
		var tree := _media_tree()
		var why: String = await ui.drag_from(ui.tree_item_point(tree, ui.tree_item(tree, CLIP)), _ed()._frame, Vector2(0.06, 0.92))
		if why != "":
			return why
		if not await ui.wait_for(func() -> bool: return (_ed()._layers() as Array).size() == 3, 8.0):
			return "the clip did not become a third layer"
		if not await ui.wait_for(func() -> bool: return ip.tab_shown() == 0, 3.0):
			return "the Inspector column stayed on Layer presets (tab %d)" % ip.tab_shown()
		return await _layer_page_shown(2))
