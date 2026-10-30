extends Node
## WO-599 T4 placement, plus WO-868: keep the window on the operator monitor when the X layout changes under it.
## --screen wins; otherwise the server's operator monitor (GET /api/system/operator-display). The "Operator GUI first"
## switch (and a NovaStar replug) moves the monitors with xrandr while the client runs: the window manager then refits
## the maximized window to whatever monitor now sits where it was (the LED wall), so the screen rects are polled and a
## change places the window again.

const Placement := preload("res://app/window_placement.gd")
const Platform := preload("res://core/platform.gd")
const ScreenModel := preload("res://app/operator_screen_model.gd")

const POLL_S := 2.0

signal said(line: String)

var _sig := ""
var _busy := false
var _target := -1  # the screen place() chose: w.current_screen still answers the old one right after a move


func _ready() -> void:
	_sig = _signature()
	var t := Timer.new()
	t.wait_time = POLL_S
	t.timeout.connect(_poll)
	add_child(t)
	t.start()


static func _screens() -> Array:
	var screens := []
	for i in DisplayServer.get_screen_count():
		screens.append(Rect2i(DisplayServer.screen_get_position(i), DisplayServer.screen_get_size(i)))
	return screens


func _signature() -> String:
	return str(_screens())


## Puts the window on the operator monitor; true when the box has no operator monitor yet (the boot question opens).
func place(w: Window) -> bool:
	if Config.args.has("screen"):
		var s := int(Config.args["screen"])
		_target = s
		if s != w.current_screen or w.position != DisplayServer.screen_get_position(s):
			Placement.move_to_screen(w, s)
		return false
	if not Platform.is_local_origin(Config.origin):  # WO-686: off-box the box's operator monitor is not one of ours
		return false
	var res: Dictionary = await Api.get_json("/api/system/operator-display")
	var screens := _screens()
	var outs: Dictionary = await Api.get_json("/api/system/operator-screen")  # live places, by output name
	var rect: Variant = Placement.live_rect(res.data.get("rect") if res.ok and res.data is Dictionary else null, outs.data.get("outputs") if outs.ok and outs.data is Dictionary else null)
	var i := Placement.pick_screen(rect, screens)
	_target = i
	if i >= 0 and (i != w.current_screen or w.position != DisplayServer.screen_get_position(i)):
		Placement.move_to_screen(w, i)
		said.emit("operator monitor: screen %d" % i)
		return false
	return res.ok and ScreenModel.should_auto_open(rect, null, screens.size())


func _poll() -> void:
	var sig := _signature()
	if sig == _sig or _busy:
		return
	_sig = sig
	_busy = true
	said.emit("screen layout changed: %s" % sig)
	var w := get_window()
	_target = -1
	await place(w)
	if Platform.is_local_origin(Config.origin):
		var scr := _target if _target >= 0 and _target < DisplayServer.get_screen_count() else w.current_screen
		w.content_scale_factor = Placement.ui_scale(DisplayServer.screen_get_size(scr), Placement.saved_scale())
	_busy = false
