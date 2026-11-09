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


static func host_text(h: Dictionary, key: String) -> String:
	var e := host_entry(h, key)
	if e.is_empty() or not bool(e.get("configured", false)):
		return ""
	var s := str(e.get("route", ""))
	if not bool(e.get("live", false)):
		s += " · needs Apply & restart"
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
