extends RefCounted
## WO-894 dev probe: `--probe-visuals-shader=<dir>[:<shader id>]` — one shader layer (never stored: no project autosave), the Shader
## mode picked, the window saved as <dir>/shader-1-before.png, one key control moved + its canvas, a Randomize, then Original
## (<dir>/shader-2-control.png, shader-3-random.png, shader-4-original.png). Prints each step (compile counts, values), then quits.

const Probes := preload("res://features/visuals/visuals_probes.gd")
const Model := preload("res://features/live/shader_live_model.gd")


static func run(tab: Node, arg: String) -> void:
	var p := arg.split(":")
	var dir := p[0]
	var id := p[1] if p.size() > 1 else "sh-sa-ribbons"
	await tab.get_tree().create_timer(4.0).timeout
	tab.slice.layers = Probes.stack(["shader"], id)
	tab.sel = 0
	tab.page.set_state(tab.slice, tab._cm())
	await tab._go(false)
	tab.work.set_mode("shader")
	var mode: Node = tab.work._modes.shader.control
	await tab.get_tree().create_timer(2.0).timeout
	var dbg: Dictionary = await tab._g("DevicesTarget").box_api.get_json("/api/shaders/" + id)
	print("[probe-visuals-shader] fetch ok ", dbg.get("ok"), " err ", dbg.get("error"), " data ", typeof(dbg.get("data")))
	print("[probe-visuals-shader] cache ", (tab._shader_cache.get(id, {}).get("passes", {}) as Dictionary).keys(), " errors ", tab.scene.errors())
	print("[probe-visuals-shader] view ", mode._view.get("id"), " controls ", (mode._view.get("controls", []) as Array).size(), " compiles ", mode.sync.compiles)
	_shot(tab, dir + "/shader-1-before.png")
	var c: Dictionary = (mode._view.get("controls", [{}]) as Array)[0]
	var macro: bool = str(c.get("widget", "")) == "macro"
	var key := str((c.get("keys", [""]) as Array)[0])
	var prm: Dictionary = Model.params_by_key(mode._view).get(key, {})
	var was: Array = [float(c.get("factor", 1.0))] if macro else mode.current_values(key)
	var span := float(prm.get("max", 1.0)) - float(prm.get("min", 0.0))
	var to := 2.5 if macro else (float(was[0]) + span * 0.5 if float(was[0]) + span * 0.5 <= float(prm.get("max", 1.0)) else float(was[0]) - span * 0.5)
	var before: int = mode.sync.compiles
	for i in 20:  # a drag: 20 changes in a second
		var v := lerpf(float(was[0]), to, (i + 1) / 20.0)
		if macro:
			mode.post_op("macro", {"control": c.id, "factor": v}, false)
		else:
			mode.post_op("set", {"key": key, "values": [v]}, false)
		await tab.get_tree().create_timer(0.05).timeout
	await tab.get_tree().create_timer(1.5).timeout
	print("[probe-visuals-shader] control ", c.get("label"), " (", key if not macro else c.id, ") ", was, " → ", to, " · 20 changes = ",
		mode.sync.compiles - before, " compiles · status '", mode._status.text, "' · error '", tab.scene.errors(), "'")
	_shot(tab, dir + "/shader-2-control.png")
	mode.post_op("randomize", {})
	await tab.get_tree().create_timer(2.0).timeout
	print("[probe-visuals-shader] randomize → compiles ", mode.sync.compiles, " dirty ", mode._dirty.visible)
	_shot(tab, dir + "/shader-3-random.png")
	mode.post_op("preset", {"original": true})
	await tab.get_tree().create_timer(2.0).timeout
	print("[probe-visuals-shader] original → compiles ", mode.sync.compiles, " dirty ", mode._dirty.visible)
	_shot(tab, dir + "/shader-4-original.png")
	mode.post_op("reset", {})
	await tab.get_tree().create_timer(2.0).timeout
	print("[probe-visuals-shader] reset all → compiles ", mode.sync.compiles, " dirty ", mode._dirty.visible)
	_shot(tab, dir + "/shader-5-reset.png")
	tab.get_tree().quit()


static func _shot(tab: Node, path: String) -> void:
	print("[probe-visuals-shader] ", path, " → ", error_string(tab.get_viewport().get_texture().get_image().save_png(path)))
