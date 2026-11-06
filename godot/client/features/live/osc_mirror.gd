extends Node
## WO-600 O — client copy of the server's OSC channel state (`osc` WS snapshots ~25 Hz + deltas; a delta channel
## REPLACES the copy, WO-985). Timers read `channels[str(ch)]`.

signal updated

const P := preload("res://features/live/pgm_timer_model.gd")

var channels := {}


func _ready() -> void:
	Ws.on("osc", _ingest)
	Ws.on("state", func(d: Variant) -> void:
		if d is Dictionary and (d as Dictionary).get("osc") is Dictionary:
			_ingest(d.osc))


func _ingest(d: Variant) -> void:
	if not (d is Dictionary) or not ((d as Dictionary).get("channels") is Dictionary):
		return
	channels = P.apply_osc(channels, d)
	updated.emit()
