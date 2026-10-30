extends RefCounted
## WO-602 slice 6 — timeline layer ops, pure (web lib/timeline-state.js reorderLayer / addLayer / insertLayer /
## insertLayerBelow / removeLayer / updateLayer, timeline-canvas-render.js applyLayerDividerMouseMove). Heights live in
## `tl.layerHeights`, index-aligned with `tl.layers`, and travel with their layer.

const TM := preload("res://features/timeline/timeline_math.gd")
const TE := preload("res://features/timeline/timeline_edit.gd")
const RW := preload("res://features/timeline/timeline_rows.gd")


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
	if RW.layer_screen(ls[li]) != RW.ALL:  # WO-837: a new layer goes into the section it was added from
		layer["screenIdx"] = RW.layer_screen(ls[li])
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
## WO-837: `other` is the layer below the divider when it is not idx + 1 (sections interleave the array).
static func divider_heights(orig: Array, idx: int, dy: float, shift: bool, other := -1) -> Array:
	var j := idx + 1 if other < 0 else other
	var lo := TM.MIN_LAYER_H
	var hi := TM.MAX_LAYER_H
	if shift:
		return orig.map(func(h: Variant) -> int: return clampi(roundi(float(h) + dy), lo, hi))
	var sum := int(orig[idx]) + int(orig[j])
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
	next[j] = h1
	return next


## ── WO-837 screen sections ──

## Move layer `li` to screen section `screen` (RW.ALL = every screen: the key goes). The section is listed on the timeline.
static func set_screen(tl: Dictionary, li: int, screen: int) -> void:
	var ls: Array = tl.get("layers", [])
	if li < 0 or li >= ls.size():
		return
	if screen == RW.ALL:
		(ls[li] as Dictionary).erase("screenIdx")
	else:
		ls[li]["screenIdx"] = screen
		add_screen(tl, screen)


## Add the (empty) section for `screen` at the bottom. False when it already exists or is not a screen.
static func add_screen(tl: Dictionary, screen: int) -> bool:
	if screen < 0 or screen in RW.screens(tl):
		return false
	if not (tl.get("screens") is Array):
		tl["screens"] = []
	(tl.screens as Array).append(screen)
	return true


## Drop the section when no layer is in it. False (nothing changed) when layers still are.
static func remove_screen(tl: Dictionary, screen: int) -> bool:
	for l in tl.get("layers", []):
		if RW.layer_screen(l) == screen:
			return false
	if not (tl.get("screens") is Array) or not screen in tl.screens:
		return false
	(tl.screens as Array).erase(screen)
	return true


## A new layer at the end, in section `screen`. Returns its index.
static func add_in_section(tl: Dictionary, screen: int) -> int:
	var ls: Array = tl.get("layers", [])
	var layer := {"id": TM.uid(), "name": TE.next_layer_name(tl), "clips": []}
	ls.append(layer)
	TM.ensure_heights(tl)
	set_screen(tl, ls.size() - 1, screen)
	return ls.size() - 1


## Live layer drag: the dragged layer `li` is over display row `row` (RW.row_at). Over another layer it joins that
## layer's section and takes its place; over a divider it joins that section at the top. Returns its new index.
static func drag_over(tl: Dictionary, li: int, row: Dictionary) -> int:
	var ls: Array = tl.get("layers", [])
	if row.is_empty() or li < 0 or li >= ls.size():
		return li
	if row.kind == "layer":
		var to := int(row.li)
		if to == li:
			return li
		set_screen(tl, li, int(row.screen))
		reorder(tl, li, to)
		return to
	var sec := int(row.screen)
	if RW.layer_screen(ls[li]) == sec:
		return li
	set_screen(tl, li, sec)
	for i in ls.size():
		if i != li and RW.layer_screen(ls[i]) == sec:
			var to := i - 1 if li < i else i  # in front of the section's first layer
			reorder(tl, li, to)
			return to
	return li
