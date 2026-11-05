extends "res://e2e/e2e_scenario.gd"
## WO-966 — the media file page has "Set in" / "Set out" next to the In / Out boxes. The sandbox has no operator
## screen, so its Caspar preview is unavailable: the buttons must be there and disabled (they set the point to the
## preview position; the patch rules are unit-tested in test_wo966_media_marks.gd).

const CLIP := "e2e_bars"


func _media_tree() -> Tree:
	var t: Array = ui.root.shell.find_children("*", "Tree", true, false).filter(func(x: Tree) -> bool:
		return ui.shown(x) and ui.tree_item(x, CLIP) != null)
	return t[0] if not t.is_empty() else null


func run() -> void:
	await step("Select a clip in Sources → Media", func() -> String:
		await ui.tab("Live")
		var why: String = await ui.pick_tab("Media")
		if why != "":
			return why
		var tree: Tree = await ui.wait_for(_media_tree, 15.0)
		if tree == null:
			return "%s not in Sources → Media" % CLIP
		await ui.click_at(ui.tree_item_point(tree, ui.tree_item(tree, CLIP)))
		return expect(await ui.await_control("Button", "Set in", null, 8.0) != null and ui.find("Button", "Set out") != null,
			"no Set in / Set out on the media page"))
	await step("Without a preview they are disabled and say why", func() -> String:
		await ui.sleep(1.5)
		var b: Button = ui.find("Button", "Set in")
		return expect(b.disabled and b.tooltip_text.contains("start the preview first"), "Set in enabled without a preview"))
