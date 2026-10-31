extends RefCounted
## WO-894 — the Visuals ▸ Shader mode: the working GLSL merged over the library config, the op queue (one at a time, a pending
## value op replaced by a newer one) and the throttled recompile (at most one per window, the last value always lands), the
## controls of the SELECTED layer (another layer → its own shader, a non-shader layer → a note), the recompile of the layers
## running the shader (their clock kept), and the live slider commits. The box is a fake that rewrites `SPEED = <v>;` like the node.

const Mode := preload("res://features/visuals/visuals_shader_mode.gd")
const Sync := preload("res://features/visuals/visuals_shader_sync.gd")
const W := preload("res://features/live/shader_live_controls.gd")
const L := preload("res://features/visuals/visuals_layers.gd")
const Deck := preload("res://features/visuals/visuals_deck.gd")
var t


## The node's Shader Live for shaders "sh-a" and "sh-b": one SPEED literal each (/api/shader-live/shaders/:id[/:op]).
class FakeBox:
	extends RefCounted
	var speed := {"sh-a": 0.5, "sh-b": 0.25}
	var dirty := {}
	var gets := []
	var posts := []

	func _view(id: String) -> Dictionary:
		var v: float = speed[id]
		return {"id": id, "name": "Name " + id, "parentId": null, "dirty": dirty.get(id, false), "sections": ["Motion"],
			"controls": [{"id": "c1", "section": "Motion", "label": "Speed", "widget": "slider", "keys": ["image:0"], "hint": ""}],
			"hiddenCount": 2, "hiddenManual": 0, "presets": ["Fast"],
			"params": [{"key": "image:0", "name": "SPEED", "label": "", "passKey": "image", "deep": false, "kind": "float", "vec": 1,
				"values": [v], "min": 0.0, "max": 2.0, "step": 0.01, "desc": "", "expr": "", "context": "", "changed": dirty.get(id, false)}],
			"advanced": [{"title": "Motion", "keys": ["image:0"]}]}

	func _ok(d: Variant) -> Dictionary:
		return {"ok": true, "data": d, "error": ""}

	func get_json(path: String) -> Dictionary:
		gets.append(path)
		var p := path.split("?")
		if p[0].begins_with("/api/shaders/"):
			var lib_id := p[0].get_file()
			return _ok({"id": lib_id, "common": "", "opts": {"alpha": true}, "passes": {"image": {"source": "orig", "channels": ["audio"]}}})
		var id := p[0].get_file()
		if not speed.has(id):
			return {"ok": false, "data": null, "error": "404"}
		var v := _view(id)
		if p.size() > 1 and p[1] == "working=1":
			v["working"] = {"common": "", "passes": {"image": {"source": "const float SPEED = %s;" % speed[id]}}}
		return _ok(v)

	func post_json(path: String, body: Variant) -> Dictionary:
		posts.append([path, body.duplicate(true)])
		var parts := path.split("/")
		var id := parts[4]
		match parts[5]:
			"set":
				speed[id] = float(body.values[0])
				dirty[id] = true
			"reset":
				speed[id] = 0.5 if id == "sh-a" else 0.25
				dirty[id] = false
			"save":
				return _ok({"ok": true, "savedAs": id + "-c2", "push": null, "view": _view(id)})
		return _ok({"ok": true, "push": {"targets": 0, "errors": []}, "view": _view(id)})


func _wait(s: Sync) -> void:
	for i in 100:
		if not s._busy:
			return
		await t.create_timer(0.02).timeout


func test_merged_working_glsl() -> void:
	var lib := {"id": "x", "common": "old", "opts": {"alpha": true}, "passes": {"image": {"source": "a", "channels": ["audio"]}, "bufferA": {"source": "b"}}}
	var m := Sync.merged(lib, {"common": "", "passes": {"image": {"source": "A2"}}})
	t.eq([m.common, m.passes.image.source, m.passes.image.channels, m.passes.bufferA.source, m.opts], ["", "A2", ["audio"], "b", {"alpha": true}],
		"the working GLSL over the library's channels / opts; a pass the working copy lacks stays")
	t.eq(lib.common, "old", "the library config itself is not changed")
	t.eq(Sync.merged({"id": "y"}, {"passes": {"image": {"source": "S"}}}).passes.image.source, "S", "a pass the library lacks is added")


