extends RefCounted
## WO-918 — Devices tab sweep fixes: size / fps upper bounds (F16), the Main index cap (F17), the Operator GUI type
## option (F18), the remove-destination confirm text (F21), project-change follow (F1/F5) and the apply layout warning (F3).

const Page := preload("res://features/devices/destination_inspector.gd")
const DM := preload("res://features/devices/destinations_model.gd")
const Follow := preload("res://features/devices/devices_follow_model.gd")
var t


func _entry(d: Dictionary) -> Dictionary:
	return {"id": d.id, "label": d.get("label", d.id), "mode": d.get("mode", "pgm_prv"), "host": false,
		"connector": "", "dest": d, "intent": null}


func _page(d: Dictionary, payload: Dictionary, calls: Array) -> Page:
	var p := Page.new()
	p.patch.connect(func(id: String, body: Dictionary) -> void: calls.append([id, body]))
	p.show_destination(_entry(d), payload, {})
	return p


func _line(p: Node, caption: String) -> LineEdit:
	for v in p.get_children():
		if v is VBoxContainer and v.get_child_count() == 2 and (v.get_child(0) as Label).text == caption:
			return v.get_child(1)
	return null


func test_f16_size_and_fps_upper_bounds() -> void:
	t.eq(DM.width({"width": 99999}), 16384, "stored width clamps for display")
	t.eq(DM.height({"height": "70000"}), 16384, "height")
	t.eq(DM.fps({"fps": 1000}), 240.0, "fps")
	t.eq(DM.width({"width": 3840}), 3840, "in range untouched")
	t.eq(DM.fps({"fps": 59.94}), 59.94, "fractional fps untouched")
	t.eq(DM.size_patch("width", "99999", "", "", {"width": 1920, "height": 1080}), {"videoMode": "custom", "width": 16384, "height": 1080}, "width patch")
	t.eq(DM.size_patch("height", "", "20000", "", {"width": 1920, "height": 1080}), {"videoMode": "custom", "width": 1920, "height": 16384}, "height patch")
	t.eq(DM.size_patch("fps", "", "", "1000", {}), {"videoMode": "custom", "fps": 240.0}, "fps patch")
	var d := {"id": "x", "mode": "pgm_prv", "videoMode": "custom", "width": 2048, "height": 858, "fps": 24}
	for row in [["Width", "99999", "16384"], ["Frame rate", "1000", "240.00"], ["Frame rate", "960/4", "240.00"],
			["Width", "10", "64"]]:
		var calls := []
		var p := _page(d, {}, calls)
		var le := _line(p, row[0])
		le.text = row[1]
		le.text_submitted.emit(le.text)
		t.eq(le.text, row[2], "%s typed %s" % row.slice(0, 2))
		p.free()
	var calls2 := []
	var p2 := _page(d, {}, calls2)
	var w := _line(p2, "Width")
	w.text = "99999"
	w.text_submitted.emit(w.text)
	t.eq(calls2[0][1].width, 16384, "the patch carries the clamped width")
	p2.free()


func test_f17_main_index_stops_at_the_screen_count() -> void:
	var one := [{"id": "a", "mode": "pgm_prv"}, {"id": "g", "mode": "operator_gui"}, {"id": "m", "mode": "multiview"}]
	var two := one + [{"id": "b", "mode": "pgm_only"}]
	t.eq(DM.main_index_max(one[0], one), 0.0, "one main-bus screen: only 0")
	t.eq(DM.main_index_max(two[0], two), 1.0, "two main-bus screens: 0..1")
	t.ok(DM.main_index_max(one[2], one) == INF, "multiview index is a placement hint")
	t.ok(DM.main_index_max(one[1], one) == INF, "operator GUI too")
	t.ok(DM.main_index_max(one[0], []) == INF, "unknown list: no cap")
	# Page: the only screen -> read-only 0; with two screens a typed 5 lands on 1 (and says so in the field).
	var calls := []
	var p := _page(two[0], {"screenDestinations": {"destinations": one}}, calls)
	var le := _line(p, "Main index")
	t.eq([le.editable, le.text], [false, "0"], "single screen: locked at 0")
	t.ok(le.tooltip_text.contains("only PGM/PRV screen"), "says why")
	p.free()
	var p2 := _page(two[0], {"screenDestinations": {"destinations": two}}, calls)
	var le2 := _line(p2, "Main index")
	t.eq(le2.editable, true, "two screens: editable")
	le2.text = "5"
	le2.text_submitted.emit(le2.text)
	t.eq([le2.text, calls[0][1]], ["1", {"mainScreenIndex": 1}], "5 clamps to 1, never silently 0")
	t.ok(le2.tooltip_text.contains("0-1"), "tooltip names the range")
	p2.free()


