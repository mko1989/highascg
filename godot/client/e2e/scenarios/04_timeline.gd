extends "res://e2e/e2e_scenario.gd"
## WO-719 — a timeline from scratch: New timeline, drag a clip and an audio file onto it, play, stop. Checked on the
## server's timeline engine (clips stored, /state playing) — what Companion / the take path read.

const CLIP := "e2e_bars"
const TONE := "e2e_tone"

var _tl_id := ""


func _tab() -> Node:
	return ui.root.shell.tabs.get_node("Timeline")


func _media_point(name: String) -> Variant:
	for t in ui.root.shell.find_children("*", "Tree", true, false):
		if ui.shown(t) and ui.tree_item(t, name) != null:
			return ui.tree_item_point(t, ui.tree_item(t, name))
	return null


static func _clip_values(tl: Dictionary) -> String:
	var out := PackedStringArray()
	for l in tl.get("layers", []):
		for c in (l as Dictionary).get("clips", []):
			out.append(str((c.get("source", {}) as Dictionary).get("value", "")).to_lower())
	return " ".join(out)


func run() -> void:
	await step("New timeline", func() -> String:
		await ui.tab("Timeline")
		var before: Array = (await api("/api/timelines")).get("data", [])
		var why: String = await ui.click(ui.button("New timeline"))
		if why != "":
			return why
		return await await_api("/api/timelines", func(d: Variant) -> bool:
			if d is Array and d.size() > before.size():
				_tl_id = str(d[d.size() - 1].get("id", ""))
				return true
			return false, "no new timeline on the server")
	)
	await step("Drag the clip onto the timeline", func() -> String:
		var p: Variant = await ui.wait_for(func() -> Variant: return _media_point(CLIP), 6.0)
		if p == null:
			return "%s not in the Sources media list" % CLIP
		var why: String = await ui.drag_from(p, _tab().view)
		if why != "":
			return why
		return await await_api("/api/timelines/" + _tl_id.uri_encode(), func(d: Variant) -> bool:
			return d is Dictionary and _clip_values(d).contains(CLIP), "timeline has no %s clip" % CLIP)
	)
	await step("Drag an audio file onto it", func() -> String:
		var p: Variant = _media_point(TONE)
		if p == null:
			return "%s not in the Sources media list" % TONE
		var why: String = await ui.drag_from(p, _tab().view)
		if why != "":
			return why
		return await await_api("/api/timelines/" + _tl_id.uri_encode(), func(d: Variant) -> bool:
			return d is Dictionary and _clip_values(d).contains(TONE), "timeline has no %s clip" % TONE)
	)
	await step("Play runs the timeline", func() -> String:
		var why: String = await ui.click(ui.button("Play / pause from the playhead (Space)"))
		if why != "":
			return why
		return await await_api("/api/timelines/%s/state" % _tl_id.uri_encode(), func(d: Variant) -> bool:
			return d is Dictionary and (d.get("playing") == true or JSON.stringify(d).contains("\"playing\":true")),
			"timeline not playing")
	)
	await step("Stop halts it", func() -> String:
		var why: String = await ui.click(ui.button("Stop (back to start)"))
		if why != "":
			return why
		return await await_api("/api/timelines/%s/state" % _tl_id.uri_encode(), func(d: Variant) -> bool:
			return d is Dictionary and not JSON.stringify(d).contains("\"playing\":true"), "timeline still playing")
	)
