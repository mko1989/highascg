extends RefCounted
## WO-974 — the LTC status line from GET /api/ltc (ltc_model.gd). WO-1092: the LTC fold moved from Settings → Timecode
## to the Audio tab (features/audio/ltc_fold.gd); it uses the Settings / Api autoloads, which the headless runner does not
## load — it is covered by `run-client.sh --check`. The pickers' pure parts are tested here.

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


func test_transport_readout() -> void:  # WO-1059
	t.eq(LM.readout(null).state, "off")
	var off: Dictionary = LM.readout(_st(false, false))
	t.eq(off.text, "LTC off")
	t.eq(off.state, "off")
	var cfg := {"config": {"input": {"enabled": false}, "output": {"enabled": true, "sink": "alsa", "device": "plughw:CARD=Pro,DEV=0", "source": "timeline"}}}
	var run: Dictionary = LM.readout(_st(false, true, cfg.merged({"output": {"running": true, "tc": "00:01:02:03"}})))
	t.eq(run.text, "LTC 00:01:02:03")
	t.eq(run.state, "run")
	t.ok(str(run.tip).contains("plughw:CARD=Pro,DEV=0"), "tooltip names the device")
	var silent: Dictionary = LM.readout(_st(false, true, cfg.merged({"output": {"running": false, "tc": null}})))
	t.eq(silent.text, "LTC --:--:--:--")
	t.eq(silent.state, "silent")
	t.ok(str(silent.tip).contains("timeline is not playing"), "says why it is silent")
	var err: Dictionary = LM.readout(_st(false, true, cfg.merged({"output": {"running": false, "error": "aplay exited 1: No such device"}})))
	t.eq(err.state, "error")
	t.ok(str(err.tip).contains("No such device"), "error text in the tooltip")
	t.eq(LM.readout(_st(false, true, {"libltc": {"ok": false}})).state, "error")
	var unchosen: Dictionary = LM.readout(_st(false, true, cfg.merged({"output": {"running": true, "tc": "00:01:02:03"}})), false)  # WO-1060
	t.eq(unchosen.text, "LTC off", "a timeline that was not chosen shows no timecode")
	t.eq(unchosen.state, "off")


func test_out_status_words_wo1092() -> void:
	var miss := _st(false, true, {"output": {"state": "missing", "running": false, "error": "plughw:CARD=Pro,DEV=0 is not connected"}})
	t.eq(LM.status_line(miss), "Out plughw:CARD=Pro,DEV=0 is not connected")
	var busy := _st(false, true, {"output": {"state": "busy", "running": false, "error": "hcg_ltc_PCH_0: in use by another program"}})
	t.eq(LM.status_line(busy), "Out hcg_ltc_PCH_0: in use by another program")
	var run := {"state": "running", "running": true, "tc": "01:00:00:00", "device": "HDA NVidia — HDMI 2", "channels": [7, 8],
		"rate": 48000, "delayMs": 31.4, "driftMs": 0.42, "underruns": 0}
	t.eq(LM.out_detail(run), "→ HDA NVidia — HDMI 2 · ch 7+8 · 48 kHz · device 31 ms · drift 0.4 ms · 0 under-runs")
	t.eq(LM.out_detail({"state": "off"}), "")
	t.eq(LM.out_detail(null), "")


func test_out_device_and_channel_pickers_wo1092() -> void:
	var devs := [{"value": "program", "label": "Program audio output (Audio 1)", "channels": 6, "usedBy": ["Audio 1"], "program": true},
		{"value": "plughw:CARD=NVidia,DEV=8", "label": "HDA NVidia — HDMI 2", "channels": 8, "usedBy": []},
		{"value": "plughw:CARD=PCH,DEV=0", "label": "HDA Intel PCH — ALC1220 Analog", "channels": 6, "usedBy": ["Audio 1"]}]
	var it := LM.out_device_items(devs, "plughw:CARD=Pro,DEV=0")
	t.eq(it[0], ["", "None"])
	t.eq(it[1], ["program", "Program audio output (Audio 1) · 6 ch"])
	t.eq(it[2], ["plughw:CARD=NVidia,DEV=8", "HDA NVidia — HDMI 2 · 8 ch"])
	t.eq(it[3], ["plughw:CARD=PCH,DEV=0", "HDA Intel PCH — ALC1220 Analog · 6 ch · Audio 1"], "who uses the card")
	t.eq(it[-1], ["plughw:CARD=Pro,DEV=0", "plughw:CARD=Pro,DEV=0 (not connected)"], "the owner's unplugged box stays listed")
	t.eq(LM.device_channels(devs, "plughw:CARD=NVidia,DEV=8", 2), 8)
	t.eq(LM.device_channels(devs, "plughw:CARD=Pro,DEV=0", 1), 1, "not listed: the stored count")
	var ch := LM.channel_items(4)
	t.eq(ch.map(func(x: Array) -> String: return str(x[1])), ["Ch 1", "Ch 2", "Ch 3", "Ch 4", "Ch 1+2", "Ch 3+4"])
	t.eq(LM.channel_items(1).size(), 1, "mono device: no pair")
	t.eq(LM.channel_value(7, true), "7+8")
	t.eq(LM.channel_value(3, false), "3")
	t.eq(LM.parse_channel("7+8"), {"channel": 7, "pair": true})
	t.eq(LM.parse_channel("3"), {"channel": 3, "pair": false})
	t.eq(LM.index_of(LM.channel_items(8), LM.channel_value(7, true)), 11, "Ch 7+8 is the 4th pair after 8 singles")
