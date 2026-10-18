extends RefCounted
## WO-601 — PIP overlays on a look layer, pure (client/lib/pip-overlay-registry.js + components/
## inspector-pip-overlay.js). Registry (types, templates, defaults, schemas, max stack) comes from the server,
## served from the web's own pip-overlay-registry.js (GET /api/scene/effect-registry → pipOverlays).
## Stored as layer.pipOverlays = [{type, params}], index 0 drawn behind; legacy single `pipOverlay` read too.


## getPipOverlaysFromLayer
static func from_layer(layer: Dictionary) -> Array:
	var a: Variant = layer.get("pipOverlays")
	if a is Array and not (a as Array).is_empty():
		return (a as Array).filter(func(o: Variant) -> bool: return o is Dictionary and str(o.get("type", "")) != "")
	var one: Variant = layer.get("pipOverlay")
	if one is Dictionary and str(one.get("type", "")) != "":
		return [one]
	return []


static func def_of(registry: Array, type: String) -> Dictionary:
	for d in registry:
		if d is Dictionary and str(d.get("type", "")) == type:
			return d
	return {}


## createPipOverlayInstance
static func instance(registry: Array, type: String) -> Dictionary:
	var d := def_of(registry, type)
	if d.is_empty():
		return {}
	return {"type": type, "params": (d.get("defaults", {}) as Dictionary).duplicate(true)}


## Add at the top of the stack; refused at max_stack (web disables the picker). Duplicates allowed.
static func add(list: Array, registry: Array, type: String, max_stack: int) -> Array:
	var inst := instance(registry, type)
	if inst.is_empty() or list.size() >= max_stack:
		return list
	var out := list.duplicate(true)
	out.append(inst)
	return out


static func remove(list: Array, i: int) -> Array:
	var out := list.duplicate(true)
	if i >= 0 and i < out.size():
		out.remove_at(i)
	return out


## dir −1 = earlier (behind), +1 = later (on top); out of range = unchanged.
static func move(list: Array, i: int, dir: int) -> Array:
	var j := i + dir
	if i < 0 or i >= list.size() or j < 0 or j >= list.size():
		return list
	var out := list.duplicate(true)
	var tmp: Variant = out[i]
	out[i] = out[j]
	out[j] = tmp
	return out


## Type select: same type keeps the overlay; another type = a fresh default instance.
static func set_type(list: Array, i: int, registry: Array, type: String) -> Array:
	if i < 0 or i >= list.size() or str(list[i].get("type", "")) == type:
		return list
	var inst := instance(registry, type)
	if inst.is_empty():
		return list
	var out := list.duplicate(true)
	out[i] = inst
	return out


static func set_param(list: Array, i: int, key: String, v: Variant) -> Array:
	var out := list.duplicate(true)
	if i < 0 or i >= out.size():
		return out
	var p: Dictionary = (out[i].get("params", {}) as Dictionary).duplicate() if out[i].get("params") is Dictionary else {}
	p[key] = v
	out[i]["params"] = p
	return out


## pipOverlayFieldVisible: every visibleWhen rule must hold (missing values → that field's schema default).
static func field_visible(field: Dictionary, params: Dictionary, schema: Array) -> bool:
	for r in (field.get("visibleWhen", []) if field.get("visibleWhen") is Array else []):
		var v: Variant = params.get(r.key)
		if v == null:
			for s in schema:
				if str(s.get("key", "")) == str(r.key):
					v = s.get("default")
		if r.has("min") and r.min != null and not (_num(v) >= float(r.min)):
			return false
		if r.has("equals") and not _same(v, r.equals):
			return false
	return true


static func _num(v: Variant) -> float:
	if v is float or v is int:
		return float(v)
	if v is bool:
		return 1.0 if v else 0.0
	var s := str(v)
	return s.to_float() if s.is_valid_float() else NAN


## JS strict equality on JSON values (1 === 1.0, true !== 1).
static func _same(a: Variant, b: Variant) -> bool:
	if (a is bool) != (b is bool):
		return false
	if (a is float or a is int) and (b is float or b is int):
		return float(a) == float(b)
	return typeof(a) == typeof(b) and a == b


## CSS colour → Color: #rgb, #rrggbb, #rrggbbaa, rgb(), rgba(); anything else → white.
static func parse_css(s: String) -> Color:
	var t := s.strip_edges().to_lower()
	if t.begins_with("#") and t.length() in [4, 7, 9]:
		return Color.html(t)
	if t.begins_with("rgb"):
		var inner := t.substr(t.find("(") + 1).trim_suffix(")")
		var parts := inner.split(",")
		if parts.size() >= 3:
			var a := parts[3].strip_edges().to_float() if parts.size() > 3 else 1.0
			return Color(parts[0].to_float() / 255.0, parts[1].to_float() / 255.0, parts[2].to_float() / 255.0, a)
	return Color.WHITE


## Color → CSS: opaque = #rrggbb (what the web colour input writes), translucent = rgba(r,g,b,a).
static func to_css(c: Color) -> String:
	if c.a >= 0.999:
		return "#" + c.to_html(false)
	return "rgba(%d,%d,%d,%s)" % [c.r8, c.g8, c.b8, str(snappedf(c.a, 0.01))]
