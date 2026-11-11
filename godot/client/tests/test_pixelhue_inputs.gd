extends RefCounted
## WO-1039 — Inputs sub-tab logic: staged changes, Studio's request bodies, advanced settings, tiles, timing.
const M := preload("res://features/pixelhue/inputs_model.gd")
const A := preload("res://features/pixelhue/inputs_adv_model.gd")
var t


func _row() -> Dictionary:
	return {"key": "100:0", "label": "Input 1", "number": 1, "fixedPort": false, "supportsEdid": true, "family": "HDMI/DP",
		"capacityEditable": true, "capacityChoices": [1, 2], "portKey": "8:0", "capacity": 1,
		"ports": [
			{"key": "8:0", "type": 8, "label": "DP 1.2", "id": 25, "name": "A", "workMode": 0, "signal": "x",
				"edid": {"width": 1920, "height": 1080, "frame": 50, "standardType": 6, "interlaced": 0, "mode": 0, "fileName": ""}},
			{"key": "6:1", "type": 6, "label": "HDMI 2.0", "id": 26, "name": "B", "workMode": 2, "signal": "y",
				"edid": {"width": 3840, "height": 1080, "frame": 60, "standardType": 0, "interlaced": 0, "mode": 0, "fileName": ""}}]}


func test_untouched_rows_stage_nothing() -> void:
	var rows := [_row()]
	t.eq(M.pending(rows, M.drafts_for(rows)).size(), 0, "no edits, no changes")


func test_name_and_edid_edits_are_staged_in_studios_shape() -> void:
	var rows := [_row()]
	var dr := M.drafts_for(rows)
	var d: Dictionary = dr["100:0"]
	d.name = "Cam"
	d.nameTouched = true
	d.edid.width = 1280
	d.edidTouched = true
	var c: Array = M.pending(rows, dr)
	t.eq(c.size(), 1, "one change")
	t.eq(c[0].key, "100:0", "key")
	t.eq(c[0].portKey, "8:0", "portKey kept")
	t.eq(c[0].name, "Cam", "name")
	t.eq(c[0].edid.width, 1280, "edid width")
	t.eq(c[0].edid.keys().size(), 5, "edid has the five keys only")


func test_choosing_a_port_resets_name_and_edid_and_stages_a_mode_change() -> void:
	var rows := [_row()]
	var dr := M.drafts_for(rows)
	M.choose_port(rows[0], dr["100:0"], "6:1")
	t.eq(dr["100:0"].name, "B", "name of the new port")
	var c: Array = M.pending(rows, dr)
	t.eq(c[0].portKey, "6:1", "new port staged")
	t.ok(not c[0].has("name"), "name untouched is not sent")


func test_preset_and_fill_selected() -> void:
	var rows := [_row()]
	var dr := M.drafts_for(rows)
	M.fill(rows, dr, {"100:0": true}, "hdmi", "2", "Cam {n}", "3840,2160,60")
	var c: Array = M.pending(rows, dr)
	t.eq(c[0].portKey, "6:1", "hdmi family picked")
	t.eq(c[0].capacity, 2, "capacity")
	t.eq(c[0].name, "Cam 1", "name template")
	t.eq(c[0].edid.height, 2160, "preset")
	t.eq(c[0].edid.standardType, 6, "preset is CEA")
	var dr2 := M.drafts_for(rows)
	M.fill(rows, dr2, {}, "dp", "", "x", "")
	t.eq(M.pending(rows, dr2).size(), 0, "unchecked rows untouched")


func test_edid_from_file_mode_is_resent_when_edited_to_same_values() -> void:
	var r := _row()
	r.ports[0].edid.mode = 1
	var rows := [r]
	var dr := M.drafts_for(rows)
	dr["100:0"].edidTouched = true
	t.eq(M.pending(rows, dr).size(), 1, "mode != 0 counts as a change once touched")


func test_validation_mirrors_the_server() -> void:
	var rows := [_row()]
	t.ok(M.validate(rows, [{"key": "100:0", "name": ""}]) != "", "empty name")
	t.ok(M.validate(rows, [{"key": "100:0", "name": "é".repeat(17)}]) != "", "over 32 bytes")
	t.eq(M.validate(rows, [{"key": "100:0", "name": "ok"}]), "", "fine name")
	t.ok(M.validate(rows, [{"key": "100:0", "edid": {"width": 10, "height": 1080, "frame": 50}}]) != "", "width < 64")
	t.ok(M.validate(rows, [{"key": "100:0", "edid": {"width": 1920, "height": 1080, "frame": 300}}]) != "", "hz > 240")
	t.eq(M.validate(rows, [{"key": "100:0", "edid": {"width": 1920, "height": 1080, "frame": 59.94}}]), "", "good edid")


