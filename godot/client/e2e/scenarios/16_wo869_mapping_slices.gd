extends "res://e2e/e2e_scenario.gd"
## WO-869 — mapping-node slices, walked as the operator does it: a PGM destination cabled into a mapping node whose
## Output 1 goes to a GPU head; the node page's slice section (no per-output Src fields any more); "Edit slices" puts
## the input and output canvases in the Devices tab centre; two slices drawn on the input picture with real drags;
## on the output: move one, rotate it with the knob, keystone a corner in Warp mode, flip it; numbers typed in the
## Inspector (maths, gibberish reverts — RULES.md); Done brings the panels back. After every gesture the server's
## stored slices (GET /api/device-view) are the truth, and the planner reports a slice window for Output 1.

var tab: Node
var dest := ""
var node := ""
var ed: Control  # slice_editor.gd
var src_cv: Control
var dst_cv: Control


func _graph(d: Variant) -> Dictionary:
	return (d as Dictionary).get("graph", {}) if d is Dictionary else {}


func _slices(d: Variant) -> Array:
	for dev in _graph(d).get("devices", []):
		if str(dev.get("id")) == node:
			return dev.get("settings", {}).get("slices", [])
	return []


func _backend(d: Variant, out_id: String) -> String:
	for p in (d as Dictionary).get("mappingSlicePlans", []) if d is Dictionary else []:
		if str(p.get("nodeId")) == node:
			for o in p.get("outputs", []):
				if str(o.get("outputId")) == out_id:
					return str(o.get("backend"))
	return ""


## Canvas-local raster px (input or output) → root-viewport point.
func _at(cv: Control, p: Vector2) -> Vector2:
	var f: Dictionary = cv.call("_fit")
	var sc := cv.get_global_transform_with_canvas().get_scale()
	return ui.screen_rect(cv).position + (f.off + p * f.scale) * sc


func _flow() -> RefCounted:
	return tab.get("_mapc").get("slices")


func _field(key: String) -> LineEdit:
	for le in ui.all("LineEdit", null, false):
		if (le as LineEdit).get_meta("key", "") == key:
			return le
	return null


func _wait_saved(n0: int) -> String:
	return "" if await ui.wait_for(func() -> bool: return int(_flow().saves) > n0, 8.0) else "the edit was never saved"


