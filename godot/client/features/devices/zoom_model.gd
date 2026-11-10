extends RefCounted
## WO-1012 stage E — the Zoom device page's model. Pure: the API replies (GET /api/zoom, /api/zoom/host,
## /api/zoom/audio) → labels, picker options and POST bodies. zoom_controls.gd is the view.

const SOURCES := [["presenter", "Presenter"], ["share", "Share"], ["gallery", "Gallery"]]
const SIZES := [["1920x1080", "1920×1080"], ["1280x720", "1280×720"]]
const UNAVAILABLE := "not available yet"


## A reply of the Api autoload ({ok, status, data}) → its JSON body, or {} when the route is missing / failed.
static func body(r: Dictionary) -> Dictionary:
	var d: Variant = r.get("data")
	return d if bool(r.get("ok", false)) and d is Dictionary else {}


## true when the section's route answered (a 404 = the server does not have it yet).
static func available(r: Dictionary) -> bool:
	return bool(r.get("ok", false)) and r.get("data") is Dictionary


static func status_line(z: Dictionary) -> String:
	if z.is_empty():
		return "Zoom: no answer from the server"
	if not bool(z.get("installed", false)):
		return "Zoom is not installed"
	if not bool(z.get("running", false)):
		return "Zoom is not running"
	var n := _windows(z).size()
	return "Zoom is running · %d window%s" % [n, "" if n == 1 else "s"]


static func running(z: Dictionary) -> bool:
	return bool(z.get("running", false))


static func _windows(z: Dictionary) -> Array:
	var w: Variant = z.get("windows")
	return w if w is Array else []


## [[id, label]…] — "Off" (id "") then every window "title · WxH".
static func window_options(z: Dictionary) -> Array:
	var out := [["", "Off"]]
	for w in _windows(z):
		if w is Dictionary:
			var t := str(w.get("title", "")).strip_edges()
			out.append([str(w.get("id", "")), "%s · %d×%d" % [t if t != "" else str(w.get("id", "")), int(w.get("width", 0)), int(w.get("height", 0))]])
	return out


static func source_of(z: Dictionary, key: String) -> Dictionary:
	var s: Variant = z.get("sources")
	var v: Variant = s.get(key) if s is Dictionary else null
	return v if v is Dictionary else {}


## The window picker needs the chosen window listed even when Zoom no longer shows it (so the choice is not lost).
static func window_options_for(z: Dictionary, key: String) -> Array:
	var opts := window_options(z)
	var cur := str(source_of(z, key).get("window", "") if source_of(z, key).get("window") != null else "")
	if cur != "":
		for o in opts:
			if o[0] == cur:
				return opts
		var t := str(source_of(z, key).get("title", ""))
		opts.append([cur, "%s (gone)" % (t if t != "" else cur)])
	return opts


## Live = grabbing and the published counter moved since the previous poll (`prev` = that count, -1 = first poll).
static func live(src: Dictionary, prev: int) -> bool:
	return bool(src.get("grabbing", false)) and prev >= 0 and int(src.get("published", 0)) > prev


static func live_text(src: Dictionary, prev: int) -> String:
	if str(src.get("error", "")) != "":
		return "no picture · %s" % str(src.error)
	if live(src, prev):
		return "live"
	if bool(src.get("grabbing", false)) and prev < 0:
		return "checking…"
	return "no picture"


## Host-channel entry of `key` in a /api/zoom/host reply ({} when absent).
static func host_entry(h: Dictionary, key: String) -> Dictionary:
	var e: Variant = h.get("entries")
	if e is Array:
		for x in e:
			if x is Dictionary and str(x.get("source", "")) == key:
				return x
	return {}


## WO-1012 B2: a source is a LAYER on a channel Caspar already runs, so enabling it plays at once. "needs Apply &
## restart" only while the server says so (no host channel yet, or a channel renumber not applied).
static func host_text(h: Dictionary, key: String) -> String:
	var e := host_entry(h, key)
	if e.is_empty() or not bool(e.get("configured", false)):
		return ""
	var r: Variant = e.get("route")
	var s := str(r) if r != null and str(r) != "" else "no input channel yet"
	if not bool(e.get("live", false)):
		s += " · needs Apply & restart" if host_needs_restart(h) else " · not playing"
	return s


static func host_needs_restart(h: Dictionary) -> bool:
	return bool(h.get("needsRestart", false))


static func source_body(key: String, field: String, value: Variant) -> Dictionary:
	var b := {"source": key}
	match field:
		"window":
			b["window"] = null if str(value) == "" else str(value)
		"hidden":
			b["hidden"] = bool(value)
		"fit":
			b["fit"] = bool(value)
		"size":
			b["size"] = str(value)
	return b


static func host_body(key: String, enabled: bool) -> Dictionary:
	return {"source": key, "enabled": enabled}


static func launch_body(url: String) -> Dictionary:
	var u := url.strip_edges()
	return {"url": u} if u != "" else {}


