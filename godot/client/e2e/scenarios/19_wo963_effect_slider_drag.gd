extends "res://e2e/e2e_scenario.gd"
## WO-963 — dragging a mixer-effect slider (Brightness) is smooth: the slider keeps the drag (same node, value
## follows), several intermediate values reach the server during the drag (coalesced MIXER nudges), and the PRV
## layer is never re-played for it. Before the fix a stale server echo rebuilt the section mid-drag.

const CLIP := "e2e_bars"

var slider: HSlider
var pushes0 := 0


static func _looks(d: Variant) -> Array:
	var p: Dictionary = d.get("project", d) if d is Dictionary else {}
	return (p.get("scenes", {}) as Dictionary).get("scenes", [])


func _channel(kind: String) -> int:
	var r: Dictionary = await api("/api/settings")
	var cm: Variant = r.data.get("channelMap") if r.get("data") is Dictionary else null
	var list: Array = (cm as Dictionary).get(kind, []) if cm is Dictionary else []
	return int(list[0]) if not list.is_empty() else 0


func _media_tree() -> Tree:
	var sources: Array = ui.root.shell.find_children("*", "Tree", true, false).filter(func(t: Tree) -> bool:
		return ui.shown(t) and ui.tree_item(t, CLIP) != null)
	return sources[0] if not sources.is_empty() else null


func run() -> void:
	await step("The throwaway Caspar answers AMCP (its CEF start takes ~40 s)", func() -> String:
		if OS.get_environment("HIGHASCG_E2E_AIR") == "":
			return "needs --air"
		var until := Time.get_ticks_msec() + 120000
		var last := ""
		while Time.get_ticks_msec() < until:
			var r: Dictionary = await post("/api/amcp/raw", {"cmd": "INFO"})
			last = JSON.stringify(r).left(200)
			if r.get("ok", false) and not JSON.stringify(r.get("data")).to_lower().contains("not connected"):
				return ""
			await ui.sleep(1.0)
		return "AMCP never connected: " + last
	)
	await step("A PGM/PRV screen exists", func() -> String:
		if await _channel("previewChannels") <= 0:
			await ui.root.shell.tabs.get_node("Devices").get("_dests").add("pgm_prv")
		var until := Time.get_ticks_msec() + 10000
		while Time.get_ticks_msec() < until:
			if await _channel("previewChannels") > 0 and await _channel("programChannels") > 0:
				return ""
			await ui.sleep(0.3)
		return "no PRV / PGM channel"
	)
	await step("A look with the clip is open in the editor", func() -> String:
		await ui.tab("Live")
		var why: String = await ui.pick_tab("Media")
		if why != "":
			return why
		if await ui.wait_for(_media_tree, 15.0) == null:
			return "no media list"
		var tree := _media_tree()
		var plus: Control = await ui.await_control("BaseButton", "New look — or drop a media file here / on empty deck space")
		why = await ui.drag_from(ui.tree_item_point(tree, ui.tree_item(tree, CLIP)), plus)
		if why != "":
			return why
		var ed: Node = ui.root.shell.tabs.get_node("Live").editor
		return expect(await ui.wait_for(func() -> bool: return ui.shown(ed._frame), 6.0) == true, "editor did not open")
	)
	await step("Add the Brightness effect", func() -> String:
		var ed: Node = ui.root.shell.tabs.get_node("Live").editor
		ed._select(0)  # the layer page (the Inspector shows the media file until a layer is chosen)
		await ui.frames(3)
		var ob: OptionButton = await ui.await_control("OptionButton", "Choose effect to add…", null, 8.0)
		if ob == null:
			return "no effect add menu"
		var why: String = await ui.choose(ob, "Brightness")
		if why != "":
			return why
		var fx: Node = ui.root.find_children("*", "VBoxContainer", true, false).filter(func(n: Node) -> bool: return n.get_script() != null and str(n.get_script().resource_path).ends_with("effects_section.gd"))[0]
		var found: Array = fx.find_children("*", "HSlider", true, false)
		if found.is_empty():
			return "no brightness slider"
		slider = found[0]
		return ""
	)
	await step("Drag the slider across its range: same node, several values reach the server", func() -> String:
		var live: Node = ui.root.shell.tabs.get_node("Live")
		var pusher: Node = live.editor.pusher
		pushes0 = pusher.pushes
		await ui.reveal(slider)
		var r: Rect2 = ui.screen_rect(slider)
		var a := Vector2(r.position.x + 3, r.position.y + r.size.y * 0.5)
		var b := Vector2(r.end.x - 3, a.y)
		var seen: Array = []
		var node_id := slider.get_instance_id()
		ui._move(a, 0)
		await ui.frames(1)
		ui._button(a, MOUSE_BUTTON_LEFT, true, false)
		await ui.frames(1)
		var kept := true
		for i in range(1, 41):
			ui._move(a.lerp(b, i / 40.0), MOUSE_BUTTON_MASK_LEFT)
			await ui.sleep(0.05)
			if not is_instance_valid(slider) or slider.get_instance_id() != node_id or slider.is_queued_for_deletion():
				kept = false
				break
			seen.append(snappedf(slider.value, 0.01))
		ui._button(b, MOUSE_BUTTON_LEFT, false, false)
		await ui.frames(2)
		if not kept:
			return "the slider was rebuilt during the drag (after %d ticks)" % seen.size()
		var distinct := {}
		for v in seen:
			distinct[v] = true
		if distinct.size() < 10:
			return "slider values did not follow the drag: %s" % str(seen)
		await ui.sleep(1.0)
		var n: int = pusher.pushes - pushes0
		print("[wo963] pushes during drag: %d, last mode %s, final %s" % [n, pusher.last_mode, slider.value])
		if n < 3:
			return "only %d PRV pushes for a 2 s drag" % n
		return expect(absf(slider.value - 2.0) < 0.05, "slider ended at %s, not the max" % slider.value)
	)
