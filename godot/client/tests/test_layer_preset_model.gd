extends RefCounted
## WO-952 — the Layer presets tab's list logic (layer_preset_model.gd) and a preset card dropped on a look layer
## (look_layer_drop.gd drop_data): the style lands on that layer, its media stays.

const M := preload("res://features/live/layer_preset_model.gd")
const S := preload("res://features/live/layer_style_model.gd")
const D := preload("res://features/live/look_layer_drop.gd")
var t


class FakeEditor:
	extends RefCounted
	var scene_id := "look_test"
	var main := 0
	var _sel := -1
	var lk := {"id": "look_test", "layers": [
		{"layerNumber": 10, "source": {"type": "media", "value": "A.mp4"}, "fill": {"x": 0, "y": 0, "scaleX": 1, "scaleY": 1}},
		{"layerNumber": 20, "source": {"type": "media", "value": "B.mp4"}, "opacity": 1.0},
	]}
	var shown := []  # _select's show flag per call
	var status := ""

	func look() -> Dictionary:
		return lk

	func _layers() -> Array:
		return lk.layers

	func _select(i: int, show := true) -> void:
		_sel = i
		shown.append(show)

	func _apply_layer(p: Dictionary) -> void:
		(lk.layers[_sel] as Dictionary).merge(p, true)

	func show_status(s: String) -> void:
		status = s


func _styled() -> Dictionary:
	return {"layerNumber": 5, "source": {"value": "X.mov"}, "fill": {"x": 0.5, "y": 0.25, "scaleX": 0.5, "scaleY": 0.5}, "opacity": 0.8,
		"effects": [{"type": "chroma_key", "params": {}}], "transition": {"type": "MIX", "duration": 12}, "loop": true}


func test_summary() -> void:
	var d := S.style_data(_styled())
	t.eq(M.summary(d), "50%×50% at 50%, 25% · opacity 80% · chroma key · MIX auto · loop", "box, opacity, effect, auto transition, loop")
	t.eq(M.summary({"fill": {"x": 0, "y": 0, "scaleX": 1, "scaleY": 1}, "transition": {"type": "CUT", "duration": 0}}), "Full frame · CUT 0f")
	t.eq(M.summary({"muted": true, "fadeOnEnd": {"enabled": true, "frames": 12}, "pipOverlays": [{"type": "border"}]}), "fade at end · PIP overlay · muted")
	t.eq(M.summary({}), "Layer defaults")
	t.eq(M.summary(null), "")


func test_make_rename_overwrite_duplicate_remove() -> void:
	var list := []
	t.ok(M.make(list, "  ", _styled(), "x").is_empty(), "a blank name saves nothing")
	t.ok(M.make(list, "PIP", {}, "x").is_empty(), "no layer, nothing saved")
	var a := M.make(list, "PIP", _styled(), "a")
	t.ok(not (a.data as Dictionary).has("source"), "never the media")
	list.append(a)
	list.append(M.make(list, "pip", _styled(), "b"))
	t.eq(list[1].name, "pip (2)", "names stay unique, case-insensitive")
	t.ok(M.rename(list, "b", "Lower right"), "rename")
	t.eq(list[1].name, "Lower right")
	t.ok(M.rename(list, "a", "PIP"), "renaming to its own name keeps it (no \"(2)\")")
	t.eq(list[0].name, "PIP")
	t.ok(not M.rename(list, "a", " "), "a blank rename is refused")
	t.ok(M.overwrite(list, "a", {"opacity": 0.5}), "overwrite")
	t.eq(list[0].data.opacity, 0.5)
	var c := M.duplicate_preset(list, "a", "c")
	t.eq([c.name, list.find(c)], ["PIP (2)", 1], "the copy follows the original")
	c.data.opacity = 0.1
	t.eq(list[0].data.opacity, 0.5, "a deep copy")
	t.ok(M.remove(list, "a") and list.size() == 2 and M.find(list, "a").is_empty(), "remove")
	t.ok(not M.remove(list, "zzz"), "unknown id")


func test_drag_payload_and_drop_on_a_layer() -> void:
	var p := {"id": "p1", "name": "Small", "data": S.style_data(_styled())}
	var drag := M.drag_payload(p)
	t.ok(M.is_drag(drag) and D.can_take(drag), "the editor takes a preset card")
	t.ok(not M.is_drag({"type": "media", "value": "x"}), "media is not a preset")
	t.ok(D.can_take({"type": "media", "value": "x"}), "media still drops")
	var ed := FakeEditor.new()
	await D.drop_data(ed, null, 1, drag)
	var l: Dictionary = ed.lk.layers[1]
	t.eq([l.source.value, l.fill.scaleX, l.opacity, l.loop], ["B.mp4", 0.5, 0.8, true], "the style on L20, its media kept")
	t.eq(ed.shown, [false], "selected without taking the right column back to the Inspector")
	t.ok(ed.status.contains("L20"), ed.status)
	var ed2 := FakeEditor.new()
	await D.drop_data(ed2, null, -1, drag)
	t.ok(ed2.status.contains("Drop the preset on a layer") and ed2.lk.layers[0].fill.scaleX == 1, "off every layer, nothing selected: nothing changes")
	ed2._sel = 0
	await D.drop_data(ed2, null, -1, drag)
	t.eq(ed2.lk.layers[0].fill.scaleX, 0.5, "off every layer: the selected one")
