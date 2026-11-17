extends RefCounted
## WO-1108 dev probe: --probe-previs-output=<dir> turns the Previs output on in THIS client only (never saved into the
## project), renders ~2 s, saves the output viewport as <dir>/previs_output.png, prints one line (ring, size, the
## publisher's skipped frames, whether the sink is open, the status line) and quits. The ring is `previs-probe` unless
## --previs-ring names one (previs_output_model.gd ring_name), so the operator's `previs` ring is never written.

const OM := preload("res://features/previs/output/previs_output_model.gd")


static func run(c: Node, dir: String) -> void:
	var tree := c.get_tree()
	for i in 40:  # up to ~20 s for the project (the stage, MVR and walls load with it)
		if not Store.project.is_empty():
			break
		await tree.create_timer(0.5).timeout
	await tree.create_timer(2.0).timeout
	var out := OM.of_project(Store.project)
	out.enabled = true
	c.probe_cfg = out
	c.output.force_render = true
	c._apply()
	await tree.create_timer(2.0).timeout
	var o: Node = c.output
	DirAccess.make_dir_recursive_absolute(dir)
	var path := dir.path_join("previs_output.png")
	var err: int = o.vp.get_texture().get_image().save_png(path)
	print("[probe-previs-output] ring %s · %dx%d · skipped %d · sink %s · png %s · %s" % [o.ring, o.vp.size.x, o.vp.size.y,
		o.publisher.skipped, "open" if o.running() else "closed", path if err == OK else "error %d" % err, o.status_text()])
	o.force_render = false
	c.probe_cfg = {}
	o.publisher.stop()
	tree.quit()
