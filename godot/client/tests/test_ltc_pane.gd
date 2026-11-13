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



## WO-1055: the LTC Device dropdowns — the cards, None first, a stored device kept, a card-number device matched to its card.
func test_device_items() -> void:
	var cards := [{"value": "plughw:CARD=PCH,DEV=0", "label": "HDA Intel PCH — ALC1220 Analog", "card": 0, "device": 0},
		{"value": "plughw:CARD=USB,DEV=0", "label": "Scarlett Solo USB — USB Audio", "card": 4, "device": 0}]
	var it := LM.device_items(cards, "")
	t.eq(it, [["", "None"], ["plughw:CARD=PCH,DEV=0", "HDA Intel PCH — ALC1220 Analog"],
		["plughw:CARD=USB,DEV=0", "Scarlett Solo USB — USB Audio"]], "None, then the cards")
	t.eq(LM.index_of(it, "plughw:CARD=USB,DEV=0", cards), 2, "the stored card")
	t.eq(LM.index_of(it, "plughw:4,0", cards), 2, "a card-number device shows its card")
	t.eq(LM.index_of(it, "hw:4,0", cards), 2, "hw: too")
	t.eq(LM.index_of(it, "", cards), 0, "nothing stored: None")
	var gone := LM.device_items(cards, "plughw:CARD=X32,DEV=0")
	t.eq(gone[-1], ["plughw:CARD=X32,DEV=0", "plughw:CARD=X32,DEV=0 (not connected)"], "a missing card stays listed")
	t.eq(LM.device_items(cards, "plughw:4,0").size(), 3, "a card-number device is not listed twice")
