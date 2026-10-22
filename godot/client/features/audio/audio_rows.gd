extends RefCounted
## WO-604 — the audio console's strip list. 1:1 ports of client/lib/audio-mixer-rows.js (collectProgramAudioRows,
## collectLiveInputMeterRows, layerHasMixerAudio, meterMetaForInputRow), audio-mixer-ui.js shortenMediaName,
## live-audio-inputs.js enumerateLiveAudioMixerSlots and program-audio-layouts.js (bus width per program channel).
## Gains / mutes come from the server's GET /api/audio/mixer (the web read them from localStorage). Golden-tested.

const HC := preload("res://features/devices/host_channels.gd")
const R := preload("res://features/devices/cable_rules.gd")
const MM := preload("res://features/live/mixer_math.gd")
const OP := preload("res://features/devices/output_ports_model.gd")

const TIMELINE_LAYER_BASE := 210
const AUDIO_ONLY_LOOK_LAYER := 200
const LIVE_AUDIO_LAYER_BASE := 10
const LIVE_AUDIO_MAX_SLOTS := 8
const LAYOUT_CHANNELS := {"mono": 1, "stereo": 2, "4ch": 4, "8ch": 8, "16ch": 16}
const PROGRAM_LAYOUTS := ["stereo", "4ch", "8ch", "16ch"]
const AUDIO_INPUT_KINDS := ["decklink", "live_audio", "ndi_host"]
const _DROP := ["(?i)^\\d{1,4}(fps|hz|k|p|i)$", "(?i)^(hd|uhd|sd|4k|8k|hdr|sdr)$", "(?i)^(r709|r2020|p3|rec709|rec2020|srgb)$",
	"(?i)^(hap|prores|h264|h265|hevc|dnxhd|dnxhr|mxf|mov)$", "(?i)^(master|final|preview|proxy|mezz|mezzanine)$",
	"(?i)^\\d+dfx?$", "^\\d{6,}$"]  # the web's [A-Z]{2}-[A-Z]{2,} rule can never match a '-'-split token


## A web store value: gains[key] when it is a number ≥ 0 (the server already filtered), else unity.
static func gain(mixer: Dictionary, key: String) -> float:
	var v: Variant = R.d(mixer.get("gains")).get(key)
	return float(v) if (v is float or v is int) and v >= 0 else 1.0


static func muted(mixer: Dictionary, key: String) -> bool:
	var m: Variant = R.d(mixer.get("muted")).get(key)
	return m is bool and m


static func shorten_media_name(raw: Variant, max_len := 22, tail := 3) -> String:
	var s := "" if raw == null else str(raw).strip_edges()
	if s == "":
		return ""
	var no_ext := RegEx.create_from_string("(?i)\\.[a-z0-9]{2,4}$").sub(s, "")
	var keep := PackedStringArray()
	for tok in RegEx.create_from_string("[_\\s.-]+").sub(no_ext, "\n", true).split("\n", false):
		var drop := false
		for pat in _DROP:
			if RegEx.create_from_string(pat).search(tok):
				drop = true
				break
		if not drop:
			keep.append(tok)
	var cleaned := "_".join(keep) if keep.size() > 0 else no_ext
	if cleaned.length() <= max_len:
		return cleaned
	if tail > 0 and max_len > tail + 4:
		return cleaned.substr(0, max_len - tail - 1) + "…" + cleaned.substr(cleaned.length() - tail)
	return cleaned.substr(0, max_len - 1) + "…"


static func layer_has_mixer_audio(layer: Variant) -> bool:
	var src: Variant = R.d(layer).get("source")
	if not (src is Dictionary):
		return false
	var t := str(src.get("type", "")).to_lower() if src.get("type") != null else ""
	var placeholder: bool = HC.truthy(src.get("isPlaceholder")) or t == "placeholder"
	if not placeholder and (t == "media" or t == "file") and HC.truthy(src.get("value")):
		var e := str(src.value).get_extension().to_lower() if str(src.value).get_file().contains(".") else ""
		return not MM.STILL.has(e)
	return t == "live_audio" and HC.truthy(src.get("value"))


