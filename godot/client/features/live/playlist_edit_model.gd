extends RefCounted
## WO-603 slice 6 — look-layer playlist editor: labels and request bodies (web inspector-layer-playlist.js). Pure.
## Every mutation is planned in node (POST /api/playlist/edit); the section only shows the server's rows and
## stores the returned patch.

const MODES := [["single", "1. Single Media (Default)"], ["list", "2. Playlist Workflow"]]
const ADVANCE := [["auto", "Auto Advance"], ["manual", "Manual Next"]]
const TRANSITIONS := [["MIX", "MIX (Dissolve)"], ["CUT", "CUT (None)"], ["SLIDE", "SLIDE"], ["WIPE", "WIPE"]]


static func index_of(table: Array, key: String, fallback := 0) -> int:
	for i in table.size():
		if table[i][0] == key:
			return i
	return fallback


static func edit_body(scene_id: String, layer: Dictionary, op: String, args := {}) -> Dictionary:
	var b := {"sceneId": scene_id, "layer": layer, "op": op}
	b.merge(args, true)
	return b


## "⚠ logo.png" for a missing file; the server decides `missing`.
static func row_name(row: Dictionary) -> String:
	return ("⚠ " if row.get("missing", false) else "") + str(row.get("name", row.get("value", "")))


## A row dragged from `from` and dropped on row `target` (section −1 above, 0 on, 1 below) → the splice index the
## server's `move` op takes (remove at from, insert at to), or −1 for no move.
static func drop_index(from: int, target: int, section: int, count: int) -> int:
	if from < 0 or from >= count:
		return -1
	if target < 0:  # below the last row
		return count - 1 if from != count - 1 else -1
	var at := target + (1 if section > 0 else 0)  # insertion point in the original list
	var to := at - 1 if from < at else at
	to = clampi(to, 0, count - 1)
	return -1 if to == from else to


## Whether a drag payload can add items: one source with a value (never an effect) or a {type:"multi"} drag.
static func droppable(data: Variant) -> bool:
	if not data is Dictionary:
		return false
	var d: Dictionary = data
	if d.get("type") == "multi":
		return d.get("items") is Array and (d.items as Array).any(func(it: Variant) -> bool: return it is Dictionary and str(it.get("value", "")) != "" and str(it.get("type", "")) != "effect")
	return str(d.get("value", "")) != "" and str(d.get("type", "")) != "effect" and not d.has("playlist_row")
