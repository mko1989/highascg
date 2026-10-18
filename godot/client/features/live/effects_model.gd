extends RefCounted
## WO-601 — look-layer mixer effects, pure (client/lib/effect-registry.js + components/inspector-effects.js).
## The registry itself (types, defaults, param schemas) comes from the server, served from the web's own
## effect-registry.js (GET /api/scene/effect-registry) — nothing about effects is re-declared here.
## Effects live in layer.effects = [{type, params}], one instance per type (web refuses duplicates).


static func def_of(registry: Array, type: String) -> Dictionary:
	for d in registry:
		if d is Dictionary and str(d.get("type", "")) == type:
			return d
	return {}


## createEffectInstance: {type, params: {...def.defaults}}; null-equivalent {} for an unknown type.
static func instance(registry: Array, type: String) -> Dictionary:
	var d := def_of(registry, type)
	if d.is_empty():
		return {}
	return {"type": type, "params": (d.get("defaults", {}) as Dictionary).duplicate(true)}


## Web "Choose effect to add…": appended at the end; a type already present is refused (returns the input).
static func add(effects: Array, registry: Array, type: String) -> Array:
	for fx in effects:
		if fx is Dictionary and str(fx.get("type", "")) == type:
			return effects
	var inst := instance(registry, type)
	if inst.is_empty():
		return effects
	var out := effects.duplicate(true)
	out.append(inst)
	return out


static func remove(effects: Array, i: int) -> Array:
	var out := effects.duplicate(true)
	if i >= 0 and i < out.size():
		out.remove_at(i)
	return out


## One param edited → {...fx, params: {...params, [key]: v}} (renderEffectParamBlock).
static func set_param(effects: Array, i: int, key: String, v: Variant) -> Array:
	var out := effects.duplicate(true)
	if i < 0 or i >= out.size() or not (out[i] is Dictionary):
		return out
	var p: Dictionary = (out[i].get("params", {}) as Dictionary).duplicate() if out[i].get("params") is Dictionary else {}
	p[key] = v
	out[i]["params"] = p
	return out


## effect.params[key] ?? schema.default
static func value_of(fx: Dictionary, schema: Dictionary) -> Variant:
	var p: Variant = fx.get("params")
	if p is Dictionary and (p as Dictionary).has(schema.key) and p[schema.key] != null:
		return p[schema.key]
	return schema.get("default")


## effectPrimarySchema / effectAdvancedSchema: `primary: false` = advanced (collapsed).
static func primary(def: Dictionary) -> Array:
	return (def.get("schema", []) as Array).filter(func(s: Dictionary) -> bool: return s.get("primary") != false)


static func advanced(def: Dictionary) -> Array:
	return (def.get("schema", []) as Array).filter(func(s: Dictionary) -> bool: return s.get("primary") == false)


## displayAs 'px' (crop, WO-158): edited as pixels of the content resolution, stored as 0–1 fractions.
## Returns 0 when the param is not shown in px (no px display, or no resolution).
static func px_dim(schema: Dictionary, content: Vector2i) -> int:
	if str(schema.get("displayAs", "")) != "px" or content.x <= 0 or content.y <= 0:
		return 0
	return content.y if str(schema.get("pxAxis", "w")) == "h" else content.x


static func to_px(v: float, dim: int) -> int:
	return roundi(v * dim)


## onChange(min(fracMax, max(fracMin, val / pxDim)))
static func from_px(px: float, dim: int, schema: Dictionary) -> float:
	return clampf(px / float(dim), float(schema.get("min", 0.0)), float(schema.get("max", 1.0)))
