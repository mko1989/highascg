extends RefCounted
## WO-604 — the console's meter reads. 1:1 ports of client/lib/audio-mixer-peaks.js (bus / bus-channel / layer /
## input-channel peaks), audio-mixer-meter-eligibility.js isLayerStripOnAir (+ playback-timer.js hints),
## audio-input-meter-map.js (no-data vs silent vs signal) and the meter loop's key dispatch + smoothing
## (audio-mixer-meter-loop.js). `ctx` = {osc: OscMirror.channels, info: state.channels, live: scene.live,
## vars: state.variables}. Golden-tested against the JS.

const FLOOR_DBFS := -60.0
const CLIP_DBFS := -1.0
const SMOOTH_FALL := 0.45  # per 50 ms tick (web WO-401 F12)
const TICK_S := 0.05


static func _fin(v: Variant) -> bool:
	return (v is float or v is int) and is_finite(float(v))


static func _str(v: Variant) -> String:
	return "" if v == null or (v is bool and not v) else str(v)


static func _int(v: Variant) -> Variant:
	var m := RegEx.create_from_string("^\\s*([+-]?\\d+)").search(_str(v))
	return int(m.get_string(1)) if m else null


static func _pf(v: Variant) -> float:  # JS parseFloat of a string (NaN when it does not start with a number)
	var m := RegEx.create_from_string("^\\s*([+-]?(\\d+\\.?\\d*|\\.\\d+)([eE][+-]?\\d+)?)").search(_str(v))
	return float(m.get_string(1)) if m else NAN


static func _dict(v: Variant) -> Dictionary:
	return v if v is Dictionary else {}


static func _chan(ctx: Dictionary, ch: Variant) -> Variant:
	var osc := _dict(ctx.get("osc"))
	var v: Variant = osc.get(str(int(ch)) if _fin(ch) else _str(ch))
	return v if v is Dictionary else null


static func _osc_layer(ch_state: Variant, ln: int) -> Variant:
	var v: Variant = _dict(_dict(ch_state).get("layers")).get(str(ln))
	return v if v is Dictionary else null


static func file_has_playback_hints(f: Variant) -> bool:
	if not (f is Dictionary):
		return false
	return (_fin(f.get("duration")) and f.duration > 0) or (_fin(f.get("elapsed")) and f.elapsed >= 0) \
		or (_fin(f.get("frameTotal")) and f.frameTotal > 0) or (_fin(f.get("frameElapsed")) and f.frameElapsed >= 0)


## playback-timer.js infoLayerToPlaybackHints, reduced to "would it return hints".
static func info_layer_has_hints(info: Variant) -> bool:
	if not (info is Dictionary):
		return false
	var dur := _pf(info.get("durationSec"))
	var el := _pf(info.get("timeSec"))
	var rem := _pf(info.get("remainingSec"))
	return (is_finite(dur) and dur > 0) or (is_finite(el) and el >= 0) or (is_finite(rem) and rem >= 0)


static func is_meter_utility_osc_layer(ln: int, layer: Variant) -> bool:
	if ln < 90:
		return false
	var l := _dict(layer)
	var f := _dict(l.get("file"))
	var path := _str(f.get("path") if f.get("path") else l.get("path")).to_lower()
	var name := _str(f.get("name")).to_lower()
	return path.contains("udp://") or path.contains("stream") or name.contains("stream")


static func _row_at(layers: Variant, ln: int) -> Variant:
	if layers is Array:
		return layers[ln] if ln >= 0 and ln < layers.size() else null
	if layers is Dictionary:
		return layers.get(str(ln))
	return null


## findChannelEntry + findInfoLayerRow over state.channels (AMCP INFO rows).
static func _info_row(ctx: Dictionary, ch: int, ln: int) -> Variant:
	var entry: Variant = null
	if ctx.get("info") is Array:
		for c in ctx.info:
			if c is Dictionary and ((_fin(c.get("id")) and int(c.id) == ch) or (_fin(c.get("channel")) and int(c.channel) == ch)):
				entry = c
				break
	if not (entry is Dictionary) or entry.get("layers") == null:
		return null
	var ly: Variant = entry.layers
	var direct: Variant = _row_at(ly, ln)
	if direct != null:
		return direct
	var keys: Array = range(ly.size()) if ly is Array else (ly.keys() if ly is Dictionary else [])
	for k in keys:
		var row: Variant = ly[k]
		if not (row is Dictionary):
			continue
		var n: Variant = _int(row.get("layer") if row.get("layer") != null else (row.get("layerNum") if row.get("layerNum") != null else (row.get("index") if row.get("index") != null else k)))
		if n == ln:
			return row
	return null


