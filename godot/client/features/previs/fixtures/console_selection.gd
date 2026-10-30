extends RefCounted
## WO-857 — what the lighting console (grandMA3 plugin, later MagicQ) has selected, one per client (`shared()`). It is a
## SECOND selection set, kept apart from fixture_selection.gd on purpose: the operator's own pick (3D click, VR box
## select — WO-774 / WO-841) and the console's selection would fight over one set. Nothing here ever writes
## fixture_selection.gd's `ids`; only the explicit "Take" button does (console_row.gd), once, on a click.
## The feed is the server's WS `fixtures:console_selection` { source, heads, ids, unmatched, ts } (and GET
## /api/fixtures/console-selection for the state at connect), delivered by console_selection_feed.gd.
## `follow` (ui.cfg [previs] follow_console, default off) is the "Follow console selection" toggle: while it is on the
## previs draws `shown()` in `COLOR`, otherwise the set is only counted.

signal changed

const UI_CFG := "user://ui.cfg"
const COLOR := Color(0.2, 0.85, 1.0)  # the previs mark of a console-selected head (the operator's own is amber)

static var _one: RefCounted = null

var source := ""
var heads: Array = []  # the console's head numbers (FixtureIDs)
var ids: Array = []  # patch fixture ids those heads map to (server side, MVR FixtureIDs)
var unmatched: Array = []  # head numbers nothing is patched under
var ts := 0.0
var follow := false
var persist := true  # false in tests: never write the operator's ui.cfg


static func shared() -> RefCounted:
	if _one == null:
		_one = new()
		var cfg := ConfigFile.new()
		cfg.load(UI_CFG)
		_one.follow = bool(cfg.get_value("previs", "follow_console", false))
	return _one


## A server payload → {source, heads, ids, unmatched, ts} with the right types, or {} when it is not a selection.
static func parse(data: Variant) -> Dictionary:
	if not data is Dictionary or not (data as Dictionary).get("ids") is Array:
		return {}
	var d: Dictionary = data
	var strs := func(a: Variant) -> Array:
		var out: Array = []
		for v in (a if a is Array else []):
			out.append(str(v))
		return out
	var nums := func(a: Variant) -> Array:
		var out: Array = []
		for v in (a if a is Array else []):
			if v is int or v is float:
				out.append(int(v))
		return out
	return {"source": str(d.get("source", "")), "heads": nums.call(d.get("heads")), "ids": strs.call(d.ids),
		"unmatched": nums.call(d.get("unmatched")), "ts": float(d.get("ts", 0))}


## Take a server payload; emits `changed` only when the set differs.
func apply(data: Variant) -> void:
	var p := parse(data)
	if p.is_empty():
		return
	if p.source == source and p.heads == heads and p.ids == ids and p.unmatched == unmatched:
		return
	source = p.source
	heads = p.heads
	ids = p.ids
	unmatched = p.unmatched
	ts = p.ts
	changed.emit()


## The patch ids to draw: the console's set while following, else none.
func shown() -> Array:
	return ids if follow else []


func set_follow(on: bool) -> void:
	if on == follow:
		return
	follow = on
	if persist:
		var cfg := ConfigFile.new()
		cfg.load(UI_CFG)
		cfg.set_value("previs", "follow_console", on)
		cfg.save(UI_CFG)
	changed.emit()


## "Console (gma3): 3 heads" for the Programmer row; the tooltip says which head numbers have no fixture.
func summary() -> String:
	if source == "":
		return "no console selection yet"
	return "%s: %d head%s" % [source, heads.size(), "" if heads.size() == 1 else "s"]


func detail() -> String:
	if unmatched.is_empty():
		return "Heads the console has selected, mapped through the MVR FixtureIDs."
	return "%d head number%s not in the patch: %s" % [unmatched.size(), "" if unmatched.size() == 1 else "s",
		", ".join(unmatched.slice(0, 12).map(func(n: Variant) -> String: return str(n))) + (" …" if unmatched.size() > 12 else "")]