static func meter_meta(row: Dictionary) -> Dictionary:
	var st := "media"
	if row.get("liveAudioSlot") != null or HC.truthy(row.get("isLiveInput")):
		st = "live_audio"
	elif HC.truthy(row.get("isTimelineClip")):
		st = "timeline"
	var host: Variant = row.get("hostChannel") if row.get("hostChannel") != null else (row.get("ch") if HC.truthy(row.get("isLiveInput")) else null)
	return {"muted": HC.truthy(row.get("muted")), "layer": row.get("layer"), "ch": row.get("ch"), "hostChannel": host,
		"expectAudio": true, "sourceType": st, "inputLayer": row.get("layer") if HC.truthy(row.get("isLiveInput")) else null}


## The timeline sent to this program channel (web getActiveTimelineForChannel: screenIdx null / 'all' = every screen).
static func _active_timeline(cm: Dictionary, pb: Variant, timelines: Array, ch: Variant) -> Dictionary:
	var p := R.d(pb)
	if not HC.truthy(p.get("timelineId")) or not (p.get("sendTo") is Dictionary) or not (p.sendTo.get("program") is bool and p.sendTo.program):
		return {}
	var si: Variant = p.sendTo.get("screenIdx")
	var progs := R.a(cm.get("programChannels"))
	if si == null or (si is String and si == "all"):
		if not progs.any(func(c: Variant) -> bool: return HC._js_num(c) == HC._js_num(ch)):
			return {}
	elif not (si is float or si is int) or int(si) < 0 or int(si) >= progs.size() or HC._js_num(progs[int(si)]) != HC._js_num(ch):
		return {}
	for t in timelines:
		if t is Dictionary and str(t.get("id")) == str(p.timelineId):
			return t
	return {}


## Web collectProgramAudioRows with the console's labels. `st`: {channelMap, live (scene.live), liveAudioOnly,
## playback (timeline.playback), timelines, mixer, liveInputs (GET /api/audio/live-inputs), casparServer}.
static func program_rows(st: Dictionary, label_max := 14, tail := 0) -> Array:
	var cm := R.d(st.get("channelMap"))
	var mixer := R.d(st.get("mixer"))
	var progs := R.a(cm.get("programChannels"))
	if progs.is_empty():
		progs = [1]
	var rows := []
	for i in progs.size():
		var ch: Variant = progs[i]
		var key := "pgm:" + R.s(ch)
		rows.append({"key": key, "ch": ch, "label": "PGM %d Master" % (i + 1), "v": gain(mixer, key), "isMaster": true})
		var prvs := R.a(cm.get("previewChannels"))
		var prv: float = HC._js_num(prvs[i]) if i < prvs.size() else NAN
		if is_finite(prv) and prv > 0:
			var pk := "prv:" + R.s(prv)
			rows.append({"key": pk, "ch": prv, "label": "PRV %d Master" % (i + 1), "v": gain(mixer, pk), "isMaster": true, "isPreview": true})
		var tl := _active_timeline(cm, st.get("playback"), R.a(st.get("timelines")), ch)
		if tl.get("layers") is Array:
			_timeline_rows(rows, tl.layers, ch, label_max, tail)
		else:
			_scene_rows(rows, cm, R.d(st.get("live")), ch, label_max, tail)
	var have := {}
	for r in rows:
		have[r.key] = true
	for slot_row in live_audio_slots(cm, st.get("liveInputs"), R.d(st.get("casparServer"))):
		var k := "pgm:%s:layer:%s" % [R.s(slot_row.channel), R.s(slot_row.layer)]
		if have.has(k):
			continue
		have[k] = true
		rows.append({"key": k, "ch": slot_row.channel, "layer": slot_row.layer, "label": shorten_media_name(slot_row.label, label_max, tail),
			"labelTitle": "%s (Live audio · Ch %s L%s)" % [slot_row.label, R.s(slot_row.channel), R.s(slot_row.layer)],
			"v": gain(mixer, k), "muted": muted(mixer, k), "isMaster": false, "audioRoute": "1+2", "sceneId": null,
			"liveAudioSlot": slot_row.slot, "hostChannel": slot_row.channel})
	var audio_only := R.d(st.get("liveAudioOnly"))
	for ch in progs:
		var scene: Variant = R.d(audio_only.get(R.s(ch))).get("scene")
		if not HC.truthy(scene):
			continue
		var k := "pgm:%s:layer:%d" % [R.s(ch), AUDIO_ONLY_LOOK_LAYER]
		if have.has(k):
			continue
		have[k] = true
		var full := str(R.d(scene).get("name")).strip_edges() if HC.truthy(R.d(scene).get("name")) else "Audio only"
		rows.append({"key": k, "ch": ch, "layer": AUDIO_ONLY_LOOK_LAYER, "label": "🔊 " + shorten_media_name(full, label_max, tail),
			"labelTitle": "%s (Audio-only look · Ch %s L%d)" % [full, R.s(ch), AUDIO_ONLY_LOOK_LAYER],
			"v": gain(mixer, k), "muted": muted(mixer, k), "isMaster": false, "audioRoute": "1+2", "sceneId": null, "isAudioOnlyLook": true})
	return rows


