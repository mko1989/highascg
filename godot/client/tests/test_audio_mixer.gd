extends RefCounted
## WO-604 — audio_rows.gd / audio_meter_model.gd against the web console modules run under Node with fake stores
## (audio-mixer-rows, audio-mixer-ui, audio-mixer-bus-meters → program-audio-layouts, audio-mixer-meter-loop →
## audio-mixer-peaks / -meter-eligibility / audio-input-meter-map): tests/golden/audio_mixer.json.

const AR := preload("res://features/audio/audio_rows.gd")
const AM := preload("res://features/audio/audio_meter_model.gd")
var t
var _g: Dictionary


func _golden() -> Dictionary:
	if _g.is_empty():
		_g = JSON.parse_string(FileAccess.get_file_as_string("res://tests/golden/audio_mixer.json"))
	return _g


## ints → floats; null-valued keys dropped (JSON.stringify drops the web's `undefined`, and `.get()` reads both as null).
static func _norm(v: Variant) -> Variant:
	if v is int:
		return float(v)
	if v is Dictionary:
		var o := {}
		for k in v:
			if v[k] != null:
				o[k] = _norm(v[k])
		return o
	if v is Array:
		return v.map(func(x: Variant) -> Variant: return _norm(x))
	return v


func test_shorten_media_name() -> void:
	for c in _golden().shorten:
		t.eq(AR.shorten_media_name(c[0]), c[1], "shorten %s" % c[0])
		t.eq(AR.shorten_media_name(c[0], 14, 0), c[2], "shorten 14/0 %s" % c[0])
		t.eq(AR.shorten_media_name(c[0], 8, 3), c[3], "shorten 8/3 %s" % c[0])


func test_layer_has_mixer_audio() -> void:
	for c in _golden().hasAudio:
		t.eq(AR.layer_has_mixer_audio(c[0]), c[1], "hasAudio %s" % str(c[0]))


func test_program_rows() -> void:
	for c in _golden().programRows:
		var i: Dictionary = c.input
		var st := {"channelMap": i.get("channelMap", {}), "live": i.get("live", {}), "liveAudioOnly": i.get("liveAudioOnly", {}),
			"playback": i.get("playback"), "timelines": i.get("timelines", []), "mixer": i.get("mixer", {}),
			"liveInputs": i.get("liveInputs"), "casparServer": i.get("casparServer", {})}
		var got: Array = _norm(AR.program_rows(st))
		var want: Array = _norm(c.rows)
		t.eq(got.size(), want.size(), "%s row count" % c.name)
		for k in mini(got.size(), want.size()):
			t.eq(got[k], want[k], "%s row %d" % [c.name, k])


func test_input_rows() -> void:
	for c in _golden().inputRows:
		t.eq(_norm(AR.input_rows(c.cm, c.mixer)), _norm(c.rows), "inputs %s" % c.name)


func test_meter_meta() -> void:
	for c in _golden().meterMeta:
		t.eq(_norm(AR.meter_meta(c[0])), _norm(c[1]), "meta %s" % c[0].key)


func test_bus_channel_count() -> void:
	for c in _golden().busCount:
		t.eq(AR.bus_channel_count(c[0], c[1], c[2]), c[3], "bus count %s %s ch %s" % [str(c[0]), str(c[1]), c[2]])


static func _colour(bg: String) -> String:
	return "clip" if bg.contains("red") else ("ok" if bg != "" else "")


func test_meter_reads() -> void:
	var ctx: Dictionary = _golden().meterCtx
	for c in _golden().meters:
		var r := AM.read_key(ctx, c.key, c.meta)
		var s := AM.smooth(0.0, r.level)
		var w: Array = c.seq[0]
		t.eq(s, w[0], "%s %s smoothed" % [c.key, str(c.meta)])
		t.eq(AM.colour(r.level), _colour(w[2]), "%s %s colour" % [c.key, str(c.meta)])
		t.eq(r.state, w[3], "%s %s state" % [c.key, str(c.meta)])


func test_meter_smoothing() -> void:
	var ctx: Dictionary = _golden().smoothCtx.duplicate(true)
	var lv: Array = ctx.osc["1"].audio.levels
	var s := 0.0
	var seq: Array = _golden().smooth
	for i in seq.size():
		if i > 0:
			var v := -120.0 if i < 6 else -3.0
			lv[0].dBFS = v
			lv[1].dBFS = v
		s = AM.smooth(s, AM.read_key(ctx, "pgm:1", {}).level)
		t.eq(s, seq[i][0], "tick %d" % i)


## Godot-only: the server keeps fader gains above unity (+6 dB); the web's localStorage read reset them to 1.
func test_gain_above_unity_survives() -> void:
	t.eq(AR.gain({"gains": {"pgm:1": 1.5}}, "pgm:1"), 1.5, "+3.5 dB kept")
	t.eq(AR.gain({"gains": {"pgm:1": -1}}, "pgm:1"), 1.0, "negative → unity")
	t.eq(AR.gain({}, "pgm:1"), 1.0, "missing → unity")
