extends "res://e2e/e2e_scenario.gd"
## WO-843 — the four GUI checks the headless suite could not make, driven with real mouse / key events through the viewport:
##  1. the timeline splitter drag keeps the other ui.cfg keys (haze set through the Previs toolbar picker, a Previs fold
##     clicked) — the old splitter saved the ConfigFile it loaded when the tab was built and wrote every key back stale;
##  2. blurring an untouched media inspector In field saves nothing (the old blur re-read "0:01.05" as 1.05 s and POSTed
##     1050) — proven on the server's media-library registry file (a save rewrites it) and on the stored trim;
##  3. Delete / Ctrl+D in Previs Camera mode leave the stage object alone (3D mode still removes it: the probe's control);
##  4. a click at ≥ 16× zoom in the pixel map draws no 1×1 region (a real drag at that zoom still draws one).
## Needs the pixel-map fixture (run-gui-e2e.js starts it for this scenario, like 07_pixel_map) and HIGHASCG_E2E_SANDBOX.

const View := preload("res://features/previs/fixtures/pixel_map_view.gd")
const CLIP := "e2e_bars"
const SLUG := "e2e_pixel_map"
const UI_CFG := "user://ui.cfg"

var split: SplitContainer
var win: AcceptDialog
var view: Control


func _cfg() -> ConfigFile:
	var c := ConfigFile.new()
	c.load(UI_CFG)
	return c


func _previs() -> Node:
	return ui.root.shell.tabs.get_node("Previs")


## A control in the tree (visible, maybe scrolled out of the Inspector's view) by its text.
func _in_tree(cls: String, text: String) -> Control:
	for c in ui.all(cls, null, false):
		if (c as Control).is_visible_in_tree() and ui.label_of(c) == text:
			return c
	return null


func _fold_button() -> Control:
	for c in ui.all("BaseButton", null, false):
		var t: String = ui.label_of(c)
		if (c as Control).is_visible_in_tree() and t.begins_with("▾ ") and t != "▾ Stage":  # (step 3 needs the Stage fold open)
			return c
	return null


# ---------------------------------------------------------------- 1. splitter

func _splitter() -> String:
	var tab: Control = await ui.tab("Timeline")
	var splits: Array = ui.all("VSplitContainer", tab)
	if splits.is_empty():
		return "no splitter on the Timeline tab"
	split = splits[0]
	var a := Vector2(ui.screen_rect(split).position.x + ui.screen_rect(split).size.x * 0.5, 0)
	var first: Control = split.get_child(0)
	a.y = ui.screen_rect(first).end.y + (ui.screen_rect(split.get_child(1)).position.y - ui.screen_rect(first).end.y) * 0.5
	var before := split.split_offset
	var why: String = await ui.press_drag(split, a, a + Vector2(0, 90))
	if why != "":
		return why
	if split.split_offset == before:
		return "the splitter did not move (offset %d) — the drag missed the divider at %s" % [before, a]
	var cfg := _cfg()
	if int(cfg.get_value("timeline", "preview_h", -1)) != split.split_offset:
		return "ui.cfg [timeline] preview_h %s, the splitter sits at %d" % [cfg.get_value("timeline", "preview_h", null), split.split_offset]
	return ""


# ---------------------------------------------------------------- 2. media inspector

func _registry() -> String:
	return OS.get_environment("HIGHASCG_E2E_SANDBOX") + "/data/media-library/registry.json"


func _trim() -> Variant:
	var r: Dictionary = await api("/api/media/library/entry?path=%s.mp4" % CLIP)
	var d: Variant = r.data.get("entry", {}).get("defaults", {}) if r.get("data") is Dictionary else {}
	return d.get("trimInMs") if d is Dictionary else null


func _media_tree() -> Tree:
	var sources: Array = ui.root.shell.find_children("*", "Tree", true, false).filter(func(t: Tree) -> bool:
		return ui.shown(t) and ui.tree_item(t, CLIP) != null)
	return sources[0] if not sources.is_empty() else null


func _in_field() -> Control:
	var e: Control = ui.find("LineEdit", "start")
	return e if e != null and e.get_parent().get_child_count() >= 4 else null


# ---------------------------------------------------------------- 3. previs keys

func _objects() -> int:
	return _previs().stage_panel.builder.objects.size()


