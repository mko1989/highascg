extends RefCounted
## WO-837 — GET /api/lighting/consoles into the light flags' cache (timeline_light.gd consoles). The chips show console
## names, so the canvases that asked repaint when the list lands.

const LF := preload("res://features/timeline/timeline_light.gd")

static var _redraw: Array = []


static func fetch(ci: CanvasItem = null) -> void:
	if ci != null and not ci in _redraw:
		_redraw.append(ci)
	var r: Dictionary = await Api.get_json("/api/lighting/consoles")
	if r.ok and r.data is Dictionary and r.data.get("consoles") is Array:
		LF.consoles = r.data.consoles
	_redraw = _redraw.filter(func(c: Variant) -> bool: return is_instance_valid(c))
	for c in _redraw:
		(c as CanvasItem).queue_redraw()
