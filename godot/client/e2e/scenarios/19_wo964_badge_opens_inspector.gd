extends "res://e2e/e2e_scenario.gd"
## WO-964 — a header record badge (the round "R1") opens that output's page in the Inspector column on the tab that is
## showing; it no longer jumps to the Devices tab.

const InspectorPanel := preload("res://app/inspector_panel.gd")
const REC := {"id": "rec_1", "name": "Rec", "enabled": true}


func _badge() -> Button:
	var b: Variant = ui.root.shell.header_tools.badges
	for c in (b as Node).get_children():
		if c is Button and str((c as Button).get_meta("label", "")) == "R1":
			return c
	return null


func run() -> void:
	await step("A record output in the settings", func() -> String:
		var r: Dictionary = await post("/api/settings", {"recordOutputs": [REC]})
		if not r.get("ok", false):
			return "POST /api/settings: %s" % str(r.get("error"))
		await Settings.load_from_server()
		return expect(await ui.wait_for(func() -> Variant: return _badge(), 10.0) != null, "no R1 badge in the header"))
	await step("On Live, click R1", func() -> String:
		await ui.tab("Live")
		return await ui.click(_badge()))
	await step("Its Inspector page shows; the tab stays Live", func() -> String:
		var page: Variant = await ui.wait_for(func() -> Variant:
			var d: Node = ui.root.shell.tab_node("Devices")
			var p: Control = d._outp.page if d != null else null
			return p if p != null and InspectorPanel.current.showing(p) and str(d._outp.conn_id) == "rec_1" else null, 15.0)
		if page == null:
			return "the record output page is not in the Inspector"
		var cur: Control = ui.root.shell.tabs.get_current_tab_control()
		return expect(cur != null and cur.name == "Live", "the click switched to the %s tab" % (cur.name if cur else "?")))
