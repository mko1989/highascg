extends Node
## dev: --probe-blank-clear=<main> — the deck's blank-space PRV clear (features/live/deck_blank_clear.gd) through real
## mouse events pushed into this window's viewport (never the OS pointer): a click on the screen's first card stages
## it on PRV (cards STOP — no clear), then a click on the blank space under the cards clears PRV. Prints the PRV look
## after each step.

const DeckModel := preload("res://features/live/deck_model.gd")

var main := 0
var deck: Node


func _ready() -> void:
	main = int(Config.args["probe-blank-clear"])
	if not Ws.is_open:
		await Ws.connected
	await get_tree().create_timer(2.0).timeout  # deck built from the first scene.live / channelMap
	deck = get_tree().root.find_children("*", "ScrollContainer", true, false).filter(func(n: Node) -> bool:
		return n.has_method("request_take") and n.is_visible_in_tree())[0]
	_report("start")
	if _grid().get_child_count() < 2:
		print("[client] blank-clear probe: no look on main %d" % main)
		return
	await _click((_grid().get_child(0) as Control).get_global_rect().get_center())
	_report("after card click")
	await _click(Vector2(_grid().get_global_rect().get_center().x, _col().get_global_rect().end.y - 8.0))
	_report("after blank click")


## Looked up per step: the deck rebuilds its columns on every scene.live change.
func _col() -> Control:
	return deck._columns.get_child(main * 2)  # columns are separated by a vline


func _grid() -> Control:
	return _col().find_children("*", "HFlowContainer", false, false)[0]


func _click(at: Vector2) -> void:
	for pressed in [true, false]:
		var ev := InputEventMouseButton.new()
		ev.button_index = MOUSE_BUTTON_LEFT
		ev.pressed = pressed
		ev.position = at
		ev.global_position = at
		get_viewport().push_input(ev)
		await get_tree().process_frame
	await get_tree().create_timer(4.0).timeout  # the take / clear round trip + scene.live broadcast


func _report(step: String) -> void:
	var ps: Dictionary = Store.project.get("scenes", {}) if Store.project.get("scenes") is Dictionary else {}
	var known := {}
	for s in ps.get("scenes", []):
		known[str(s.get("id", ""))] = true
	var live: Dictionary = Store.get_value("scene.live", {}) if Store.get_value("scene.live") is Dictionary else {}
	var cm: Dictionary = Store.get_value("channelMap", {}) if Store.get_value("channelMap") is Dictionary else {}
	print("[client] blank-clear probe %s: PRV = '%s'" % [step, DeckModel.resolve_bus_look_ids(main, live, cm, known, ps).prv])
