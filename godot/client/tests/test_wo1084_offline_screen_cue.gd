extends RefCounted
## WO-1084 — the Devices destination card says when a screen destination is configured but not started.

const DD := preload("res://features/devices/destinations_model.gd")
var t


func test_offline_cue_from_live_screen_outputs() -> void:
	var payload := {"live": {"screenOutputs": {
		"pgm2": {"state": "offline", "reason": "DP-4/DP-5 + DP-6/DP-7 not connected"},
		"pgm1": {"state": "live", "reason": ""},
		"mix": {"state": "partial", "reason": "DP-3 is the operator screen"},
		"bare": {"state": "offline", "reason": ""}}}}
	t.eq(DD.offline_cue("pgm2", payload), "Not started: DP-4/DP-5 + DP-6/DP-7 not connected", "offline with the reason")
	t.eq(DD.offline_cue("pgm1", payload), "", "running: no cue")
	t.eq(DD.offline_cue("mix", payload), "Some windows not started: DP-3 is the operator screen", "partial")
	t.eq(DD.offline_cue("bare", payload), "Not started", "no reason")
	t.eq(DD.offline_cue("nope", payload), "", "unknown destination")
	t.eq(DD.offline_cue("pgm2", {}), "", "older server without screenOutputs")
	t.eq(DD.offline_cue("pgm2", null), "", "no payload")