static func _timeline_rows(rows: Array, layers: Array, ch: Variant, label_max: int, tail: int) -> void:
	for idx in layers.size():
		var tll: Variant = layers[idx]
		if not HC.truthy(tll) or not HC.truthy(R.d(tll).get("clips")):
			continue
		var clips := R.a(tll.clips)
		var clip: Variant = clips[0] if clips.size() > 0 else null
		if not HC.truthy(clip):
			continue
		var ln := TIMELINE_LAYER_BASE + idx
		var name := str(clip.name) if HC.truthy(clip.get("name")) else "Clip %d" % (idx + 1)
		rows.append({"key": "pgm:%s:layer:%d" % [R.s(ch), ln], "ch": ch, "layer": ln, "label": shorten_media_name(name, label_max, tail),
			"labelTitle": "%s (Timeline layer)" % name, "v": clip.volume if clip.get("volume") != null else 1.0,
			"muted": HC.truthy(clip.get("muted")), "isMaster": false,
			"audioRoute": clip.audioRoute if HC.truthy(clip.get("audioRoute")) else "1+2", "sceneId": null, "isTimelineClip": true})


static func _scene_rows(rows: Array, cm: Dictionary, live: Dictionary, ch: Variant, label_max: int, tail: int) -> void:
	var entry := R.d(live.get(R.s(ch)))
	var layers: Variant = R.d(entry.get("scene")).get("layers")
	if not (layers is Array):
		return
	for layer in layers:
		var src := R.d(R.d(layer).get("source"))
		if str(src.get("type")) == "timeline" or not layer_has_mixer_audio(layer):
			continue
		var ln: Variant = layer.get("layerNumber")
		var ty := str(src.get("type", "")).to_lower() if src.get("type") != null else ""
		var value := "" if src.get("value") == null else R.s(src.value) if src.value is float else str(src.value)
		var full := value.get_file() if not value.ends_with("/") else ""
		if ty == "live_audio":
			full = str(src.label) if HC.truthy(src.get("label")) else "Live audio " + value
		var short := shorten_media_name(full, label_max, tail)
		var slot: Variant = HC.js_int(value) if ty == "live_audio" else null
		var row := {"key": "pgm:%s:layer:%s" % [R.s(ch), R.s(ln)], "ch": ch, "layer": ln, "label": "L%s · %s" % [R.s(ln), short],
			"labelTitle": "L%s: %s" % [R.s(ln), full], "v": layer.volume if layer.get("volume") != null else 1.0,
			"muted": HC.truthy(layer.get("muted")), "isMaster": false,
			"audioRoute": layer.audioRoute if HC.truthy(layer.get("audioRoute")) else "1+2",
			"audioScreens": (layer.audioScreens as Array).duplicate() if layer.get("audioScreens") is Array else [],
			"sceneId": entry.get("sceneId")}
		if HC.truthy(layer.get("routeSourceAudio")) and str(layer.routeSourceAudio) != "all":
			row["sourceAudioPair"] = layer.routeSourceAudio
		if slot != null:
			row["liveAudioSlot"] = slot
			row["hostChannel"] = HC.live_audio_entry(cm, slot).get("channel")
		rows.append(row)