func _stored_objects() -> Variant:
	var r: Dictionary = await api("/api/project")
	var root: Variant = r.data.get("project", r.data) if r.get("data") is Dictionary else {}
	var p: Variant = root.get("previs", {}) if root is Dictionary else {}
	return ((p as Dictionary).get("stage", {}) as Dictionary).get("objects", []).size() if p is Dictionary else -1


func _add_wall() -> String:
	var btn: Control = ui.find("MenuButton", "Add ▾")
	if btn == null:
		btn = _in_tree("MenuButton", "Add ▾")
	if btn == null:
		return "no Add ▾ menu in the Previs Inspector"
	await ui.reveal(btn)
	var why: String = await ui.click(btn)
	if why != "":
		return why
	var pm: PopupMenu = (btn as MenuButton).get_popup()
	if not pm.visible:
		return "the Add menu did not open"
	pm.id_pressed.emit(0)  # "LED wall" (the popup is a Window, not a Control: same as ui.choose)
	pm.hide()
	await ui.frames(3)
	return ""


# ---------------------------------------------------------------- 4. pixel map

func _open_pixel_map() -> String:
	await ui.tab("Previs")
	var b3d: BaseButton = ui.button("3D")
	if b3d != null and not b3d.button_pressed:
		await ui.click(b3d)
	var btn: Variant = await ui.wait_for(func() -> Variant: return _in_tree("BaseButton", "Pixel map…"), 10.0)
	for fold in ["▸ Lighting", "▸ DMX output"]:  # a fold closed in this client's ui.cfg
		var f: Control = _in_tree("BaseButton", fold)
		if btn == null and f != null:
			await ui.reveal(f)
			await ui.click(f)
			btn = await ui.wait_for(func() -> Variant: return _in_tree("BaseButton", "Pixel map…"), 3.0)
	if btn == null:
		return "no \"Pixel map…\" button in the Previs Inspector"
	await ui.reveal(btn)
	var why: String = await ui.click(btn)
	if why != "":
		return why
	win = await ui.wait_for(func() -> Variant:
		for w in ui.root.find_children("*", "AcceptDialog", true, false):
			if (w as Window).visible and (w as Window).title.begins_with("Pixel map"):
				return w
		return null, 5.0)
	if win == null:
		return "the Pixel map window did not open"
	var vs: Array = win.find_children("*", "Control", true, false).filter(func(c: Node) -> bool: return c.get_script() == View)
	view = vs[0] if not vs.is_empty() else null
	return expect(view != null and ui.shown(view), "the window has no picture view")


func _regions() -> int:
	return (win.get("regions") as Array).size()


func _wheel(at: Vector2, up: bool) -> void:
	ui._move(at, 0)
	for pressed in [true, false]:
		var e := InputEventMouseButton.new()
		e.position = at
		e.global_position = at
		e.button_index = MOUSE_BUTTON_WHEEL_UP if up else MOUSE_BUTTON_WHEEL_DOWN
		e.pressed = pressed
		ui.vp().push_input(e, true)


