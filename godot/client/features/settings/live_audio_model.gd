extends RefCounted
## WO-608 — Settings → Live audio status text (web settings-live-audio-panel.js renderStatus).
## GET /api/audio/live-inputs carries liveAudioCount / liveAudioInputChannels, not a channelMap — the web read
## `liveState.channelMap` (always absent) and warned "not in channelMap yet" for every configured slot (WO-611 #8);
## the map is built from those two fields here.

const H := preload("res://features/devices/host_channels.gd")

const BUSES := [["preview_1", "Preview 1"], ["multiview", "Multiview"]]
const DEFAULT_SOURCES := [["preview_1", "Preview 1"], ["program_1", "Program 1"], ["multiview", "Multiview"]]


static func channel_map(live: Dictionary) -> Dictionary:
	if live.get("channelMap") is Dictionary:
		return live.channelMap
	return {"liveAudioCount": live.get("liveAudioCount", 0), "liveAudioInputChannels": live.get("liveAudioInputChannels", [])}


## [[text, tone]…], tone "" / "ok" / "warn".
static func status_lines(live: Dictionary) -> Array:
	var entries := H.input_channels(channel_map(live)).filter(func(e: Dictionary) -> bool: return e.get("kind") == "live_audio")
	var configured: Dictionary = live.get("configured") if live.get("configured") is Dictionary else {}
	if entries.is_empty():
		var count := int(str(live.get("liveAudioCount", configured.get("count", 0))).to_int())
		if count <= 0:
			return [["Add capture devices with Sources → Live → + or the Audio tab. Each slot uses one dedicated Caspar "
				+ "channel (allocated after apply + restart).", ""]]
		return [["Live audio channels not in the channel map yet. Apply the Caspar config and restart, then refresh.", "warn"]]
	var out: Array = [["Live audio inputs: %d dedicated channel(s)" % entries.size(), ""],
		[" · ".join(PackedStringArray(entries.map(func(e: Dictionary) -> String:
			return "Slot %s → ch %s (%s)" % [_n(e.get("slot")), _n(e.get("channel")), str(e.get("route", ""))]))), ""]]
	var st: Variant = live.get("status")
	if st is Dictionary:
		if st.get("enabled") == false and st.get("reason"):
			out.append([str(st.reason), "warn"])
		if st.get("started") is Array and not st.started.is_empty():
			out.append(["Started: " + ", ".join(PackedStringArray(st.started.map(_started_text))), "ok"])
		if st.get("failed") is Array and not st.failed.is_empty():
			out.append(["Failed: " + "; ".join(PackedStringArray(st.failed.map(_failed_text))), "warn"])
	var pv: Variant = configured.get("audioPreview", live.get("audioPreview"))
	if pv is Dictionary and pv.get("enabled") == true and pv.get("channel") != null:
		out.append(["Headphones bus: ch %s (%s)" % [_n(pv.channel), str(pv.get("bus", "preview"))], ""])
	return out


## OpenAL sink choices: Default + every device name (web previewDevices).
static func preview_devices(devices: Variant) -> Array:
	var out: Array = [["", "Default sink"]]
	if devices is Array:
		for d in devices:
			if d is Dictionary:
				var n := str(d.get("name", d.get("id", ""))).strip_edges()
				if n != "":
					out.append([n, n])
	return out


static func _started_text(x: Variant) -> String:
	if not (x is Dictionary):
		return str(x)
	return "slot %s" % _n(x.slot) if x.get("slot") != null else str(x.get("layer", ""))


static func _failed_text(x: Variant) -> String:
	if not (x is Dictionary):
		return str(x)
	for k in ["message", "slot", "layer"]:
		if x.get(k) != null and str(x[k]) != "":
			return _n(x[k])
	return ""


static func _n(v: Variant) -> String:
	return str(int(v)) if v is float and v == floorf(v) else str(v)
