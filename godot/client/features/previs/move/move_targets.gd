extends RefCounted
## WO-682 — what the Position card and a 3D drag move: the last kind the operator picked that still has a selection —
## "heads" (the programmer's fixture selection → project.fixtures.patch poses), "mvr" (the MVR objects selected with a
## 3D click → project.previs.mvr.moved, per object uuid) or "stage" (the Stage panel's object → its position / yaw).
## begin() snapshots; preview(d, dyaw) shows a move live without saving; commit(d, dyaw) saves it. d is a stage-frame
## delta (metres), dyaw the stage-sense turn (move_model.gd).

const MM := preload("res://features/previs/move/move_model.gd")

signal changed  ## the target, or where it stands, changed → the card refreshes

var kind := ""
var fixtures3d: Node3D
var sel: RefCounted
var mvr: Node3D
var mvr_section: Node
var stage_panel: Node
var builder: Node3D
var _start := {}
var _pivot := Vector3.ZERO


func bind(f3d: Node3D, selection: RefCounted, scene: Node3D, section: Node, panel: Node, b: Node3D) -> void:
	fixtures3d = f3d
	sel = selection
	mvr = scene
	mvr_section = section
	stage_panel = panel
	builder = b
	sel.changed.connect(func() -> void: _pick("heads" if not sel.ids.is_empty() else kind))
	stage_panel.selection_changed.connect(func(id: String) -> void: _pick("stage" if id != "" else kind))
	mvr_section.objects_picked.connect(func() -> void: _pick("mvr"))
	stage_panel.stage_changed.connect(func() -> void: changed.emit())  # its own saves do not echo project_changed
	Store.project_changed.connect(func(_p: Dictionary) -> void: changed.emit())


func _pick(k: String) -> void:
	kind = k
	changed.emit()


## The kind still selected, or "".
func active() -> String:
	match kind:
		"heads":
			return kind if not _heads().is_empty() else ""
		"mvr":
			return kind if not _nodes().is_empty() else ""
		"stage":
			return kind if builder.index_of(stage_panel.selected_id()) >= 0 else ""
	return ""


## {kind, label, pos (stage frame), yaw (as the card shows it: a head's pose yaw, else the stage sense)} or {}.
func current() -> Dictionary:
	match active():
		"heads":
			var hs := _heads()
			var p: Dictionary = hs[0].get("pose", {}) if hs[0].get("pose") is Dictionary else {}
			var more := "" if hs.size() == 1 else " (+%d more)" % (hs.size() - 1)
			return {"kind": "heads", "label": str(hs[0].get("name", hs[0].id)) + more,
				"pos": MM.psn_to_stage(float(p.get("x", 0.0)), float(p.get("y", 0.0)), float(p.get("z", 6.0))),
				"yaw": float(p.get("yaw", 0.0))}
		"mvr":
			var ns := _nodes()
			var more := "" if ns.size() == 1 else " (+%d more)" % (ns.size() - 1)
			return {"kind": "mvr", "label": "%s%s — MVR" % [ns[0].name, more], "pos": MM.base_of(_box(ns)),
				"yaw": MM.yaw_of((ns[0] as Node3D).transform.basis)}
		"stage":
			var o: Dictionary = builder.objects[builder.index_of(stage_panel.selected_id())]
			return {"kind": "stage", "label": str(o.get("name", o.id)),
				"pos": Vector3(float(o.position[0]), float(o.position[1]), float(o.position[2])), "yaw": float(o.rotation[1])}
	return {}


## Whether a press at `at` lands on the current selection (so a drag there moves it instead of orbiting).
func hit(cam: Camera3D, at: Vector2) -> bool:
	match active():
		"heads":
			var id: String = fixtures3d.hit(cam, at)
			return sel.ids.has(id if id != "" else fixtures3d.near(cam, at, 20.0))
		"mvr":
			return mvr_section.selected_uuids().has(mvr.pick(cam, at))
		"stage":
			return builder.pick(cam, at) == stage_panel.selected_id()
	return false


