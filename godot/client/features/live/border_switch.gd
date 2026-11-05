extends RefCounted
## WO-959 — a deck column's Border tick: switch the screen's global border on / off without opening its options
## (owner 05.11: "the border should have a tick box in the screens' top bar"). Same request as the Inspector's
## "Enabled" (POST /api/scene/global-border — WO-601); the reply's slot replaces project.scenes.globalBorders[screen]
## and Store.changed(PATH, screen) tells the deck header and an open border page to follow.

const PATH := "scenes.globalBorders"


static func _node(name: String) -> Node:
	var tree := Engine.get_main_loop() as SceneTree
	return tree.root.get_node_or_null(name) if tree != null else null


## The screen's slot in a project dictionary (null when it has none).
static func slot_of(project: Dictionary, main: int) -> Variant:
	var sc: Variant = project.get("scenes")
	var arr: Variant = (sc as Dictionary).get("globalBorders") if sc is Dictionary else null
	return arr[main] if arr is Array and main >= 0 and main < (arr as Array).size() and arr[main] is Dictionary else null


static func enabled_in(project: Dictionary, main: int) -> bool:
	var s: Variant = slot_of(project, main)
	return s is Dictionary and (s as Dictionary).get("enabled") == true


## Put `border` into project.scenes.globalBorders[main] (4 slots, like the server).
static func adopt(project: Dictionary, main: int, border: Variant) -> void:
	if not (project.get("scenes") is Dictionary):
		project["scenes"] = {}
	var arr: Array = project.scenes.get("globalBorders", []) if project.scenes.get("globalBorders") is Array else []
	while arr.size() < maxi(4, main + 1):
		arr.append(null)
	arr[main] = border
	project.scenes["globalBorders"] = arr


static func announce(main: int) -> void:
	var store := _node("Store")
	if store != null:
		store.changed.emit(PATH, main)


static func is_on(main: int) -> bool:
	var store := _node("Store")
	return store != null and enabled_in(store.project, main)


## The tick: switch, adopt the reply, announce. Returns the request result ({ok, data, error}).
static func set_on(main: int, on: bool) -> Dictionary:
	var api := _node("Api")
	var store := _node("Store")
	if api == null or store == null:
		return {"ok": false, "error": "no client"}
	var res: Dictionary = await api.post_json("/api/scene/global-border", {"screen": main, "enabled": on})
	if res.ok and res.data is Dictionary and res.data.has("border"):
		adopt(store.project, main, res.data.border)
	announce(main)
	return res
