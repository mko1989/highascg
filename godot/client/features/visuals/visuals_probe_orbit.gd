extends RefCounted
## WO-896 dev probe — `--probe-visuals-orbit=<dir>` (visuals_tab.gd _ready): the 3D view's orbit vs the OUTPUT canvas. Saves the
## output (the mixer's canvas, what Send publishes) as <dir>/NN-*.png and prints how far each shot is from the reference.
## A probe client: it never saves the box's project (ProjectSync.project_gone) nor writes the operator's ring (pair with
## --visuals-ring=probe896). No pointer: the orbit is set and `orbit_changed` emitted the way a mouse drag would.

const M := preload("res://features/visuals/visuals_model.gd")
const Probes := preload("res://features/visuals/visuals_probes.gd")
const Cam := preload("res://features/visuals/visuals_camera.gd")
const EMPTY := {"nodes": [], "links": []}  # no Flow: nothing moves the picture but the camera


static func run(tab: Node, dir: String) -> void:
	await tab.get_tree().create_timer(4.0).timeout
	tab._g("ProjectSync").project_gone = true
	tab.mixer.set_running(true)
	tab.set_process(true)
	var w = tab.work
	w.set_mode("3d")
	tab.slice.graph = EMPTY
	tab.slice.params = M.params_of({"spin": 0.0, "pulse": 0.0, "speed": 0.0, "glow": 0.3})
	tab.slice.fade = 0.0
	M.with_layers(tab.slice, Probes.stack(["rings"]))  # static with spin / pulse 0 → a pose-less shot repeats exactly
	await tab._go(true)
	var ref := await _shot(tab, dir, "00-home")
	var still := await _shot(tab, dir, "00-home-again")
	print("[probe-orbit] noise floor (same pose twice): %.4f" % _diff(ref, still))
	w.orbit = Vector3(1.0, 0.5, 25.0)
	w.orbit_changed.emit()
	print("[probe-orbit] drive OFF, orbit (1.0, 0.5, 25): output pose %s · diff to home %.4f" % [
		tab.mixer.deck().cam, _diff(ref, await _shot(tab, dir, "01-drive-off-orbited"))])
	w.drive.button_pressed = true
	var on := await _shot(tab, dir, "02-drive-on-orbited")
	print("[probe-orbit] drive ON: output pose %s · diff to home %.4f" % [tab.mixer.deck().cam, _diff(ref, on)])
	w.orbit = Vector3(-0.8, 0.2, 18.0)
	w.orbit_changed.emit()
	var moved := await _shot(tab, dir, "03-drive-on-moved")
	print("[probe-orbit] drive ON, orbit (-0.8, 0.2, 18): pose %s · diff to the last %.4f" % [tab.mixer.deck().cam, _diff(on, moved)])
	tab.page.show_panel.save.emit(-1)  # look 1
	w.orbit = Cam.HOME
	w.orbit_changed.emit()
	var home := await _shot(tab, dir, "04-orbit-home")
	print("[probe-orbit] orbit back home (driving): diff to the reference %.4f" % _diff(ref, home))
	w.drive.button_pressed = false
	w.orbit = Vector3(2.0, -0.4, 40.0)
	w.orbit_changed.emit()
	await _shot(tab, dir, "05-before-recall")
	tab.show_ctl.recall(0)
	var back := await _shot(tab, dir, "06-look-recalled")
	print("[probe-orbit] look recalled: drive %s pose %s · diff to the saved framing %.4f" % [w.drive.button_pressed, tab.mixer.deck().cam,
		_diff(moved, back)])
	# the Shader backdrop at the extreme angles of the orbit
	var r: Dictionary = await tab._g("DevicesTarget").box_api.get_json("/api/shaders/sh-sa-ribbons")
	tab._shader_cache["sh-sa-ribbons"] = r.data if r.get("ok") else null
	M.with_layers(tab.slice, Probes.stack(["shader"]))
	tab.slice.camera.drive = true
	await tab._go(true)
	await tab.get_tree().create_timer(1.0).timeout
	for p in [Cam.HOME, Vector3(2.9, 1.3, 80.0), Vector3(PI, 0.0, 6.0), Vector3(-1.2, -1.4, 3.0)]:
		w.orbit = p
		w.orbit_changed.emit()
		var img := await _shot(tab, dir, "07-shader-%s" % str(p).replace(" ", "").replace("(", "").replace(")", ""))
		print("[probe-orbit] shader backdrop at pose %s: edge brightness %.3f · centre %.3f" % [tab.mixer.deck().cam, _edge(img), _lum(img, 0.4, 0.6)])
	tab.get_tree().quit()


static func _shot(tab: Node, dir: String, name: String) -> Image:
	for i in 12:
		await tab.get_tree().process_frame
	await RenderingServer.frame_post_draw
	var img: Image = tab.out_vp.get_texture().get_image()
	img.save_png("%s/%s.png" % [dir, name])
	return img


## Mean absolute colour difference of two shots (0 = identical, 1 = black vs white), compared at 64×36.
static func _diff(a: Image, b: Image) -> float:
	var x := a.duplicate() as Image
	var y := b.duplicate() as Image
	x.resize(64, 36)
	y.resize(64, 36)
	var s := 0.0
	for j in 36:
		for i in 64:
			var p := x.get_pixel(i, j)
			var q := y.get_pixel(i, j)
			s += (absf(p.r - q.r) + absf(p.g - q.g) + absf(p.b - q.b)) / 3.0
	return s / (64.0 * 36.0)


## Mean brightness of the outer 5 % frame of the shot — a backdrop that stops covering shows black here.
static func _edge(img: Image) -> float:
	var w := img.get_width()
	var h := img.get_height()
	var s := 0.0
	var n := 0
	for j in range(0, h, 4):
		for i in range(0, w, 4):
			if i < w * 0.05 or i > w * 0.95 or j < h * 0.05 or j > h * 0.95:
				s += img.get_pixel(i, j).get_luminance()
				n += 1
	return s / maxf(1.0, n)


static func _lum(img: Image, a: float, b: float) -> float:
	var w := img.get_width()
	var h := img.get_height()
	var s := 0.0
	var n := 0
	for j in range(int(h * a), int(h * b), 4):
		for i in range(int(w * a), int(w * b), 4):
			s += img.get_pixel(i, j).get_luminance()
			n += 1
	return s / maxf(1.0, n)
