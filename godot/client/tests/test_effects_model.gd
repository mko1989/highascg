extends RefCounted
## WO-601 effects editor — golden values from the web's effect-registry.js / inspector-effects.js under node.

const E := preload("res://features/live/effects_model.gd")
## Subset of GET /api/scene/effect-registry (= web MIXER_EFFECTS), as JSON → the same Variant types the client gets.
const REG_JSON := "[{\"type\":\"brightness\",\"defaults\":{\"value\":1},\"schema\":[{\"key\":\"value\",\"type\":\"float\",\"default\":1,\"min\":0,\"max\":2}]},{\"type\":\"levels\",\"defaults\":{\"minIn\":0,\"maxIn\":1,\"gamma\":1,\"minOut\":0,\"maxOut\":1},\"schema\":[{\"key\":\"minIn\",\"type\":\"float\",\"default\":0,\"min\":0,\"max\":1,\"primary\":true},{\"key\":\"maxIn\",\"type\":\"float\",\"default\":1,\"min\":0,\"max\":1,\"primary\":true},{\"key\":\"gamma\",\"type\":\"float\",\"default\":1,\"min\":0,\"max\":4,\"primary\":true},{\"key\":\"minOut\",\"type\":\"float\",\"default\":0,\"min\":0,\"max\":1,\"primary\":false},{\"key\":\"maxOut\",\"type\":\"float\",\"default\":1,\"min\":0,\"max\":1,\"primary\":false}]},{\"type\":\"crop\",\"defaults\":{\"left\":0,\"top\":0,\"right\":1,\"bottom\":1},\"schema\":[{\"key\":\"left\",\"type\":\"float\",\"default\":0,\"min\":0,\"max\":1,\"displayAs\":\"px\",\"pxAxis\":\"w\"},{\"key\":\"top\",\"type\":\"float\",\"default\":0,\"min\":0,\"max\":1,\"displayAs\":\"px\",\"pxAxis\":\"h\"},{\"key\":\"right\",\"type\":\"float\",\"default\":1,\"min\":0,\"max\":1,\"displayAs\":\"px\",\"pxAxis\":\"w\"},{\"key\":\"bottom\",\"type\":\"float\",\"default\":1,\"min\":0,\"max\":1,\"displayAs\":\"px\",\"pxAxis\":\"h\"}]},{\"type\":\"chroma_key\",\"defaults\":{\"key\":\"None\",\"threshold\":0.34,\"softness\":0.44,\"spill\":1,\"blur\":0},\"schema\":[{\"key\":\"key\",\"type\":\"select\",\"default\":\"None\",\"primary\":true},{\"key\":\"threshold\",\"type\":\"float\",\"default\":0.34,\"min\":0,\"max\":1,\"primary\":true},{\"key\":\"softness\",\"type\":\"float\",\"default\":0.44,\"min\":0,\"max\":1,\"primary\":true},{\"key\":\"spill\",\"type\":\"float\",\"default\":1,\"min\":0,\"max\":2,\"primary\":false},{\"key\":\"blur\",\"type\":\"float\",\"default\":0,\"min\":0,\"max\":2,\"primary\":false}]}]"
var t


func _reg() -> Array:
	return JSON.parse_string(REG_JSON)


func test_instance_and_add_refuse_duplicates() -> void:
	var reg := _reg()
	t.eq(E.instance(reg, "levels"), JSON.parse_string('{"type":"levels","params":{"minIn":0,"maxIn":1,"gamma":1,"minOut":0,"maxOut":1}}'), "createEffectInstance(levels)")
	t.eq(E.instance(reg, "nope"), {}, "unknown type → nothing")
	var fx := E.add([], reg, "brightness")
	fx = E.add(fx, reg, "crop")
	t.eq(fx.map(func(e: Dictionary) -> String: return e.type), ["brightness", "crop"], "appended in order")
	t.eq(E.add(fx, reg, "brightness").size(), 2, "duplicate type refused")
	fx[0].params.value = 1.5
	var again := E.instance(reg, "brightness")
	t.eq(again.params.value, 1.0, "defaults are copied, not shared")


func test_set_param_remove_value() -> void:
	var reg := _reg()
	var fx := E.add(E.add([], reg, "levels"), reg, "chroma_key")
	var fx2 := E.set_param(fx, 1, "key", "Green")
	t.eq(fx2[1].params.key, "Green", "param set")
	t.eq(fx[1].params.key, "None", "input untouched")
	t.eq(fx2[1].params.threshold, 0.34, "other params kept")
	t.eq(E.remove(fx2, 0).map(func(e: Dictionary) -> String: return e.type), ["chroma_key"], "removed by index")
	var crop_def := E.def_of(reg, "crop")
	t.eq(E.value_of({"type": "crop", "params": {}}, crop_def.schema[2]), 1.0, "missing param → schema default")
	t.eq(E.value_of({"type": "crop", "params": {"right": 0.9}}, crop_def.schema[2]), 0.9, "stored value wins")


func test_primary_advanced_split() -> void:
	var reg := _reg()
	var keys := func(a: Array) -> String: return ",".join(a.map(func(s: Dictionary) -> String: return s.key))
	t.eq(keys.call(E.primary(E.def_of(reg, "levels"))), "minIn,maxIn,gamma", "levels primary")
	t.eq(keys.call(E.advanced(E.def_of(reg, "levels"))), "minOut,maxOut", "levels advanced")
	t.eq(keys.call(E.primary(E.def_of(reg, "chroma_key"))), "key,threshold,softness", "chroma primary")
	t.eq(keys.call(E.advanced(E.def_of(reg, "chroma_key"))), "spill,blur", "chroma advanced")
	t.eq(E.advanced(E.def_of(reg, "crop")).size(), 0, "crop: no advanced")


func test_crop_px_display() -> void:
	var crop: Array = E.def_of(_reg(), "crop").schema
	var res := Vector2i(1920, 1080)
	t.eq(E.px_dim(crop[2], res), 1920, "right edits in px of width")
	t.eq(E.px_dim(crop[1], res), 1080, "top edits in px of height")
	t.eq(E.px_dim(crop[1], Vector2i.ZERO), 0, "no resolution → fraction editing")
	t.eq(E.px_dim(E.def_of(_reg(), "brightness").schema[0], res), 0, "brightness never px")
	t.eq(E.to_px(0.9, 1920), 1728, "0.9 → 1728 px")
	t.eq(E.to_px(0.3337, 1080), 360, "rounded")
	t.ok(absf(E.from_px(1000, 1920, crop[2]) - 0.5208333333333334) < 1e-12, "1000 px → fraction")
	t.eq(E.from_px(2500, 1920, crop[2]), 1.0, "clamped to max")
