extends RefCounted
## WO-607 / WO-1009 — the previs Models list: the open project's .glb files (its project folder, header Files; owner
## 09.11: both Models and Screens were empty because nothing could put a model there from this client) first, then the
## server model library (/api/previs/models, filled only by the old web drop zone). A click loads it on the stage.
## Out of previs_tab.gd for the 500-line limit.

const PF := preload("res://core/project_files.gd")
const Venue := preload("res://features/previs/mvr_venue.gd")

var list: ItemList
var status: Label
var stage: Node3D
var glb_id := ""  # the shown model's key for its screen tags (project.previs.modelScreens): library id or "project:<name>"
var items: Array = []  # [key, url] per row


func bind(l: ItemList, s: Label, st: Node3D) -> void:
	list = l
	status = s
	stage = st
	list.item_activated.connect(load_model)
	list.item_selected.connect(load_model)
	list.visibility_changed.connect(func() -> void:  # WO-1003: a .glb uploaded through Sources (no projectFiles event)
		if list.is_visible_in_tree():
			refresh())
	Ws.on("change", func(d: Variant) -> void:
		if d is Dictionary and str(d.get("path")) in [PF.EVENT_PATH, "project.activated"]:
			refresh())


func refresh() -> void:
	var files: Variant = await PF.list()
	var lib: Dictionary = await Api.get_json("/api/previs/models")
	list.clear()
	items.clear()
	for f in (files if files is Array else []):
		if str(f.kind) == "model":
			list.add_item(str(f.name))
			list.set_item_tooltip(list.item_count - 1, "In this project's files")
			items.append(["project:" + str(f.name), PF.url(str(f.name))])
	if lib.ok and lib.data is Dictionary:
		for m in (lib.data as Dictionary).get("models", []):
			list.add_item(str(m.get("name", m.get("id"))))
			list.set_item_tooltip(list.item_count - 1, "In the server's model library")
			items.append([str(m.get("id")), "/api/previs/models/%s" % m.get("id")])
	status.text = "No 3D models — add a .glb with Files (in the header); its screens are listed here once it is loaded." \
		if items.is_empty() else "%d model(s) — click one to load it on the stage" % items.size()
	if not items.is_empty() and Config.args.has("previs-autoload"):
		load_model(0)


func load_model(idx: int) -> void:
	if idx < 0 or idx >= items.size():
		return
	status.text = "loading…"
	glb_id = str(items[idx][0])
	var res: Dictionary = await Api.get_bytes(str(items[idx][1]))
	if not res.ok:
		status.text = "download failed: %s" % res.error
		return
	var name := str(items[idx][0]).trim_prefix("project:")
	if glb_id.begins_with("project:") and Venue.is_capture(res.bytes) and Venue.save_venue(name):
		stage.clear_model()  # WO-1003: one copy of the room — the MVR scene draws it from this .glb, in its place
		status.text = "%s is a Capture export of the scene: it is now the MVR scene's venue model (MVR scene ▸ Venue model)" % name
		return
	if not stage.load_glb_bytes(res.bytes):
		status.text = "not a glTF/GLB the runtime can read"
	# on success previs_tab _on_model_loaded() has already written "N meshes, M screens"
