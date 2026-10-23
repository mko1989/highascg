extends Node3D
## WO-700 — the stage marks heads are calibrated on (project.fixtures.marks, PSN metres), drawn on the 3D stage: a
## floor cross and a name tag each, so the operator sees where a mark sits before aiming a real beam onto it.
## Child of the previs stage (previs_tab.gd); rebuilt when the marks change.

const F := preload("res://features/previs/tracking/follow_model.gd")
const C := preload("res://features/previs/tracking/camera_model.gd")

const ARM := 0.25  # half a cross arm, metres
const LIFT := 0.01  # above the floor so it does not z-fight
const COLOR := Color(1.0, 0.75, 0.2)

var _key := ""


func _ready() -> void:
	Store.project_changed.connect(_on_project)
	_on_project(Store.project)


func _on_project(project: Variant) -> void:
	var fx: Variant = (project as Dictionary).get("fixtures") if project is Dictionary else null
	var marks := F.normalize_marks(fx.get("marks") if fx is Dictionary else null)
	var key := JSON.stringify(marks)
	if key == _key:
		return
	_key = key
	for c in get_children():
		c.queue_free()
	if marks.is_empty():
		return
	var lines := ImmediateMesh.new()
	lines.surface_begin(Mesh.PRIMITIVE_LINES)
	for m in marks:
		var at := C.psn_to_godot([m.x, m.y, m.z]) + Vector3(0, LIFT, 0)
		for d in [Vector3(ARM, 0, 0), Vector3(0, 0, ARM)]:
			lines.surface_add_vertex(at - d)
			lines.surface_add_vertex(at + d)
		var tag := Label3D.new()
		tag.text = str(m.name)
		tag.modulate = COLOR
		tag.billboard = BaseMaterial3D.BILLBOARD_ENABLED
		tag.no_depth_test = true
		tag.pixel_size = 0.012
		tag.position = at + Vector3(0, 0.2, 0)
		add_child(tag)
	lines.surface_end()
	var mat := StandardMaterial3D.new()
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.albedo_color = COLOR
	mat.no_depth_test = true
	var mi := MeshInstance3D.new()
	mi.mesh = lines
	mi.material_override = mat
	add_child(mi)
