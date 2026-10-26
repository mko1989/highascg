extends Node
## dev: --probe-e2-presets=<png prefix> — WO-781 through the real live tab: highlight screens 1 + 2, save "probe PGM"
## (their PGM looks) and "probe empty" (their empty PRVs), recall each to PRV (the second clears what the first
## loaded), hide / show the look cards, then remove both presets and the highlight. Screenshots <prefix>_N.png.

const Destinations := preload("res://features/live/destinations.gd")
const M := preload("res://features/live/look_preset_model.gd")

var lt: Node
var prefix := ""


func _ready() -> void:
	prefix = str(Config.args["probe-e2-presets"])
	if not Ws.is_open:
		await Ws.connected
	await get_tree().create_timer(2.0).timeout
	lt = get_tree().root.find_children("*", "", true, false).filter(func(n: Node) -> bool: return n.has_method("_set_shown"))[0]
	var page: Node = lt.presets
	Destinations.set_only([0, 1])
	var a: String = page.save("pgm", "probe PGM")
	var b: String = page.save("prv", "probe empty")
	for p in page.presets():
		if str(p.get("id")) in [a, b]:
			print("[client] e2 probe saved %s: %s" % [p.name, JSON.stringify(p.items)])
	await _shot(1)
	_report("before recall")
	await page.recall(a, "preview")
	await get_tree().create_timer(4.0).timeout
	_report("after PRV recall of probe PGM")
	await _shot(2)
	await page.recall(b, "preview")
	await get_tree().create_timer(4.0).timeout
	_report("after PRV recall of probe empty")
	lt._set_shown("looks", false, false)
	await _shot(3)
	lt._set_shown("looks", true, false)
	for id in [a, b]:
		M.remove(page.presets(), id)
	page._commit("probe presets removed")
	Destinations.set_only([])
	print("[client] e2 probe done, presets left: %d" % page.presets().size())


func _report(step: String) -> void:
	var bus: Dictionary = lt.presets.true_buses()
	print("[client] e2 probe %s: PRV %s / %s · PGM %s / %s · highlighted %s" % [step, bus[0].prv, bus[1].prv, bus[0].pgm, bus[1].pgm, Destinations.selected()])


func _shot(n: int) -> void:
	for i in 3:
		await get_tree().process_frame
	await RenderingServer.frame_post_draw
	get_viewport().get_texture().get_image().save_png("%s_%d.png" % [prefix, n])
