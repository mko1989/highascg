extends RefCounted
## WO-1108 — the Previs view as a Live source: previs_output_model.gd (the slice, rate, ring name, camera picker, status
## line), clean_layer.gd (what never reaches the output picture), fixtures_3d_model.gd renders() with the output's
## FEEDS mark, the Sources ▸ Live row label, and the hooks in previs_tab.gd / previs_stage.gd.

const OM := preload("res://features/previs/output/previs_output_model.gd")
const Clean := preload("res://features/previs/output/clean_layer.gd")
const F := preload("res://features/previs/fixtures/fixtures_3d_model.gd")
const Shm := preload("res://features/live/shm_sources_model.gd")
const FLOOR_LAYER := 1 << 19  # previs_stage.gd (not preloaded: it needs the autoloads)
var t


func test_normalize() -> void:
	t.eq(OM.normalize(null), {"enabled": false, "size": [1920, 1080], "camera": "view"}, "nothing → off, 1080p, my view")
	var o := OM.normalize({"enabled": true, "size": [3840.0, 2160.0], "camera": "m2", "note": 1})
	t.eq(o.enabled, true, "on")
	t.eq(o.size, [3840, 2160], "an offered size (floats from JSON)")
	t.eq(o.camera, "m2", "a move id")
	t.eq(o.note, 1, "unknown keys kept")
	t.eq(OM.normalize({"enabled": "yes", "size": [1000, 1000], "camera": ""}),
		{"enabled": false, "size": [1920, 1080], "camera": "view"}, "junk → defaults")
	t.eq(OM.normalize({"size": ["a", 720], "camera": 7}).size, [1920, 1080], "non-numeric size → default")
	t.eq(OM.normalize({"camera": 7}).camera, "view", "non-string camera → my view")
	t.eq(OM.of_project({"previs": {"output": {"enabled": true, "size": [1280, 720]}}}).size, [1280, 720], "read from project.previs.output")
	t.eq(OM.of_project({}).enabled, false, "no previs → off")


func test_fps_ring_autostart() -> void:
	t.eq(OM.fps_of({"programResolutions": [{"w": 1920, "h": 1080, "fps": 25}, {"fps": 60}]}), 25, "the program channel's rate")
	t.eq(OM.fps_of({"programResolutions": [{"fps": 59.94}]}), 59, "fractional → int (the publisher's fps)")
	t.eq(OM.fps_of({}), 50, "no channel map → 50")
	t.eq([OM.out_fps({"programResolutions": [{"fps": 50}]}), OM.out_fps({"programResolutions": [{"fps": 60}]}), OM.out_fps({"programResolutions": [{"fps": 59.94}]}), OM.out_fps({"programResolutions": [{"fps": 25}]}), OM.out_fps({})], [25, 30, 30, 25, 25], "WO-1116: half the program rate from 50p up")
	t.eq(OM.fps_of({"programResolutions": [{"fps": 0}]}), 50, "zero → 50")
	t.eq(OM.ring_name({}), "previs", "the operator's ring")
	t.eq(OM.ring_name({"previs-ring": "previs-test"}), "previs-test", "--previs-ring")
	t.eq(OM.ring_name({"probe-previs-output": "/tmp/x"}), "previs-probe", "the probe never writes the operator's ring")
	t.eq(OM.ring_name({"previs-ring": "bad name/../x"}), "previs", "a name the ring rule refuses → default")
	t.ok(OM.may_autostart({}), "the operator's client starts an enabled output")
	t.ok(not OM.may_autostart({"check": true}), "a --check boot does not")
	t.ok(not OM.may_autostart({"probe-visuals-ring": "5"}), "nor a probe of something else")
	t.ok(OM.may_autostart({"probe-x": "1", "previs-ring": "p2"}), "unless it was given its own ring")


func test_camera_items_and_status() -> void:
	var moves := [{"id": "m1", "name": "Push in"}, {"id": "m2", "name": "Orbit"}]
	t.eq(OM.camera_items(moves), [["My view", "view"], ["Push in", "m1"], ["Orbit", "m2"]], "My view + every move")
	t.eq(OM.camera_move({"camera": "m2"}, moves).name, "Orbit", "the picked move")
	t.eq(OM.camera_move({"camera": "view"}, moves), {}, "my view → no move")
	t.ok(OM.camera_missing({"camera": "m9"}, moves), "a deleted move is missing")
	t.ok(not OM.camera_missing({"camera": "view"}, moves), "my view is never missing")
	var on := OM.normalize({"enabled": true})
	var s := OM.status(on, "", "previs", true, 50, false)
	t.ok(s.contains("shm://previs") and s.contains("1920×1080") and s.contains("50 fps"), "on: ring, size, rate (%s)" % s)
	t.ok(s.contains("Sources ▸ Live as \"Previs\""), "on: where to find it")
	t.ok(OM.status(on, "", "previs", true, 50, true).contains("follows your view"), "a missing move says so")
	t.eq(OM.status(on, "libhshm_sink is not loaded", "previs", false, 50, false), "libhshm_sink is not loaded", "why not")
	t.eq(OM.status(OM.normalize(null), "", "previs", false, 50, false), "", "off and able: no line")
	t.eq(OM.status(OM.normalize(null), "box only", "previs", false, 50, false), "box only", "off: why it could not, before it is on")


