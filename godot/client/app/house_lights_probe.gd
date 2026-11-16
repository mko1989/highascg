extends Node
## dev: --probe-house=<png prefix> (with --tab=Previs) — WO-1099: the Previs 3D view at every render quality at house lights
## 100 / 50 / 20 / 0 %, through the running client and the project's own rig as the engine computes it (no DMX is
## sent). Per state: the stage view's measured GPU ms and the window's fps over 90 frames ("[client] house probe" lines),
## and the stage SubViewport saved from three cameras: <prefix>_<Quality>_<level %>_<front|pool|side>.png ("pool" = close
## on the floor under the brightest lit beam). The levels are set for this run only (ui.cfg untouched), then restored.

const Quality := preload("res://features/previs/previs_quality.gd")
const House := preload("res://features/previs/house_lights.gd")
const F := preload("res://features/previs/fixtures/fixtures_3d_model.gd")
const Cone := preload("res://features/previs/fixtures/beam_cone.gd")

var prefix := ""


func _ready() -> void:
	prefix = str(Config.args["probe-house"])
	await get_tree().create_timer(15.0).timeout  # rig, venue and DMX decode arrive over HTTP / WS
	var tab: Node = get_tree().root.find_child("Previs", true, false)
	if tab == null or tab.get("stage") == null:
		print("[client] house probe: no Previs tab")
		return
	var q: RefCounted = Quality.shared()
	var hl: RefCounted = House.shared()
	for i in 60:  # the rig built and its DMX decode in (a lit beam), at most a minute more
		if Cone.pick(tab.fixtures3d._fx, 999, 0) > 0:
			break
		await get_tree().create_timer(1.0).timeout
	tab.fixtures3d.apply(tab.fixtures3d._last)
	print("[client] house probe: heads %d, lit beams %d" % [tab.fixtures3d._fx.size(), hl.lit_beams()])
	var was := [q.level, hl.level]
	RenderingServer.viewport_set_measure_render_time(tab._sv.get_viewport_rid(), true)
	for lv in Quality.max_level() + 1:
		for h in [1.0, 0.5, 0.2, 0.0]:
			_levels(q, lv, hl, h)
			await _frames(30)
			var ms := 0.0
			var fps := 0.0
			for i in 90:
				await get_tree().process_frame
				ms += RenderingServer.viewport_get_measured_render_time_gpu(tab._sv.get_viewport_rid())
				fps += Engine.get_frames_per_second()
			print("[client] house probe: %s house %s gpu %.2f ms fps %.0f lit beams %d" % [Quality.NAMES[lv], "%d%%" % roundi(h * 100.0),
				ms / 90.0, fps / 90.0, hl.lit_beams()])
			for cam in ["front", "pool", "side"] if h == 1.0 or h == 0.0 else ["front"]:
				await _aim(tab, cam)
				await _frames(8)
				tab._sv.get_texture().get_image().save_png("%s_%s_%s_%s.png" % [prefix, Quality.NAMES[lv], "%03d" % roundi(h * 100.0), cam])
	var t0 := Time.get_ticks_usec()
	for k in 101:  # a slider drag's steps (every stage, venue glow, avatar, overlay listener runs per step)
		hl.set_level(k / 100.0, false)
	print("[client] house probe: slider step %.3f ms (CPU, all listeners)" % ((Time.get_ticks_usec() - t0) / 101000.0))
	_levels(q, was[0], hl, was[1])
	await _aim(tab, "front")
	print("[client] house probe done")


func _levels(q: RefCounted, lv: int, hl: RefCounted, h: float) -> void:
	q.level = lv
	Quality.apply_globals(q.current())
	q.changed.emit(lv)
	hl.set_level(h, false)  # live, not saved


func _frames(n: int) -> void:
	for i in n:
		await get_tree().process_frame


func _aim(tab: Node, cam: String) -> void:
	if cam == "pool":
		var at: Variant = _pool(tab.fixtures3d)
		if at != null:
			tab.stage.frame_box(AABB(at - Vector3(2.5, 0.0, 2.5), Vector3(5.0, 2.5, 5.0)), tab.builder.front_yaw() + 0.35)
			tab.stage._pitch = 0.3
			tab.stage._update_camera()
			return
	var preset := "ISO" if cam == "side" else "Front"  # WO-1098 View presets: the stage from its audience
	tab.stage.fly_to_preset(preset, tab._view_pose(preset))
	await _frames(45)


## Where the brightest lit beam with a light meets the floor (world), or null.
func _pool(rig: Node) -> Variant:
	var best: SpotLight3D = null
	var bi := 0.0
	for id in rig._fx:
		for b: Dictionary in (rig._fx[id].beams as Dictionary).values():
			if b.has("light") and float(b.get("i", 0.0)) > bi:
				bi = float(b.i)
				best = b.light
	if best == null:
		return null
	var g := best.global_transform
	return F.floor_hit(g.origin, -g.basis.z)
