extends RefCounted
## WO-918 F19 — press-drag-release from a connector dot onto another connector completes the cable (it used to only arm
## click-click mode, so the finish needed a second click). cable_gesture.gd notes the press that armed it and asks here
## whether the button coming up is such a drop; the click-click flow is untouched (a release near the press is the click).

const DRAG_PX := 8.0  # travel from the press that makes it a drag (cable_layer.gd UNPLUG_PX)

var press_pos := Vector2.ZERO  # where the arming press landed
var held := false              # …and it was a press on a dot (a button was down when the gesture armed)
var _seen_pos := Vector2.ZERO  # the last left press the gesture's _input saw, and the frame it came in
var _seen_frame := -1


func note_press(at: Vector2) -> void:
	_seen_pos = at
	_seen_frame = Engine.get_process_frames()


## The gesture armed. A press seen this very frame is the arming one (the tab's click and the gesture's _input run in the
## same dispatch, in either order); else trust the button state / the pointer (a real mouse updates both before dispatch).
func arm(pointer: Vector2, button_down: bool) -> void:
	var same := _seen_frame == Engine.get_process_frames()
	press_pos = _seen_pos if same else pointer
	held = same or button_down


## `target_id`: the connector under the release ("" = none); `target_ok`: the gesture accepts a cable source → target.
func completes(armed: bool, regrab_empty: bool, release_pos: Vector2, target_id: String, source_id: String, target_ok: bool) -> bool:
	return held and armed and regrab_empty and target_id != "" and target_id != source_id and target_ok \
		and release_pos.distance_to(press_pos) > DRAG_PX