func test_labels() -> void:
	t.eq(M.capacity_label(1), "DL", "dl")
	t.eq(M.capacity_label(9), "Device managed", "unknown")
	t.eq(M.dirty_label(0), "No pending input changes", "none")
	t.eq(M.dirty_label(1), "1 pending input change", "one")
	t.eq(M.dirty_label(3), "3 pending input changes", "many")
	t.eq(M.counts_label({"inputs": [{"family": "HDMI/DP"}, {"family": "SDI"}]}), "2 inputs · 1 HDMI/DP + 1 SDI", "counts")
	t.eq(M.port_signal({"workMode": 2, "signal": "s"}), "Inactive · s", "inactive")


func test_advanced_diff_and_change() -> void:
	var row := {"id": 2, "values": {"hdcp.enable": 0, "imageQuality.hue": 0}, "mosaic": {"side": "none", "group": 0}}
	var vals := {"hdcp.enable": 1.0, "imageQuality.hue": 0.0}
	t.eq(A.settings_diff(row, vals).size(), 1, "only changed")
	var m := {"side": "none", "group": 0}
	A.set_side(m, "left")
	t.eq(m.group, 1, "side without group goes to group 1")
	t.ok(A.mosaic_changed(row, m), "mosaic moved")
	var c := A.change_for(row, vals, m)
	t.eq(c.id, 2, "id")
	t.eq(c.settings["hdcp.enable"], 1, "setting")
	t.eq(c.mosaic.side, "left", "mosaic")
	A.set_group(m, 0)
	t.eq(m.side, "none", "group none = side off")
	t.eq(A.pending_label(0), "No pending advanced settings", "label")


func test_setting_validation() -> void:
	var opt := {"label": "HDCP", "options": [[0, "Off"], [1, "On"]]}
	t.eq(A.validate_setting(opt, 1), "", "option ok")
	t.ok(A.validate_setting(opt, 5) != "", "option bad")
	var q := {"label": "Gamma", "min": 0.5, "max": 3, "step": 0.1}
	t.eq(A.validate_setting(q, 2.2), "", "step ok")
	t.ok(A.validate_setting(q, 2.25) != "", "off step")
	t.ok(A.validate_setting({"label": "B", "min": 0, "max": 200, "step": 1}, 100.5) != "", "int field fractional")
	t.ok(A.validate_setting({"label": "B", "min": 0, "max": 200, "step": 1}, 201) != "", "out of range")


func test_tiles_and_bulk_bodies() -> void:
	var st := {"inputs": [
		{"id": 2, "name": "A", "mosaicSupported": true, "mosaic": {"side": "left", "group": 1}, "fields": [{"key": "compatibilityMode"}]},
		{"id": 4, "name": "B", "mosaicSupported": true, "mosaic": {"side": "right", "group": 1}, "fields": [{"key": "compatibilityMode"}]},
		{"id": 5, "name": "C", "mosaicSupported": true, "mosaic": {"side": "none", "group": 0}, "fields": []},
		{"id": 13, "name": "S", "mosaicSupported": false, "mosaic": {"side": "none", "group": 0}, "fields": []}]}
	t.eq(A.free_group(st), 2, "first unused group")
	t.eq(A.used_groups(st), [1], "used groups")
	t.eq(A.group_label(st, 1), "Group 1: left — A / right — B", "label")
	t.eq(A.remove_group_changes(st, 1).size(), 2, "remove both tiles")
	t.eq(A.remove_group_changes(st, 1)[0].mosaic.group, 0, "group 0")
	var comp := A.compat_changes(st, 1)
	t.eq(comp.size(), 2, "bulk mac only for supporting inputs")
	t.eq(comp[0].settings.compatibilityMode, 1, "mode")
	var p := A.pair_changes(2, 4, 3, true)
	t.eq(p[0].mosaic.side, "left", "left first")
	t.eq(p[1].settings.compatibilityMode, 1, "compat on")
	t.ok(not A.pair_changes(2, 4, 3, false)[0].has("settings"), "compat off omits settings")


func _timing() -> Dictionary:
	return {"refresh": 60.0,
		"horizontal": {"active": 1920, "front": 88, "sync": 44, "total": 2200, "polarity": 1},
		"vertical": {"active": 1080, "front": 4, "sync": 5, "total": 1125, "polarity": 1}}


func test_timing_info_validation_and_body() -> void:
	var tm := _timing()
	t.eq(A.back_porch(tm.horizontal), 148, "H back porch")
	t.eq(A.timing_info(tm), "Back porch H 148 / V 36 · pixel clock 148.50 MHz", "info line")
	t.eq(A.validate_timing(tm), "", "valid")
	tm.vertical.total = 1000
	t.ok(not A.timing_ok(tm), "negative back porch")
	t.eq(A.timing_info(tm), "Total must be at least active + front porch + sync.", "reason")
	t.ok(A.validate_timing(tm) != "", "server would refuse")
	var good := _timing()
	good.refresh = 59.941
	t.ok(A.validate_timing(good) != "", "more than two decimals")
	var b := A.timing_body(25, _timing())
	t.eq(b.id, 25, "id")
	t.eq(b.timing.horizontal.total, 2200, "total")
	t.eq(b.timing.keys().size(), 3, "refresh + two axes")
