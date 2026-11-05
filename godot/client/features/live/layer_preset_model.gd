extends RefCounted
## WO-952 — the "Layer presets" tab's list logic, pure (tests load it without autoloads). The records are the WO-601
## ones: `project.scenes.layerPresets = [{id, name, data}]`, `data` = layer_style_model.gd style_data (everything
## but the source), so a preset applies to any media. This adds what the tab needs on top: a one-line summary, a
## drag payload that carries the style itself, rename / overwrite / duplicate / remove.

const S := preload("res://features/live/layer_style_model.gd")
const T := preload("res://features/live/transitions.gd")
const DRAG_TYPE := "layer_preset"


static func find(list: Array, id: String) -> Dictionary:
	for p in list:
		if p is Dictionary and str(p.get("id", "")) == id:
			return p
	return {}


static func _pct(v: Variant) -> String:
	return "%d%%" % roundi(float(v) * 100.0)


## What the preset changes, in a line (the card's second row): box, opacity, rotation, effects, transition, extras.
static func summary(data: Variant) -> String:
	if not data is Dictionary:
		return ""
	var d: Dictionary = data
	var parts: Array[String] = []
	if d.get("fill") is Dictionary:
		var f: Dictionary = d.fill
		var x := float(f.get("x", 0))
		var y := float(f.get("y", 0))
		var sx := float(f.get("scaleX", 1))
		var sy := float(f.get("scaleY", 1))
		if is_equal_approx(x, 0) and is_equal_approx(y, 0) and is_equal_approx(sx, 1) and is_equal_approx(sy, 1):
			parts.append("Full frame")
		else:
			parts.append("%s×%s at %s, %s" % [_pct(sx), _pct(sy), _pct(x), _pct(y)])
	if d.get("opacity") != null and float(d.opacity) < 0.999:
		parts.append("opacity " + _pct(d.opacity))
	if d.get("rotation") != null and absf(float(d.rotation)) > 0.001:
		parts.append("%s°" % str(snappedf(float(d.rotation), 0.1)))
	var fx: Array = d.effects if d.get("effects") is Array else []
	if not fx.is_empty():
		parts.append(", ".join(fx.map(func(e: Variant) -> String: return str(e.get("type", "?")).replace("_", " ") if e is Dictionary else "?")))
	if d.get("transition") is Dictionary and str(d.transition.get("type", "")) != "":
		var tr: Dictionary = d.transition
		var dur := "auto" if T.is_auto_duration(tr.get("duration")) else "%df" % int(float(tr.get("duration", 0)))
		parts.append("%s %s" % [str(tr.type), dur])
	if d.get("fadeOnEnd") is Dictionary and d.fadeOnEnd.get("enabled") == true:
		parts.append("fade at end")
	if d.get("pipOverlays") is Array and not (d.pipOverlays as Array).is_empty():
		parts.append("PIP overlay")
	if d.get("loop") == true:
		parts.append("loop")
	if d.get("muted") == true:
		parts.append("muted")
	elif d.get("volume") != null and float(d.volume) < 0.999:
		parts.append("volume " + _pct(d.volume))
	if str(d.get("contentFit", "")) != "":
		parts.append("fit: " + str(d.contentFit))
	return " · ".join(parts) if not parts.is_empty() else "Layer defaults"


## The card's drag data. It carries the style, so the look editor's drop applies it without reading the project.
static func drag_payload(p: Dictionary) -> Dictionary:
	return {"type": DRAG_TYPE, "id": str(p.get("id", "")), "name": str(p.get("name", "")), "data": (p.get("data", {}) as Dictionary).duplicate(true) if p.get("data") is Dictionary else {}}


static func is_drag(data: Variant) -> bool:
	return data is Dictionary and str(data.get("type", "")) == DRAG_TYPE and data.get("data") is Dictionary


## A new record from a layer (the row's "Save preset…" and the tab's Save share it). {} when the name is blank.
static func make(list: Array, preset_name: String, layer: Dictionary, id: String) -> Dictionary:
	if preset_name.strip_edges() == "" or layer.is_empty():
		return {}
	return {"id": id, "name": S.unique_name(list, preset_name), "data": S.style_data(layer)}


## Rename: unique among the others (its own old name does not count). false = no such preset or a blank name.
static func rename(list: Array, id: String, new_name: String) -> bool:
	var p := find(list, id)
	if p.is_empty() or new_name.strip_edges() == "":
		return false
	p["name"] = S.unique_name(list.filter(func(q: Variant) -> bool: return q != p), new_name)
	return true


static func overwrite(list: Array, id: String, layer: Dictionary) -> bool:
	var p := find(list, id)
	if p.is_empty() or layer.is_empty():
		return false
	p["data"] = S.style_data(layer)
	return true


## A copy right after the original, named "<name> (2)" …; returns it ({} = no such preset).
static func duplicate_preset(list: Array, id: String, new_id: String) -> Dictionary:
	var p := find(list, id)
	if p.is_empty():
		return {}
	var c := {"id": new_id, "name": S.unique_name(list, str(p.get("name", ""))), "data": (p.get("data", {}) as Dictionary).duplicate(true) if p.get("data") is Dictionary else {}}
	list.insert(list.find(p) + 1, c)
	return c


static func remove(list: Array, id: String) -> bool:
	var p := find(list, id)
	if p.is_empty():
		return false
	list.erase(p)
	return true