## enumerateLiveAudioMixerSlots (+ resolveLiveAudioSlotCount / liveAudioSlotDisplayLabel / readLiveAudioCasparSettings).
static func live_audio_slots(cm: Dictionary, api: Variant, cs: Dictionary) -> Array:
	var cfg: Variant = R.d(api).get("configured") if R.d(api).get("configured") is Dictionary else null
	var cfg_slots := R.a(R.d(cfg).get("slots"))
	var active := cfg_slots.filter(func(s: Variant) -> bool:
		return HC.truthy(s) and (HC.truthy(R.d(s).get("device")) or HC.truthy(R.d(s).get("clip")) or HC.truthy(R.d(s).get("slot")))).size()
	var explicit: Variant = HC.js_int(HC.coalesce([cm.get("liveAudioCount"), R.d(api).get("liveAudioCount"), R.d(cfg).get("count"),
		HC.js_int(HC.coalesce([cs.get("live_audio_input_count"), "0"])), "0"]))
	var ui_count: int = clampi(maxi(explicit if explicit != null else 0, active), 0, LIVE_AUDIO_MAX_SLOTS)
	if ui_count <= 0:
		return []
	var entries := cfg_slots.filter(func(s: Variant) -> bool: return HC.truthy(s) and HC._js_num(R.d(s).get("slot")) > 0)
	if entries.is_empty():
		for i in ui_count:
			entries.append({"slot": i + 1})
	var out := []
	for row in entries:
		var n: Variant = HC.js_int(row.get("slot"))
		var slot: int = maxi(1, n if n != null and n != 0 else 1)
		var dev_ui := str(cs.get("live_audio_input_%d_device" % slot, "")).strip_edges() if slot <= LIVE_AUDIO_MAX_SLOTS and cs.get("live_audio_input_%d_device" % slot) != null else ""
		var device := R.s(HC.coalesce([row.get("device") if HC.truthy(row.get("device")) else null, row.get("clip") if HC.truthy(row.get("clip")) else null, dev_ui if dev_ui != "" else null, ""]))
		var e := HC.live_audio_entry(cm, slot)
		var ch: Variant = HC.coalesce([e.get("channel"), row.get("channel")])
		var layer: Variant = HC.coalesce([e.get("layer"), row.get("layer"), LIVE_AUDIO_LAYER_BASE])
		var lab := R.s(e.get("label"))
		if lab == "":
			if device.begins_with("alsa://"):
				lab = device.substr(7) if device.length() > 7 else "Live audio %d" % slot
			else:
				lab = device if device != "" else "Live audio %d" % slot
		if device != "" and ch != null:
			out.append({"slot": slot, "channel": ch, "layer": layer, "label": lab, "device": device, "route": HC.coalesce([e.get("route"), row.get("route")])})
	return out


static func _default_input_label(e: Dictionary) -> String:
	var slot := R.s(e.get("slot")) if e.get("slot") != null else "?"
	match str(e.get("kind", "")):
		"decklink":
			return "DeckLink " + slot
		"live_audio":
			return "Live audio " + slot
	return "Input " + slot


## collectLiveInputMeterRows: one strip per audio-capable dedicated input channel (decklink / live_audio / ndi_host).
static func input_rows(cm: Dictionary, mixer: Dictionary) -> Array:
	var out := []
	for e in HC.input_channels(cm):
		if not AUDIO_INPUT_KINDS.has(str(e.get("kind", "")).strip_edges()):
			continue
		var key := "input:" + R.s(e.channel)
		var layer: Variant = e.get("layer") if e.get("layer") != null else (10 if e.get("kind") == "live_audio" else 1)
		var route: Variant = e.get("route") if HC.truthy(e.get("route")) else null
		out.append({"key": key, "ch": e.channel, "layer": layer,
			"label": str(e.label) if HC.truthy(e.get("label")) else _default_input_label(e),
			"labelTitle": "Ch %s · L%s — %s" % [R.s(e.channel), R.s(layer), route if route != null else ""],
			"v": gain(mixer, key), "muted": muted(mixer, key), "isMaster": false, "isLiveInput": true,
			"inputKind": e.get("kind"), "slot": e.get("slot"), "route": route, "hostChannel": e.channel})
	return out


