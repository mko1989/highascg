extends Node
## dev: --probe-drape=<png prefix> (with --tab=Previs) — WO-1104: the Previs 3D view from fixed cameras on the Hilton
## Wawer wall's bottom edge (the hand-built MVR "Kotara" before, the "drape" stage object after: the same poses), at
## house lights 100 % and 35 %, saved from the stage SubViewport as <prefix>_<cam>_<house %>.png. The house level is set
## for this run only (ui.cfg untouched) and restored; the orbit camera is left on the last pose.

const Quality := preload("res://features/previs/previs_quality.gd")
const House := preload("res://features/previs/house_lights.gd")

## name → [target, yaw (rad; 0 = from +Z), pitch (rad), distance m]. The wall faces −X (rotation −90°).
const CAMS := {
	"front": [Vector3(12.6, 1.4, 3.5), -PI / 2.0, 0.06, 17.0],
	"close": [Vector3(12.6, 1.0, 8.5), -PI / 2.0 + 0.35, 0.1, 6.0],
	"edge": [Vector3(12.55, 0.9, -2.5), -PI / 2.0 - 0.6, 0.1, 3.5],
}


func _ready() -> void:
	var prefix := str(Config.args["probe-drape"])
	await get_tree().create_timer(15.0).timeout  # venue, rig and project arrive over HTTP / WS
	var tab: Node = get_tree().root.find_child("Previs", true, false)
	if tab == null or tab.get("stage") == null:
		print("[client] drape probe: no Previs tab")
		return
	var hl: RefCounted = House.shared()
	var was: float = hl.level
	print("[client] drape probe: quality %s, house %.2f" % [Quality.NAMES[Quality.shared().level], was])
	for h in [1.0, 0.35]:
		hl.set_level(h, false)  # live, not saved
		for cam: String in CAMS:
			_aim(tab.stage, CAMS[cam])
			for i in 20:
				await get_tree().process_frame
			tab._sv.get_texture().get_image().save_png("%s_%s_%03d.png" % [prefix, cam, roundi(h * 100.0)])
	hl.set_level(was, false)
	print("[client] drape probe done")


func _aim(stage: Node, c: Array) -> void:
	if stage._fly_tween != null:
		stage._fly_tween.kill()
	stage._target = c[0]
	stage._yaw = c[1]
	stage._pitch = c[2]
	stage._dist = c[3]
	stage._update_camera()