func test_throttle_and_last_value_lands() -> void:
	var box := FakeBox.new()
	var s: Sync = Sync.new()
	s.api_cb = func() -> Variant: return box
	s.compile_ms = 120
	t.root.add_child(s)
	var seen := []
	s.compiled.connect(func(id: String, cfg: Dictionary) -> void: seen.append([Time.get_ticks_msec(), id, cfg.passes.image.source]))
	await s.load_shader("sh-a")
	t.eq(seen.size(), 0, "an unedited shader is not recompiled on load")
	for i in 30:
		s.post_op("set", {"key": "image:0", "values": [0.01 * (i + 1)]}, false)
	await _wait(s)
	t.ok(box.posts.size() <= 4, "30 drags of one control: a pending value op is replaced by the newer one (%d sent)" % box.posts.size())
	t.ok(seen.size() >= 2 and seen.size() <= 3, "the first value compiles at once, then at most one per window (%d compiles for 30 changes)" % seen.size())
	for i in range(1, seen.size()):
		t.ok(seen[i][0] - seen[i - 1][0] >= 100, "compiles are a window apart (%d ms)" % (seen[i][0] - seen[i - 1][0]))
	t.eq([seen[-1][1], seen[-1][2]], ["sh-a", "const float SPEED = 0.3;"], "the last value lands, merged over the library config")
	t.eq(s.compiles, seen.size(), "counted")
	# an op for the shader that was replaced meanwhile never reaches the new one
	s.post_op("set", {"key": "image:0", "values": [1.0]}, false)
	await s.load_shader("sh-b")
	await _wait(s)
	t.eq(box.speed["sh-b"], 0.25, "sh-b untouched by an op queued for sh-a")
	s.free()


func test_mode_follows_the_selected_layer() -> void:
	var box := FakeBox.new()
	var mode: Mode = Mode.new()
	var cur := {"v": {"index": 0, "layer": {"scene": "shader", "shader": "sh-a"}}}
	mode.layer_cb = func() -> Dictionary: return cur.v
	mode.sync.api_cb = func() -> Variant: return box
	var compiled := []
	mode.compile_cb = func(id: String, cfg: Dictionary) -> String:
		compiled.append([id, cfg.passes.image.source])
		return ""
	t.root.add_child(mode)
	mode.refresh()
	await t.process_frame
	t.eq(mode._view.get("id"), "sh-a", "the selected layer's shader")
	t.eq(mode._head.text, "Layer 1 · Name sh-a", "named")
	var labels := mode._main.find_children("*", "Label", true, false).map(func(l: Label) -> String: return l.text)
	t.ok("Speed" in labels, "its key control is listed")
	t.ok(mode._main.find_children("*", "HSlider", true, false).size() == 1, "one slider")
	t.eq(mode._main.get_child(0).get_child_count() >= 4, true, "presets bar: Original, preset, + Preset, Randomize")
	cur.v = {"index": 2, "layer": {"scene": "shader", "shader": "sh-b"}}
	mode.refresh()
	await t.process_frame
	t.eq([mode._view.get("id"), mode._head.text], ["sh-b", "Layer 3 · Name sh-b"], "another layer → its own shader, not the previous one")
	t.eq((mode._main.find_children("*", "HSlider", true, false)[0] as HSlider).value, 0.25, "with its own values")
	cur.v = {"index": 1, "layer": {"scene": "tunnel", "opacity": 1.0}}
	mode.refresh()
	await t.process_frame
	t.eq([mode._view.is_empty(), mode._note.visible, mode._note.text.contains("not a shader layer"), mode._main.get_child_count()],
		[true, true, true, 0], "a non-shader layer: a note, no controls")
	cur.v = {"index": 0, "layer": {"scene": "shader", "shader": ""}}
	mode.refresh()
	t.ok(mode._note.text.contains("no shader picked"), "a shader layer without a shader")
	cur.v = {}
	mode.refresh()
	t.ok(mode._note.text.begins_with("No layers"), "no layers")
	# ops: a value, then reset → the controls come back with the library value, and each op recompiled
	cur.v = {"index": 0, "layer": {"scene": "shader", "shader": "sh-a"}}
	mode.refresh()
	await t.process_frame
	mode.post_op("set", {"key": "image:0", "values": [1.5]}, false)
	await _wait(mode.sync)
	t.eq(compiled[-1], ["sh-a", "const float SPEED = 1.5;"], "a control change recompiles the layer with the working GLSL")
	t.eq(mode.current_values("image:0"), [1.5], "the sliders' siblings read the new value")
	t.eq(mode._dirty.visible, true, "edited marker")
	t.eq(mode._save.disabled, false, "Save as child is on")
	mode.post_op("reset", {})
	await _wait(mode.sync)
	await t.process_frame
	t.eq([compiled[-1][1], mode._dirty.visible, (mode._main.find_children("*", "HSlider", true, false)[0] as HSlider).value],
		["const float SPEED = 0.5;", false, 0.5], "Reset all: recompiled from the library values, controls redrawn")
	mode.post_op("save", {})
	await _wait(mode.sync)
	t.ok(mode._status.text.begins_with("Saved as sh-a-c2"), "Save as child names the child")
	# a shader with live edits already on the node compiles from them when its layer is picked
	box.speed["sh-b"] = 1.0
	box.dirty["sh-b"] = true
	cur.v = {"index": 2, "layer": {"scene": "shader", "shader": "sh-b"}}
	mode.refresh()
	await t.process_frame
	t.eq(compiled[-1], ["sh-b", "const float SPEED = 1.0;"], "picked with live edits: the preview shows what the controls show")
	# a compile error is shown, and cleared by the next good one
	mode.compile_cb = func(_id: String, _cfg: Dictionary) -> String: return "0:3: syntax"
	mode.post_op("set", {"key": "image:0", "values": [0.7]}, false)
	await _wait(mode.sync)
	t.ok(mode._status.text.begins_with("Shader error: 0:3: syntax"), "the compile error is shown")
	mode.queue_free()


