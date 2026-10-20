extends RefCounted
## WO-605 slice 8 — device snapshots (web device-view-snapshot-modals.js + lib/device-snapshot-capture.js, WO-49):
## the texts, the file-name slug, the saved document (the server's GET /api/device-snapshot/build envelope + device
## name, slug, optional rear-panel PNG) written as the web's JSON.stringify(doc, null, 2), the load file parse and the
## dry-run preview. Pure (tests preload it).

const SAVE_TITLE := "Save device snapshot"
const SAVE_TIP := "Save device snapshot (cabling + GPU/DeckLink profile as JSON)"
const NAME_HINT := "e.g. OB truck Caspar 1"
const CAPTURE := "Embed rear-panel image (PNG)"
const SAVE_NOTE := "Saves device graph, screen destinations, GPU layout & DeckLink-related screen settings."
const NO_NAME := "Enter a device name."
const NO_IMAGE := "Saved without image (capture failed)."
const NO_ENVELOPE := "Server did not return a device snapshot envelope"
const KIND := "highascg-device-snapshot"
const LOAD_TITLE := "Load device snapshot"
const LOAD_INTRO := "Load a snapshot file created with “Save device snapshot”."
const MODES := [["full", "Full — graph + screens + GPU/DeckLink fields"], ["graphOnly", "Device graph only"]]
const PICK := "Choose a .json file to preview changes."
const NO_FILE := "No file selected."
const READY := "Click Preview to validate and list changes."
const NO_JSON := "Select a valid JSON file first."
const CHECKING := "Checking…"
const APPLIED := "Device snapshot applied."
const MAX_SAFE := 9007199254740991.0  # Number.MAX_SAFE_INTEGER — integral floats below it print as ints


## slugifyDeviceName: lowercase, runs of anything but a-z / 0-9 → "-", trimmed of "-"; "" → "device".
static func slugify(name: Variant) -> String:
	var s := str(name if name != null else "").strip_edges().to_lower()
	s = RegEx.create_from_string("[^a-z0-9]+").sub(s, "-", true)
	s = RegEx.create_from_string("^-+|-+$").sub(s, "", true)
	return s if s != "" else "device"


static func file_label(name: String) -> String:
	return "File: %s.json" % slugify(name)


## new Date(ms).toISOString().
static func iso(ms: float) -> String:
	var whole := floori(ms / 1000.0)
	return "%s.%03dZ" % [Time.get_datetime_string_from_unix_time(whole), int(ms - whole * 1000.0)]


## The build reply's error ("" when it is a snapshot envelope).
static func envelope_error(built: Variant) -> String:
	var b: Dictionary = built if built is Dictionary else {}
	if b.get("ok") is bool and b.ok and str(b.get("kind")) == KIND:
		return ""
	var e: Variant = b.get("error")
	return _js(e) if _truthy(e) else NO_ENVELOPE


## The saved document, keys in the web's order (appVersion / host / visual only when present).
static func document(built: Dictionary, device_name: String, visual: Variant, now_ms: float) -> Dictionary:
	var doc := {"kind": built.kind, "version": built.get("version"), "deviceName": device_name, "slug": slugify(device_name),
		"createdAt": built.createdAt if _truthy(built.get("createdAt")) else iso(now_ms)}
	if _truthy(built.get("appVersion")):
		doc["appVersion"] = built.appVersion
	if _truthy(built.get("host")):
		doc["host"] = built.host
	if visual is Dictionary:
		doc["visual"] = visual
	doc["payload"] = built.get("payload")
	return doc


static func _truthy(v: Variant) -> bool:
	if v == null:
		return false
	if v is bool:
		return v
	if v is String or v is StringName:
		return str(v) != ""
	if v is float or v is int:
		return v != 0 and not is_nan(float(v))
	return true


## JSON.stringify(doc, null, 2): Godot's full-precision text with integral floats written as ints (JSON numbers
## parse as floats, so 1 would come back as "1.0").
static func to_text(doc: Variant) -> String:
	return JSON.stringify(_ints(doc), "  ", false, true)


static func _ints(v: Variant) -> Variant:
	if v is float and is_finite(v) and v == floorf(v) and absf(v) <= MAX_SAFE:
		return int(v)
	if v is Dictionary:
		var o := {}
		for k in v:
			o[k] = _ints(v[k])
		return o
	if v is Array:
		return v.map(func(x: Variant) -> Variant: return _ints(x))
	return v


## A picked file's text → {ok, data} or {ok: false, error: "Invalid JSON: …"} (JSON.parse of "" is an error).
static func parse_file(text: String) -> Dictionary:
	var j := JSON.new()
	if j.parse(text) != OK:
		# Godot counts lines from 0
		return {"ok": false, "error": "Invalid JSON: %s (line %d)" % [j.get_error_message(), j.get_error_line() + 1]}
	return {"ok": true, "data": j.data}


## The dry-run reply → the preview lines.
static func dry_text(r: Dictionary) -> String:
	var keys := ", ".join(_strs(r.get("changedKeys")))
	return "\n".join(["Mode: %s" % _js(r.get("mode")), "Sections: %s" % ", ".join(_strs(r.get("sections"))),
		"Changed keys: %s" % (keys if keys != "" else "(none)"), "", "Click Apply to write to config."])


static func _strs(v: Variant) -> Array:
	return (v as Array).map(func(x: Variant) -> String: return "" if x == null else _js(x)) if v is Array else []


static func _js(v: Variant) -> String:
	if v == null:
		return "undefined"
	if v is float and v == floorf(v) and absf(v) < 1e15:
		return str(int(v))
	return str(v)


static func apply_confirm(mode: String) -> String:
	return "Apply device snapshot (%s)? This updates saved configuration." % mode
