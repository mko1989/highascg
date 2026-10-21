extends RefCounted
## WO-653 — the clip size per look layer for the editor's boxes (layer_fit_math.gd), asked once per source from the
## server (POST /api/scene/layer-fit: the same probe the take uses). `changed` fires when an answer lands.

signal changed

const F := preload("res://features/live/layer_fit_math.gd")

var _res := {}  # source value → Vector2 (ZERO = unknown)


func shown_fill(scene_id: String, main: int, l: Dictionary, canvas: Vector2) -> Dictionary:
	if F.stretch_mode(l) == "stretch" or not F.refits(l):
		return l.fill if l.get("fill") is Dictionary else {"x": 0.0, "y": 0.0, "scaleX": 1.0, "scaleY": 1.0}
	var key := str((l.source as Dictionary).get("value", "")) if l.get("source") is Dictionary else ""
	if not _res.has(key):
		_res[key] = Vector2.ZERO
		_ask(key, scene_id, main, l)
	return F.shown_fill(l, _res[key], canvas)


func _ask(key: String, scene_id: String, main: int, l: Dictionary) -> void:
	var res: Dictionary = await Api.post_json("/api/scene/layer-fit", {"sceneId": scene_id,
		"layerNumber": int(l.get("layerNumber", 0)), "contentFit": str(l.get("contentFit", "native")), "mainIdx": main})
	var cr: Variant = (res.data as Dictionary).get("contentResolution") if res.ok and res.data is Dictionary else null
	if cr is Dictionary and float(cr.get("w", 0)) > 0 and float(cr.get("h", 0)) > 0:
		_res[key] = Vector2(float(cr.w), float(cr.h))
		changed.emit()
