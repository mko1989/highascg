extends RefCounted
## WO-800 — per-layer audio levels in the console: row → Caspar (channel, layer) incl. the PGM look bank, the level read
## from GET /api/osc/audio-layers, the lane's ballistics (= the channel meters' smoothing), the meter bank's lane.

const LL := preload("res://features/audio/layer_levels.gd")
const AM := preload("res://features/audio/audio_meter_model.gd")
const MeterBank := preload("res://features/audio/meter_bank.gd")
var t


## The shape the box returned on 29.10 (curl), trimmed to 4 of 16 audio channels.
func _data() -> Dictionary:
	var lv := func(l: float, r: float) -> Array:
		return [{"dBFS": l, "peak": l}, {"dBFS": r, "peak": r}, {"dBFS": -120.0, "peak": -120.0}, {"dBFS": -120.0, "peak": -120.0}]
	return {"channels": {
		"2": {"11": {"nbChannels": 4, "levels": lv.call(-27.25, -25.88), "updatedAt": 1.0},
			"12": {"nbChannels": 4, "levels": lv.call(-120.0, -120.0), "updatedAt": 1.0},
			"111": {"nbChannels": 4, "levels": lv.call(-6.9, -0.5), "updatedAt": 1.0}},
		"3": {"200": {"nbChannels": 4, "levels": lv.call(-12.0, -14.0)}, "210": {"nbChannels": 4, "levels": lv.call(-30.0, -40.0)}},
		"7": {"10": {"nbChannels": 4, "levels": lv.call(-20.0, -18.0)}}}, "updatedAt": 2.0}


func _scene_row(ch: int, ln: int) -> Dictionary:  # audio_rows._scene_rows: the only rows with audioScreens
	return {"key": "pgm:%d:layer:%d" % [ch, ln], "ch": float(ch), "layer": float(ln), "isMaster": false, "audioScreens": []}


func test_target_maps_rows_to_physical_layers() -> void:
	t.eq(LL.target(_scene_row(2, 11), {"2": "a"}), [2, 11], "bank A look layer = logical")
	t.eq(LL.target(_scene_row(2, 11), {"2": "b"}), [2, 111], "bank B look layer = +100")
	t.eq(LL.target(_scene_row(2, 11), null), [2, 11], "no bank map → bank A")
	t.eq(LL.target(_scene_row(2, 11), {"1": "b"}), [2, 11], "another channel's bank does not shift")
	t.eq(LL.target({"ch": 3, "layer": 210, "isTimelineClip": true}, {"3": "b"}), [3, 210], "timeline layers are fixed")
	t.eq(LL.target({"ch": 3, "layer": 200, "isAudioOnlyLook": true}, {"3": "b"}), [3, 200], "audio-only look is fixed")
	t.eq(LL.target({"key": "input:7", "ch": 7, "layer": 10, "isLiveInput": true}, {"7": "b"}), [7, 10], "input row: its channel + producer layer")
	t.eq(LL.target({"key": "pgm:1", "ch": 1, "isMaster": true}, {}), [], "masters have no lane")
	t.eq(LL.target({"ch": 1}, {}), [], "a row without a layer has no lane")
	var live := _scene_row(2, 11)
	live["hostChannel"] = 9
	t.eq(LL.target(live, {}), [2, 11], "a live-audio look layer meters on the program channel, not its host channel")


func test_read_level_is_the_loudest_audio_channel() -> void:
	var d := _data()
	var r := LL.read(d, _scene_row(2, 11), {})
	t.ok(r.present, "layer 11 carries audio")
	t.eq(r.level, -25.88, "max dBFS over the layer's channels")
	t.eq(LL.read(d, _scene_row(2, 11), {"2": "b"}).level, -0.5, "bank B reads layer 111")
	t.eq(LL.read(d, {"ch": 3, "layer": 200}, {}).level, -12.0, "audio-only look")
	t.eq(LL.read(d, {"key": "input:7", "ch": 7, "layer": 10, "isLiveInput": true}, {}).level, -18.0, "input layer")
	var silent := LL.read(d, _scene_row(2, 12), {})
	t.ok(silent.present and silent.level <= -90.0, "present but silent: below the meter floor")
	var none := LL.read(d, _scene_row(2, 10), {})
	t.ok(not none.present, "a layer not in the response has no audio")
	t.ok(not LL.read({}, _scene_row(2, 11), {}).present, "empty / failed poll → nothing")
	t.ok(not LL.read({"channels": {}}, {"key": "pgm:1", "ch": 1, "isMaster": true}, {}).present, "master → nothing")