func test_f18_operator_gui_option() -> void:
	t.eq(DM.has_operator_gui([{"mode": "pgm_prv"}, {"mode": "operator_gui"}]), true, "one exists")
	t.eq(DM.has_operator_gui([{"mode": "pgm_prv"}]), false, "none")
	t.eq(DM.has_operator_gui([]), false, "empty")
	var src := FileAccess.get_file_as_string("res://features/devices/destinations_panel.gd")
	t.ok(src.contains("_type.set_item_disabled(i, has_gui)") and src.contains("_sync_type_options()"), "the panel syncs the list on every model")


func test_f21_remove_confirm() -> void:
	var scenes := {"scenes": [{"mainScope": "1"}, {"mainScope": "1"}, {"mainScope": "0"}, {"mainScope": "all"}, {}]}
	t.eq(DM.looks_on_main(scenes, 1), 2, "two looks on main 1")
	t.eq(DM.looks_on_main(scenes, 0), 1, "one on main 0 (all is nobody's)")
	t.eq(DM.looks_on_main(scenes, 3), 0, "none")
	t.eq(DM.looks_on_main(null, 0), 0, "no scenes")
	t.eq(DM.remove_confirm("Prog", 0, 1), "", "nothing to warn about: no confirm")
	t.eq(DM.remove_confirm("Prog", 2, 1), "Remove \"Prog\"?\n\n2 looks on this screen stay in the project but are hidden until a screen uses main index 1 again.", "plural")
	t.ok(DM.remove_confirm("Prog", 1, 0).contains("1 look on this screen stays in the project but is hidden"), "singular")
	var src := FileAccess.get_file_as_string("res://features/devices/destinations_panel.gd")
	t.ok(src.contains("await _ask(warn, \"Remove\")"), "remove asks first")


func test_f1_f5_project_follow() -> void:
	t.eq(Follow.restart_on_activate("project.activated", {"restartRequired": true}), true, "load needing a restart")
	t.eq(Follow.restart_on_activate("project.activated", {"restartRequired": false}), false, "load without")
	t.eq(Follow.restart_on_activate("hardwareConfig", {"restartRequired": true}), false, "other path")
	t.eq(Follow.clears_status("project.activated", {}), true, "load clears the old status")
	t.eq(Follow.clears_status("hardwareConfig", {"applied": true}), true, "new project / apply-hardware clears it")
	t.eq(Follow.clears_status("hardwareConfig", {"applied": false}), false, "not applied")
	t.eq(Follow.clears_status("scene.live", {}), false, "unrelated change")
	t.eq(Follow.misaligned({"aligned": false, "serverChannelCount": 3}), true, "running layout differs")
	t.eq(Follow.misaligned({"aligned": true, "serverChannelCount": 3}), false, "matches")
	t.eq(Follow.misaligned({"aligned": false, "serverChannelCount": 0}), false, "not connected is unknown")
	t.eq(Follow.misaligned(null), false, "no comparison")


func test_f3_layout_warning() -> void:
	t.eq(Follow.layout_warning({"ok": true, "message": "done"}), "", "missing layoutOk counts as true")
	t.eq(Follow.layout_warning({"layoutOk": true}), "", "ok")
	t.eq(Follow.layout_warning({"layoutOk": false, "layoutProblem": "xrandr failed 3/3"}), "Display layout not applied: xrandr failed 3/3", "problem shown")
	t.ok(Follow.layout_warning({"layoutOk": false}).begins_with(Follow.WARN_PREFIX), "no problem text: still a warning")
	var srv := "Display layout was NOT applied: xrandr failed on every attempt (check the connected outputs and apply-layout.sh)."
	t.eq(Follow.layout_warning({"layoutOk": false, "layoutProblem": srv}), srv, "the server's sentence is not prefixed twice")
	t.eq(Follow.layout_warning(null), "", "no data")
	t.eq(Follow.status_color(true, false), Follow.ThemeBuilder.SUCCESS, "green")
	t.eq(Follow.status_color(false, true), Follow.ThemeBuilder.WARN, "warn colour")
	t.eq(Follow.status_color(false, false), Follow.ThemeBuilder.ERROR, "red")
	var bar := FileAccess.get_file_as_string("res://features/devices/devices_toolbar.gd")
	t.ok(bar.contains("func set_status(text: String, ok: bool, warn := false)") and bar.contains("Follow.status_color(ok, warn)"), "toolbar takes warn")


## WO-919 F13: after a Load / New the header reloads Settings; the shown local Devices tab refreshes then (its first
## refresh compared the old show's planned channelMap with the new live one and kept a stale host card).
func test_f13_refresh_after_settings_loaded() -> void:
	t.ok(Follow.refresh_on_settings_loaded("", true), "this machine, tab shown")
	t.ok(not Follow.refresh_on_settings_loaded("", false), "tab hidden: its visibility refresh reads the fresh settings")
	t.ok(not Follow.refresh_on_settings_loaded("peer-a", true), "an edited peer's planned map is not the local Settings")