func run() -> void:
	await step("1 Timeline splitter drag keeps haze and the Previs folds in ui.cfg", func() -> String:
		await ui.tab("Previs")
		var haze: OptionButton = ui.find("OptionButton", "Haze in the 3D views", null, false)
		if haze == null:
			return "no haze picker on the Previs toolbar"
		var why: String = await ui.choose(haze, "Thick haze")
		if why != "":
			return why
		var fold: Control = _fold_button()
		if fold == null:
			return "no fold section in the Previs Inspector"
		await ui.reveal(fold)
		why = await ui.click(fold)  # writes [previs_folds]
		if why != "":
			return why
		var cfg := _cfg()
		var folds: PackedStringArray = cfg.get_section_keys("previs_folds") if cfg.has_section("previs_folds") else PackedStringArray()
		if absf(float(cfg.get_value("previs", "haze", -1.0)) - 1.0) > 0.001 or folds.is_empty():
			return "setup: ui.cfg should hold haze 1.0 and a fold key after the real clicks (haze %s, folds %s)" % [cfg.get_value("previs", "haze", null), folds]
		var kept := {}
		for k in folds:
			kept[k] = cfg.get_value("previs_folds", k)
		print("[e2e] ui.cfg before the drag: haze 1.0, folds %s" % str(kept))
		why = await _splitter()
		if why != "":
			return why
		cfg = _cfg()
		if absf(float(cfg.get_value("previs", "haze", -1.0)) - 1.0) > 0.001:
			return "the splitter drag clobbered haze: ui.cfg [previs] haze = %s (was 1.0)" % cfg.get_value("previs", "haze", null)
		for k in kept:
			if cfg.get_value("previs_folds", k, null) != kept[k]:
				return "the splitter drag clobbered fold %s: %s (was %s)" % [k, cfg.get_value("previs_folds", k, null), kept[k]]
		print("[e2e] after the drag: preview_h %s, haze %s, folds intact" % [cfg.get_value("timeline", "preview_h"), cfg.get_value("previs", "haze")])
		return ""
	)
	await step("2 Blurring an untouched media In field makes no save", func() -> String:
		if OS.get_environment("HIGHASCG_E2E_SANDBOX") == "":
			return "HIGHASCG_E2E_SANDBOX is not set (run via tools/e2e/run-gui-e2e.js)"
		await ui.tab("Live")
		var why: String = await ui.pick_tab("Media")
		if why != "":
			return why
		var tree: Tree = await ui.wait_for(_media_tree, 15.0)
		if tree == null:
			return "%s never appeared in Sources → Media" % CLIP
		await ui.click_at(ui.tree_item_point(tree, ui.tree_item(tree, CLIP)))
		var e: Control = await ui.wait_for(_in_field, 10.0)
		if e == null:
			return "the media inspector's In field never showed (is the file in the media library?)"
		var t0 := FileAccess.get_modified_time(_registry())
		await ui.sleep(1.2)
		# a real edit first: 1.2 s at 25 fps shows as 0:01.05 (frames); the old blur re-read that as 1.05 s = 1050 ms
		why = await ui.type_into(e, "1.2")
		if why != "":
			return why
		why = await await_api("/api/media/library/entry?path=%s.mp4" % CLIP, func(d: Variant) -> bool:
			return int(d.get("entry", {}).get("defaults", {}).get("trimInMs", -1)) == 1200, "the typed 1.2 s trim was not stored")
		if why != "":
			return why
		var t1 := FileAccess.get_modified_time(_registry())
		if t1 <= t0:
			return "probe check: a real trim save did not touch the registry file (mtime %d -> %d)" % [t0, t1]
		await ui.frames(10)
		var shown: String = (e as LineEdit).text
		if shown != "0:01.05":
			return "the In field shows \"%s\", expected 0:01.05 (1200 ms @ 25 fps)" % shown
		await ui.sleep(1.3)
		# now focus the field with a click and blur it with Tab, with the text untouched
		await ui.click(e)
		if not (e as LineEdit).has_focus():
			return "the click did not focus the In field"
		ui._key(KEY_TAB)
		await ui.frames(3)
		if (e as LineEdit).has_focus():
			return "Tab did not blur the In field"
		await ui.sleep(1.5)
		var t2 := FileAccess.get_modified_time(_registry())
		var trim: Variant = await _trim()
		print("[e2e] registry mtime after real save %d, after blur %d; stored trimInMs %s; field \"%s\"" % [t1, t2, trim, (e as LineEdit).text])
		if t2 != t1:
			return "the blur re-saved the trim (registry mtime %d -> %d, stored trimInMs %s)" % [t1, t2, trim]
		return expect(int(trim) == 1200 and (e as LineEdit).text == "0:01.05", "trim %s / field \"%s\" changed by the blur" % [trim, (e as LineEdit).text])
	)
	await step("3 Delete and Ctrl+D in Previs Camera mode keep the stage object", func() -> String:
		await ui.tab("Previs")
		var b3d: BaseButton = ui.button("3D")
		if b3d != null and not b3d.button_pressed:
			await ui.click(b3d)
		var n0 := _objects()
		var why := await _add_wall()
		if why == "":
			why = await _add_wall()
		if why != "":
			return why
		var n := _objects()
		if n != n0 + 2:
			return "setup: two LED walls should make %d objects, there are %d" % [n0 + 2, n]
		var why2: String = await await_api("/api/project", func(d: Variant) -> bool:
			var pr: Variant = d.get("project", d).get("previs", {})
			return pr is Dictionary and ((pr.get("stage", {}) as Dictionary).get("objects", []) as Array).size() == n, "the autosave never stored %d stage objects" % n)
		if why2 != "":
			return why2
		if _previs().stage_panel.selected_id() == "":
			return "setup: the new wall is not selected"
		var cam: BaseButton = ui.button("Camera")
		why = await ui.click(cam)
		if why != "" or _previs().mode != "camera":
			return why if why != "" else "Camera mode did not open"
		ui._move(Vector2(900, 500), 0)
		ui._key(KEY_DELETE)
		ui._key(KEY_BACKSPACE)
		ui._key(KEY_D, 0, true)
		await ui.sleep(2.5)
		if _objects() != n:
			return "Delete / Backspace / Ctrl+D in Camera mode changed the stage: %d -> %d objects" % [n, _objects()]
		var stored: Variant = await _stored_objects()
		if int(stored) != n:
			return "the project stores %s stage objects after the Camera-mode keys, expected %d" % [stored, n]
		# control: the same Delete in 3D mode removes the selected object (so the probe can tell)
		why = await ui.click(ui.button("3D"))
		if why != "" or _previs().mode != "3d":
			return why if why != "" else "3D mode did not open"
		ui._key(KEY_DELETE)
		await ui.sleep(0.5)
		if _objects() != n - 1:
			return "control: Delete in 3D mode should remove the selection (%d -> %d)" % [n, _objects()]
		return await await_api("/api/project", func(d: Variant) -> bool:
			var pr: Variant = d.get("project", d).get("previs", {})
			return pr is Dictionary and ((pr.get("stage", {}) as Dictionary).get("objects", []) as Array).size() == n - 1, "control: the 3D Delete was not stored")
	)
	await step("4a Setup: the loopback MHP patch with a Pixel Line head", func() -> String:
		var why := await await_api("/api/settings", func(d: Variant) -> bool:
			return JSON.stringify(d.get("channelMap", {}).get("channelResolutionsByChannel", {})).contains("\"1\""), "no channel 1 raster (run via tools/e2e/run-gui-e2e.js)", 15.0)
		if why != "":
			return why
		var res: Dictionary = await post("/api/project/load", {"slug": SLUG, "broadcastProject": true})
		if not res.ok:
			return "load %s: %s" % [SLUG, res.error]
		why = await await_api("/api/fixtures/pixelmap/pixels", func(d: Variant) -> bool:
			for f in (d.get("fixtures", []) if d is Dictionary else []):
				if f.get("name") == "Pixel Line IP 1042":
					return true
			return false, "the Pixel Line head is not in the sandbox patch", 15.0)
		if why != "":
			return why
		await ui.sleep(1.5)
		return await _open_pixel_map()
	)
	await step("4b A click at 16x zoom draws no region, a drag still does", func() -> String:
		var ob: OptionButton = ui.find("OptionButton", "The Caspar channel whose output the regions sample", win)
		await ui.wait_for(func() -> bool: return ob != null and ob.item_count > 0, 10.0)
		var why: String = await ui.choose(ob, "Channel 1 (Program 1) · 1920×1080")
		if why != "":
			return why
		var n0 := _regions()
		var sc := view.get_global_transform_with_canvas().get_scale()
		var r: Rect2 = ui.screen_rect(view)
		var at: Vector2 = r.position + (view.call("to_view", Vector2(1000, 900)) as Vector2) * sc  # empty picture, no region there
		for i in 18:
			_wheel(at, true)
			await ui.frames(1)
		var z := float(view.get("_zoom"))
		if z < 16.0:
			return "setup: zoom is %.1f×, wanted at least 16×" % z
		await ui.shot("%s_zoomed" % name)
		var px: float = view.call("_scale") * 1.0
		await ui.click_at(at)
		await ui.frames(3)
		var n1 := _regions()
		print("[e2e] zoom %.1fx (%.1f view px per channel pixel): regions %d -> %d after a click" % [z, px, n0, n1])
		if n1 != n0:
			var g: Dictionary = (win.get("regions") as Array)[n1 - 1]
			return "a click at %.1f× zoom created %d region(s) (last %s)" % [z, n1 - n0, g]
		# control: a real drag at the same zoom draws one
		why = await ui.press_drag(view, at, at + Vector2(70, 50))
		if why != "":
			return why
		return expect(_regions() == n0 + 1, "control: a 70 px drag at %.1f× should draw a region (%d -> %d)" % [z, n0, _regions()])
	)