static func _has_content(l: Dictionary) -> bool:
	var t := _str(l.get("type")).to_lower()
	if t != "" and t != "empty":
		return true
	var f := _dict(l.get("file"))
	return file_has_playback_hints(l.get("file")) or _str(f.get("name") if f.get("name") else f.get("path")).strip_edges() != ""


## isLayerStripOnAir: this exact layer is playing (live OSC), else INFO says it has a clip / timing.
static func is_layer_on_air(ctx: Dictionary, ch: int, ln: int, hints: Dictionary) -> bool:
	if hints.get("muted") == true:
		return false
	var cs: Variant = _chan(ctx, ch)
	var ol: Variant = _osc_layer(cs, ln)
	if ol != null and not is_meter_utility_osc_layer(ln, ol):
		if ol.get("paused") == true:
			return false
		var sp: Variant = ol.get("speed") if ol.get("speed") != null else (ol.get("playbackSpeed") if ol.get("playbackSpeed") != null else _dict(ol.get("file")).get("speed"))
		if (_fin(sp) and float(sp) == 0.0) or (sp is String and sp == "0"):
			return false
		if _has_content(ol):
			return true
	var info: Variant = _info_row(ctx, ch, ln)
	var info_clip := _str(info.get("fgClip")).strip_edges() if info is Dictionary and info.get("fgClip") != null else _str(_dict(info).get("clip")).strip_edges()
	if info_clip != "" or info_layer_has_hints(info):
		return true
	for k in _dict(_dict(cs).get("layers")):
		var n: Variant = _int(k)
		if n == ln and not is_meter_utility_osc_layer(n, cs.layers[k]) and _has_content(_dict(cs.layers[k])):
			return true
	return false


static func peak_from_levels(levels: Variant) -> float:
	if not (levels is Array) or levels.is_empty():
		return NAN
	var l: Variant = _dict(levels[0]).get("dBFS")
	var r: Variant = _dict(levels[1]).get("dBFS") if levels.size() > 1 else null
	if not _fin(l) and not _fin(r):
		return NAN
	return maxf(float(l) if _fin(l) else -99.0, float(r) if _fin(r) else -99.0)


static func _var_channel(vars: Variant, ch: int, i: int) -> float:
	if not (vars is Dictionary):
		return NAN
	if i == 0 and is_finite(_pf(vars.get("osc_ch%d_audio_L" % ch))):
		return _pf(vars.get("osc_ch%d_audio_L" % ch))
	if i == 1 and is_finite(_pf(vars.get("osc_ch%d_audio_R" % ch))):
		return _pf(vars.get("osc_ch%d_audio_R" % ch))
	return _pf(vars.get("osc_ch%d_audio_c%d_dBFS" % [ch, i + 1]))


## readBusPeakDbfsOrNull: OSC L/R first, the 10 Hz variables after; null = never heard from this channel.
static func bus_peak_or_null(ctx: Dictionary, ch: int) -> Variant:
	var p := peak_from_levels(_dict(_dict(_chan(ctx, ch)).get("audio")).get("levels"))
	if is_finite(p):
		return p
	var l := _var_channel(ctx.get("vars"), ch, 0)
	var r := _var_channel(ctx.get("vars"), ch, 1)
	if not is_finite(l) and not is_finite(r):
		return null
	return maxf(l if is_finite(l) else -99.0, r if is_finite(r) else -99.0)


static func bus_peak(ctx: Dictionary, ch: int) -> float:
	var p: Variant = bus_peak_or_null(ctx, ch)
	return -99.0 if p == null else float(p)


static func bus_channel_peak(ctx: Dictionary, ch: int, i: int) -> float:
	var levels: Variant = _dict(_dict(_chan(ctx, ch)).get("audio")).get("levels")
	var slot: Variant = levels[i] if levels is Array and i < levels.size() else null
	if slot is Dictionary and _fin(slot.get("dBFS")):
		return float(slot.dBFS)
	var v := _var_channel(ctx.get("vars"), ch, i)
	return v if is_finite(v) else -99.0


static func _sole_live_media_layer(ctx: Dictionary, ch: int, ln: int) -> bool:
	var layers: Variant = _dict(_dict(_dict(ctx.get("live")).get(str(ch))).get("scene")).get("layers")
	if not (layers is Array):
		return false
	var media: Array = (layers as Array).filter(func(l: Variant) -> bool:
		var src := _dict(_dict(l).get("source"))
		var ty := _str(src.get("type")).to_lower()
		return _str(src.get("value")) != "" and (ty == "media" or ty == "file"))
	return media.size() == 1 and _fin(media[0].get("layerNumber")) and int(media[0].layerNumber) == ln


