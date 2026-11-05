extends "res://e2e/e2e_scenario.gd"
## WO-961 — changing a look layer's Content sizing (layer inspector) re-sizes the clip on PRV with MIXER only: the
## server's preview push is a nudge, no PLAY / LOAD reaches the PRV layer, and (with --air: a throwaway real Caspar)
## the clip's playhead keeps running instead of jumping back to the top. Before the fix contentFit counted as
## "content", so every change was a preview take (forceCut PLAY) and the clip restarted.
## AMCP evidence: the sandbox server's own ring of sent commands (<sandbox>/data/amcp-last50.txt, flushed 1 s).

const CLIP := "e2e_bars"

var prv := 0
var insp: Node


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


func _amcp_ring() -> PackedStringArray:
	var p := OS.get_environment("HIGHASCG_E2E_SANDBOX").path_join("data/amcp-last50.txt")
	return FileAccess.get_file_as_string(p).split("\n", false) if FileAccess.file_exists(p) else PackedStringArray()


## Caspar's answer to INFO <prv> (through the sandbox server's AMCP connection), "" when unavailable.
func _caspar_info() -> String:
	var r: Dictionary = await post("/api/amcp/raw", {"cmd": "INFO %d" % prv})
	return JSON.stringify(r.get("data")) if r.get("ok", false) else ""


## The PRV clip's playhead in seconds (the ffmpeg producer's <time> in INFO), -1 when not readable.
func _prv_time() -> float:
	var info := (await _caspar_info()).replace("\\n", "\n")
	var m := RegEx.create_from_string("<time>\\s*([0-9.]+)").search(info, maxi(0, info.find("<stage>")))
	return float(m.get_string(1)) if m != null else -1.0


func run() -> void:
	if OS.get_environment("HIGHASCG_E2E_AIR") == "":  # the nudge needs a Caspar: run with --air
		await step("Not run (needs --air: a throwaway Caspar)", func() -> String: return "")
		return
	await step("A PGM/PRV screen exists", func() -> String:
		if await _channel("previewChannels") <= 0:
			await ui.root.shell.tabs.get_node("Devices").get("_dests").add("pgm_prv")
		var until := Time.get_ticks_msec() + 20000
		while Time.get_ticks_msec() < until:
			prv = await _channel("previewChannels")
			if prv > 0 and await _channel("programChannels") > 0:
				return ""
			await ui.sleep(0.3)
		return "no PRV / PGM channel"
	)
	await step("A look with the clip is open in the editor and staged on PRV", func() -> String:
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
		if await ui.wait_for(func() -> bool: return ui.shown(ed._frame), 6.0) != true:
			return "editor did not open"
		if await ui.wait_for(func() -> bool: return ed._list.item_count > 0, 6.0) != true:
			return "the editor lists no layer"
		tree.deselect_all()  # setup: the dragged media row's file inspector must not hold the Inspector
		await ui.sleep(1.0)
		ed._select(0)  # setup: the clip's layer in the Inspector (a click on the frame does the same)
		insp = ed._inspector
		if await ui.wait_for(func() -> bool: return ui.shown(insp._w.fit), 6.0) != true:
			return "no Content sizing option in the layer inspector"
		var until := Time.get_ticks_msec() + 10000
		while Time.get_ticks_msec() < until:
			var info := await _caspar_info()
			if info.to_lower().contains(CLIP):
				print("[wo961] INFO %d stage: %s" % [prv, info.substr(info.find("<stage>")).replace("\\n", " ").left(1500)])
				return ""
			await ui.sleep(0.3)
		return "PRV %d never played %s" % [prv, CLIP]
	)
	for fit in ["Stretch", "Fill width"]:
		await step("Content sizing → %s: MIXER only on PRV, the clip keeps playing" % fit, func() -> String:
			var pusher: Node = ui.root.shell.tabs.get_node("Live").editor.pusher
			await ui.sleep(1.5)  # the ring file is flushed 1 s after the last command
			var before := {}
			for l in _amcp_ring():
				before[l] = true
			var t0 := await _prv_time()
			var pushes0: int = pusher.pushes
			await ui.reveal(insp._w.fit)
			var why: String = await ui.choose(insp._w.fit, fit)
			if why != "":
				return why
			if await ui.wait_for(func() -> bool: return pusher.pushes >= pushes0 + 1 and pusher._due_at == 0 and not pusher._busy, 6.0) != true:
				return "no PRV push after the change"
			var t1 := await _prv_time()
			await ui.sleep(1.5)
			var fresh: Array = Array(_amcp_ring()).filter(func(l: String) -> bool: return not before.has(l))
			print("[wo961] %s: push mode %s, PRV time %.2f → %.2f, AMCP: %s" % [fit, pusher.last_mode, t0, t1, " | ".join(fresh)])
			var reload := RegEx.create_from_string("\\b(PLAY|LOAD|LOADBG)\\s+%d-" % prv)
			for l in fresh:
				if reload.search(l) != null:
					return "PRV layer reloaded: %s" % l
			if not fresh.any(func(l: String) -> bool: return l.contains("MIXER %d-" % prv)):
				return "no MIXER line reached PRV %d (%s)" % [prv, " | ".join(fresh)]
			if pusher.last_mode != "nudge":
				return "preview push mode %s, not nudge" % pusher.last_mode
			if t0 < 0.0 or t1 < 0.0:
				return "no clip time in Caspar's INFO %d" % prv
			return expect(t1 >= t0, "the PRV clip jumped back: %.2f s → %.2f s" % [t0, t1])
		)
