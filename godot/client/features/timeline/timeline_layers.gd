extends RefCounted
## WO-602 slice 6 — timeline layer ops, pure (web lib/timeline-state.js reorderLayer / addLayer / insertLayer /
## insertLayerBelow / removeLayer / updateLayer, timeline-canvas-render.js applyLayerDividerMouseMove). Heights live in
## `tl.layerHeights`, index-aligned with `tl.layers`, and travel with their layer.

const TM := preload("res://features/timeline/timeline_math.gd")
const TE := preload("res://features/timeline/timeline_edit.gd")


static func reorder(tl: Dictionary, from: int, to: int) -> bool:
	var ls: Array = tl.get("layers", [])
	if from < 0 or from >= ls.size() or to < 0 or to >= ls.size():
		return false
	if from == to:
		return true
	var l: Variant = ls.pop_at(from)
	ls.insert(to, l)
	if tl.get("layerHeights") is Array and (tl.layerHeights as Array).size() > from:
		var h: Variant = (tl.layerHeights as Array).pop_at(from)
		(tl.layerHeights as Array).insert(mini(to, (tl.layerHeights as Array).size()), h)
	return true


## insertLayerBelow: a new "Layer N" after `li`, or at the end when `li` is out of range. Returns its index.
static func insert_below(tl: Dictionary, li: int) -> int:
	var ls: Array = tl.get("layers", [])
	var layer := {"id": TM.uid(), "name": TE.next_layer_name(tl), "clips": []}
	TM.ensure_heights(tl)
	if li < 0 or li >= ls.size():
		ls.append(layer)
		TM.ensure_heights(tl)
		return ls.size() - 1
	ls.insert(li + 1, layer)
	(tl.layerHeights as Array).insert(li + 1, TM.DEFAULT_LAYER_H)
	return li + 1


static func remove(tl: Dictionary, li: int) -> void:
	var ls: Array = tl.get("layers", [])
	if li < 0 or li >= ls.size():
		return
	ls.remove_at(li)
	if tl.get("layerHeights") is Array and (tl.layerHeights as Array).size() > li:
		(tl.layerHeights as Array).remove_at(li)
	TM.ensure_heights(tl)


## The layer page's Name field: trimmed, empty → "Layer N".
static func rename(tl: Dictionary, li: int, name: String) -> void:
	var ls: Array = tl.get("layers", [])
	if li >= 0 and li < ls.size():
		ls[li]["name"] = name.strip_edges() if name.strip_edges() != "" else "Layer %d" % (li + 1)


static func display_name(tl: Dictionary, li: int) -> String:
	var ls: Array = tl.get("layers", [])
	var n := str(ls[li].get("name", "")) if li >= 0 and li < ls.size() else ""
	return n if n != "" else "Layer %d" % (li + 1)


## applyLayerDividerMouseMove: the divider under layer `idx` trades height with the layer below (their sum stays,
## each within [MIN, MAX]); with Shift every layer grows / shrinks by the drag.
static func divider_heights(orig: Array, idx: int, dy: float, shift: bool) -> Array:
	var lo := TM.MIN_LAYER_H
	var hi := TM.MAX_LAYER_H
	if shift:
		return orig.map(func(h: Variant) -> int: return clampi(roundi(float(h) + dy), lo, hi))
	var sum := int(orig[idx]) + int(orig[idx + 1])
	var h0 := clampi(roundi(float(orig[idx]) + dy), lo, hi)
	var h1 := sum - h0
	if h1 < lo:
		h1 = lo
		h0 = sum - h1
	elif h1 > hi:
		h1 = hi
		h0 = sum - h1
	if h0 < lo:
		h0 = lo
		h1 = sum - h0
	elif h0 > hi:
		h0 = hi
		h1 = sum - h0
	var next := orig.duplicate()
	next[idx] = h0
	next[idx + 1] = h1
	return next
