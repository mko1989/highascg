extends Node3D
## WO-978 — the server hub's markers on the 3D stage (previs_tab.gd adds it under the stage): a pole from the floor to
## the marker's height, a ball on top and a name tag, so what goes to the lighting desk (PSN / follow) is visible in
## the previs without a tracking camera. The test puppet (source "puppet", src/tracking/puppet.js) is magenta and
## tagged "test puppet"; a stale marker (no write for 1 s) is dimmed. Fed by WS tracking:markers (≤ 30 Hz).

const C := preload("res://features/previs/tracking/camera_model.gd")

const PUPPET := Color(1.0, 0.3, 0.85)
const OTHER := Color(0.35, 0.85, 1.0)
const STALE_ALPHA := 0.35
const MIN_H := 0.2  # a marker on the floor still gets a visible pole

var _pins := {}  # marker id → {root: Node3D, pole: MeshInstance3D, ball: MeshInstance3D, tag: Label3D, mat}


func _ready() -> void:
	var ws := get_node_or_null("/root/Ws")  # the autoload (looked up, so tests can load this script without it)
	if ws != null:
		ws.message.connect(_on_ws)


func _on_ws(type: String, data: Variant) -> void:
	if type == "tracking:markers" and data is Dictionary:
		show_markers((data as Dictionary).get("markers", []))


## The hub's marker list → pins (made, moved, dropped).
func show_markers(list: Variant) -> void:
	var seen := {}
	for m in (list if list is Array else []):
		if not (m is Dictionary) or not (m.get("id") is float or m.get("id") is int):
			continue
		var id := int(m.id)
		seen[id] = true
		if not _pins.has(id):
			_pins[id] = _make()
		_place(_pins[id], m)
	for id in _pins.keys():
		if not seen.has(id):
			(_pins[id].root as Node3D).queue_free()
			_pins.erase(id)


## Pin count (tests).
func count() -> int:
	return _pins.size()


## Tag text and colour of one marker (pure; tests).
static func look(m: Dictionary) -> Dictionary:
	var puppet: bool = m.get("source") == "puppet"
	var c := PUPPET if puppet else OTHER
	if m.get("stale") == true:
		c.a = STALE_ALPHA
	var label := str(m.get("name", "")) if str(m.get("name", "")) != "" else "Marker %d" % int(m.get("id", 0))
	return {"text": label + (" · test puppet" if puppet else ""), "color": c}


func _make() -> Dictionary:
	var root := Node3D.new()
	var mat := StandardMaterial3D.new()
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	var pole := MeshInstance3D.new()
	var cyl := CylinderMesh.new()
	cyl.top_radius = 0.025
	cyl.bottom_radius = 0.025
	cyl.height = 1.0
	pole.mesh = cyl
	pole.material_override = mat
	root.add_child(pole)
	var ball := MeshInstance3D.new()
	var sph := SphereMesh.new()
	sph.radius = 0.12
	sph.height = 0.24
	ball.mesh = sph
	ball.material_override = mat
	root.add_child(ball)
	var tag := Label3D.new()
	tag.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	tag.no_depth_test = true
	tag.pixel_size = 0.012
	root.add_child(tag)
	add_child(root)
	return {"root": root, "pole": pole, "ball": ball, "tag": tag, "mat": mat}


func _place(pin: Dictionary, m: Dictionary) -> void:
	var h := maxf(MIN_H, float(m.get("z", 0.0)))
	(pin.root as Node3D).position = C.psn_to_godot([float(m.get("x", 0.0)), float(m.get("y", 0.0)), 0.0])
	var pole := pin.pole as MeshInstance3D
	pole.scale = Vector3(1, h, 1)
	pole.position = Vector3(0, h / 2.0, 0)
	(pin.ball as MeshInstance3D).position = Vector3(0, h, 0)
	var lk := look(m)
	(pin.mat as StandardMaterial3D).albedo_color = lk.color
	var tag := pin.tag as Label3D
	tag.text = lk.text
	tag.modulate = lk.color
	tag.position = Vector3(0, h + 0.3, 0)
