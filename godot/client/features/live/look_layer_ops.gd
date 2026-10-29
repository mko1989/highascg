extends RefCounted
## Look editor layer helpers kept out of look_editor.gd (500-line cap). Pure, tests headless.
## WO-657: Mirror copy — a copy of a layer mirrored across the canvas's vertical centre line.

const LR := preload("res://features/live/layer_rect_math.gd")
const C := preload("res://features/live/compose_math.gd")
const FIRST := 10  # web scene-state-helpers.js LOOK_LAYER_FIRST / LOOK_LAYER_MAX
const MAX := 99


## Lowest free layer number ≥ 10 (web nextLayerNumber, WO-160); -1 when the look is full.
static func next_layer_number(layers: Array) -> int:
	var used := {}
	for l in layers:
		if l is Dictionary:
			used[int(l.get("layerNumber", 0))] = true
	for n in range(FIRST, MAX + 1):
		if not used.has(n):
			return n
	return -1


## `layer` copied onto the next free number with what Caspar SHOWS (`shown` = WO-653 shown fill, anchored at the raw
## x) mirrored left↔right: the visible (cropped) rect's x flips about the centre line, rotation negates. The raw fill
## size stays (the server refits it the same way), only x moves. {} when the look is full.
static func mirror_copy(layers: Array, layer: Dictionary, shown: Dictionary) -> Dictionary:
	var n := next_layer_number(layers)
	if n < 0:
		return {}
	var d: Dictionary = layer.duplicate(true)
	d["layerNumber"] = n
	var f: Dictionary = LR.fill_of(layer).duplicate()
	var crop: Variant = LR.crop_of(layer)
	var c: Dictionary = crop if crop != null else {"left": 0.0, "right": 1.0}
	var sw := float(shown.get("scaleX", f.get("scaleX", 1.0)))
	var vis_x := float(f.get("x", 0.0)) + float(c.left) * sw
	var vis_w := (float(c.right) - float(c.left)) * sw
	f["x"] = (1.0 - vis_x - vis_w) - float(c.left) * sw
	d["fill"] = f
	if layer.get("rotation") != null and float(layer.rotation) != 0.0:
		d["rotation"] = -float(layer.rotation)
	return d


## Media: the file name; live / template sources (WO-622): their label ("DeckLink 2", not "5-2"), as the web layer row.
static func layer_name(src: Dictionary) -> String:
	var label := str(src.get("label", ""))
	if str(src.get("type", "media")) != "media" and label != "":
		return label
	var seg := str(src.get("value", "")).replace("\\", "/").split("/", false)
	return seg[seg.size() - 1] if not seg.is_empty() else str(src.get("value", ""))


## WO-766 (owner 25.10: "add a layer to a look by draging media onto the layers list"): the sources a drop onto the
## compose frame or the layer list adds, one layer each — a single source or a multi-select drag ({type:"multi"}),
## never an effect or a playlist row (web isDraggableLayerSourcePayload).
static func drop_sources(data: Variant) -> Array:
	if not data is Dictionary:
		return []
	var d: Dictionary = data
	var items: Array = d.items if d.get("type") == "multi" and d.get("items") is Array else [d]
	return items.filter(func(s: Variant) -> bool: return s is Dictionary and str(s.get("value", "")) != "" \
		and str(s.get("type", "")) != "effect" and not s.has("playlist_row"))


## The topmost layer showing something whose box (`rect_of(layer)`, turned by its rotation about the box centre like
## Caspar, WO-635) holds `at`; -1 = none. The frame's click-to-select and WO-816's drop-to-exchange share it.
static func layer_at(layers: Array, rect_of: Callable, at: Vector2) -> int:
	for i in range(layers.size() - 1, -1, -1):  # topmost first
		var l: Variant = layers[i]
		if not (l is Dictionary and l.get("source") is Dictionary and str(l.source.get("value", "")) != ""):
			continue
		var r: Rect2 = rect_of.call(l)
		var deg := float(l.get("rotation", 0.0)) if l.get("rotation") != null else 0.0
		if r.has_point(C.layer_xform(r, deg).affine_inverse() * at):
			return i
	return -1
