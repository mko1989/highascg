extends RefCounted
## WO-1106 B27 — the APC40 default bindings a stored MIDI map (ui.cfg [midi] `map`) still has to gain. Each revision
## lists the target kinds it added; ui.cfg [midi] `defaults_rev` says which revisions the stored map has seen, so each
## default arrives once and an operator's Unmap of it stays unmapped after a restart (it used to come back on every
## load). A map stored before the key counts as revision 0: it gains revision 1 once, as the old loader did.

const MidiMap := preload("res://features/midi/midi_map.gd")
const UiCfg := preload("res://core/ui_cfg.gd")
const SECTION := "midi"
const KEY := "defaults_rev"
## Revision n (1-based) = the target kinds it added. 1: WO-913 edit / clear, WO-1054 devpage, WO-1070 padbank.
## A later work order that adds default kinds appends its own entry here.
const REVISIONS: Array = [["edit", "clear", "devpage", "padbank"]]


static func current() -> int:
	return REVISIONS.size()


## The target kinds of the revisions newer than `rev`.
static func kinds_after(rev: int) -> Array:
	var out := []
	for i in range(clampi(rev, 0, REVISIONS.size()), REVISIONS.size()):
		out.append_array(REVISIONS[i])
	return out


## `stored` (normalized) with the defaults of the revisions newer than `rev`.
static func upgrade(stored: Array, rev: int) -> Array:
	var kinds := kinds_after(rev)
	return stored if kinds.is_empty() else MidiMap.with_new_defaults(stored, kinds)


## The map ui.cfg holds (`c`, loaded from `path`), with the newer defaults; a map below the current revision is written
## back with it right away, so the new defaults land exactly once.
static func stored_map(c: ConfigFile, path: String) -> Array:
	var rev := int(c.get_value(SECTION, KEY, 0))
	var map := upgrade(MidiMap.without_phantoms(MidiMap.normalize(c.get_value(SECTION, "map"))), rev)
	if rev < current():
		save(map, path)
	return map


## The map and the revision it has seen ("" = nowhere: the test runner).
static func save(map: Array, path: String) -> void:
	if path == "":
		return
	UiCfg.save_value(SECTION, "map", map, path)
	UiCfg.save_value(SECTION, KEY, current(), path)
