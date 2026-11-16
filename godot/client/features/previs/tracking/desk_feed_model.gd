extends RefCounted
## WO-1097 — the "desk feed" settings (project.fixtures.feed) and its status line. normalize() is the twin of
## src/fixtures/desk-feed-layout.js normalizeFeed: the fronts' FINAL pan / tilt / dimmer (after tracking, calibration,
## IK, Auto follow and the spot handover) sent to the lighting desk on a universe its show does not output; the LD
## takes it over under a fader (help: desk-feed-magicq, desk-feed-grandma3). Its own switch, off by default.

const PORT_ADDRESS_MAX := 32767
const SACN_UNIVERSE_MAX := 63999
const PROTOCOLS := [["artnet", "Art-Net (unicast to the desk)"], ["sacn", "sACN (priority; empty = multicast)"]]
const LAYOUTS := [["mirror", "Mirror — same channel numbers as the real patch"], ["compact", "Compact — 8 channels per head"]]
const CSV_PATH := "/api/tracking/follow/feed.csv"


static func _num(v: Variant, d: float, lo: float, hi: float) -> float:
	return clampf(float(v), lo, hi) if (v is int or v is float) and is_finite(float(v)) else d


static func _int(v: Variant, d: int, lo: int, hi: int) -> int:
	return int(round(_num(v, d, lo, hi)))


static func normalize(raw: Variant) -> Dictionary:
	var o: Dictionary = raw if raw is Dictionary else {}
	var sacn: bool = o.get("protocol") is String and o.protocol == "sacn"
	return {
		"enabled": o.get("enabled") is bool and o.enabled,  # like node: only true itself
		"protocol": "sacn" if sacn else "artnet",
		"universe": _int(o.get("universe"), 200, 1, SACN_UNIVERSE_MAX) if sacn else _int(o.get("universe"), 200, 0, PORT_ADDRESS_MAX),
		"dest": str(o.get("dest")).strip_edges().left(64) if o.get("dest") is String else "",
		"priority": _int(o.get("priority"), 100, 1, 200),
		"layout": "compact" if o.get("layout") is String and o.layout == "compact" else "mirror",
		"address": _int(o.get("address"), 1, 1, 512),
	}


## GET /api/tracking/follow `feed` → one line: off / refused (why) / live (heads, who is aimed now, packets a second).
static func status_text(st: Variant) -> String:
	if not st is Dictionary or st.is_empty():
		return "Server not reporting the desk feed (Tracking module off, or an older server)."
	var n := int(st.get("heads", 0))
	var heads := "%d head%s" % [n, "" if n == 1 else "s"]
	if not (st.get("enabled") is bool and st.enabled):
		return "Off — would carry %s (Auto / marker heads)." % heads
	var probs: Array = st.get("problems") if st.get("problems") is Array else []
	if not probs.is_empty():
		return "Not sending: " + "; ".join(probs.map(func(p: Variant) -> String: return str(p)))
	if n == 0:
		return "On — no head follows a marker or Auto yet."
	var unis: Array = st.get("universes") if st.get("universes") is Array else []
	var to := ", ".join(unis.map(func(u: Variant) -> String: return "U%d → %s" % [int(u.get("universe", 0)), str(u.get("dest"))]))
	var act: Array = st.get("active") if st.get("active") is Array else []
	return "Live: %s · %s · aimed now: %s · %s packets/s" % [heads, to,
		"nobody" if act.is_empty() else ", ".join(act.map(func(a: Variant) -> String: return str(a))), str(st.get("pps", 0))]
