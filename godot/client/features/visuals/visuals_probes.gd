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



## dev probe (WO-877/880 on air): with --probe-visuals-channel=<ch>, Send to that Caspar channel and check each show
## control on Caspar's own output (PRINT through the node, e2e_probe.gd) against the canvas at the same moment: Send,
## the master at half, blackout and back, a crossfade, Send off. Prints + a line per step into <dir>, then quit.
static func onair(tab: Node, dir: String) -> void:
	await tab.get_tree().create_timer(4.0).timeout
	var P: GDScript = load("res://e2e/e2e_probe.gd")  # load, not preload: exports leave e2e/ out
	var pr: RefCounted = P.new()
	var sc := _Box.new(tab)
	var media := ProjectSettings.globalize_path("res://").path_join("../../media").simplify_path()
	var ch: int = tab.page.screen_channel()
	var shot := func(name: String) -> Dictionary:
		var canvas: Dictionary = P.stats(tab.out_vp.get_texture().get_image())
		var p: Dictionary = await pr.print_once(sc, ch, media, "%s/%s.png" % [dir, name])
		if not p.ok:
			print("[probe-onair] %s: %s" % [name, p.error])
			return {}
		var s: Dictionary = P.stats(p.img)
		print("[probe-onair] %s: air %s · canvas luma %.0f" % [name, P.fmt(s), canvas.luma])
		return s
	tab.mixer.go("tunnel", "particles", null, 0.0, true)
	await tab.send(true)
	print("[probe-onair] send ch %d: %s · %s" % [ch, tab.sending, tab.page._note.text])
	await tab.get_tree().create_timer(2.0).timeout
	await shot.call("1-send")
	tab.mixer.level = 0.5
	await tab.get_tree().create_timer(1.2).timeout
	await shot.call("2-master-half")
	tab.mixer.level = 1.0
	tab.mixer.blackout = true
	await tab.get_tree().create_timer(1.2).timeout
	await shot.call("3-blackout")
	tab.mixer.blackout = false
	await tab.get_tree().create_timer(1.2).timeout
	await shot.call("4-back")
	tab.mixer.go("rings", "", null, 1.0)
	await tab.get_tree().create_timer(1.6).timeout
	await shot.call("5-crossfaded")
	await tab.send(false)
	await tab.get_tree().create_timer(1.0).timeout
	await shot.call("6-send-off")
	tab.get_tree().quit()


## What e2e_probe.gd's print_once needs of a scenario: post() to the box and ui.sleep().
class _Box:
	extends RefCounted
	var tab: Node
	var ui: _Sleep

	func _init(t: Node) -> void:
		tab = t
		ui = _Sleep.new(t)

	func post(path: String, body: Dictionary) -> Dictionary:
		return await tab._g("DevicesTarget").box_api.post_json(path, body)


class _Sleep:
	extends RefCounted
	var tab: Node
	var shots_dir := ""

	func _init(t: Node) -> void:
		tab = t

	func sleep(s: float) -> void:
		await tab.get_tree().create_timer(s).timeout


## dev probe (WO-878 live): three looks, the autopilot every 4 bars on the box's beat grid for `secs`, then a pick between
## two beats; each look change is printed with the beat it landed on. A probe client: it never saves the box's project.
static func autopilot(tab: Node, secs: float) -> void:
	await tab.get_tree().create_timer(4.0).timeout
	tab._g("ProjectSync").project_gone = true
	var Looks: GDScript = load("res://features/visuals/visuals_looks.gd")
	var ctl: Node = tab.show_ctl
	var looks := []
	for s in ["tunnel", "rings", "particles"]:
		tab.slice.scene = s
		looks.append(Looks.capture(tab.slice, s))
	ctl.looks = looks
	tab.slice.looks = looks
	tab.slice.auto = {"bars": 4, "drops": false, "quantise": true}
	ctl.recall(0)
	var watch := func(ms: float, label: String) -> Array:  # [look changes, beats] seen within `ms`
		var t0 := Time.get_ticks_msec()
		var seen: int = ctl.showing
		var n := -1
		var beat_at := 0
		var counts := [0, 0]
		while Time.get_ticks_msec() - t0 < ms:
			await tab.get_tree().process_frame
			var b: Variant = ctl._live_beat()
			if b is Dictionary and int(b.n) != n:
				n = int(b.n)
				beat_at = Time.get_ticks_msec()
				counts[1] += 1
			if ctl.showing != seen:
				seen = ctl.showing
				counts[0] += 1
				print("[probe-auto] %s t=%.2f s → look %d on beat n %d (%d ms after it reached the client) · %s BPM locked %s" % [
					label, (Time.get_ticks_msec() - t0) / 1000.0, seen + 1, n, Time.get_ticks_msec() - beat_at,
					str(b.get("bpm")) if b is Dictionary else "-", str(b.get("locked")) if b is Dictionary else "-"])
		return counts
	var c: Array = await watch.call(secs * 1000.0, "auto")
	print("[probe-auto] autopilot: %d changes over %d beats in %.0f s" % [c[0], c[1], secs])
	tab.slice.auto = {"bars": 0, "drops": false, "quantise": true}
	await tab.get_tree().create_timer(0.25).timeout  # between two beats
	var picked: int = (int(ctl.showing) + 1) % looks.size()
	ctl.pick(picked)
	print("[probe-auto] picked look %d: on stage at once %s, pending %d" % [picked + 1, ctl.showing == picked, ctl._st.pending])
	c = await watch.call(2000.0, "pick")
	print("[probe-auto] pick landed: %s" % (ctl.showing == picked))
	tab.get_tree().quit()
