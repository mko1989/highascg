extends RefCounted
## WO-601 — look presets (web scene-state-preset-actions.js + inspector-panel-presets-modes.js): named bookmarks of
## which deck look is on PRV / PGM / the editor, per screen, kept in `project.scenes.lookPresets` (deck-synced, like
## the web). Pure: the page edits the list with these and recalls through POST /api/scene/look-preset/recall.


## web uniqueLookPresetName: "Name", then "Name (2)"… (case-insensitive).
static func unique_name(presets: Array, base_name: String) -> String:
	var base := base_name.strip_edges()
	if base == "":
		base = "Look preset"
	var taken := {}
	for p in presets:
		if p is Dictionary:
			taken[str(p.get("name", "")).strip_edges().to_lower()] = true
	if not taken.has(base.to_lower()):
		return base
	for n in range(2, 1000):
		var c := "%s (%d)" % [base, n]
		if not taken.has(c.to_lower()):
			return c
	return "%s %d" % [base, Time.get_ticks_msec()]


## The items a save captures: for each main, the look on that bus (`buses[main]` = {prv, pgm}) or the open look.
static func capture_items(source: String, mains: Array, buses: Dictionary, editing_id: String) -> Array:
	var out := []
	for m in mains:
		var bus: Dictionary = buses.get(int(m), {})
		var sid := ""
		if source == "prv":
			sid = str(bus.get("prv", ""))
		elif source == "pgm":
			sid = str(bus.get("pgm", ""))
		elif source == "editing":
			sid = editing_id
		if sid != "":
			out.append({"mainIdx": int(m), "sceneId": sid, "sourceKind": source})
	return out


## web sceneStateSaveLookPreset: a new preset (with the legacy single-look fields from the first item), or {} if empty.
static func make_preset(presets: Array, name: String, items: Array, id: String, now_ms: int) -> Dictionary:
	if name.strip_edges() == "" or items.is_empty():
		return {}
	var first: Dictionary = items[0]
	return {"id": id, "name": unique_name(presets, name), "createdAt": now_ms, "items": items.duplicate(true),
		"sceneId": first.sceneId, "sourceKind": first.sourceKind, "targetMain": first.mainIdx}


## web sceneStateOverwriteLookPreset: same source kind, current buses. False = nothing valid to capture.
static func overwrite(preset: Dictionary, items: Array, now_ms: int) -> bool:
	if items.is_empty():
		return false
	var first: Dictionary = items[0]
	preset.items = items.duplicate(true)
	preset.sceneId = first.sceneId
	preset.sourceKind = first.sourceKind
	preset.targetMain = first.mainIdx
	preset.createdAt = now_ms
	return true


static func remove(presets: Array, id: String) -> bool:
	for i in presets.size():
		if presets[i] is Dictionary and str(presets[i].get("id", "")) == id:
			presets.remove_at(i)
			return true
	return false


## The mains a preset covers (web card "· mains 1, 2" / "· main 1"), 0-based.
static func mains_of(preset: Dictionary) -> Array:
	var out := []
	for it in preset.get("items", []):
		if it is Dictionary and not out.has(int(it.get("mainIdx", 0))):
			out.append(int(it.get("mainIdx", 0)))
	if out.is_empty() and preset.has("targetMain"):
		out.append(int(preset.targetMain))
	return out


static func source_label(kind: String) -> String:
	match kind:
		"prv": return "PRV"
		"pgm": return "PGM"
		"editing": return "Open look"
	return "—"


## Card meta line: "PRV · mains 1, 2" / "PGM · main 1", plus "· look missing".
static func meta_line(preset: Dictionary, look_exists: bool) -> String:
	var mains := mains_of(preset)
	var hint := ""
	if (preset.get("items", []) as Array).size() > 1:
		hint = " · mains " + ", ".join(mains.map(func(m: int) -> String: return str(m + 1)))
	elif preset.get("targetMain") is float or preset.get("targetMain") is int:
		hint = " · main %d" % (int(preset.targetMain) + 1)
	return source_label(str(preset.get("sourceKind", ""))) + hint + ("" if look_exists else " · look missing")


## web isLoadedOnPrv: every item's look is the one on its screen's PRV now.
static func loaded_on_prv(preset: Dictionary, buses: Dictionary) -> bool:
	var items: Array = preset.get("items", [])
	if items.is_empty():
		return str(preset.get("sceneId", "")) != "" and str(preset.get("sceneId", "")) == str((buses.get(int(preset.get("targetMain", 0)), {}) as Dictionary).get("prv", ""))
	for it in items:
		if not (it is Dictionary) or str(it.get("sceneId", "")) != str((buses.get(int(it.get("mainIdx", 0)), {}) as Dictionary).get("prv", "")):
			return false
	return true
