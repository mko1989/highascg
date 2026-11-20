extends RefCounted
## WO-653 — the clip size per look layer for the editor's boxes (layer_fit_math.gd), asked once per source from the
## server (POST /api/scene/layer-fit: the same probe the take uses). `changed` fires when an answer lands.
## The request carries the layer's source: a layer dropped a moment ago is not in the server's copy of the look until
## the autosave lands, and that 404 used to be kept as "unknown" — the box was drawn 16:9 (and moved, snapped and
## resized as 16:9) for the rest of the session. A failed ask is retried with backoff instead.

signal changed

const F := preload("res://features/live/layer_fit_math.gd")
const RETRY_S := [1.0, 2.0, 4.0, 8.0, 16.0, 30.0]

var _res := {}  # source value → Vector2 (ZERO = unknown)


func shown_fill(scene_id: String, main: int, l: Dictionary, canvas: Vector2) -> Dictionary:
	if F.stretch_mode(l) == "stretch" or not F.refits(l):
		return l.fill if l.get("fill") is Dictionary else {"x": 0.0, "y": 0.0, "scaleX": 1.0, "scaleY": 1.0}
	var key := str((l.source as Dictionary).get("value", "")) if l.get("source") is Dictionary else ""
	if not _res.has(key):
		_res[key] = Vector2.ZERO
		_ask(key, scene_id, main, l.duplicate(true))
	return F.shown_fill(l, _res[key], canvas)


## The server's request body for `l` (pure; tests).
static func ask_body(scene_id: String, main: int, l: Dictionary) -> Dictionary:
	var body := {"sceneId": scene_id, "layerNumber": int(l.get("layerNumber", 0)), "contentFit": str(l.get("contentFit", "native")), "mainIdx": main}
	if l.get("source") is Dictionary:
		body["source"] = l.source
	return body


func _ask(key: String, scene_id: String, main: int, l: Dictionary) -> void:
	for attempt in RETRY_S.size() + 1:
		var res: Dictionary = await Api.post_json("/api/scene/layer-fit", ask_body(scene_id, main, l))
		var cr: Variant = (res.data as Dictionary).get("contentResolution") if res.ok and res.data is Dictionary else null
		if cr is Dictionary and float(cr.get("w", 0)) > 0 and float(cr.get("h", 0)) > 0:
			_res[key] = Vector2(float(cr.w), float(cr.h))
			changed.emit()
			return
		if attempt >= RETRY_S.size() or not _res.has(key):
			return
		await Engine.get_main_loop().create_timer(RETRY_S[attempt]).timeout
