extends RefCounted
## WO-781 — E2-style destinations: the operator highlights screens (a click on a deck column's title) and a look
## preset saves / recalls exactly those. This client's selection, like the E2's destination buttons — not project
## data. A recall re-highlights the preset's screens. Changes are announced as Store.changed("ui.destinations").

const PATH := "ui.destinations"

static var _on := {}


static func selected() -> Array:
	var out := _on.keys()
	out.sort()
	return out


static func is_on(main: int) -> bool:
	return _on.has(main)


static func toggle(main: int) -> void:
	if _on.has(main):
		_on.erase(main)
	else:
		_on[main] = true
	_announce()


static func set_only(mains: Array) -> void:
	_on.clear()
	for m in mains:
		_on[int(m)] = true
	_announce()


## Screens that went away (fewer mains after a config change) drop out of the selection.
static func prune(count: int) -> void:
	for m in _on.keys():
		if int(m) >= count:
			_on.erase(m)


static func _announce() -> void:
	var tree := Engine.get_main_loop() as SceneTree
	var store: Node = tree.root.get_node_or_null("Store") if tree != null else null
	if store != null:
		store.changed.emit(PATH, selected())
