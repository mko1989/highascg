extends RefCounted
## WO-873 Visuals stage + scene library: the burst edge (rise through 0.5, re-arm under 0.3, manual fire), the layers (main +
## second, no duplicate, unknown → rings, rebuilt only on change), and every scene built and stepped through bursts headless.

const Stage := preload("res://features/visuals/visuals_stage.gd")
const M := preload("res://features/visuals/visuals_model.gd")
var t


func _stage() -> Node3D:
	var s: Node3D = Stage.new()
	s._ready()  # not in a tree under the runner
	return s


func test_burst_edge() -> void:
	var s := _stage()
	t.eq(s.burst_edge(0.2), false, "below the threshold")
	t.eq(s.burst_edge(0.6), true, "rises through 0.5 → fires")
	t.eq(s.burst_edge(0.9), false, "held high → once")
	t.eq(s.burst_edge(0.4), false, "falls to 0.4: not re-armed yet")
	t.eq(s.burst_edge(0.7), false, "back up from 0.4 → no second burst (hysteresis)")
	t.eq(s.burst_edge(0.1), false, "under 0.3 re-arms")
	t.eq(s.burst_edge(0.55), true, "the next hit fires")
	s.fire()
	t.eq(s.burst_edge(0.0), true, "a manual fire fires on the next frame")
	t.eq(s.burst_edge(0.0), false, "once")
	s.free()


func test_layers() -> void:
	var s := _stage()
	t.eq(s.ids(), ["rings"], "rings by default")
	s.set_layers("tunnel", "particles")
	t.eq(s.ids(), ["tunnel", "particles"], "main + second layer")
	var first: Node3D = s.layers[0]
	s.set_layers("tunnel", "particles")
	t.ok(s.layers[0] == first, "same layers → nothing rebuilt")
	s.set_layers("starfield", "starfield")
	t.eq(s.ids(), ["starfield"], "never the same scene twice")
	s.set_layers("nope", "nada")
	t.eq(s.ids(), ["rings"], "unknown ids → rings, no second layer")
	s.free()


func test_every_scene_steps_and_bursts() -> void:
	for id in M.scene_ids():
		t.ok(Stage.SCENES.has(id), "%s: the stage knows the model's scene" % id)
		var s := _stage()
		s.set_layers(id, "particles" if id != "particles" else "rings")
		var p := M.PARAM_DEFAULTS.duplicate()
		for f in 40:
			p.burst = 1.0 if f % 10 == 0 else 0.0
			p.pulse = f / 40.0
			s.params = p
			s._process(1.0 / 60.0)
		t.eq(s.layers.size(), 2, "%s: both layers ran 40 frames with 4 bursts" % id)
		s.free()
	t.eq(Stage.SCENES.size(), M.SCENES.size(), "no scene missing from the picker")