## readLayerPeakDbfs: −99 unless this layer is on air (or the only live media layer with bus audio).
static func layer_peak(ctx: Dictionary, ch: int, ln: int, meta: Dictionary) -> float:
	if meta.get("muted") == true:
		return -99.0
	var bus := bus_peak(ctx, ch)
	if not is_layer_on_air(ctx, ch, ln, meta) and not (_sole_live_media_layer(ctx, ch, ln) and bus > -90):
		return -99.0
	var lp := peak_from_levels(_dict(_dict(_osc_layer(_chan(ctx, ch), ln)).get("audio")).get("levels"))
	return lp if is_finite(lp) else bus


## inputHasAudioData: the input's producer layer must exist (when OSC reports layers) and some level must exist.
static func input_has_audio_data(ch_state: Variant, input_layer: Variant, dbfs: Variant) -> bool:
	var has_ch := ch_state is Dictionary
	if not has_ch and not _fin(dbfs):
		return false
	var layers: Variant = ch_state.get("layers") if has_ch and ch_state.get("layers") is Dictionary else null
	if layers != null and _fin(input_layer) and not (layers as Dictionary).is_empty():
		var row: Variant = layers.get(str(int(input_layer)))
		if not (row is Dictionary):
			return false
		var t := _str(row.get("type")).strip_edges().to_lower()
		var f := _dict(row.get("file"))
		var named := _str(f.get("name") if f.get("name") else (f.get("path") if f.get("path") else row.get("producer"))).strip_edges()
		if (t == "" or t == "empty") and named == "":
			return false
	if _fin(dbfs):
		return true
	var levels: Variant = _dict(_dict(ch_state).get("audio")).get("levels")
	return levels is Array and levels.any(func(l: Variant) -> bool: return _fin(_dict(l).get("dBFS")))


## readInputChannelMeterSample → mapLevelToMeter: {state: no-data | silent | signal, aim, clip, dbfs}.
static func input_meter(ctx: Dictionary, host_ch: int, meta: Dictionary) -> Dictionary:
	if host_ch < 1:
		return map_level(null, false, meta.get("muted") == true)
	var dbfs: Variant = bus_peak_or_null(ctx, host_ch)
	return map_level(dbfs, input_has_audio_data(_chan(ctx, host_ch), meta.get("inputLayer"), dbfs), meta.get("muted") == true)


static func map_level(dbfs: Variant, has_data: bool, is_muted: bool) -> Dictionary:
	var d: Variant = float(dbfs) if _fin(dbfs) else null
	if not has_data:
		return {"state": "no-data", "aim": 0.0, "clip": false, "dbfs": d}
	if is_muted or d == null or d <= FLOOR_DBFS:
		return {"state": "silent", "aim": 0.0, "clip": false, "dbfs": d}
	return {"state": "signal", "aim": clampf((d - FLOOR_DBFS) / -FLOOR_DBFS, 0.0, 1.0), "clip": d > CLIP_DBFS, "dbfs": d}


## The meter loop's per-key read: {level, state} — state is set for `input:` keys only.
static func read_key(ctx: Dictionary, key: String, meta: Dictionary) -> Dictionary:
	var parts := key.split(":")
	if key.contains(":layer:"):
		if meta.get("hostChannel") != null:
			var hc: Variant = _int(meta.hostChannel)
			return {"level": -99.0 if meta.get("muted") == true or hc == null or hc < 1 else bus_peak(ctx, hc), "state": ""}
		var ch: Variant = _int(parts[1])
		var ln: Variant = _int(parts[3]) if parts.size() > 3 else null
		return {"level": layer_peak(ctx, ch, ln, meta) if ch != null and ln != null else -99.0, "state": ""}
	var bus := RegEx.create_from_string("^(?:pgm|prv):(\\d+):bus:(\\d+)$").search(key)
	if bus:
		return {"level": bus_channel_peak(ctx, int(bus.get_string(1)), int(bus.get_string(2))), "state": ""}
	if key.begins_with("input:"):
		var hc2: Variant = _int(key.substr(6))
		var m := input_meter(ctx, hc2 if hc2 != null else 0, meta)
		return {"level": float(m.dbfs) if m.state == "signal" else -99.0, "state": m.state}
	var c: Variant = _int(parts[1]) if parts.size() > 1 else null
	return {"level": bus_peak(ctx, c) if c != null else -99.0, "state": ""}


## One 50 ms tick of the web smoothing: instant rise, 0.45 fall toward the target.
static func smooth(prev: float, level: float) -> float:
	var aim := clampf((level + 60.0) / 60.0, 0.0, 1.0) if level > -90 else 0.0
	return aim if aim >= prev else prev + (aim - prev) * SMOOTH_FALL


## Bar colour class: "" (empty), "ok" (green), "clip" (red above −1 dBFS).
static func colour(level: float) -> String:
	return "" if level <= -90 else ("clip" if level > CLIP_DBFS else "ok")
