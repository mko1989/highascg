extends Node
## WO-600 F/G — push look edits to PRV like the web editor (components/scenes-preview-runtime.js):
## 16 ms debounce, 200 ms max wait while edits keep streaming, one push in flight (coalesced).
## A push = deck sync (the edit reaches the server's live deck first, WO-598 contract) → POST
## /api/scene/preview-push (server picks MIXER nudge vs re-take, WO-598 C2) → autosave scheduled.

signal pushed(result: Dictionary)

const DEBOUNCE_MS := 16
const MAX_WAIT_MS := 200

var _scene_id := ""
var _main := 0
var _first_at := 0
var _due_at := 0
var _busy := false
var _again := false
var pushes := 0
var last_mode := ""


func schedule(scene_id: String, main: int) -> void:
	var now := Time.get_ticks_msec()
	if _due_at == 0:
		_first_at = now
	_scene_id = scene_id
	_main = main
	_due_at = mini(now + DEBOUNCE_MS, _first_at + MAX_WAIT_MS)


func _process(_d: float) -> void:
	if _due_at == 0 or Time.get_ticks_msec() < _due_at:
		return
	_due_at = 0
	if _busy:
		_again = true
		return
	_run()


func _run() -> void:
	_busy = true
	ProjectSync.send_deck_sync(true)
	var res: Dictionary = await Api.post_json("/api/scene/preview-push", {"sceneId": _scene_id, "mainIdx": _main})
	pushes += 1
	last_mode = str((res.data as Dictionary).get("mode", "")) if res.data is Dictionary else ""
	ProjectSync.mark_dirty()
	pushed.emit(res)
	_busy = false
	if _again:
		_again = false
		_run()
