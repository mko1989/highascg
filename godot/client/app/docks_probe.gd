extends Node
## dev: --probe-docks — WO-806: opens the Inspector footer's Timers and Program audio sections against the live server
## (reads only: GET /api/timers/list, /api/audio/*), waits for the polls and the meter ticks, and prints what they
## built: timer rows with their readouts, masters with their bar count and width, input rows, the dock heights.
## Writes nothing (no fader, mute, timer command). Restores the open / closed state it found.

const TimersDock := preload("res://features/live/timers_dock.gd")
const AudioDock := preload("res://features/audio/audio_dock.gd")
const Master := preload("res://features/audio/audio_dock_master.gd")
const Row := preload("res://features/audio/audio_dock_row.gd")


func _ready() -> void:
	if not Ws.is_open:
		await Ws.connected
	await get_tree().create_timer(1.5).timeout
	var td: Node = _find(TimersDock)
	var ad: Node = _find(AudioDock)
	if td == null or ad == null:
		print("[client] docks probe: footer sections not found (timers %s, audio %s)" % [td != null, ad != null])
		return
	var was := [TimersDock.session_open, AudioDock.session_open]
	td.set_open(true)
	ad.set_open(true)
	await get_tree().create_timer(2.5).timeout
	print("[client] docks probe: timers %d — %s" % [td.timers.size(), ", ".join(td._readouts.keys().map(func(k: String) -> String:
		return "%s %s" % [k.left(14), (td._readouts[k] as Label).text]))])
	var masters := []
	var rows := 0
	var lit := 0
	for k in ad.ctl.strips:
		var s: Variant = ad.ctl.strips[k]
		if s is Master:
			masters.append("%s %d bars %dpx" % [k, (s as Master).meter.levels.size(), int((s as Master).size.x)])
		elif s is Row:
			rows += 1
			if (s as Row).level.v > 0.0:
				lit += 1
	print("[client] docks probe: audio masters [%s], rows %d (%d with level), dock %dx%d, timers dock %dx%d, inspector %dpx" % [
		", ".join(masters), rows, lit, int(ad.size.x), int(ad.size.y), int(td.size.x), int(td.size.y),
		int((ad.get_parent() as Control).size.x)])
	td.set_open(was[0])
	ad.set_open(was[1])


func _find(script: Script) -> Node:
	for n in get_tree().root.find_children("*", "VBoxContainer", true, false):
		if n.get_script() == script:
			return n
	return null