func run() -> void:
	await step("Setup: PGM destination → mapping node → Output 1 on GPU P1", func() -> String:
		await ui.tab("Devices")
		tab = ui.root.shell.tabs.get_node("Devices")
		var r: Dictionary = await api("/api/device-view")  # the pixel-map fixture seeds PGM/PRV 1 with a test picture
		if (r.data as Dictionary).get("screenDestinations", {}).get("destinations", []).is_empty():
			r = await post("/api/device-view", {"addDestination": {"type": "pgm_only", "mainScreenIndex": 0}})
			if not r.ok:
				return "addDestination: %s" % r.get("error")
		r = await post("/api/device-view", {"addMappingNode": true})
		if not r.ok:
			return "addMappingNode: %s" % r.get("error")
		var why: String = await await_api("/api/device-view", func(d: Variant) -> bool:
			var ds: Array = d.get("screenDestinations", {}).get("destinations", [])
			dest = str(ds[0].id) if not ds.is_empty() else ""
			for dev in _graph(d).get("devices", []):
				if dev.get("role") == "pixel_mapping":
					node = str(dev.id)
			return dest != "" and node != "", "no destination / mapping node")
		if why != "":
			return why
		for e in [["dst_in_" + dest, node + "_in"], [node + "_out_1", "gpu_p1"]]:
			r = await post("/api/device-view", {"addEdge": {"sourceId": e[0], "sinkId": e[1]}})
			if not r.ok or (r.data is Dictionary and r.data.get("error")):
				return "addEdge %s → %s: %s" % [e[0], e[1], r.get("error", r.data)]
		await tab.refresh()
		return ""
	)
	await step("The node page has the slice section, no Src fields", func() -> String:
		var card: Control = await ui.wait_for(func() -> Variant:
			for c in ui.all("PanelContainer", tab.get("_maps"), true):
				if (c as Control).tooltip_text.begins_with("Click to edit this mapping node"):
					return c
			return null, 8.0)
		var why: String = await ui.click(card)
		if why != "":
			return why
		var edit: BaseButton = await ui.wait_for(func() -> Variant: return ui.button("Edit slices"), 8.0)
		if edit == null:
			return "no Edit slices button on the node page"
		if ui.find("Label", "Src X") != null:
			return "the per-output Src X field is still on the page"
		return expect(ui.find("Label", "Output 1: Not cabled", null, false) == null, "Output 1 is cabled to a GPU head but reads Not cabled")
	)
	await step("Edit slices → the two canvases take the centre", func() -> String:
		var why: String = await ui.click(ui.button("Edit slices"))
		if why != "":
			return why
		ed = tab.get("_slices")
		src_cv = ed.get("src")
		dst_cv = ed.get("dst")
		await ui.frames(4)
		if not (ui.shown(ed) and ui.shown(src_cv) and ui.shown(dst_cv)):
			return "the slice editor is not shown"
		if tab.get("_body").visible:
			return "the device panels are still shown under the editor"
		var pic: Variant = await ui.wait_for(func() -> Variant: return src_cv.call("_picture"), 10.0)
		return expect(pic != null, "the input canvas never showed the feed's picture (%s)" % _flow().video_role())
	)
	await step("Draw two slices on the input (snapped to 8 px)", func() -> String:
		for r in [[Vector2(100, 60), Vector2(900, 560)], [Vector2(1000, 300), Vector2(1700, 900)]]:
			var n0 := int(_flow().saves)
			var why: String = await ui.press_drag(src_cv, _at(src_cv, r[0]), _at(src_cv, r[1]))
			if why == "":
				why = await _wait_saved(n0)
			if why != "":
				return why
		var got: Array = []  # filled in place: a lambda cannot rebind an outer local
		var why2: String = await await_api("/api/device-view", func(d: Variant) -> bool:
			got.clear()
			got.append_array(_slices(d))
			return got.size() == 2, "the server does not hold 2 slices")
		if why2 != "":
			return why2
		for s in got:
			for k in ["x", "y", "w", "h"]:
				if int(s.src[k]) % 8 != 0:
					return "src %s not on the 8 px grid: %s" % [k, s.src]
		var s0: Dictionary = got[0]
		if absi(int(s0.src.x) - 100) > 8 or absi(int(s0.src.w) - 800) > 16:
			return "slice 1 src %s is not the dragged 100,60 → 900,560" % s0.src
		return expect(int(s0.dst.rect.w) == int(s0.src.w), "a drawn slice should land 1:1 (dst %s)" % s0.dst.rect)
	)
	await step("Two slices on the GPU head → a slice window (planner)", func() -> String:
		return await await_api("/api/device-view", func(d: Variant) -> bool: return _backend(d, "out_1") == "screen-slices",
			"Output 1 is not planned as screen-slices")
	)
	await step("Output canvas: move the selected slice by dragging its body", func() -> String:
		var s: Dictionary = _flow().selected()
		if s.is_empty():
			return "no slice selected after drawing"
		var r: Dictionary = s.dst.rect
		var c := Vector2(r.x + r.w / 2.0, r.y + r.h / 2.0)
		var n0 := int(_flow().saves)
		var why: String = await ui.press_drag(dst_cv, _at(dst_cv, c), _at(dst_cv, c + Vector2(200, 120)))
		if why == "":
			why = await _wait_saved(n0)
		if why != "":
			return why
		return await await_api("/api/device-view", func(d: Variant) -> bool:
			var g: Array = _slices(d)
			return g.size() == 2 and absi(int(g[1].dst.rect.x) - (int(r.x) + 200)) <= 8 and absi(int(g[1].dst.rect.y) - (int(r.y) + 120)) <= 8,
			"slice 2 did not move by 200,120 from %s,%s" % [r.x, r.y])
	)
	await step("Rotate with the knob", func() -> String:
		var hs: Dictionary = dst_cv.call("_handles", _flow().selected(), dst_cv.call("_fit"))
		var sc := dst_cv.get_global_transform_with_canvas().get_scale()
		var knob: Vector2 = ui.screen_rect(dst_cv).position + hs.knob * sc
		var top: Vector2 = ui.screen_rect(dst_cv).position + hs.top * sc
		var n0 := int(_flow().saves)
		var why: String = await ui.press_drag(dst_cv, knob, knob + (knob - top).rotated(PI / 2.0) * 3.0)
		if why == "":
			why = await _wait_saved(n0)
		if why != "":
			return why
		return await await_api("/api/device-view", func(d: Variant) -> bool:
			var g: Array = _slices(d)
			return g.size() == 2 and absf(float(g[1].dst.rotation)) > 20.0, "slice 2 was not rotated")
	)
	await step("Warp mode: drag a corner diamond (keystone)", func() -> String:
		var why: String = await ui.click(ed.find_child("Mode_warp", true, false))
		if why != "":
			return why
		var hs: Dictionary = dst_cv.call("_handles", _flow().selected(), dst_cv.call("_fit"))
		var sc := dst_cv.get_global_transform_with_canvas().get_scale()
		var corner: Vector2 = ui.screen_rect(dst_cv).position + hs.warp[1] * sc
		var n0 := int(_flow().saves)
		why = await ui.press_drag(dst_cv, corner, corner + Vector2(-30, 25))
		if why == "":
			why = await _wait_saved(n0)
		if why != "":
			return why
		return await await_api("/api/device-view", func(d: Variant) -> bool:
			var g: Array = _slices(d)
			return g.size() == 2 and (absf(float(g[1].dst.warp[1][0])) > 4.0 or absf(float(g[1].dst.warp[1][1])) > 4.0),
			"corner 2 of slice 2 has no warp")
	)
	await step("Flip H from the editor header", func() -> String:
		var n0 := int(_flow().saves)
		var why: String = await ui.click(ui.button("Flip H", ed))
		if why == "":
			why = await _wait_saved(n0)
		if why != "":
			return why
		return await await_api("/api/device-view", func(d: Variant) -> bool:
			var g: Array = _slices(d)
			return g.size() == 2 and g[1].dst.flipH == true, "slice 2 is not flipped")
	)
	await step("Inspector numbers: Dst W = 960/2 → 480; 12abc reverts", func() -> String:
		var le := _field("dst.rect.w")
		if le == null:
			return "no Dst W field for the selected slice"
		await ui.reveal(le)
		var n0 := int(_flow().saves)
		var why: String = await ui.type_into(le, "960/2")
		if why == "":
			why = await _wait_saved(n0)
		if why != "":
			return why
		if le.text != "480":
			return "Dst W shows %s after 960/2" % le.text
		why = await ui.type_into(le, "12abc")
		if why != "":
			return why
		if le.text != "480":
			return "gibberish was not reverted (%s)" % le.text
		return await await_api("/api/device-view", func(d: Variant) -> bool:
			var g: Array = _slices(d)
			return g.size() == 2 and int(g[1].dst.rect.w) == 480, "the server's slice 2 width is not 480")
	)
	await step("Done → the device panels come back", func() -> String:
		var why: String = await ui.click(ui.button("Done", ed))
		if why != "":
			return why
		await ui.frames(3)
		return expect(not ed.visible and tab.get("_body").visible, "the editor is still shown")
	)
