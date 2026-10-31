extends Node
## dev (WO-892): a synthetic previs stage rendered at every quality level — an LED wall with a moire-prone test picture,
## truss heads with real beam cones + spot lights (fixtures_3d.gd, built from a made-up rig, no server), boxes on the
## floor — so the render quality can be compared off-screen without touching the project or the rig's DMX:
##   XDG_DATA_HOME=<private dir> godot --path godot/client res://app/previs_quality_probe.tscn -- --out=<dir>
##     [--levels=0,1,2,3] [--haze=0.65] [--real  the project's patched heads (their GDTF bodies) instead of the made-up ones]
## Per level: the measured GPU ms of the stage viewport (averaged over 90 frames) and one PNG per camera.
## Run it on a private Xvfb with its own XDG_DATA_HOME: it saves the quality into ui.cfg like the toolbar picker does.

const PrevisStage := preload("res://features/previs/previs_stage.gd")
const Fixtures3D := preload("res://features/previs/fixtures/fixtures_3d.gd")
const Quality := preload("res://features/previs/previs_quality.gd")
const Haze := preload("res://features/previs/haze.gd")
const LED := preload("res://features/previs/led_screen.gdshader")

var views := {  # name → [yaw, pitch, distance, target]
	"wide": [0.0, 0.12, 15.0, Vector3(0, 3.0, -3.0)],
	"low": [0.35, 0.02, 8.0, Vector3(0, 1.5, -2.0)],
	"inside": [0.0, 0.0, 2.0, Vector3(-3.2, 3.8, 2.0)],  # the camera in a beam
	"far": [0.0, 0.2, 40.0, Vector3(0, 3.0, -6.0)],  # the LED wall minified: shimmer / moire
}

var stage: PrevisStage
var rig: Node3D
var sv: SubViewport
var out := "user://qprobe"
var _tex: ImageTexture


func _ready() -> void:
	out = str(Config.args.get("out", out))
	DirAccess.make_dir_recursive_absolute(out)
	var svc := SubViewportContainer.new()
	svc.stretch = true
	svc.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	var ui := Control.new()
	ui.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(ui)
	ui.add_child(svc)
	sv = SubViewport.new()
	sv.own_world_3d = true
	svc.add_child(sv)
	stage = PrevisStage.new()
	sv.add_child(stage)
	_wall()
	_props()
	rig = Fixtures3D.new()
	stage.add_child(rig)
	await get_tree().process_frame
	if Config.args.has("real"):  # the live project's patched heads (read-only GETs), every beam lit
		await _real_heads()
	else:
		_heads()
	if Config.args.has("haze"):
		Haze.shared().level = float(Config.args["haze"])
		Haze.shared().changed.emit(Haze.shared().level)
	RenderingServer.viewport_set_measure_render_time(sv.get_viewport_rid(), true)
	var levels: PackedStringArray = str(Config.args.get("levels", "0,1,2,3")).split(",")
	for l in levels:
		await _level(int(l))
	print("[qprobe] done")
	get_tree().quit()


func _level(lv: int) -> void:
	Quality.shared().set_level(lv)
	print("[qprobe] level %d (%s) -> in force %s" % [lv, Quality.NAMES[lv], Quality.NAMES[mini(lv, Quality.max_level())]])
	for k in str(Config.args.get("off", "")).split(","):  # dev: switch one effect off again to see what it does
		match k:
			"glow": stage.environment.glow_hdr_threshold = 1.0
			"sun": stage.sun.shadow_enabled = false
			"ssr": stage.environment.ssr_enabled = false
			"ssao": stage.environment.ssao_enabled = false
			"msaa": sv.msaa_3d = Viewport.MSAA_DISABLED
			"smaa": sv.screen_space_aa = Viewport.SCREEN_SPACE_AA_DISABLED
			"spots":
				for l in rig.find_children("*", "SpotLight3D", true, false):
					(l as SpotLight3D).shadow_enabled = false
			"deband": sv.use_debanding = false
			"lens":
				for mi in rig.find_children("*", "MeshInstance3D", true, false):
					if (mi as MeshInstance3D).mesh is CylinderMesh and (mi as MeshInstance3D).mesh != rig._cone:
						mi.visible = false
			"cones":
				for mi in rig.find_children("*", "MeshInstance3D", true, false):
					if (mi as MeshInstance3D).mesh == rig._cone:
						mi.visible = false
			"plaincone": rig._shader.code = rig.Cone.code(false)
			"noglow": stage.environment.glow_enabled = false
			"lights":
				for l in rig.find_children("*", "SpotLight3D", true, false):
					l.visible = false
	_view("wide")
	for i in 40:
		await get_tree().process_frame
	var sum := 0.0
	for i in 90:
		await get_tree().process_frame
		sum += RenderingServer.viewport_get_measured_render_time_gpu(sv.get_viewport_rid())
	print("[qprobe] level %d gpu %.2f ms (avg of 90 frames, wide view, %s)" % [lv, sum / 90.0, str(sv.size)])
	for v in views:
		_view(v)
		for i in 12:
			await get_tree().process_frame
		await RenderingServer.frame_post_draw
		var path := "%s/q%d_%s.png" % [out, lv, v]
		get_viewport().get_texture().get_image().save_png(path)
		print("[qprobe] ", path)


func _view(name: String) -> void:
	var v: Array = views[name]
	stage._yaw = v[0]
	stage._pitch = v[1]
	stage._dist = v[2]
	stage._target = v[3]
	stage._update_camera()


