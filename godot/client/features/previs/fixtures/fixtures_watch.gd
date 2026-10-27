extends Node
## WO-797 — the server decodes and sends `tracking:fixtures` only to clients that watch it (src/tracking/fixtures-watch.js).
## A child of every fixture rig (fixtures_3d.gd): it holds the watch while the rig's viewport renders. Every view that
## draws a rig already turns its SubViewport off when hidden (the Previs tab outside 3D or on another tab, the Live tab's
## 3D view; the headset renders through the Previs one), so that one state covers them all (F.renders). Checked 4× a
## second.

const F := preload("res://features/previs/fixtures/fixtures_3d_model.gd")
const TYPE := "tracking:fixtures_watch"
const CHECK_S := 0.25

var watching := false
var _t := CHECK_S  # the first frame checks at once


func _process(delta: float) -> void:
	_t += delta
	if _t < CHECK_S:
		return
	_t = 0.0
	var on := F.renders(get_viewport())
	if on != watching:
		watching = on
		Ws.watch(TYPE, self, on)


func _exit_tree() -> void:
	if watching:
		watching = false
		Ws.watch(TYPE, self, false)
	_t = CHECK_S