func test_entry_older_than_fresh_ms_is_absent() -> void:
	t.eq(LL.FRESH_MS, 500, "same window as the web lane")
	var at := func(age: int) -> Dictionary:
		return {"channels": {"2": {"10": {"nbChannels": 2, "levels": [{"dBFS": -18.0}], "updatedAt": 10000 - age}}}, "updatedAt": 10000}
	t.ok(LL.read(at.call(480), _scene_row(2, 10), {}).present, "480 ms old: still live")
	t.ok(not LL.read(at.call(520), _scene_row(2, 10), {}).present, "520 ms old: the clip ended, no frozen level")
	var no_stamp := {"channels": {"2": {"10": {"levels": [{"dBFS": -18.0}]}}}}
	t.ok(LL.read(no_stamp, _scene_row(2, 10), {}).present, "no timestamps → present (older nodes)")


func test_peak_respects_nb_channels_and_bad_values() -> void:
	t.eq(LL.peak({"nbChannels": 1, "levels": [{"dBFS": -30.0}, {"dBFS": -3.0}]}), -30.0, "only nbChannels count")
	t.eq(LL.peak({"levels": [{"dBFS": "x"}, {}, null]}), -99.0, "no numbers → -99")
	t.eq(LL.peak(null), -99.0, "no entry → -99")


func test_lane_uses_the_channel_meter_scale_and_ballistics() -> void:
	var r := {"present": true, "level": -30.0}
	var a := LL.lane_tick(0.0, r)
	t.eq(a[0], AM.smooth(0.0, -30.0), "rise = AM.smooth (instant)")
	t.eq(a[0], 0.5, "-30 dBFS on the -60…0 scale")
	t.eq(a[1], AM.colour(-30.0), "colour = AM.colour")
	var b := LL.lane_tick(0.9, {"present": true, "level": -60.0})
	t.eq(b[0], AM.smooth(0.9, -60.0), "fall = AM.smooth (0.45 per tick)")
	t.eq(LL.lane_tick(0.2, {"present": true, "level": -0.5})[1], "clip", "above -1 dBFS is red")
	t.eq(LL.lane_tick(0.7, {"present": false, "level": -99.0}), [-1.0, ""], "no audio → hidden, not an empty bar")
	t.eq(LL.lane_tick(-1.0, r)[0], 0.5, "a hidden lane starts from 0")


func test_meter_bank_lane_hidden_until_audio() -> void:
	var m := MeterBank.new()
	m.set_count(1)
	t.ok(not m.lane_on, "no lane by default")
	m.set_lane(0.5, "ok")
	t.eq(m.lane, -1.0, "set_lane is ignored without a lane")
	m.enable_lane()
	t.ok(m.lane_on, "single-bar bank reserves the lane")
	t.eq(m.custom_minimum_size.x, 10.0, "the lane does not widen the strip")
	t.eq(m.lane, -1.0, "lane hidden until the layer has audio")
	m.set_lane(0.5, "ok")
	t.eq(m.lane, 0.5, "lane level")
	m.free()
	var bus := MeterBank.new()
	bus.set_count(2)
	bus.enable_lane()
	t.ok(not bus.lane_on, "a master's multi-bar bank never gets a lane")
	bus.free()


func test_audio_tab_polls_only_while_visible() -> void:
	var src := FileAccess.get_file_as_string("res://features/audio/audio_tab.gd")
	t.ok(src.contains("await Api.get_json(LL.PATH)"), "the tab reads GET /api/osc/audio-layers")
	t.ok(src.contains("_poll_acc >= LL.POLL_S and not _polling"), "one request at a time, at POLL_S")
	var proc := src.substr(src.find("func _process("))
	t.ok(proc.find("if not is_visible_in_tree():") < proc.find("_poll_layers()"), "no poll while the tab is hidden")
	t.eq(LL.PATH, "/api/osc/audio-layers", "endpoint")
	t.eq(LL.POLL_S, 0.2, "5 Hz")
	var strip := FileAccess.get_file_as_string("res://features/audio/audio_strip.gd")
	t.ok(strip.contains("meter.enable_lane()"), "layer strips reserve the lane")
