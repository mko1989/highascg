extends RefCounted
## WO-608 — ALSA hardware mixer rules (web client/lib/alsa-mixer-api.js).

const VIEWS := [["playback", "Playback"], ["capture", "Capture"], ["all", "All"]]
const _CAPTURE_RE := "capture|mic|input|adc|record"
const _PLAYBACK_RE := "playback|output|dac|master|speaker|headphone|pcm"


## {card, cards: [{card, name}], controls, suggested (-1 = none)} — normalizeAlsaMixerPayload.
static func normalize(p: Variant) -> Dictionary:
	var d: Dictionary = p if p is Dictionary else {}
	var cards: Array = []
	if d.get("cards") is Array:
		for c in d.cards:
			if c is Dictionary:
				var n: Variant = c.get("card", c.get("index"))
				if n is float or n is int or (n is String and n.is_valid_int()):
					var i := int(n)
					if i >= 0:
						cards.append({"card": i, "name": str(c.get("name", c.get("label", "Card %d" % i))).strip_edges()})
	var card := int(d.get("card", cards[0].card if not cards.is_empty() else 0))
	var controls: Array = []
	if d.get("controls") is Array:
		controls = d.controls
	elif d.get("elements") is Array:
		controls = d.elements
	else:
		for k in ["playback", "capture"]:
			if d.get(k) is Array:
				controls.append_array(d[k])
	var sug: Variant = d.get("suggestedCard")
	return {"card": card, "cards": cards, "controls": controls.filter(func(c: Variant) -> bool: return c is Dictionary),
		"suggested": int(sug) if sug != null and (sug is float or sug is int) else -1}


## alsaControlMatchesView
static func matches_view(c: Dictionary, view: String) -> bool:
	if view == "all":
		return true
	var ty := str(c.get("type", "")).to_lower()
	if ty in ["boolean", "switch", "enum", "enumerated"]:
		return true
	var cap: bool = c.get("capture") == true or c.get("isCapture") == true
	var play: bool = c.get("playback") == true or c.get("isPlayback") == true
	if cap or play:
		return cap if view == "capture" else play
	var name := str(c.get("name", c.get("id", ""))).to_lower()
	var is_cap := RegEx.create_from_string(_CAPTURE_RE).search(name) != null
	if view == "capture":
		return is_cap
	return not is_cap or RegEx.create_from_string(_PLAYBACK_RE).search(name) != null


## alsaControlPercent, except a server `percent` is used as is — the web rescaled it by min..max whenever it fell
## inside that range (percent 50 on a 0..87 control showed 57 %, WO-611 #9).
static func percent(c: Dictionary) -> int:
	var lo := float(c.get("min", 0))
	var hi := float(c.get("max", 100))
	var raw: Variant = c.get("percent", c.get("value", c.get("volume")))
	if raw == null or not str(raw).is_valid_float():
		return 0
	var n := float(str(raw))
	if c.get("percent") == null and hi > lo and n >= lo and n <= hi:
		return roundi((n - lo) / (hi - lo) * 100.0)
	return clampi(roundi(n), 0, 100)


## "volume" / "bool" / "enum"
static func kind(c: Dictionary) -> String:
	var ty := str(c.get("type", "volume")).to_lower()
	if ty in ["enum", "enumerated"]:
		return "enum"
	if ty in ["boolean", "switch"]:
		return "bool"
	return "volume"


## Switch state: `value` (0 / 1, or a bool) else `on` — JS `!!(value ?? on)`.
static func switch_on(c: Dictionary) -> bool:
	var v: Variant = c.get("value") if c.get("value") != null else c.get("on")
	if v is bool:
		return v
	return v != null and str(v).is_valid_float() and float(str(v)) != 0.0


static func value_text(c: Dictionary, pct: int) -> String:
	return "%d%%" % pct + (" · %.1f dB" % float(c.dB) if c.get("dB") != null else "")


## POST /api/audio/alsa-mixer body for one control.
static func body(card: int, c: Dictionary, change: Dictionary) -> Dictionary:
	var b := {"card": card, "name": str(c.get("name", c.get("id", "")))}
	if c.get("index") != null:
		b["index"] = int(c.index)
	b.merge(change)
	return b
