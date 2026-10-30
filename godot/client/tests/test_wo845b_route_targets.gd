extends RefCounted
## WO-845b — removing a live-audio slot forgets that slot's persisted route selection (routeTargets[s-1] = null),
## so the config POST carries no `live_audio_input_N_pgm_channels` for it (the server neutralises it, WO-845).
## Same rule as the web's live-audio-remove-input.js (tools/smoke/smoke-wo845b-followups.test.js).

const IS := preload("res://features/devices/input_slots_model.gd")
var t


func _cs() -> Dictionary:
	return {
		"live_audio_input_count": 2,
		"live_audio_input_1_device": "alsa://hw:1,0",
		"live_audio_input_2_device": "alsa://hw:2,0",
		"live_audio_input_1_pgm_channels": "1,2",
		"live_audio_input_2_pgm_channels": "1",
		"live_audio_pgm_layer": 2,
	}


func _config_body(plan: Dictionary) -> Dictionary:
	for r in plan.requests:
		if r[1] == "/api/audio/live-inputs/config":
			return r[2]
	return {}


func test_remove_slot_drops_its_route_selection() -> void:
	var body := _config_body(IS.live_audio_remove_plan(_cs(), {}, 2))
	t.eq(body.get("live_audio_input_2_device"), "", "device cleared")
	t.ok(not body.has("live_audio_input_2_pgm_channels"), "removed slot sends no pgm_channels")
	t.eq(body.get("live_audio_input_1_pgm_channels"), "1,2", "other slots keep their selection")
	t.eq(body.get("live_audio_input_count"), 1, "count shrinks past the emptied tail slot")


func test_remove_slot_without_saved_routes_is_unchanged() -> void:
	var cs := _cs()
	cs.erase("live_audio_input_1_pgm_channels")
	var body := _config_body(IS.live_audio_remove_plan(cs, {}, 1))
	t.ok(not body.has("live_audio_input_1_pgm_channels"), "never-saved slot sends no key")
	t.eq(body.get("live_audio_input_2_pgm_channels"), "1")
