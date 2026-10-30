extends RefCounted
## WO-837 — the Devices tab's "Lighting consoles" section, pure (server: src/lighting-console/console-store.js, routes
## src/api/routes-lighting.js). A console is {id, name, kind, host, port} (+ `prefix` for grandMA3, + `templates` for the
## generic OSC kind: per action {address, args[]}). The form is checked here the way the server checks it, so a typo is
## told before the POST; the server stays the judge.

const KINDS := [
	{"kind": "magicq", "label": "ChamSys MagicQ (OSC)", "port": 8000},
	{"kind": "eos", "label": "ETC Eos (OSC)", "port": 8000},
	{"kind": "grandma3", "label": "MA Lighting grandMA3 (OSC)", "port": 8000},
	{"kind": "osc", "label": "Generic OSC (address templates)", "port": 0},
]
## The generic kind's templates: [key, label, hint]. goCue replaces go when the flag has a cue; test is what Test sends.
const TEMPLATES := [
	["go", "Go", "/pb/{list}/go  1"],
	["goCue", "Go to cue", "/pb/{list}/{cue}  1"],
	["fader", "Fader", "/fader/{fader}  {level01}"],
	["release", "Release", "/pb/{list}/release  1"],
	["command", "Command", "/cmd  {command}"],
	["test", "Test", "/ping  (something harmless)"],
]
const PLACEHOLDERS := "{list} {cue} {fader} {level} {level01} {command}"

const HOST_RE := "^[A-Za-z0-9.:-]{1,253}$"
const PREFIX_RE := "^[A-Za-z0-9_-]{0,32}$"
const ADDR_RE := "^/[^\\s]{0,199}$"
const MAX_CONSOLES := 16


static func kind_label(kind: String) -> String:
	for k in KINDS:
		if k.kind == kind:
			return str(k.label)
	return kind


static func default_port(kind: String) -> int:
	for k in KINDS:
		if k.kind == kind:
			return int(k.port)
	return 0


## "192.168.1.20:8000 · ChamSys MagicQ (OSC)" — the list row's second line.
static func summary(c: Dictionary) -> String:
	return "%s:%s · %s" % [str(c.get("host", "")), str(int(c.get("port", 0))), kind_label(str(c.get("kind", "")))]


## Template args typed as space-separated words → the JSON list: a word that is a number is a number, anything else
## (also "{level01}") stays text.
static func args_from_text(text: String) -> Array:
	var out := []
	for w in text.strip_edges().split(" ", false):
		out.append(int(w) if w.is_valid_int() else (float(w) if w.is_valid_float() else str(w)))
	return out


static func args_to_text(args: Variant) -> String:
	var parts := PackedStringArray()
	for a in (args if args is Array else []):
		parts.append(str(int(a)) if (a is float and is_equal_approx(a, roundf(a))) else str(a))
	return " ".join(parts)


## The form → the record to POST, or the first problem. `form`: {id?, name, kind, host, port (text), prefix, templates:
## {key: {address, args (text)}}}. A blank port takes the kind's default (the generic kind has none: it needs one).
static func to_record(form: Dictionary) -> Dictionary:
	var name := str(form.get("name", "")).strip_edges()
	if name == "" or name.length() > 40:
		return {"ok": false, "error": "Name: 1-40 characters."}
	var kind := str(form.get("kind", ""))
	var known := false
	for k in KINDS:
		known = known or k.kind == kind
	if not known:
		return {"ok": false, "error": "Choose a console type."}
	var host := str(form.get("host", "")).strip_edges()
	if RegEx.create_from_string(HOST_RE).search(host) == null:
		return {"ok": false, "error": "Host: an IP address or a host name."}
	var ptxt := str(form.get("port", "")).strip_edges()
	var port := default_port(kind)
	if ptxt != "":
		if not ptxt.is_valid_int():
			return {"ok": false, "error": "Port: a number, 1-65535."}
		port = int(ptxt)
	if port < 1 or port > 65535:
		return {"ok": false, "error": "Port: required for a generic OSC console (1-65535)." if kind == "osc" and ptxt == "" else "Port: 1-65535."}
	var rec := {"name": name, "kind": kind, "host": host, "port": port}
	if str(form.get("id", "")) != "":
		rec["id"] = str(form.id)
	var prefix := str(form.get("prefix", "")).strip_edges()
	if kind == "grandma3" and prefix != "":
		if RegEx.create_from_string(PREFIX_RE).search(prefix) == null:
			return {"ok": false, "error": "Prefix: letters, digits, _ or - (no slashes)."}
		rec["prefix"] = prefix
	if kind == "osc":
		var tpl := {}
		var src: Variant = form.get("templates", {})
		for k in TEMPLATES:
			var t: Variant = src.get(k[0]) if src is Dictionary else null
			var addr := str(t.get("address", "")).strip_edges() if t is Dictionary else ""
			if addr == "":
				continue
			if RegEx.create_from_string(ADDR_RE).search(addr) == null:
				return {"ok": false, "error": "%s: the address starts with / and has no spaces." % k[1]}
			tpl[k[0]] = {"address": addr, "args": args_from_text(str(t.get("args", "")))}
		if not tpl.is_empty():
			rec["templates"] = tpl
	return {"ok": true, "record": rec}


## A stored console → the form's starting values.
static func to_form(c: Dictionary) -> Dictionary:
	var form := {"id": str(c.get("id", "")), "name": str(c.get("name", "")), "kind": str(c.get("kind", "magicq")),
		"host": str(c.get("host", "")), "port": str(int(c.port)) if c.get("port") != null else "", "prefix": str(c.get("prefix", "")), "templates": {}}
	var t: Variant = c.get("templates")
	if t is Dictionary:
		for k in t:
			form.templates[k] = {"address": str(t[k].get("address", "")), "args": args_to_text(t[k].get("args"))}
	return form


## The Test button's answer line.
static func test_line(r: Dictionary) -> String:
	var d: Dictionary = r.data if r.get("data") is Dictionary else {}
	if r.get("ok") == true and d.get("ok") != false:
		return "Sent %s%s" % [", ".join(PackedStringArray(d.get("sent", []))), (" · " + str(d.note)) if str(d.get("note", "")) != "" else ""]
	return "Test failed: %s" % (str(d.error) if str(d.get("error", "")) != "" else str(r.get("error", "no answer")))
