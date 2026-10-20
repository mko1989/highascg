extends RefCounted
## WO-605 slice 9b — gpu_entries.gd / gpu_layout.gd against the web GPU port lib (buildGpuSelectablePortEntries,
## entryToRearPanelGpuItem, the markers' "Disconnected" folder test, layoutItemsFromGpuEntries,
## gpuLayoutItemsToPhysicalTopology, buildGpuLayoutItemsFromLive, collectGpuPortNameOptions) run under Node on
## the box's GET /api/device-view GPU block and nine variants of it, with and without saved layout prefs:
## tests/golden/devices_gpu_layout.json.

const L := preload("res://features/devices/gpu_layout.gd")
var t
var _g: Dictionary


func _golden() -> Dictionary:
	if _g.is_empty():
		_g = JSON.parse_string(FileAccess.get_file_as_string("res://tests/golden/devices_gpu_layout.json"))
	return _g


static func _norm(v: Variant) -> Variant:
	if v is int:
		return float(v)
	if v is Dictionary:
		var o := {}
		for k in v:
			if k != "physicalPort":
				o[k] = _norm(v[k])
		return o
	if v is Array:
		return v.map(func(x: Variant) -> Variant: return _norm(x))
	return v


func _each(got: Array, want: Array, what: String) -> void:
	t.eq(got.size(), want.size(), what + ": count")
	for i in mini(got.size(), want.size()):
		t.eq(_norm(got[i]), _norm(want[i]), "%s %d" % [what, i])


func test_cases() -> void:
	for c in _golden().cases:
		var fx: Dictionary = c.fx
		var prefs := L.prefs_of(c.prefs if c.prefs is Array else [])
		var list := L.entries(fx.live, fx.suggested, fx.graph, c.saved, prefs)
		_each(list, c.entries, c.name + ": entry")
		var items := L.rear_items(fx.live, list)
		_each(items, c.items, c.name + ": rear item")
		t.eq(items.map(func(it: Dictionary) -> bool: return L.in_folder(it)), c.folder, c.name + ": Disconnected folder")
		var layout := L.layout_items(list)
		_each(layout, c.layout, c.name + ": layout item")
		t.eq(_norm(L.to_topology(layout)), _norm(c.topology), c.name + ": topology")
		_each(L.items_from_live(fx.live, fx.suggested, c.saved), c.fromLive, c.name + ": items from live")
		t.eq(L.port_options(fx.live), c.options, c.name + ": port options")


func test_odd_rows() -> void:
	t.eq(_norm(L.to_topology([{"id": "gpu_p3__DP_6", "pairs": ["DP-6", null, "DP-7"]}, {"id": "gpu_x"}, {"id": "GPU_P1", "pairs": []}, null])),
		_norm(_golden().topologyOdd), "topology: split id, no gpu id, upper case, null row")
	t.eq(L.port_options({"gpu": {}}), _golden().optionsEmpty, "port options without any GPU data")
