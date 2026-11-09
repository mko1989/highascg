extends VBoxContainer
## WO-1003 — the MVR scene's "Venue model" pick: none, or one of the open project's .glb files (header Files / Sources
## upload). Saved as project.previs.mvr.venue_glb; mvr_scene.gd then draws the room's objects from it by uuid
## (mvr_venue.gd) while the MVR keeps the patch and the fixtures. Shown only while a scene is picked. Out of
## mvr_section.gd for the 500-line limit.

const PF := preload("res://core/project_files.gd")
const NONE := "None — the MVR's own meshes"

var _pick := OptionButton.new()
var _names: Array = []  # "" (none) then the .glb names, per item


func _ready() -> void:
	add_child(preload("res://features/previs/previs_ui.gd").caption(
		"Venue model — a Capture .glb export of this scene draws the room; fixtures and the patch stay the MVR's"))
	_pick.fit_to_longest_item = false
	_pick.tooltip_text = "Objects are matched by their MVR uuid (Capture writes it into the .glb)"
	_pick.item_selected.connect(_on_pick)
	add_child(_pick)
	Store.project_changed.connect(func(_p: Dictionary) -> void: refresh())
	Ws.on("change", func(d: Variant) -> void:
		if d is Dictionary and str(d.get("path")) in [PF.EVENT_PATH, "project.activated"]:
			refresh())
	visibility_changed.connect(func() -> void:
		if is_visible_in_tree():
			refresh())
	refresh()


func _cfg() -> Dictionary:
	var previs: Variant = Store.project.get("previs")
	return (previs as Dictionary).get("mvr", {}) if previs is Dictionary and (previs as Dictionary).get("mvr") is Dictionary else {}


func refresh() -> void:
	var files: Variant = await PF.list()
	var c := _cfg()
	var cur := str(c.get("venue_glb", ""))
	_names = [""]
	for f in (files if files is Array else []):
		if str(f.kind) == "model":
			_names.append(str(f.name))
	var present := _names.size()
	if cur != "" and not _names.has(cur):
		_names.append(cur)  # saved but gone from the folder: still shown, so it can be set to None
	_pick.clear()
	for i in _names.size():
		_pick.add_item(NONE if i == 0 else str(_names[i]) + ("" if i < present else " (missing)"))
	_pick.select(_names.find(cur))
	get_child(0).visible = c.has("id")
	_pick.visible = c.has("id")


func _on_pick(i: int) -> void:
	if i >= 0 and i < _names.size():
		preload("res://features/previs/mvr_venue.gd").save_venue(str(_names[i]))