## Audio section → {available, enabled, feeds [[id,label]], feed, note}.
static func audio_view(a: Dictionary) -> Dictionary:
	var feeds := []
	var f: Variant = a.get("feeds")
	if f is Array:
		for x in f:
			if x is Dictionary:
				feeds.append([str(x.get("id", "")), str(x.get("label", x.get("id", "")))])
	var out: Variant = a.get("out")
	var note := str(a.get("note", ""))
	if str(a.get("error", "")) != "":
		note = str(a.error)
	return {"available": bool(a.get("available", false)), "enabled": bool(a.get("enabled", false)), "feeds": feeds,
		"feed": str(out.get("feed", "")) if out is Dictionary else "", "note": note}


static func audio_body(field: String, value: Variant) -> Dictionary:
	return {"enabled": bool(value)} if field == "enabled" else {"feed": str(value)}


# ---------------------------------------------------------------- Meeting section (GET/POST /api/zoom/ui)

const SHARE_TAB_SUFFIX := "'s screen"


static func ui_status(u: Dictionary) -> String:
	var s := "Not in a meeting"
	if bool(u.get("waiting", false)):
		s = "In the waiting room"
	elif bool(u.get("inMeeting", false)):
		s = "In the meeting"
	elif str(u.get("preview", "")) != "":
		s = "Join preview open"
	var sh: Variant = u.get("sharing")
	if sh is Array and not sh.is_empty():
		s += " · %s is sharing" % ", ".join(sh.map(func(x: Variant) -> String: return str(x)))
	return s


static func join_visible(u: Dictionary) -> bool:
	return str(u.get("preview", "")) != ""


## Microphone / Camera: {enabled, pressed}. pressed = the device is ON (mic live, camera sending); disabled when Zoom
## reports null (not in a meeting).
static func toggle_view(u: Dictionary, kind: String) -> Dictionary:
	var v: Variant = u.get("muted" if kind == "mic" else "video")
	if v == null:
		return {"enabled": false, "pressed": false}
	return {"enabled": true, "pressed": (not bool(v)) if kind == "mic" else bool(v)}


static func toggle_body(kind: String, on: bool) -> Dictionary:
	if kind == "mic":
		return {"action": "unmute" if on else "mute"}
	return {"action": "video_on" if on else "video_off"}


static func _tabs(u: Dictionary) -> Array:
	var t: Variant = u.get("tabs")
	return t if t is Array else []


static func share_tab_exists(u: Dictionary) -> bool:
	for x in _tabs(u):
		if x is Dictionary and str(x.get("name", "")).ends_with(SHARE_TAB_SUFFIX):
			return true
	return false


## "speaker" | "share" | "" — which tab the main window shows.
static func main_window(u: Dictionary) -> String:
	for x in _tabs(u):
		if x is Dictionary and bool(x.get("checked", false)):
			var n := str(x.get("name", ""))
			if n == "Meeting":
				return "speaker"
			if n.ends_with(SHARE_TAB_SUFFIX):
				return "share"
	return ""


static func main_window_body(which: String) -> Dictionary:
	return {"action": "share_tab" if which == "share" else "meeting_tab"}


static func join_body() -> Dictionary:
	return {"action": "join"}


static func participants_body() -> Dictionary:
	return {"action": "participants"}


static func settings_body() -> Dictionary:
	return {"action": "settings"}


## name "" removes the pin.
static func pin_body(name: String) -> Dictionary:
	return {"action": "pin", "name": name}


## "3 changed, 14 already right" (+ " · not found: a, b, c, +N" for failed and missing settings).
## `r` = the `settings` field of GET /api/zoom/ui: {} (never run), {running: true}, {error}, or the result.
static func settings_line(r: Dictionary) -> String:
	if r.is_empty():
		return ""
	if bool(r.get("running", false)):
		return "Applying… Zoom's Settings window is open for about half a minute"
	if str(r.get("error", "")) != "":
		return "Not applied: " + str(r.get("error"))
	var ch: Variant = r.get("changed")
	var s := "%d changed, %d already right" % [ch.size() if ch is Array else 0, int(r.get("alreadyRight", 0))]
	var names := []
	for key in ["failed", "missing"]:
		var l: Variant = r.get(key)
		if l is Array:
			for x in l:
				if x is Dictionary:
					names.append(str(x.get("setting", "")))
	if not names.is_empty():
		var shown := names.slice(0, 3)
		var txt := ", ".join(shown)
		if names.size() > 3:
			txt += ", +%d" % (names.size() - 3)
		s += " · not found: " + txt
	return s


## Participants reply → [{name, label, pin}] — only others get a Pin button; flags in the label.
static func pin_rows(r: Dictionary) -> Array:
	var out := []
	var p: Variant = r.get("participants")
	if p is Array:
		for x in p:
			if not x is Dictionary:
				continue
			var name := str(x.get("name", ""))
			var label := name
			var flags := []
			if bool(x.get("me", false)):
				flags.append("me")
			if bool(x.get("host", false)):
				flags.append("host")
			if bool(x.get("sharing", false)):
				flags.append("sharing")
			if not flags.is_empty():
				label += " (%s)" % ", ".join(flags)
			out.append({"name": name, "label": label, "pin": not bool(x.get("me", false)) and name != ""})
	return out
