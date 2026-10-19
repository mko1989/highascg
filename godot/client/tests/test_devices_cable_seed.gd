extends RefCounted
## WO-605 slice 2b — cable_seed.gd against golden values from the web modules (project-fps.js,
## CASPAR_VIDEO_MODE_SPECS, videoModeToResolution, screen-consumer-defaults.js, device-view-gpu-source-inherit.js,
## device-view-inspector-gpu-resolve.js, device-view-cable-preflight.js) run under Node:
## tests/golden/devices_cable_seed.json.

const S := preload("res://features/devices/cable_seed.gd")
const R := preload("res://features/devices/cable_rules.gd")
var t
var _g: Dictionary


func _golden() -> Dictionary:
	if _g.is_empty():
		_g = JSON.parse_string(FileAccess.get_file_as_string("res://tests/golden/devices_cable_seed.json"))
	return _g


## JSON has one number type; Godot's Dictionary == tells 720 from 720.0. Compare as JSON would.
static func _norm(v: Variant) -> Variant:
	if v is int:
		return float(v)
	if v is Dictionary:
		var o := {}
		for k in v:
			o[k] = _norm(v[k])
		return o
	if v is Array:
		return v.map(func(x: Variant) -> Variant: return _norm(x))
	return v


func _eq(actual: Variant, expected: Variant, what: String) -> void:
	t.eq(_norm(actual), _norm(expected), what)


func _or_null(d: Dictionary) -> Variant:
	return d if not d.is_empty() else null


func test_project_fps() -> void:
	var g := _golden()
	var inputs := [null, 0, -3, "x", 24.5, 25, 29.9, 30, 48, 59, 61, "23.976"]
	for v in inputs:
		var key := "null" if v == null else (str(v) if not v is float else str(v))
		var want: Array = g.out.fps[key]
		_eq(S.normalize_fps(v), want[0], "normalize %s" % key)
		_eq(S.default_mode_for_fps(v), want[1], "mode %s" % key)
	for row in g.out.projFps:
		_eq(S.project_fps(row[0]), row[1], "project fps %s" % str(row[0]))
		_eq(S.default_video_mode(row[0]), row[2], "default mode %s" % str(row[0]))


func test_mode_spec_and_resolution() -> void:
	var g := _golden()
	for m in g.out.spec:
		_eq(_or_null(S.mode_spec(m)), g.out.spec[m], "spec '%s'" % m)
		_eq(S.mode_resolution(m), g.out.res[m], "resolution '%s'" % m)


func test_feed_source_and_binding() -> void:
	var g := _golden()
	for id in g.out.feed:
		_eq(_or_null(S.feed_source(g.payload, id)), g.out.feed[id], "feed " + id)
		_eq(_or_null(S.output_binding(g.payload, id, "")), g.out.binding[id][0], "binding " + id)
		_eq(_or_null(S.output_binding(g.payload, id, "prv")), g.out.binding[id][1], "prv binding " + id)


func test_screen_seed() -> void:
	var g := _golden()
	for row in g.out.seed:
		_eq(S.screen_seed_patch(row[0], 2), row[1], "seed %s" % str(row[0]))
		_eq(S.screen_seed_patch(row[0], 2, {"machineProfile": {"defaultProjectFps": 25}}), row[2], "seed+mode %s" % str(row[0]))
		_eq(not S.screen_seed_caspar_patch(row[0], 2).is_empty(), row[3], "should seed %s" % str(row[0]))


func test_inherit_and_merge() -> void:
	var g := _golden()
	_eq(S.inherited_patch(0, {}), g.out.inherit[0], "inherit defaults")
	_eq(S.inherited_patch(3, {"videoMode": "720p5000", "width": "1280", "height": 30, "fps": "59.94"}), g.out.inherit[1], "inherit")
	_eq(S.merge_patches([{"casparServer": {"a": 1}}, null, {"casparServer": {"a": 2, "b": 3}, "other": 4}]), g.out.merge, "merge")


func test_screen_numbers() -> void:
	var g := _golden()
	for id in g.out.screen:
		var c := R.connector_by_id(g.payload, id)
		c = c if not c.is_empty() else {"id": id}
		_eq(S.screen_number(c, g.payload), g.out.screen[id], "screen " + id)
		_eq(S.physical_screen_index(c, g.payload), g.out.phys[id], "physical " + id)


func test_preflight() -> void:
	var g := _golden()
	var ids := ["dst_in_dst_a", "gpu_p1__DP_2", "gpu_p1", "gpu_p3", "gpu_p4", "gpu_p7", "gpu_p8", "dst_in_dst_b", "dst_in_zz", "DP-1", ""]
	var r := S.preflight(g.payload, null, ids)
	_eq(r.graph, g.out.pre.graph, "preflight graph")
	_eq(r.added, g.out.pre.addedIds, "preflight added")
	var e := S.preflight({}, null, ["dst_in_q"])
	_eq(e.graph, g.out.preEmpty.graph, "preflight from no graph")
	_eq(e.added, g.out.preEmpty.addedIds, "preflight from no graph, added")


func test_gpu_sink_writes() -> void:
	var g := _golden()
	var p: Dictionary = g.payload.duplicate(true)
	var bare := S.gpu_sink_writes(p, {}, "dst_in_dst_a", "gpu_p3", "")
	_eq(bare.settings.casparServer.get("screen_1_mode"), "1080p5000", "without the new edge the screen is guessed (1)")
	p.graph.edges.append({"id": "e_new", "sourceId": "dst_in_dst_a", "sinkId": "gpu_p3"})  # as after addEdge
	var w := S.gpu_sink_writes(p, {}, "dst_in_dst_a", "gpu_p3", "")
	_eq(w.settings, {"casparServer": {"screen_4_windowed": true, "screen_4_borderless": true, "screen_4_vsync": false,
		"screen_2_mode": "1080p5000", "screen_2_custom_width": 3840, "screen_2_custom_height": 1080, "screen_2_custom_fps": 50.0}},
		"PGM onto gpu_p3: seed port 4 consumer, inherit into screen 2 (the destination's main screen)")
	_eq(w.connector, {"caspar": {"mode": "1080p5000", "outputBinding": {"type": "screen", "index": 2}}}, "PGM binding")
	var prv := S.gpu_sink_writes(p, {}, "dst_in_dst_a", "gpu_p3", "prv")
	_eq(prv.settings, {}, "PRV head writes no screen settings (WO-364)")
	_eq(prv.connector.caspar.outputBinding, {"type": "screen_prv", "index": 2}, "PRV binding")
	var mv := S.gpu_sink_writes(p, {"screen_4_windowed": true}, "dst_in_dst_mv", "gpu_p3", "")
	_eq(mv.settings.casparServer.get("multiview_always_on_top"), false, "multiview seeds always-on-top off")
	t.ok(not mv.settings.casparServer.has("screen_4_windowed"), "seeded screen is left alone")
	_eq(S.gpu_sink_writes(p, {}, "dst_in_dst_a", "dlsdi_1", ""), {"settings": {}, "connector": {}}, "non-GPU sink")


func test_with_output_layer() -> void:
	var graph := {"edges": [{"id": "e1", "note": "x"}, {"id": "e2"}]}
	var g2 := S.with_output_layer(graph, "e2", 2)
	_eq(g2.edges[1].note, "{\"outputLayer\":2}", "note set")
	_eq(graph.edges[1].has("note"), false, "input untouched")
	_eq(S.with_output_layer(graph, "zz", 2), {}, "missing edge")