func begin() -> void:
	var c := current()
	_pivot = c.get("pos", Vector3.ZERO)
	_start = {}
	match c.get("kind", ""):
		"heads":
			for f in _heads():
				_start[str(f.id)] = (f.get("pose", {}) as Dictionary).duplicate() if f.get("pose") is Dictionary else {}
		"mvr":
			for n in _nodes():
				_start[str(n.get_meta("uuid"))] = (n as Node3D).transform
		"stage":
			_start = {"id": stage_panel.selected_id(), "pos": c.pos, "yaw": c.yaw}


func preview(d: Vector3, dyaw: float) -> void:
	match kind:
		"heads":
			for id in _start:
				fixtures3d.preview_pose(id, MM.head_pose(_start[id], d, dyaw))
		"mvr":
			var delta := MM.group_delta(_pivot, d, dyaw)
			for n in _nodes():
				var u := str(n.get_meta("uuid"))
				if _start.has(u):
					(n as Node3D).transform = MM.moved_local(mvr.transform, _start[u], delta)
			mvr.mark([])  # the selection box comes back with the save
		"stage":
			var node: Node3D = builder.node_for(str(_start.get("id", "")))
			if node != null:
				node.position = _start.pos + d
				node.rotation_degrees.y = float(_start.yaw) + dyaw


func commit(d: Vector3, dyaw: float) -> void:
	match kind:
		"heads":
			var patch: Array = Store.project.get("fixtures", {}).get("patch", [])
			for f in patch:
				if f is Dictionary and _start.has(str(f.get("id", ""))):
					f["pose"] = MM.head_pose(_start[str(f.id)], d, dyaw)
			_saved()
		"mvr":
			var cfg: Dictionary = Store.project.get("previs", {}).get("mvr", {})
			var moved: Dictionary = cfg.get("moved", {}) if cfg.get("moved") is Dictionary else {}
			var delta := MM.group_delta(_pivot, d, dyaw)
			for u in _start:
				var a := MM.xf_to_array(MM.moved_local(mvr.transform, _start[u], delta))
				if a.is_empty():
					moved.erase(u)
				else:
					moved[u] = a
			cfg["moved"] = moved
			_saved()
		"stage":
			stage_panel.place(_start.pos + d, float(_start.yaw) + dyaw)


## The card: put the target at `pos` (stage frame) with the yaw the card shows.
func set_from_card(pos: Vector3, yaw: float) -> void:
	var c := current()
	if c.is_empty():
		return
	begin()
	var dyaw: float = yaw - float(c.yaw)
	commit(pos - (c.pos as Vector3), -dyaw if c.kind == "heads" else dyaw)


func nudge(d: Vector3, dyaw: float) -> void:
	if active() == "":
		return
	begin()
	commit(d, dyaw)


func _saved() -> void:
	ProjectSync.mark_dirty()
	Store.project_changed.emit(Store.project)


func _heads() -> Array:
	var patch: Variant = Store.project.get("fixtures", {}).get("patch", []) if Store.project.get("fixtures") is Dictionary else []
	var by := {}
	for f in patch if patch is Array else []:
		if f is Dictionary:
			by[str(f.get("id", ""))] = f
	return sel.ids.filter(func(id: String) -> bool: return by.has(id)).map(func(id: String) -> Dictionary: return by[id])


func _nodes() -> Array:
	var uuids: Array = mvr_section.selected_uuids()
	return mvr.get_children().filter(func(c: Node) -> bool:
		return c is Node3D and c.has_meta("uuid") and uuids.has(str(c.get_meta("uuid"))))


## The nodes' meshes in the stage frame (the MVR scene's parent).
func _box(nodes: Array) -> AABB:
	var box := AABB()
	var first := true
	var to_stage := (mvr.get_parent() as Node3D).global_transform.affine_inverse()
	for n in nodes:
		for mi in (n as Node).find_children("*", "MeshInstance3D", true, false):
			var b := (to_stage * (mi as MeshInstance3D).global_transform) * (mi as MeshInstance3D).get_aabb()
			box = b if first else box.merge(b)
			first = false
	return box