## A 16 x 7 m LED wall behind the stage showing colour bars, 1-2 px grids and diagonals (what a downscale shimmers on).
func _wall() -> void:
	var img := Image.create(1920, 1080, false, Image.FORMAT_RGBA8)
	for y in 1080:
		for x in 1920:
			var c := Color.BLACK
			if y < 360:
				c = Color.from_hsv(float(x) / 1920.0, 0.9, 0.95)
			elif y < 720:
				c = Color.WHITE if ((x / 2 + y / 2) & 1) == 0 else Color.BLACK  # 2 px checker
				if x > 960:
					c = Color.WHITE if (x & 1) == 0 else Color.BLACK  # 1 px stripes
			else:
				c = Color(0.9, 0.9, 0.9) if ((x + y) % 12) < 2 else Color(0.05, 0.1, 0.4)
			img.set_pixel(x, y, c)
	_tex = ImageTexture.create_from_image(img)
	var mi := MeshInstance3D.new()
	var q := QuadMesh.new()
	q.size = Vector2(16.0, 9.0)
	mi.mesh = q
	var m := ShaderMaterial.new()
	m.shader = LED
	m.set_shader_parameter("video", _tex)
	m.set_shader_parameter("has_video", true)
	m.set_shader_parameter("panels", Vector2(10, 5))
	m.set_shader_parameter("panel_px", Vector2(192, 216))
	m.set_shader_parameter("seam_px", 1.0)
	m.set_shader_parameter("pixel_grid", 0.3)
	mi.material_override = m
	mi.position = Vector3(0, 4.5, -6.0)
	stage.add_child(mi)


func _props() -> void:
	for spec in [[Vector3(-4, 0.4, 0), Vector3(3, 0.8, 2)], [Vector3(4.5, 0.75, -1), Vector3(2, 1.5, 2)], [Vector3(0, 0.15, 3.5), Vector3(5, 0.3, 1.5)]]:
		var mi := MeshInstance3D.new()
		var b := BoxMesh.new()
		b.size = spec[1]
		mi.mesh = b
		var mat := StandardMaterial3D.new()
		mat.albedo_color = Color(0.3, 0.3, 0.33)
		mi.material_override = mat
		mi.position = spec[0]
		stage.add_child(mi)
	var truss := MeshInstance3D.new()
	var tb := BoxMesh.new()
	tb.size = Vector3(14, 0.3, 0.3)
	truss.mesh = tb
	truss.position = Vector3(0, 7.0, 1.0)
	stage.add_child(truss)


## Eight moving-head-like fixtures on the truss, each one Wash beam (a cone + a SpotLight3D), fanned over the wall and floor;
## two with a gobo-less spot. Built straight through fixtures_3d.gd's _build with a made-up rig.
func _heads() -> void:
	var data := {"fixtures": []}
	for i in 8:
		var id := "f%d" % i
		var f := {"id": id, "typeId": "abcdefabcdef", "pose": {"x": -6.0 + i * 1.7, "y": -1.0, "z": 7.0, "pitch": -25.0 + (i % 3) * 22.0, "roll": -22.0 + i * 6.0}}
		rig._build(f, {"nodes": [{"id": "b", "parent": -1, "kind": "Beam", "beam": {"radius": 0.07, "beamType": "Wash"}}]})
		var col: Array = [[1.0, 0.45, 0.2], [0.2, 0.6, 1.0], [1.0, 1.0, 1.0], [0.4, 1.0, 0.4]][i % 4]
		data.fixtures.append({"id": id, "axes": {}, "beams": {"b": {"i": 1.0, "c": col, "zoom": 24.0}}})
	rig.apply(data)
	rig._quality()
	print("[qprobe] heads: ", rig._fx.size(), " lights ", rig.lights)


## The real rig: the project from the server (GET only) → fixtures_3d.gd builds its heads from their GDTF rigs and models;
## then every beam is lit with a made-up tracking:fixtures payload (nothing is sent to the server or the lights).
func _real_heads() -> void:
	var pr: Dictionary = await Api.get_json("/api/project")
	if not pr.ok:
		print("[qprobe] no project: ", pr.error)
		return
	Store.set_project(pr.data)
	for i in 300:
		await get_tree().process_frame
		if rig._fx.size() > 0 and i > 120:
			break
	var data := {"fixtures": []}
	var n := 0
	for id in rig._fx:
		var beams := {}
		for b in rig._fx[id].beams:
			beams[b] = {"i": 1.0, "c": [[1.0, 0.45, 0.2], [0.2, 0.6, 1.0], [1.0, 1.0, 1.0]][n % 3], "zoom": 24.0}
		n += 1
		data.fixtures.append({"id": id, "axes": {}, "beams": beams})
	rig.apply(data)
	rig._quality()
	for id in rig._fx:
		for b in rig._fx[id].beams:
			var c: Variant = rig._fx[id].beams[b].get("cone")
			if c != null and (c as Node3D).transform.basis.get_scale().x > 3.0:
				print("[qprobe] wide cone ", id, " ", rig._fx[id].beams[b].type, " scale ", (c as Node3D).transform.basis.get_scale(), " at ", (c as Node3D).global_position)
	var box: AABB = rig.bounds()
	print("[qprobe] real heads: ", rig._fx.size(), " lights ", rig.lights, " bounds ", box)
	if box.size != Vector3.ZERO:
		views["wide"] = [0.0, 0.2, maxf(8.0, box.get_longest_axis_size() * 1.6), box.get_center()]
		views["low"] = [0.5, 0.05, maxf(6.0, box.get_longest_axis_size()), box.get_center() * Vector3(1, 0.3, 1)]