func test_live_row_reads_previs() -> void:
	var rows := Shm.rows({"sources": [{"name": "previs", "value": "shm://previs", "width": 1920, "height": 1080, "fps": 50},
		{"name": "visuals", "value": "shm://visuals"}]})
	t.eq(rows[0].label, "Previs", "the previs ring row reads Previs")
	t.eq(rows[0].value, "shm://previs", "and still drags shm://previs")
	t.eq(rows[1].label, "visuals", "other rings keep their name")
	t.eq(Shm.LABELS.get(OM.RING), OM.LABEL, "one label, both sides")


func test_clean_layer_rules() -> void:
	var root := Node3D.new()
	var wall := MeshInstance3D.new()
	wall.mesh = BoxMesh.new()
	root.add_child(wall)
	var line := MeshInstance3D.new()
	line.mesh = ImmediateMesh.new()
	root.add_child(line)
	var tag := Label3D.new()
	root.add_child(tag)
	var marked := MeshInstance3D.new()
	marked.mesh = BoxMesh.new()
	marked.set_meta(Clean.META, true)
	root.add_child(marked)
	var group := Node3D.new()
	group.set_meta(Clean.META, true)
	root.add_child(group)
	var inside := MeshInstance3D.new()
	inside.mesh = SphereMesh.new()
	group.add_child(inside)
	var light := OmniLight3D.new()
	root.add_child(light)
	t.ok(not Clean.is_helper(wall, root), "a wall is show picture")
	t.ok(Clean.is_helper(line, root) and Clean.is_helper(tag, root) and Clean.is_helper(marked, root), "lines, labels, marked boxes")
	t.ok(Clean.is_helper(inside, root), "anything under a helper node")
	t.ok(not Clean.is_helper(light, root), "a light is never moved off its layer")
	t.eq(Clean.mark_tree(root), 4, "four helpers marked")
	t.eq(line.layers, Clean.LAYER, "on the helper layer")
	t.eq(tag.cast_shadow, GeometryInstance3D.SHADOW_CASTING_SETTING_OFF, "and casting no shadow")
	t.eq(wall.layers, 1, "the wall stays on layer 1")
	t.ok(Clean.LAYER != FLOOR_LAYER and FileAccess.get_file_as_string("res://features/previs/previs_stage.gd").contains("const FLOOR_LAYER := 1 << 19"), "the helper layer is not the floor layer the camera overlay drops")
	t.ok(Clean.LAYER & 0xFFFFF != 0, "the operator's camera (cull_mask 0xFFFFF) still sees the helpers")
	for p in Clean.HELPER_SCRIPTS:
		t.ok(ResourceLoader.exists(p), "helper script exists: %s" % p)
	t.ok(Clean.helper_script(load(Clean.HELPER_SCRIPTS[0])) and not Clean.helper_script(OM), "helper scripts by path")
	root.free()


func test_renders_with_the_output_feed() -> void:
	var sv := SubViewport.new()
	sv.render_target_update_mode = SubViewport.UPDATE_DISABLED
	t.ok(not F.renders(sv), "a hidden view does not render")
	sv.set_meta(F.FEEDS, true)
	t.ok(F.renders(sv), "…unless the Previs output renders its stage (the rig keeps its fixtures watch)")
	sv.set_meta(F.FEEDS, false)
	t.ok(not F.renders(sv), "output off: hidden again")
	sv.free()


func test_hooks_in_place() -> void:
	var tab := FileAccess.get_file_as_string("res://features/previs/previs_tab.gd")
	t.ok(tab.contains("preload(\"res://features/previs/camera/previs_cinema.gd\").attach(self)"), "the tab adds the folds")
	t.ok(tab.contains("_sv.get_meta(\"previs_output\", false)"), "the tab keeps the videos live while the output runs")
	t.eq(F.FEEDS, "previs_output", "the same meta name")
	t.ok(tab.contains("mvr.set_live(is3d and shown or out)") and tab.contains("and shown or out)  # T12"), "walls + MVR screens")
	var stage := FileAccess.get_file_as_string("res://features/previs/previs_stage.gd")
	t.ok(stage.contains("func view_pose() -> Dictionary:") and stage.contains("func set_view_pose(pos: Vector3, look: Vector3, fov: float) -> void:"),
		"the stage's camera slider hook")
	var mvr := FileAccess.get_file_as_string("res://features/previs/mvr_scene.gd")
	t.ok(mvr.contains("mi.set_meta(\"previs_helper\", true)"), "MVR selection boxes are helpers")
	t.eq(Clean.META, "previs_helper", "the same meta name")
	var out := FileAccess.get_file_as_string("res://features/previs/output/previs_output.gd")
	t.ok(out.contains("cam.cull_mask = 0xFFFFF & ~Clean.LAYER"), "the output camera drops the helpers")
	t.ok(out.contains("vp.world_3d = s.get_viewport().find_world_3d()"), "on the stage's own world")
