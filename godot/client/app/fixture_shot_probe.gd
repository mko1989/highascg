extends Node
## dev: --probe-fixture=<type id>:<png prefix> (with --tab=1) — WO-784: the orbit camera close on the first patched head
## of that GDTF type, from the front and from below, so its body colour and beam glow can be checked off-screen.
## Screenshots <prefix>_N.png.

var prefix := ""
var type_id := ""


func _ready() -> void:
	var a := str(Config.args["probe-fixture"]).split(":", true, 1)
	type_id = a[0]
	prefix = a[1] if a.size() > 1 else "user://fixture"
	await get_tree().create_timer(12.0).timeout  # rigs + meshes load over HTTP, DMX decode arrives over WS
	var tab: Node = get_tree().root.find_child("Previs", true, false)
	var fx: Node = tab.fixtures3d if tab != null else null
	var stage: Node = tab.stage if tab != null else null
	if fx == null or stage == null:
		print("[client] fixture probe: no fixtures view / stage")
		return
	var parts: Variant = null
	for id in fx._fx:
		if str(fx._fx[id].type) == type_id:
			parts = fx._fx[id]
			print("[client] fixture probe: ", id)
			break
	if parts == null:
		print("[client] fixture probe: no head of type ", type_id)
		return
	for v in fx._last.get("fixtures", []):
		if str(v.get("id", "")) == str(parts.root.name) or str(parts.root.name) == str(v.get("id", "")).validate_node_name():
			for b in ["Beam Pixel 1", "Aura Pixel 1"]:
				print("[client] fixture probe %s: got %s, lens emission %s" % [b, v.beams.get(b), (parts.beams[b].lens as StandardMaterial3D).emission])
	var root := parts.root as Node3D
	var box: AABB = root.global_transform * (parts.box as AABB)
	for shot in [[0.0, 0.15, 1], [PI, -0.6, 2]]:
		stage.frame_box(box, shot[0])
		stage._pitch = shot[1]
		stage._dist = maxf(1.2, box.get_longest_axis_size() * 3.0)
		stage._update_camera()
		for i in 4:
			await get_tree().process_frame
		await RenderingServer.frame_post_draw
		get_viewport().get_texture().get_image().save_png("%s_%d.png" % [prefix, shot[2]])
	print("[client] fixture probe done")

