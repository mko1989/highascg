extends RefCounted
## WO-837 — the `light` timeline flag, pure (server: src/lighting-console/actions.js, engine timeline-playback-light.js).
## A light flag is {id, timeMs, type: "light", label, consoleId, action, …}; `action` is one of
##   go       list, cue?     go (or go to cue N) in cue list / playback `list`
##   fader    fader, level   level 0-100 %
##   release  list
##   command  command        a command-line string (grandMA3, Eos, MagicQ /rpc)
## Only the fields the action needs are kept. The engine passes the flag to the console service as is.
## `consoles` (GET /api/lighting/consoles) is cached here for the chips and the inspector (kept free of the Api
## autoload so the pure tests load it).

const ACTIONS := ["go", "fader", "release", "command"]
const ACTION_LABELS := ["Go / go to cue", "Move fader", "Release", "Command line"]
const FIELDS := {"go": ["list", "cue"], "fader": ["fader", "level"], "release": ["list"], "command": ["command"]}
const MAX_COMMAND := 400

static var consoles: Array = []  # [{id, name, kind, host, port, …}] — filled by timeline_light_fetch.gd when the tab is shown


static func console(id: String, list: Array = []) -> Dictionary:
	for c in (list if not list.is_empty() else consoles):
		if c is Dictionary and str(c.get("id", "")) == id:
			return c
	return {}


## The flag's action, falling back to "go".
static func action_of(f: Dictionary) -> String:
	var a := str(f.get("action", ""))
	return a if a in ACTIONS else "go"


## The changes that make `f` carry exactly `action`'s fields (null drops a key); starting values for the new fields.
static func action_patch(f: Dictionary, action: String) -> Dictionary:
	var ch := {"action": action}
	for k in ["list", "cue", "fader", "level", "command"]:
		if not k in FIELDS[action]:
			ch[k] = null
	match action:
		"go", "release":
			if f.get("list") == null:
				ch["list"] = 1
		"fader":
			if f.get("fader") == null:
				ch["fader"] = 1
			if f.get("level") == null:
				ch["level"] = 100
		"command":
			if f.get("command") == null:
				ch["command"] = ""
	return ch


## A list / cue field: 0-99999 with up to 3 decimals ("2", "2.5"). Maths already ran in the field. null = invalid.
static func parse_num(text: String) -> Variant:
	var t := text.strip_edges()
	if RegEx.create_from_string("^\\d{1,5}(\\.\\d{1,3})?$").search(t) == null:
		return null
	return int(t) if t.is_valid_int() else t.to_float()


## A fader: "N" or "page.fader" ("2.10" is page 2 fader 10, not 2.1), so it is kept as typed. null = invalid.
static func parse_fader(text: String) -> Variant:
	var t := text.strip_edges()
	if RegEx.create_from_string("^\\d{1,4}(\\.\\d{1,4})?$").search(t) == null:
		return null
	return int(t) if t.is_valid_int() else t


static func parse_level(v: float) -> float:
	return clampf(roundf(v * 10.0) / 10.0, 0.0, 100.0)


## One line, no control characters, at most 400. "" = invalid.
static func clean_command(text: String) -> String:
	var t := text.strip_edges()
	if t.length() > MAX_COMMAND:
		return ""
	for i in t.length():
		if t.unicode_at(i) < 32:
			return ""
	return t


## A number as the chip / field shows it: 3.0 → "3".
static func num_str(v: Variant) -> String:
	return str(int(v)) if (v is float and is_equal_approx(v, roundf(v))) or v is int else str(v)


## "Go 1 / cue 3", "Fader 4 to 80%", "Release 2", "Cmd: Go+ Sequence 1" — the chip's second half.
static func summary(f: Dictionary) -> String:
	match action_of(f):
		"go":
			return "Go %s" % num_str(f.get("list", "?")) + (" / cue %s" % num_str(f.cue) if f.get("cue") != null and str(f.cue) != "" else "")
		"fader":
			return "Fader %s to %s%%" % [num_str(f.get("fader", "?")), num_str(f.get("level", "?"))]
		"release":
			return "Release %s" % num_str(f.get("list", "?"))
	var c := str(f.get("command", ""))
	return "Cmd: " + (c if c != "" else "?")


## The chip text: console name + action ("MagicQ · Go 1 / cue 3"); a console that is gone / not chosen says so.
static func chip_text(f: Dictionary, list: Array = []) -> String:
	var id := str(f.get("consoleId", ""))
	var c := console(id, list)
	var name := str(c.get("name", "")) if not c.is_empty() else ("? " + id if id != "" else "No console")
	return "%s · %s" % [name, summary(f)]


## "" when the server would accept the flag, else why not (shown in the inspector).
static func problem(f: Dictionary, list: Array = []) -> String:
	if str(f.get("consoleId", "")) == "":
		return "Choose a console."
	if console(str(f.consoleId), list).is_empty():
		return "Console \"%s\" no longer exists (Devices tab)." % str(f.consoleId)
	match action_of(f):
		"go", "release":
			if f.get("list") == null:
				return "Needs a list."
		"fader":
			if f.get("fader") == null or f.get("level") == null:
				return "Needs a fader and a level."
		"command":
			if str(f.get("command", "")).strip_edges() == "":
				return "Type a command."
	return ""
