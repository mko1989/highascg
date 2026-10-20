extends RefCounted
## WO-608 — Settings → Live audio status + ALSA mixer rules (web settings-live-audio-panel.js, lib/alsa-mixer-api.js).

const L := preload("res://features/settings/live_audio_model.gd")
const A := preload("res://features/settings/alsa_mixer_model.gd")
var t


func test_status_lines() -> void:
	t.eq(L.status_lines({"liveAudioCount": 0, "configured": {"count": 0}})[0][1], "")
	t.eq(L.status_lines({"liveAudioCount": 2, "liveAudioInputChannels": []})[0][1], "warn")
	var live := {"liveAudioCount": 1.0, "liveAudioInputChannels": [5.0], "configured": {"count": 1.0},
		"status": {"enabled": true, "started": [{"slot": 1.0}], "failed": []}}
	var lines := L.status_lines(live)
	t.eq(lines[0], ["Live audio inputs: 1 dedicated channel(s)", ""])
	t.eq(lines[1][0].begins_with("Slot 1 → ch 5"), true, lines[1][0])
	t.eq(lines[2], ["Started: slot 1", "ok"])
	t.eq(L.status_lines({"liveAudioCount": 1.0, "liveAudioInputChannels": [5.0], "status": {"enabled": false,
		"reason": "amcp_disconnected", "failed": [{"message": "no device"}]}}).slice(2), [["amcp_disconnected", "warn"],
		["Failed: no device", "warn"]])
	t.eq(L.preview_devices([{"name": "PCH"}, {"id": "hw:1"}, {}]), [["", "Default sink"], ["PCH", "PCH"], ["hw:1", "hw:1"]])


func test_alsa_normalize_and_view() -> void:
	var n := A.normalize({"card": 0.0, "cards": [{"card": 0.0, "name": "PCH"}, {"index": "2", "label": "USB"}, {"card": -1}],
		"controls": [{"name": "Master"}, 3], "suggestedCard": 2.0})
	t.eq(n.cards, [{"card": 0, "name": "PCH"}, {"card": 2, "name": "USB"}])
	t.eq(n.controls.size(), 1)
	t.eq(n.suggested, 2)
	t.eq(A.normalize({"playback": [{"name": "a"}], "capture": [{"name": "b"}]}).controls.size(), 2)
	t.eq(A.normalize(null).suggested, -1)
	t.eq(A.matches_view({"name": "Mic", "type": "volume", "capture": true}, "playback"), false)
	t.eq(A.matches_view({"name": "PCM", "type": "boolean"}, "capture"), true)
	t.eq(A.matches_view({"name": "Capture Volume"}, "capture"), true)
	t.eq(A.matches_view({"name": "Master"}, "capture"), false)
	t.eq(A.matches_view({"name": "Mic Playback"}, "playback"), true)


func test_alsa_percent_and_body() -> void:
	t.eq(A.percent({"min": 0.0, "max": 87.0, "value": 87.0, "percent": 100.0}), 100)
	t.eq(A.percent({"min": 0.0, "max": 87.0, "value": 43.0, "percent": 49.0}), 49, "server percent is not rescaled")
	t.eq(A.percent({"min": 0.0, "max": 31.0, "value": 31.0}), 100)
	t.eq(A.percent({"value": "x"}), 0)
	t.eq(A.kind({"type": "enumerated"}), "enum")
	t.eq(A.kind({"type": "switch"}), "bool")
	t.eq(A.kind({}), "volume")
	t.eq(A.switch_on({"value": 0.0, "on": true}), false)
	t.eq(A.switch_on({"value": 1.0}), true)
	t.eq(A.switch_on({"on": true}), true)
	t.eq(A.switch_on({}), false)
	t.eq(A.value_text({"dB": -34.5}, 0), "0% · -34.5 dB")
	t.eq(A.body(2, {"name": "Mic", "index": 0.0}, {"percent": 40}), {"card": 2, "name": "Mic", "index": 0, "percent": 40})
