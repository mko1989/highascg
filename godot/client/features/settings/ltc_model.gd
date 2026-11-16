extends RefCounted
## WO-974 — pure helpers for the LTC fold (WO-1092: moved from Settings → Timecode to the Audio tab, audio/ltc_fold.gd):
## the one-line LTC status from GET /api/ltc, the device / channel pickers and the timeline transport read-out.

const FPS := [["24", "24"], ["25", "25"], ["29.97df", "29.97 drop-frame"], ["30", "30"]]
## WO-1092: LTC out's own rate — follow the on-air timeline (50 → 25, 59.94 → 29.97 DF, 60 → 30) or forced.
const OUT_FPS := [["timeline", "Follow the timeline"], ["23.976", "23.976"], ["24", "24"], ["25", "25"],
	["29.97df", "29.97 drop-frame"], ["29.97ndf", "29.97 non-drop"], ["30", "30"]]
const OUT_SOURCE := [["timeline", "Timeline playhead"], ["clock", "Time of day"], ["test", "Test: free-run from the start TC"]]
const WHEN_PAUSED := [["silence", "Silence (a chasing reader parks)"], ["hold", "Repeat the paused frame"]]
const OUT_STATE := {"missing": "device not connected", "busy": "device in use by another program", "error": "not running",
	"starting": "starting", "silent": "silent", "off": "off"}
const STATE_LABEL := {"none": "no signal", "acquiring": "acquiring", "locked": "locked", "freewheel": "freewheel",
	"still": "parked", "lost": "lost"}


## "In 01:00:12:04 locked −18 dB · Out 01:00:12:05" — or why a direction is not running.
static func status_line(d: Variant) -> String:
	if not (d is Dictionary):
		return "LTC status unavailable"
	var cfg: Dictionary = d.get("config", {}) if d.get("config") is Dictionary else {}
	var want_in: bool = cfg.get("input", {}).get("enabled") == true if cfg.get("input") is Dictionary else false
	var want_out: bool = cfg.get("output", {}).get("enabled") == true if cfg.get("output") is Dictionary else false
	if not want_in and not want_out:
		return "LTC in and out are off"
	var lib: Variant = d.get("libltc")
	if lib is Dictionary and lib.get("ok") != true:
		return "libltc is not installed — %s" % str(lib.get("hint", "sudo apt install libltc11"))
	var parts: Array[String] = []
	if want_in:
		parts.append("In " + _in_text(d.get("input")))
	if want_out:
		parts.append("Out " + _out_text(d.get("output")))
	return " · ".join(parts)


static func _in_text(i: Variant) -> String:
	if not (i is Dictionary):
		return "—"
	if i.get("problem"):
		return str(i.problem)
	var st := str(i.get("state", "none"))
	var s := "%s %s" % [str(i.get("tc")) if i.get("tc") != null else "--:--:--:--", STATE_LABEL.get(st, st)]
	if i.get("volumeDb") != null and st != "none":
		s += " %d dB" % int(round(float(i.volumeDb)))
	if i.get("error") and st != "locked":
		s += " (%s)" % str(i.error)
	return s


static func _out_text(o: Variant) -> String:
	if not (o is Dictionary):
		return "—"
	if o.get("problem"):
		return str(o.problem)
	var st := str(o.get("state", ""))
	if o.get("error") and o.get("running") != true:
		return ("%s (%s)" % [OUT_STATE[st], str(o.error)]) if OUT_STATE.has(st) else "stopped (%s)" % str(o.error)
	if o.get("running") == true and o.get("tc") != null:
		return str(o.tc)
	return "silent (timeline not playing)" if str(o.get("source", "")) == "timeline" else "starting"


## WO-1092 — the LTC out detail line under the status: device, channels, rate, measured device latency, drift, under-runs.
## "→ HDA NVidia — HDMI 2 · ch 7+8 · 48 kHz · device 31 ms · drift 0.4 ms · 0 under-runs"
static func out_detail(o: Variant) -> String:
	if not (o is Dictionary) or o.get("state") == null or str(o.get("state")) == "off":
		return ""
	var chans: Array = o.get("channels", []) if o.get("channels") is Array else []
	var parts: Array[String] = ["→ %s" % str(o.get("device") if o.get("device") != null else o.get("where", "?"))]
	if not chans.is_empty():
		parts.append("ch " + "+".join(chans.map(func(c: Variant) -> String: return str(int(c)))))
	parts.append("%d kHz" % int(round(float(o.get("rate", 48000)) / 1000.0)))
	if o.get("delayMs") != null:
		parts.append("device %d ms" % int(round(float(o.delayMs))))
	if str(o.get("state")) == "running":
		parts.append("drift %.1f ms" % float(o.get("driftMs", 0.0)))
	parts.append("%d under-runs" % int(o.get("underruns", 0)))
	return " · ".join(parts)