func test_recompile_runs_on_the_layers_with_that_shader() -> void:
	var d: Node = Deck.new()
	var layers := L.normalize([{"scene": "shader", "shader": "a"}, {"scene": "tunnel"}, {"scene": "shader", "shader": "b"}])
	d.apply(layers, {"a": {"id": "a"}, "b": {"id": "b"}}, 0.0)
	d.stage_at(0).layers[0]._time = 4.0
	var cfg := {"id": "a", "passes": {"image": {"source": "x"}}}
	var err: String = Mode.recompile(d, layers, "a", cfg)
	t.ok(err != "", "headless has no GPU: the runner's answer comes back (%s)" % err)
	t.ok(d.stage_at(0)._shader_cfg == cfg and d.stage_at(2)._shader_cfg != cfg, "only the layers running shader a")
	t.eq(d.stage_at(0).layers[0]._time, 4.0, "the same shader recompiled keeps its clock")
	Mode.recompile(d, layers, "b", {"id": "other"})
	t.eq(d.stage_at(2).layers[0]._time, 0.0, "a different shader id restarts the clock")
	d.free()


func test_live_slider_commits_while_dragging() -> void:
	var got := []
	var live: HSlider = W.slider(0.0, 1.0, 0.01, 0.0, func(v: float) -> void: got.append(v), null, 100000)
	t.root.add_child(live)  # a Range signals value_changed only inside the tree
	live.drag_started.emit()
	live.value = 0.2
	live.value = 0.3
	t.eq(got, [0.2], "while dragging: committed, then throttled")
	live.drag_ended.emit(true)
	t.eq(got, [0.2, 0.3], "the release commits the last value")
	var old: HSlider = W.slider(0.0, 1.0, 0.01, 0.0, func(v: float) -> void: got.append(v))
	t.root.add_child(old)
	old.drag_started.emit()
	old.value = 0.9
	t.eq(got.size(), 2, "default: nothing until the release (the old panel)")
	t.eq([W._live(RefCounted.new()), W._live(Mode.new())], [0, 120], "the panel's live_ms, 0 without one")
	live.free()
	old.free()
