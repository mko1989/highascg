extends Control
## WO-621 N6 — the Live tab's 3D view (web previs-pgm-3d.js: the PGM cell's 2D/3D toggle): the Previs stage
## (project.previs.stage.objects, live destination pictures on the walls) in its own world, orbit + wheel zoom
## and Fit. Read-only — stage editing and GLB models stay in the Previs tab. Renders and holds video surfaces
## only while shown (WO-617).
## WO-649: the project's MVR scene too (MvrScene.configure, as the Previs tab applies it), loaded on the first show, and
## the patched GDTF rig; `lights` renders its beams or not (the heads stay either way).

const PrevisStage := preload("res://features/previs/previs_stage.gd")
const StageBuilder := preload("res://features/previs/stage_builder.gd")
const MvrScene := preload("res://features/previs/mvr_scene.gd")
const M := preload("res://features/previs/mvr_model.gd")
const Fixtures3D := preload("res://features/previs/fixtures/fixtures_3d.gd")
const FollowModel := preload("res://features/previs/tracking/follow_model.gd")

var stage: PrevisStage
var builder: StageBuilder
var _sv: SubViewport
var _last_json := ""
var _framed := false
var mvr: MvrScene
var rig: Node3D  # fixtures_3d.gd, made on the first show
var lights := true
var _mvr_json := ""


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
	mvr = MvrScene.new()
	stage.add_child(mvr)
	mvr.loaded.connect(func(info: Dictionary) -> void:
		if info.has("objects"):
			fit())
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


## The MVR scene + rig follow the project only once the view has been shown (a second copy of the meshes otherwise).
func _reload_mvr() -> void:
	if rig == null:
		return
	var pv: Variant = Store.project.get("previs")
	var c: Dictionary = (pv as Dictionary).get("mvr", {}) if pv is Dictionary and (pv as Dictionary).get("mvr") is Dictionary else {}
	var js := JSON.stringify(c)
	if js != _mvr_json:
		_mvr_json = js
		mvr.configure(c)
	mvr.set_patched(M.patched_uuids(FollowModel.normalize(Store.project.get("fixtures")).patch))


func set_lights(on: bool) -> void:
	lights = on
	if rig != null:
		rig.set_beams(on)


## Frame the stage from the side its pictures face (StageBuilder.front_yaw).
func fit() -> void:
	var b := builder.bounds()
	for m: AABB in [mvr.bounds(), rig.bounds() if rig != null else AABB()]:
		if m.size != Vector3.ZERO:
			b = m if b.size == Vector3.ZERO else b.merge(m)
	stage.frame_box(b, builder.front_yaw())


func _apply() -> void:
	var shown := is_visible_in_tree()
	_sv.render_target_update_mode = SubViewport.UPDATE_WHEN_VISIBLE if shown else SubViewport.UPDATE_DISABLED
	builder.set_live(shown)
	mvr.set_live(shown)
	if shown and rig == null:
		rig = Fixtures3D.new()
		rig.beams_on = lights
		stage.add_child(rig)
		Store.project_changed.connect(func(_p: Dictionary) -> void: _reload_mvr())
		_reload_mvr()
