extends Node3D
## WO-1085 — the spot handover's thresholds on the 3D stage: a thin floor line across the rig where a lone person's
## nearest-N heads change (server src/tracking/auto-handover.js thresholds; the margin is added on top while
## walking). Child of the previs stage (previs_tab.gd); shown while the Follow section is open and the handover is on.

const H := preload("res://features/previs/tracking/handover_model.gd")
const C := preload("res://features/previs/tracking/camera_model.gd")
const TrackingModel := preload("res://features/previs/tracking/tracking_model.gd")

const LIFT := 0.012  # above the floor (and the stage marks) so it does not z-fight
const COLOR := Color(0.35, 0.85, 1.0, 0.8)

var _key := ""


## handover = marker_driver.handover (tracking:follow); shown = the Follow section is open; project = Store.project
## (the tracking grid the lines are clipped to).
func show_thresholds(handover: Dictionary, shown: bool, project: Dictionary = {}) -> void:
	var pv: Variant = project.get("previs")
	var tr: Variant = (pv as Dictionary).get("tracking") if pv is Dictionary else null
	var grid := TrackingModel.normalize_grid((tr as Dictionary).get("grid") if tr is Dictionary else null)
	var on: bool = shown and handover.get("mode") == "handover"
	var segs := H.segments(handover.get("thresholds"), grid) if on else []
	var z: float = float(grid.get("z_offset", 0.0))
	var key := JSON.stringify([segs.map(func(s: Array) -> Array: return [s[0].x, s[0].y, s[1].x, s[1].y]), z])
	if key == _key:
		return
	_key = key
	for c in get_children():
		c.queue_free()
	if segs.is_empty():
		return
	var lines := ImmediateMesh.new()
	lines.surface_begin(Mesh.PRIMITIVE_LINES)
	for s in segs:
		for p: Vector2 in s:
			lines.surface_add_vertex(C.psn_to_godot([p.x, p.y, z]) + Vector3(0, LIFT, 0))
	lines.surface_end()
	var mat := StandardMaterial3D.new()
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.albedo_color = COLOR
	mat.no_depth_test = true
	var mi := MeshInstance3D.new()
	mi.mesh = lines
	mi.material_override = mat
	add_child(mi)