## WO-1092 — the LTC out device dropdown from GET /api/ltc/devices: "Program audio output" first (LTC on its own
## channels of the program card), then every playback device with its channel count and who uses it. A stored device
## that is not connected stays listed (a save never silently changes it).
static func out_device_items(devices: Array, current: String) -> Array:
	var out := [["", "None"]]
	for d in devices:
		if not (d is Dictionary) or str(d.get("value", "")) == "":
			continue
		var label := "%s · %d ch" % [str(d.get("label", d.value)), int(d.get("channels", 2))]
		if str(d.value) != "program" and d.get("usedBy") is Array and not (d.usedBy as Array).is_empty():
			label += " · " + ", ".join(d.usedBy)
		out.append([str(d.value), label])
	if current != "" and index_of(out, current) < 0:
		out.append([current, "%s (not connected)" % current])
	return out


## Channels of the device `value` (the stored count when it is not listed).
static func device_channels(devices: Array, value: String, fallback: int) -> int:
	for d in devices:
		if d is Dictionary and str(d.get("value", "")) == value:
			return maxi(1, int(d.get("channels", fallback)))
	return maxi(1, fallback)


## The one channel picker: "Ch 1" … "Ch n" (mono), then the pairs "Ch 1+2", "Ch 3+4" … (the same LTC on both).
static func channel_items(n: int) -> Array:
	var out := []
	for c in range(1, n + 1):
		out.append([str(c), "Ch %d" % c])
	for c in range(1, n, 2):
		out.append(["%d+%d" % [c, c + 1], "Ch %d+%d" % [c, c + 1]])
	return out


static func channel_value(channel: int, pair: bool) -> String:
	return "%d+%d" % [channel, channel + 1] if pair else str(channel)


## "7+8" → {channel: 7, pair: true}; "3" → {channel: 3, pair: false}
static func parse_channel(v: String) -> Dictionary:
	var a := v.split("+")
	return {"channel": maxi(1, int(a[0])), "pair": a.size() > 1}


## WO-1055: the Device dropdown's items [[value, label], …] from GET /api/audio/alsa-cards — "None" first, then the cards;
## a stored device that is not connected (or typed by hand before) stays listed so a save never silently changes it.
static func device_items(cards: Array, current: String) -> Array:
	var out := [["", "None"]]
	for c in cards:
		if c is Dictionary and str(c.get("value", "")) != "":
			out.append([str(c.value), str(c.get("label", c.value))])
	if current != "" and index_of(out, current, cards) < 0:
		out.append([current, "%s (not connected)" % current])
	return out


## The item showing `value`: the same string, else the card it names by number (a stored "plughw:4,0" / "hw:4,0" is the
## card listed as card 4, device 0). -1 = none.
static func index_of(items: Array, value: String, cards := []) -> int:
	for i in items.size():
		if str(items[i][0]) == value:
			return i
	var m := RegEx.create_from_string("^(plug)?hw:(\\d+),(\\d+)$").search(value)
	if m == null:
		return -1
	for c in cards:
		if c is Dictionary and int(c.get("card", -1)) == int(m.get_string(2)) and int(c.get("device", -1)) == int(m.get_string(3)):
			for i in items.size():
				if str(items[i][0]) == str(c.get("value", "")):
					return i
	return -1


## WO-1059 — the LTC out read-out in the timeline transport: {text, state, tip}. state: "off" (output disabled),
## "silent" (enabled, nothing going out), "run" (timecode going out) or "error" (device / libltc problem).
## WO-1060: `timeline_on` = the shown timeline is one the operator chose to send LTC (timeline.ltcOut).
static func readout(d: Variant, timeline_on := true) -> Dictionary:
	if not (d is Dictionary):
		return {"text": "LTC —", "state": "off", "tip": "LTC status unavailable"}
	var cfg: Dictionary = d.get("config", {}) if d.get("config") is Dictionary else {}
	var oc: Dictionary = cfg.get("output", {}) if cfg.get("output") is Dictionary else {}
	if not timeline_on:
		return {"text": "LTC off", "state": "off", "tip": "This timeline plays without LTC. Click to send LTC while it plays."}
	if oc.get("enabled") != true:
		return {"text": "LTC off", "state": "off", "tip": "LTC out is off. Click to turn it on."}
	var where := str(oc.get("device", "")) if str(oc.get("sink", "alsa")) == "alsa" else str(oc.get("path", ""))
	var lib: Variant = d.get("libltc")
	if lib is Dictionary and lib.get("ok") != true:
		return {"text": "LTC error", "state": "error", "tip": "libltc is not installed — %s" % str(lib.get("hint", "sudo apt install libltc11"))}
	var o: Dictionary = d.get("output", {}) if d.get("output") is Dictionary else {}
	var tail := "\nClick to stop sending LTC from this timeline."
	if o.get("running") == true and o.get("tc") != null:
		return {"text": "LTC %s" % str(o.tc), "state": "run", "tip": "LTC out → %s%s" % [where, tail]}
	if o.get("error"):
		return {"text": "LTC error", "state": "error", "tip": "%s%s" % [str(o.error), tail]}
	var why := "the timeline is not playing" if str(oc.get("source", "timeline")) == "timeline" else "starting"
	return {"text": "LTC --:--:--:--", "state": "silent", "tip": "LTC out → %s: silent, %s.%s" % [where, why, tail]}
