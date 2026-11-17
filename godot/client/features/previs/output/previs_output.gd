extends Node
## WO-1108 — the Previs view as a Live source: its own fixed-size SubViewport on the previs stage's World3D (so the same
## scene, Environment, house lights and haze) with its OWN Camera3D, published as shm ring `previs` (viewport_publisher.gd).
## The camera follows the operator's view each frame, or plays a camera slider move on its own clock (WO-1109) while
## the operator's view stays free. Clean: the camera's cull_mask drops clean_layer.gd's helper layer.
## While it runs it marks the stage's SubViewport with fixtures_3d_model.gd FEEDS: the Previs tab then keeps the stage's
## videos live (previs_tab.gd _apply_mode) and the rig keeps its tracking:fixtures watch (fixtures_watch.gd), though
## the tab itself is hidden and its own viewport sleeps (WO-617). Renders only while the ring runs (or a probe asks).

const OM := preload("res://features/previs/output/previs_output_model.gd")
const SM := preload("res://features/previs/camera/camera_slider_model.gd")
const Publisher := preload("res://features/shm_out/viewport_publisher.gd")
const Quality := preload("res://features/previs/previs_quality.gd")
const Clean := preload("res://features/previs/output/clean_layer.gd")
const F := preload("res://features/previs/fixtures/fixtures_3d_model.gd")
const PrevisStage := preload("res://features/previs/previs_stage.gd")

signal feeding_changed  ## the stage must stay live for the output now (or may sleep again)

var stage: PrevisStage
var vp := SubViewport.new()
var cam := Camera3D.new()
var publisher := Publisher.new()
var clean := Clean.new()
var cfg := OM.normalize(null)
var moves: Array = []
var ring := OM.RING
var fps := 50
var why := ""  # why the ring is not running ("" = it is, or it is off)
var force_render := false  # the probe renders without a sink
var _elapsed := 0.0
var _move_id := ""
var _feeding := false


func _ready() -> void:
	vp.render_target_update_mode = SubViewport.UPDATE_DISABLED
	vp.size = Vector2i(OM.DEFAULT_SIZE[0], OM.DEFAULT_SIZE[1])
	vp.handle_input_locally = false
	vp.gui_disable_input = true
	vp.add_child(cam)
	cam.current = true
	cam.cull_mask = 0xFFFFF & ~Clean.LAYER
	add_child(vp)
	add_child(publisher)
	add_child(clean)
	Quality.shared().changed.connect(_on_quality)
	_on_quality()
	set_process(false)


## The stage it shows (in the tree: its viewport's World3D is shared).
func attach(s: PrevisStage) -> void:
	stage = s
	vp.world_3d = s.get_viewport().find_world_3d()
	clean.root = s


## WO-892: the render quality, compact (1.0 scale, the shadow atlas ≤ 4096: a second view of the same world).
func _on_quality(_level := 0) -> void:
	Quality.apply_viewport(vp, Quality.shared().current(), true)
	Quality.register_meter(vp)


## The slice (previs_output_model normalize), the camera slider moves, "" or why this client cannot publish, the rate.
func apply(out: Dictionary, mv: Array, cannot: String, rate: int) -> void:
	cfg = out
	moves = mv
	vp.size = Vector2i(int(out.size[0]), int(out.size[1]))  # a running ring re-opens at the new size (the publisher)
	var want: bool = out.enabled == true
	if want and (publisher.sink == null or rate != fps):
		fps = rate
		why = cannot if cannot != "" else publisher.start(vp, ring, rate)
		if why != "":
			publisher.stop()
	elif not want:
		publisher.stop()
		why = cannot
	_sync_render()


func _sync_render() -> void:
	var on := publisher.sink != null or force_render
	vp.render_target_update_mode = SubViewport.UPDATE_ALWAYS if on else SubViewport.UPDATE_DISABLED
	set_process(on)
	clean.set_active(on)
	if stage != null and stage.get_viewport() != null:
		stage.get_viewport().set_meta(F.FEEDS, on)
	if on != _feeding:
		_feeding = on
		feeding_changed.emit()


func running() -> bool:
	return publisher.sink != null


func status_text() -> String:
	return OM.status(cfg, why, ring, running(), fps, OM.camera_missing(cfg, moves))


func _process(delta: float) -> void:
	if stage == null:
		return
	var m := OM.camera_move(cfg, moves)
	if str(m.get("id", "")) != _move_id:
		_move_id = str(m.get("id", ""))
		_elapsed = 0.0
	if m.is_empty():  # "My view"
		var c := stage.camera()
		if c == null:
			return
		cam.global_transform = c.global_transform
		cam.fov = c.fov
		cam.near = c.near
		cam.far = c.far
		return
	_elapsed += delta
	var p := SM.sample(m, SM.phase(m, _elapsed))
	cam.global_transform = stage.global_transform * SM.transform_of(p)
	cam.fov = float(p.fov)
