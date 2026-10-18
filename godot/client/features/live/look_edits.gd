extends RefCounted
## WO-600 I — transition edits on the project's `scenes` envelope, same results as the web SceneState
## (client/lib/scene-state.js setGlobalDefaultTransition / applyGlobalDefaultToAllLooks,
## scene-state-layer-ops.js setDefaultTransition). Pure: callers persist (deck sync + autosave).

const T := preload("res://features/live/transitions.gd")
const DeckModel := preload("res://features/live/deck_model.gd")


## {...defaultTransition(), ...current, ...t}
static func set_global_default(root: Dictionary, t: Dictionary) -> Dictionary:
	var g := T.default_transition()
	if root.get("globalDefaultTransition") is Dictionary:
		g.merge(root.globalDefaultTransition, true)
	g.merge(t, true)
	root["globalDefaultTransition"] = g
	return g


static func set_look_transition(root: Dictionary, scene_id: String, t: Dictionary) -> bool:
	for s in root.get("scenes", []):
		if s is Dictionary and str(s.get("id", "")) == scene_id:
			var d := T.default_transition()
			if s.get("defaultTransition") is Dictionary:
				d.merge(s.defaultTransition, true)
			d.merge(t, true)
			s["defaultTransition"] = d
			return true
	return false


## Web rule: with 2+ mains only the active main's deck (activeScreenIndex) gets it, else every look.
static func apply_default_to_all(root: Dictionary, screen_count: int) -> int:
	var g := T.default_transition()
	if root.get("globalDefaultTransition") is Dictionary:
		g.merge(root.globalDefaultTransition, true)
	var scenes: Array = root.get("scenes", [])
	var targets := scenes
	if screen_count >= 2:
		targets = DeckModel.scenes_for_main(scenes, int(root.get("activeScreenIndex", 0)))
	var ids := {}
	for s in targets:
		ids[str(s.get("id", ""))] = true
	var n := 0
	for s in scenes:
		if s is Dictionary and ids.has(str(s.get("id", ""))):
			s["defaultTransition"] = g.duplicate()
			n += 1
	return n


## Short card text: "MIX 25 fr", "MIX auto", "CUT".
static func short_label(t: Variant, fps: float) -> String:
	if not (t is Dictionary):
		return ""
	var ty := T.migrate_type((t as Dictionary).get("type"))
	if ty == "" or ty == "CUT":
		return "CUT"
	var d: Variant = (t as Dictionary).get("duration")
	var dur := ("auto %d fr" % T.resolve_duration(d, fps)) if T.is_auto_duration(d) else ("%d fr" % T.resolve_duration(d, fps))
	return "%s %s" % [T.LABELS.get(ty, ty), dur]


## web scene-state-layer-logic.js reorderLayers: sort by layerNumber, move visual index, renumber from 10 step 1.
## Returns the new array or null when nothing changes (same contract as the JS).
static func reorder_layers(layers: Array, from_i: int, to_i: int, first := 10, step := 1) -> Variant:
	var sorted := layers.duplicate()
	sorted.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return float(a.get("layerNumber", 0)) < float(b.get("layerNumber", 0)))
	var n := sorted.size()
	if from_i < 0 or from_i >= n or to_i < 0 or to_i >= n or from_i == to_i:
		return null
	var item: Variant = sorted.pop_at(from_i)
	sorted.insert(to_i, item)
	var ln := first
	for l in sorted:
		l["layerNumber"] = ln
		ln += step
	return sorted
