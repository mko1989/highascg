extends Node
## WO-599 — runtime state mirror (client/lib/state-store.js): dotted paths, per-path listeners plus
## '*' listeners called with (path, value). The server's `state` snapshot is authoritative on every
## connect; `change {path, value}` patches it. Fix vs the web client: set_state() fires '*' once
## (state-store.js:86-91 fires it twice — WO-611).

signal changed(path: String, value: Variant)
signal project_changed(project: Dictionary)

var state: Dictionary = {}
## The show document (scenes, timelines, multiview, programOutput…) — WO-598: the server copy is
## authoritative for this client until the editing protocol lands; `project_sync` replaces it.
var project: Dictionary = {}
var _scene_live_seq := -1


func set_project(p: Variant) -> void:
	project = normalize_project(p)
	project_changed.emit(project)


## client/lib/project-load.js normalizeProjectPayload(): accept {version:number,…} or {project:{…}}.
static func normalize_project(res: Variant) -> Dictionary:
	if not (res is Dictionary):
		return {}
	var r: Dictionary = res
	if r.has("error"):
		return {}
	if typeof(r.get("version")) in [TYPE_INT, TYPE_FLOAT]:
		return r
	var nested: Variant = r.get("project")
	if nested is Dictionary and typeof((nested as Dictionary).get("version")) in [TYPE_INT, TYPE_FLOAT]:
		return nested
	return {}


## `scene.deck` broadcasts upsert look snapshots without a project save (WO-341 kill #6).
func upsert_deck_scenes(snapshots: Array) -> bool:
	var scenes_root: Variant = project.get("scenes")
	if not (scenes_root is Dictionary):
		return false
	var list: Array = (scenes_root as Dictionary).get("scenes", [])
	var changed_any := false
	for snap in snapshots:
		if not (snap is Dictionary) or not (snap as Dictionary).has("id"):
			continue
		var id := str((snap as Dictionary)["id"])
		var found := false
		for i in list.size():
			if list[i] is Dictionary and str((list[i] as Dictionary).get("id", "")) == id:
				list[i] = snap
				found = true
				break
		if not found:
			list.append(snap)
		changed_any = true
	(scenes_root as Dictionary)["scenes"] = list
	if changed_any:
		project_changed.emit(project)
	return changed_any


## Returns true when a `scene.live` change skipped a seq number (caller re-pulls /api/state).
func note_scene_live_seq(seq: Variant) -> bool:
	if typeof(seq) not in [TYPE_INT, TYPE_FLOAT]:
		return false
	var s := int(seq)
	var gap := _scene_live_seq >= 0 and s > _scene_live_seq + 1
	_scene_live_seq = s
	return gap
var _listeners := {}  # path -> Array[Callable]


func on(path: String, handler: Callable) -> Callable:
	if not _listeners.has(path):
		_listeners[path] = []
	(_listeners[path] as Array).append(handler)
	return func() -> void: (_listeners.get(path, []) as Array).erase(handler)


func get_value(path: String, fallback: Variant = null) -> Variant:
	return read_path(state, path, fallback)


func set_state(full: Variant) -> void:
	state = full if full is Dictionary else {}
	_emit("*", state)


func apply_change(path: String, value: Variant) -> void:
	write_path(state, path, value)
	_emit(path, value)


func _emit(path: String, value: Variant) -> void:
	changed.emit(path, value)
	if path != "*":
		for h in _listeners.get(path, []).duplicate():
			(h as Callable).call(value)
	for h in _listeners.get("*", []).duplicate():
		(h as Callable).call(path, value)


static func read_path(root: Dictionary, path: String, fallback: Variant = null) -> Variant:
	if path == "" or path == "*":
		return root
	var cur: Variant = root
	for key in path.split("."):
		if cur is Dictionary and (cur as Dictionary).has(key):
			cur = (cur as Dictionary)[key]
		else:
			return fallback
	return cur


static func write_path(root: Dictionary, path: String, value: Variant) -> void:
	var keys := path.split(".")
	var cur: Dictionary = root
	for i in keys.size() - 1:
		var k: String = keys[i]
		if not (cur.get(k) is Dictionary):
			cur[k] = {}
		cur = cur[k]
	cur[keys[keys.size() - 1]] = value
