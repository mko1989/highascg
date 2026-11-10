extends RefCounted
## WO-1029 — a look belongs to a DESTINATION, not to a screen number. Mirrors src/config/dest-scope.js (pure, headless).
## Looks store `mainScope` (a screen index, "all") and, from this build, `destScope` (the destination id, "all", or
## "unscoped"). Deleting / reordering a destination shifts the indices (box B, 10.11: the wall moved from 2 to 1 and its
## looks still said "2"), so the deck groups by destination first:
##  - `destScope` names a destination of today → that destination's index;
##  - no id (old data) → `mainScope`, when a screen has that index;
##  - a destination that no longer exists / "unscoped" / an index past the screen list → NO SCREEN (the deck's
##    "No screen" group; never attached to whatever sits at that index now; a take needs an explicit screen).
## The server stamps ids on load and on every destination edit; the client stamps a look made in / dragged to a column.

const SC := preload("res://core/screen_channels.gd")
const ALL := "all"
const UNSCOPED := "unscoped"
const NO_SCREEN := -1
const EVERY := -2
const NOT_MAIN := ["multiview", "stream", "operator_gui"]

static var _last_sig := ""
static var _last_ids: Array = []


## Destination id per screen index ("" = unknown): channelMap.screenHosts, else the destination list
## (state.screenDestinations — the server announces it on every destination edit).
static func ids(cm: Variant, sd: Variant = null) -> Array:
	var n := SC.screen_count(cm)
	var out := []
	out.resize(n)
	out.fill("")
	var found := false
	for i in n:
		var d := str(SC.host_entry(cm, i).get("destId", ""))
		if d != "":
			out[i] = d
			found = true
	if found or not (sd is Dictionary) or not ((sd as Dictionary).get("destinations") is Array):
		return out
	for d in (sd as Dictionary).destinations:
		if not (d is Dictionary) or str(d.get("mode", "pgm_prv")) in NOT_MAIN or str(d.get("id", "")) == "":
			continue
		var i := maxi(0, int(str(d.get("mainScreenIndex", 0)).to_int()))
		if i < n and out[i] == "":
			out[i] = str(d.id)
	return out


static func has_ids(id_list: Array) -> bool:
	return id_list.any(func(x: Variant) -> bool: return str(x) != "")


static func index_of(id_list: Array, id: String) -> int:
	return id_list.find(id) if id != "" else NO_SCREEN


## The screen a look shows under: its index, EVERY ('all') or NO_SCREEN.
static func screen_of(look: Dictionary, id_list: Array, count: int) -> int:
	var did := str(look.get("destScope", "")).strip_edges()
	var m := str(look.get("mainScope", "")).strip_edges()
	if did == ALL or m == ALL:
		return EVERY
	if did == UNSCOPED:
		return NO_SCREEN
	if did != "" and has_ids(id_list):
		return index_of(id_list, did)
	if not m.is_valid_int():
		return NO_SCREEN
	var i := m.to_int()
	return i if i >= 0 and i < count else NO_SCREEN


## Looks of one column: its own and the 'all' ones (deck order kept).
static func looks_for_main(scenes: Array, main: int, id_list: Array, count: int) -> Array:
	return scenes.filter(func(s: Variant) -> bool:
		if not (s is Dictionary):
			return false
		var w := screen_of(s, id_list, count)
		return w == main or w == EVERY)


static func no_screen(scenes: Array, id_list: Array, count: int) -> Array:
	return scenes.filter(func(s: Variant) -> bool: return s is Dictionary and screen_of(s, id_list, count) == NO_SCREEN)


## The repair groups of the "No screen" column: {from → count}. `from` = the old index for a look that only has one
## (what the server's rescope-looks takes), else its dead destination id, else "unscoped".
static func repair_groups(unscoped: Array) -> Dictionary:
	var out := {}
	for s in unscoped:
		var key := repair_key(s)
		out[key] = int(out.get(key, 0)) + 1
	return out


static func repair_key(look: Dictionary) -> String:
	var did := str(look.get("destScope", "")).strip_edges()
	var m := str(look.get("mainScope", "")).strip_edges()
	if did != "" and did != UNSCOPED and did != ALL:
		return did
	return m if m.is_valid_int() else UNSCOPED


## A look made in / dragged onto column `main`: its destination (when the map knows it) and its index.
static func attach(look: Dictionary, main: int, id_list: Array) -> void:
	look["mainScope"] = str(main)
	var did: String = str(id_list[main]) if main >= 0 and main < id_list.size() else ""
	if did != "":
		look["destScope"] = did
	else:
		look.erase("destScope")


## The deck's repair (mirrors the server's rescope-looks): looks of group `from` → column `main`. Returns the count.
static func rescope(scenes: Array, from: String, main: int, id_list: Array, count: int) -> int:
	var n := 0
	for s in scenes:
		if s is Dictionary and screen_of(s, id_list, count) == NO_SCREEN and (from == UNSCOPED or repair_key(s) == from):
			attach(s, main, id_list)
			n += 1
	return n


## The screen list changed under the deck: looks without an id are stamped from the list BEFORE (`prev`), then every
## look with an id takes its destination's index of today. Never stamps "unscoped" (the server does that). → changed.
static func reconcile(scenes: Array, prev: Array, now: Array) -> int:
	var n := 0
	for s in scenes:
		if not (s is Dictionary):
			continue
		var did := str(s.get("destScope", "")).strip_edges()
		var m := str(s.get("mainScope", "")).strip_edges()
		if did == "" and m.is_valid_int() and m.to_int() >= 0 and m.to_int() < prev.size() and str(prev[m.to_int()]) != "":
			did = str(prev[m.to_int()])
			s["destScope"] = did
			n += 1
		if did == "" or did == ALL or did == UNSCOPED:
			continue
		var i := index_of(now, did)
		if i >= 0 and str(i) != m:
			s["mainScope"] = str(i)
			n += 1
	return n


## Remembers the screen list between deck rebuilds: → the previous list when it changed (and both were known), else [].
static func list_changed(id_list: Array) -> Array:
	var sig := ",".join(PackedStringArray(id_list.map(func(x: Variant) -> String: return str(x))))
	var prev := _last_ids
	var changed := _last_sig != "" and sig != _last_sig and has_ids(prev) and has_ids(id_list)
	_last_sig = sig
	_last_ids = id_list.duplicate()
	return prev if changed else []
