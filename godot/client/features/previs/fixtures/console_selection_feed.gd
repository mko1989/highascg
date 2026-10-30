extends Node
## WO-857 — keeps console_selection.gd current: the state at connect (GET /api/fixtures/console-selection, again after a
## reconnect) and every WS `fixtures:console_selection`. A child of the fixture rig (fixtures_3d.gd); several copies are
## harmless, the model ignores a payload that changes nothing.

const Con := preload("res://features/previs/fixtures/console_selection.gd")


func _ready() -> void:
	Ws.message.connect(_on_ws)
	Ws.connected.connect(_fetch)
	_fetch()


func _on_ws(type: String, data: Variant) -> void:
	if type == "fixtures:console_selection":
		Con.shared().apply(data)


func _fetch() -> void:
	var res: Dictionary = await Api.get_json("/api/fixtures/console-selection")
	if res.ok and res.data is Dictionary:
		Con.shared().apply((res.data as Dictionary).get("selection"))
