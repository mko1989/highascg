extends "res://e2e/e2e_scenario.gd"
## WO-960 — look editor snapping: dragging a layer so its centre comes within a few screen px of the canvas centre
## snaps it there and draws an accent guide line across the frame (checked in the rendered picture); the guides go
## on release, the stored fill is centred; with Ctrl held the same drag does not snap.

const CLIP := "e2e_bars"
const ThemeBuilder := preload("res://app/theme_builder.gd")

var ed: Node


static func _looks(d: Variant) -> Array:
	var p: Dictionary = d.get("project", d) if d is Dictionary else {}
	return (p.get("scenes", {}) as Dictionary).get("scenes", [])


func _media_tree() -> Tree:
	var trees: Array = ui.root.shell.find_children("*", "Tree", true, false).filter(func(t: Tree) -> bool:
		return ui.shown(t) and ui.tree_item(t, CLIP) != null)
	return trees[0] if not trees.is_empty() else null


## A canvas fraction → root-viewport px (where push_input aims).
func _pt(frac: Vector2) -> Vector2:
	var fr: Rect2 = ui.screen_rect(ed._frame)
	var sc: Vector2 = (ed._frame as Control).get_global_transform_with_canvas().get_scale()
	var b: Rect2 = ed._box()
	return fr.position + (b.position + frac * b.size) * sc


func _centre() -> Vector2:
	var f: Dictionary = ed._shown(ed._layers()[ed._sel])
	return Vector2(float(f.x) + float(f.scaleX) / 2.0, float(f.y) + float(f.scaleY) / 2.0)


func _motion(p: Vector2, ctrl: bool) -> void:
	if not ctrl:
		ui._move(p, MOUSE_BUTTON_MASK_LEFT)
		return
	var m := InputEventMouseMotion.new()  # e2e_ui._move carries no modifiers
	m.position = p
	m.global_position = p
	m.relative = p - ui._last
	m.button_mask = MOUSE_BUTTON_MASK_LEFT
	m.ctrl_pressed = true
	ui._last = p  # no Input.warp_mouse: the real pointer's motion would arrive after this one, without Ctrl
	ui.vp().push_input(m, true)


## Press on the layer's centre and move it to `to` (viewport px) in steps; the button stays down.
func _hold_drag(to: Vector2, ctrl := false) -> void:
	var a := _pt(_centre())
	ui._move(a, 0)
	await ui.frames(1)
	ui._button(a, MOUSE_BUTTON_LEFT, true, false)
	await ui.frames(1)
	for i in range(1, 13):
		_motion(a.lerp(to, i / 12.0), ctrl)
		await ui.frames(1)
	await ui.frames(2)


func _release(at: Vector2) -> void:
	ui._button(at, MOUSE_BUTTON_LEFT, false, false)
	await ui.frames(3)


## Accent-coloured pixels in the rendered frame along a vertical guide at viewport x (±2 px), sampled over the frame.
func _guide_pixels(x: float) -> int:
	await RenderingServer.frame_post_draw
	var img: Image = ui.vp().get_texture().get_image()
	var fr: Rect2 = ui.screen_rect(ed._frame)
	var n := 0
	for yi in range(int(fr.position.y) + 2, int(fr.end.y) - 2, 4):
		for dx in range(-2, 3):
			var px := int(round(x)) + dx
			if px >= 0 and px < img.get_width() and yi < img.get_height():
				var c: Color = img.get_pixel(px, yi)
				if absf(c.r - ThemeBuilder.ACCENT.r) < 0.12 and absf(c.g - ThemeBuilder.ACCENT.g) < 0.12 and absf(c.b - ThemeBuilder.ACCENT.b) < 0.12:
					n += 1
					break
	return n


