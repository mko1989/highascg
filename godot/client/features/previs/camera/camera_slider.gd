extends Node
## WO-1109 — plays a camera slider move on the Previs operator view (previs_stage.gd set_view_pose). Owns the playback
## clock; the section (camera_slider_section.gd) scrubs and starts / stops it. Any camera change it did not make — orbit,
## pan, wheel, dolly, the game pad, a View preset's fly-to, Fit — means the operator took over: playback stops there.

const M := preload("res://features/previs/camera/camera_slider_model.gd")
const PrevisStage := preload("res://features/previs/previs_stage.gd")
const EPS := 1e-3  # m: the camera's own round trip through orbit state stays far below this

signal moved(at: float)  ## the position along the move (0..1), every played frame
signal stopped  ## playback ended: a once move reached B, the operator took over, or stop()

var stage: PrevisStage
var move := {}
var playing := false
var t := 0.0  # where the view is along `move`
var _elapsed := 0.0
var _last := {}  # the pose this node set last (anything else moved the camera)


func _ready() -> void:
	set_process(false)


## Play `m` from position `t` (a once move at its end starts again from A).
func play(m: Dictionary) -> void:
	move = m
	if m.is_empty() or stage == null:
		return
	if m.mode == "once" and t >= 0.999:
		t = 0.0
	_elapsed = M.elapsed_at(m, t)
	playing = true
	set_process(true)
	_apply()


func stop() -> void:
	if not playing:
		return
	playing = false
	set_process(false)
	stopped.emit()


## Put the view at `at` (0..1) along `m` — the slider's drag. Pauses playback.
func scrub(m: Dictionary, at: float) -> void:
	stop()
	move = m
	t = clampf(at, 0.0, 1.0)
	if not m.is_empty() and stage != null:
		_apply()


## The move's data changed (an edit, a remote sync): keep playing it, from the same time.
func update_move(m: Dictionary) -> void:
	if m.is_empty():
		stop()
	move = m


func _process(delta: float) -> void:
	if not playing or move.is_empty() or stage == null:
		return
	if stage.flying() or not _same(stage.view_pose(), _last):
		stop()  # the operator took over
		return
	_elapsed += delta
	t = M.phase(move, _elapsed)
	_apply()
	moved.emit(t)
	if M.done(move, _elapsed):
		stop()


func _apply() -> void:
	var p := M.sample(move, t)
	stage.set_view_pose(M.pos_of(p), M.look_of(p), float(p.fov))
	_last = stage.view_pose()


static func _same(a: Dictionary, b: Dictionary) -> bool:
	if a.is_empty() or b.is_empty():
		return a.is_empty() == b.is_empty()
	return M.pos_of(a).distance_to(M.pos_of(b)) < EPS and M.look_of(a).distance_to(M.look_of(b)) < EPS \
		and absf(float(a.fov) - float(b.fov)) < EPS
