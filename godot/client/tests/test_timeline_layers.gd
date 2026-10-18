extends RefCounted
## Timeline layer ops — web lib/timeline-state.js reorderLayer / insertLayerBelow / removeLayer / updateLayer and
## timeline-canvas-render.js applyLayerDividerMouseMove.

const L := preload("res://features/timeline/timeline_layers.gd")
var t


func _tl() -> Dictionary:
	return {"layers": [{"id": "a", "name": "A", "clips": []}, {"id": "b", "name": "B", "clips": []}, {"id": "c", "name": "", "clips": []}],
		"layerHeights": [40, 60, 80]}


static func _ids(tl: Dictionary) -> Array:
	return tl.layers.map(func(l: Dictionary) -> String: return str(l.id))


func test_reorder() -> void:
	var tl := _tl()
	t.ok(L.reorder(tl, 0, 2), "moved")
	t.eq(_ids(tl), ["b", "c", "a"])
	t.eq(tl.layerHeights, [60, 80, 40], "heights travel with their layer")
	t.ok(L.reorder(tl, 1, 1), "same index is a no-op success")
	t.ok(not L.reorder(tl, 0, 3) and not L.reorder(tl, -1, 0), "out of range")
	t.eq(_ids(tl), ["b", "c", "a"])


func test_insert_remove_rename() -> void:
	var tl := _tl()
	var i := L.insert_below(tl, 0)
	t.eq(i, 1, "inserted after the layer")
	t.eq([tl.layers.size(), tl.layerHeights[1], tl.layerHeights[2]], [4, 54, 60], "a default height, the rest shift")
	t.ok(str(tl.layers[1].name).begins_with("Layer "), "next free name")
	t.eq(L.insert_below(tl, -1), 4, "out of range appends")
	t.eq(tl.layerHeights.size(), 5)
	L.remove(tl, 1)
	t.eq([tl.layers.size(), tl.layerHeights.size(), tl.layerHeights[1]], [4, 4, 60], "removed with its height")
	L.remove(tl, 9)
	t.eq(tl.layers.size(), 4, "out of range ignored")
	L.rename(tl, 0, "  Top  ")
	t.eq(tl.layers[0].name, "Top", "trimmed")
	L.rename(tl, 0, "   ")
	t.eq(tl.layers[0].name, "Layer 1", "empty → Layer N")
	t.eq(L.display_name(tl, 2), "Layer 3", "unnamed shows Layer N")


func test_divider_heights() -> void:
	t.eq(L.divider_heights([54, 54, 54], 0, 10, false), [64, 44, 54], "trade with the layer below")
	t.eq(L.divider_heights([54, 54, 54], 0, -100, false), [28, 80, 54], "clamped at MIN, sum kept")
	t.eq(L.divider_heights([60, 120], 0, -10, false), [60, 120], "partner at MAX holds")
	t.eq(L.divider_heights([100, 100], 0, 50, false), [120, 80], "clamped at MAX")
	t.eq(L.divider_heights([110, 30], 0, 30, false), [112, 28], "partner at MIN caps the grow")
	t.eq(L.divider_heights([54, 100, 30], 1, 7, true), [61, 107, 37], "Shift: all grow")
	t.eq(L.divider_heights([54, 115, 30], 1, -10, true), [44, 105, 28], "Shift: each clamped")
