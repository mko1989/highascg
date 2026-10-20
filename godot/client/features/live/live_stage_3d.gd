extends Control
## WO-621 N6 — the Live tab's 3D view (web previs-pgm-3d.js: the PGM cell's 2D/3D toggle): the Previs stage
## (project.previs.stage.objects, live destination pictures on the walls) in its own world, orbit + wheel zoom
## and Fit. Read-only — stage editing and GLB models stay in the Previs tab. Renders and holds video surfaces
## only while shown (WO-617).

const PrevisStage := preload("res://features/previs/previs_stage.gd")
const StageBuilder := preload("res://features/previs/stage_builder.gd")

var stage: PrevisStage
var builder: StageBuilder
var _sv: SubViewport
var _last_json := ""
var _framed := false


func _ready() -> void:
	var svc := SubViewportContainer.new()
	svc.stretch = true
	svc.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(svc)
	_sv = SubViewport.new()
	_sv.own_world_3d = true
	_sv.handle_input_locally = false
	svc.add_child(_sv)
	stage = PrevisStage.new()
	_sv.add_child(stage)
	builder = StageBuilder.new()
	builder.live = false
	stage.add_child(builder)
	svc.gui_input.connect(stage.handle_input)
	Store.project_changed.connect(func(_p: Dictionary) -> void: _reload())
	visibility_changed.connect(_apply)
	_reload()
	_apply()


func _reload() -> void:
	var pv: Variant = Store.project.get("previs")
	var st: Variant = (pv as Dictionary).get("stage") if pv is Dictionary else null
	var list: Array = (st as Dictionary).get("objects", []) if st is Dictionary else []
	var js := JSON.stringify(list)
	if js == _last_json:
		return
	_last_json = js
	builder.set_objects(list)
	if not _framed and not builder.objects.is_empty():
		_framed = true
		fit.call_deferred()


## Frame the stage from the side its pictures face (an object's picture faces +Z at rotation 0), a little off-axis
## like the Previs default — an operator wants the picture, not the cabinet backs.
func fit() -> void:
	var facing := Vector2.ZERO
	for o in builder.objects:
		if o.visible:
			var ry := deg_to_rad(float(o.rotation[1]))
			facing += Vector2(sin(ry), cos(ry))
	stage.frame_box(builder.bounds(), (atan2(facing.x, facing.y) if facing.length() > 0.01 else 0.0) - 0.35)


func _apply() -> void:
	var shown := is_visible_in_tree()
	_sv.render_target_update_mode = SubViewport.UPDATE_WHEN_VISIBLE if shown else SubViewport.UPDATE_DISABLED
	builder.set_live(shown)
