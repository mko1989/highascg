extends RefCounted
## WO-974 — Settings → Timecode: the LTC status line from GET /api/ltc (ltc_model.gd). The pane itself (ltc_pane.gd)
## uses the Settings / Api autoloads, which the headless runner does not load — it is covered by `run-client.sh --check`.

const LM := preload("res://features/settings/ltc_model.gd")
var t


func _st(input_on: bool, output_on: bool, extra := {}) -> Dictionary:
	var d := {"libltc": {"ok": true}, "config": {"input": {"enabled": input_on}, "output": {"enabled": output_on}}}
	d.merge(extra, true)
	return d


func test_off_and_missing_lib() -> void:
	t.eq(LM.status_line(null), "LTC status unavailable")
	t.eq(LM.status_line(_st(false, false)), "LTC in and out are off")
	var d := _st(true, false, {"libltc": {"ok": false, "hint": "sudo apt install libltc11"}})
	t.eq(LM.status_line(d), "libltc is not installed — sudo apt install libltc11")


func test_in_and_out() -> void:
	var d := _st(true, true, {"input": {"state": "locked", "tc": "01:00:12:04", "volumeDb": -18.4},
		"output": {"running": true, "tc": "10:00:00:01", "source": "timeline"}})
	t.eq(LM.status_line(d), "In 01:00:12:04 locked -18 dB · Out 10:00:00:01")
	d = _st(true, true, {"input": {"state": "none", "tc": null}, "output": {"running": false, "source": "timeline"}})
	t.eq(LM.status_line(d), "In --:--:--:-- no signal · Out silent (timeline not playing)")
	d = _st(true, false, {"input": {"problem": "no input device chosen"}})
	t.eq(LM.status_line(d), "In no input device chosen")

