extends RefCounted
## WO-974 — pure helpers for the Settings → Timecode pane: the one-line LTC status from GET /api/ltc.

const FPS := [["24", "24"], ["25", "25"], ["29.97df", "29.97 drop-frame"], ["30", "30"]]
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
	if o.get("error") and o.get("running") != true:
		return "stopped (%s)" % str(o.error)
	if o.get("running") == true and o.get("tc") != null:
		return str(o.tc)
	return "silent (timeline not playing)" if str(o.get("source", "")) == "timeline" else "starting"


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
