extends RefCounted
## Dev probes of the Visuals tab (no pointer on the owner's screen; `--probe-visuals-*` flags, visuals_tab.gd _ready). Split
## out of the tab in WO-877. GPU figures are the live deck's (visuals_mixer.gd), the scenes' own render.


## dev probe (no pointer on the owner's screen): send to a screen for some seconds, print each step, stop.
static func send(tab: Node, arg: String) -> void:
	var p := arg.split(":")
	await tab.get_tree().create_timer(4.0).timeout
	tab.slice.output.screen = int(p[0])
	tab.page.set_state(tab.slice, tab._cm())
	tab._resize()
	await tab.send(true)
	print("[probe-visuals] send: ", tab.sending, " · ", tab.page._note.text)
	await tab.get_tree().create_timer(float(p[1]) if p.size() > 1 else 10.0).timeout
	await tab.send(false)
	print("[probe-visuals] stopped: ", tab.sending.is_empty())


## dev probe (WO-873): each scene (and tunnel + particles) with a burst, the canvas saved as <dir>/<scene>.png, then quit.
static func shots(tab: Node, dir: String) -> void:
	await tab.get_tree().create_timer(3.0).timeout
	tab.mixer.set_running(true)
	tab.set_process(true)
	for d in tab.mixer.decks:
		RenderingServer.viewport_set_measure_render_time(d.get_viewport_rid(), true)
	var r: Dictionary = await tab._g("DevicesTarget").box_api.get_json("/api/shaders/sh-sa-ribbons")  # WO-874 layer shots
	tab.scene.set_shader(r.data if r.get("ok") else null)
	for pair in [["rings", ""], ["particles", ""], ["starfield", ""], ["tunnel", ""], ["tunnel", "particles"],
			["shader", "particles"], ["tunnel", "shader"], ["spectrum", ""], ["spectrum", "shader"], ["tunnel", "spectrum"],
			["game", ""], ["tunnel", "game"], ["game", "spectrum"]]:
		tab.scene.set_layers(pair[0], pair[1])
		await tab.get_tree().create_timer(1.0).timeout
		var gpu := 0.0
		for i in 30:  # GPU ms of the canvas viewport, mean over 30 frames
			await tab.get_tree().process_frame
			gpu += RenderingServer.viewport_get_measured_render_time_gpu(tab.scene.get_viewport().get_viewport_rid()) / 30.0
		if pair[0] != "spectrum":  # WO-875: the spectrum shots show the music, not a burst
			tab.scene.fire()
		await tab.get_tree().create_timer(0.25).timeout
		var shot: String = str(pair[0]) + ("+" + str(pair[1]) if pair[1] != "" else "")
		var err: int = tab.out_vp.get_texture().get_image().save_png("%s/%s.png" % [dir, shot])
		print("[probe-visuals] shot %s → %s · canvas %dx%d GPU %.2f ms" % [shot, error_string(err), tab.out_vp.size.x, tab.out_vp.size.y, gpu])
	# WO-877: halfway through a 2 s crossfade (both decks on the canvas), then the master at half on the new look
	tab.mixer.go("tunnel", "particles", null, 2.0)
	await tab.get_tree().create_timer(1.0).timeout
	print("[probe-visuals] fade x %.2f live %d" % [tab.mixer.x, tab.mixer.live])
	tab.out_vp.get_texture().get_image().save_png("%s/fade-mid.png" % dir)
	await tab.get_tree().create_timer(1.5).timeout
	tab.mixer.level = 0.5
	await tab.get_tree().create_timer(0.6).timeout
	tab.out_vp.get_texture().get_image().save_png("%s/master-half.png" % dir)
	print("[probe-visuals] master %.2f, fading %s" % [tab.mixer.master, tab.mixer.fading()])
	tab.get_tree().quit()


## dev probe (WO-874): every library shader as the main scene for 1 s — compile result, canvas GPU ms (mean of 20 frames),
## mean brightness — and a 320-wide shot <dir>/<id>.png; then quit.
static func shaders(tab: Node, dir: String) -> void:
	await tab.get_tree().create_timer(3.0).timeout
	tab.mixer.set_running(true)
	tab.set_process(true)
	for d in tab.mixer.decks:
		RenderingServer.viewport_set_measure_render_time(d.get_viewport_rid(), true)
	tab.slice.scene = "shader"
	tab.slice.overlay = ""
	tab.scene.set_layers("shader", "")
	var api: Variant = tab._g("DevicesTarget").box_api
	var l: Dictionary = await api.get_json("/api/shaders")
	var list: Array = l.data.shaders if l.get("ok") else []
	print("[probe-shaders] %d shaders, canvas %dx%d" % [list.size(), tab.out_vp.size.x, tab.out_vp.size.y])
	for row in list:
		var r: Dictionary = await api.get_json("/api/shaders/" + str(row.id).uri_encode())
		var e: String = tab.scene.set_shader(r.data if r.get("ok") else {})
		await tab.get_tree().create_timer(0.8).timeout
		var gpu := 0.0
		for i in 20:
			await tab.get_tree().process_frame
			gpu += RenderingServer.viewport_get_measured_render_time_gpu(tab.scene.get_viewport().get_viewport_rid()) / 20.0
		var img: Image = tab.out_vp.get_texture().get_image()
		img.resize(320, maxi(1, 320 * img.get_height() / img.get_width()))
		var lum := 0.0
		for y in range(0, img.get_height(), 4):
			for x in range(0, img.get_width(), 4):
				lum += img.get_pixel(x, y).get_luminance()
		lum /= ceilf(img.get_height() / 4.0) * ceilf(img.get_width() / 4.0)
		img.save_png("%s/%s.png" % [dir, row.id])
		var st := 0.0
		for layer in tab.scene.layers:
			if layer.has_method("set_shader"):
				st = float(layer.get("runner").gpu_ms)
		print("[probe-shaders] %s · %s · canvas GPU %.2f ms · shader GPU %.2f ms · lum %.3f" % [row.id, "OK" if e == "" else e,
			gpu, st, lum])
	tab.get_tree().quit()