func run() -> void:
	await step("A fresh show on the server", func() -> String:
		var why: String = await ui.click(ui.button("New project"))
		if why == "":
			why = await ui.click(await ui.await_control("BaseButton", "Start fresh", null, 3.0))
		if why != "":
			return why
		return await await_api("/api/project", func(d: Variant) -> bool:
			var p: Variant = d.get("project", d) if d is Dictionary else null
			return p is Dictionary and p.get("scenes") is Dictionary, "no project on the server", 10.0))
	await step("A PGM/PRV screen exists", func() -> String:
		var cm: Variant = (await api("/api/settings")).get("data", {}).get("channelMap")
		if not (cm is Dictionary and not ((cm as Dictionary).get("previewChannels", []) as Array).is_empty()):
			await ui.root.shell.tabs.get_node("Devices").get("_dests").add("pgm_prv")
		return await await_api("/api/settings", func(d: Variant) -> bool:
			return d is Dictionary and d.get("channelMap") is Dictionary and not (d.channelMap.get("previewChannels", []) as Array).is_empty(),
			"no PRV channel after adding a PGM/PRV screen", 10.0))
	await ui.tab("Live")
	await step("A look with a quarter-size layer open in the editor", func() -> String:
		# found here: the screen add re-pulls the project without its slug, and the editor opened on it closed itself at
		# the first autosave (look_editor_stale saw "another show") — fixed in look_editor_stale.opened_slug
		var why: String = await ui.pick_tab("Media")
		if why != "":
			return why
		if await ui.wait_for(_media_tree, 15.0) == null:
			return "%s never appeared in Sources → Media" % CLIP
		var tree := _media_tree()
		var plus: Control = await ui.await_control("BaseButton", "New look — or drop a media file here / on empty deck space")
		why = await ui.drag_from(ui.tree_item_point(tree, ui.tree_item(tree, CLIP)), plus)
		if why != "":
			return why
		ed = ui.root.shell.tabs.get_node("Live").editor
		if not await ui.wait_for(func() -> bool: return ui.shown(ed._frame) and ed._layers().size() == 1, 8.0):
			return "the look editor did not open with one layer (visible %s, %d layers, slug '%s' / '%s')" % [ed.visible, ed._layers().size(), ed.slug, Store.project.get("slug", "")]
		ed._select(0)
		ed._apply_layer({"fill": {"x": 0.08, "y": 0.1, "scaleX": 0.3, "scaleY": 0.3}})  # off-centre, well inside the canvas
		await ui.sleep(1.5)  # past the push debounce + autosave: the editor must still be open
		if not ed.visible:
			return "the editor closed by itself (slug '%s' / '%s')" % [ed.slug, Store.project.get("slug", "")]
		var c := _centre()
		return expect(absf(c.x - 0.5) > 0.1 and absf(c.y - 0.5) > 0.1, "the layer starts centred already: %s" % c))
	await step("Drag near the centre: it snaps and a guide line shows (button held)", func() -> String:
		var target := _pt(Vector2(0.5, 0.5)) + Vector2(5, -4)  # inside the 8 px threshold on both axes
		await _hold_drag(target)
		var c := _centre()
		if absf(c.x - 0.5) > 1e-4 or absf(c.y - 0.5) > 1e-4:
			return "the centre did not snap: %s" % c
		var g: Dictionary = ed._snap.guides
		if not (0.5 in g.x and 0.5 in g.y):
			return "no centre guides: %s" % g
		var n := await _guide_pixels(_pt(Vector2(0.5, 0.5)).x)
		return expect(n > 20, "the vertical centre guide is not in the picture (%d accent samples)" % n))
	await step("Release: the guides go, the stored fill is centred", func() -> String:
		await _release(_pt(Vector2(0.5, 0.5)))
		if not ed._drag.is_empty() or not (ed._snap.guides.x as Array).is_empty():
			return "guides survive the release: %s" % ed._snap.guides
		var sid: String = ed.scene_id
		return await await_api("/api/project", func(d: Variant) -> bool:
			for lk in _looks(d):
				if str(lk.get("id")) == sid and (lk.get("layers", []) as Array).size() == 1:
					var f: Dictionary = lk.layers[0].get("fill", {})
					return absf(float(f.get("x", 0)) + float(f.get("scaleX", 0)) / 2.0 - 0.5) < 1e-4 and absf(float(f.get("y", 0)) + float(f.get("scaleY", 0)) / 2.0 - 0.5) < 1e-4
			return false, "the server's look does not hold the centred fill", 10.0))
	await step("Ctrl held: the same nudge does not snap, no guide", func() -> String:
		var b: Rect2 = ed._box()
		var sc: Vector2 = (ed._frame as Control).get_global_transform_with_canvas().get_scale()
		var target := _pt(Vector2(0.5, 0.5)) + Vector2(5, -4)
		await _hold_drag(target, true)
		var c := _centre()
		var want := Vector2(0.5, 0.5) + Vector2(5, -4) / (b.size * sc)
		var g: Dictionary = ed._snap.guides
		var ok: bool = c.distance_to(want) < 0.002 and (g.x as Array).is_empty() and (g.y as Array).is_empty()
		await _release(target)
		return expect(ok, "centre %s (want ~%s), guides %s" % [c, want, g]))