static func _norm_layout(id: Variant) -> String:
	var k := str(id).to_lower() if HC.truthy(id) else "stereo"
	return k if PROGRAM_LAYOUTS.has(k) else "stereo"


static func _channels(id: Variant) -> int:
	return LAYOUT_CHANNELS.get(str(id).to_lower() if HC.truthy(id) else "stereo", 2)


static func _max_layout(a: Variant, b: Variant) -> String:
	return (str(a) if HC.truthy(a) else "stereo") if _channels(a) >= _channels(b) else (str(b) if HC.truthy(b) else "stereo")


static func _main_idx(d: Dictionary) -> int:
	var n: Variant = HC.js_int(HC.coalesce([d.get("mainScreenIndex"), 0]))
	return maxi(0, n if n != null else 0)


## programBusChannelCountForChannel: destination audioLayout, widened by cabled PortAudio outputs, or channelMap's list.
static func bus_channel_count(settings: Dictionary, cm: Dictionary, program_ch: Variant) -> int:
	var progs := R.a(cm.get("programChannels"))
	var main := -1
	for i in progs.size():
		if HC._js_num(progs[i]) == HC._js_num(program_ch):
			main = i
			break
	if main < 0:
		return 2
	var dests := R.a(R.d(settings.get("screenDestinations")).get("destinations")).filter(func(d: Variant) -> bool: return d is Dictionary and HC.truthy(d.get("id")))
	var by_dest := {}
	for d in dests:
		if not ["multiview", "stream"].has(R.s(d.get("mode"))):
			by_dest[_main_idx(d)] = _norm_layout(d.get("audioLayout") if HC.truthy(d.get("audioLayout")) else "stereo")
	var cabled := {}
	var edges := R.a(R.d(settings.get("deviceGraph")).get("edges"))
	var pa_id := OP.portaudio_output_id(settings.get("audioOutputs"))  # WO-683: the only PortAudio consumer
	for o in R.a(settings.get("audioOutputs")):
		if not (o is Dictionary) or (o.get("enabled") is bool and not o.enabled) or str(o.get("enabled")) == "false":
			continue
		if (str(o.type) if HC.truthy(o.get("type")) else "portaudio").to_lower() == "system-audio" or R.s(o.get("id")) == "":
			continue
		if R.s(o.get("id")) != pa_id:
			continue
		var edge: Variant = null
		for e in edges:
			if e is Dictionary and str(e.get("sinkId")) == R.s(o.id):
				edge = e
				break
		if edge == null:
			continue
		var src := str(edge.get("sourceId")) if edge.get("sourceId") != null else ""
		var dest_id := src.substr(7) if src.begins_with("dst_in_") else ""
		var dest: Variant = null
		for d in dests:
			if str(d.id) == dest_id:
				dest = d
				break
		if dest == null or R.s(dest.get("mode")) == "multiview":
			continue
		var idx := _main_idx(dest)
		var lay := _norm_layout(str(o.channelLayout) if HC.truthy(o.get("channelLayout")) else "stereo")
		cabled[idx] = _max_layout(cabled[idx], lay) if cabled.has(idx) else lay
	var sc_v: Variant = HC.coalesce([cm.get("screenCount") if HC.truthy(cm.get("screenCount")) else null, R.d(settings.get("casparServer")).get("screen_count") if HC.truthy(R.d(settings.get("casparServer")).get("screen_count")) else null, 1])
	var sc := int(HC._js_num(sc_v)) if is_finite(HC._js_num(sc_v)) else 1
	var from_map := R.a(cm.get("programAudioLayouts"))
	var layout: String
	if cm.get("programAudioLayouts") is Array and from_map.size() >= sc:
		layout = _norm_layout(from_map[main]) if main < sc else ""
	else:
		layout = (by_dest.get(main, "stereo") if HC.truthy(by_dest.get(main)) else "stereo") if main < sc else ""
	if layout == "":
		return 2
	if cabled.has(main):
		layout = _max_layout(layout, cabled[main])
	return _channels(layout)
