extends RefCounted
## WO-342 on the Godot deck (web client/components/scene-list-column.js): a click on a screen's empty deck space clears
## that screen's PRV (POST /api/scene/live/preview/clear; the deck re-highlights from the scene.live broadcast). Cards
## and buttons STOP their own clicks, so only blank column / grid / header space reaches the column (they PASS). The
## deck is hidden while the look editor is open, so an edit session on PRV is never yanked (web editingSceneId guard).

const DeckModel := preload("res://features/live/deck_model.gd")


static func wire(col: Control, main: int, cm: Dictionary, report: Callable) -> void:
	if not DeckModel.preview_bus_available(cm, main):  # PGM-only screen: nothing to clear
		return
	col.tooltip_text = "Click empty space to clear this screen's PRV"
	var press := [false]  # a click = press + release on blank space (a double-click's second press does not count)
	col.gui_input.connect(func(ev: InputEvent) -> void:
		var mb := ev as InputEventMouseButton
		if mb == null or mb.button_index != MOUSE_BUTTON_LEFT:
			return
		if mb.pressed:
			press[0] = not mb.double_click
		elif press[0]:
			press[0] = false
			clear(main, report))


static func clear(main: int, report: Callable) -> Dictionary:
	var res: Dictionary = await Api.post_json("/api/scene/live/preview/clear", {"mainIndex": main})
	report.call("PRV cleared" if res.ok else "PRV clear refused: %s" % res.error, res.ok)
	print("[client] prv clear main %d → %s %s" % [main, res.status, res.error])
	return res
