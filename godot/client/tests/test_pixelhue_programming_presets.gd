extends RefCounted
## WO-1039 — programming_presets_model.gd (device presets, layer presets, group sources, gallery) and
## programming_fx_model.gd (layer effects as rows → the `effect` object lib/layer-effects.js planEffects accepts).

const P := preload("res://features/pixelhue/programming_presets_model.gd")
const FX := preload("res://features/pixelhue/programming_fx_model.gd")
const M := preload("res://features/pixelhue/programming_model.gd")
const T := preload("res://tests/test_pixelhue_programming.gd")
var t

const PRESETS := [{"guid": "g1", "serial": 1, "name": "tstow", "sourceRegion": 4, "loadType": 1, "screens": ["Screen 1", "Screen 2"]},
	{"guid": "g2", "serial": 3, "name": "Rel", "sourceRegion": 2, "loadType": 2, "screens": []}]


func test_slots() -> void:
	t.eq(P.first_free(PRESETS), 2, "first free slot")
	var opts := P.slot_options(PRESETS)
	t.eq(opts[0], [1, "1 · tstow (overwrite)"], "used slot")
	t.eq(opts[1], [2, "2 · empty"], "free slot")
	t.eq(opts.size(), 11, "empties up to 8 past the highest used")
	t.eq(P.default_name(PRESETS, 3), "Rel", "occupant's name")
	t.eq(P.default_name(PRESETS, 4), "Preset 4", "new name")
	t.eq(P.first_free([]), 1, "empty bank")


func test_save_requests() -> void:
	var r := P.save_request(PRESETS, 4, 2, " Look A ", [3, 1])
	t.eq(r.body, {"action": "preset-save", "name": "Look A", "scene": 4, "serial": 2, "overwrite": false, "screenIds": [3, 1]}, "absolute save")
	t.eq(r.message, "Preset 2 saved from PVW.", "message")
	t.eq(r.overwrite, "", "free slot")
	var o := P.save_request(PRESETS, 2, 1, "X", [1], true, ["3-3"], [100])
	t.eq(o.body.overwrite, true, "overwrite flag")
	t.eq(o.body.relative, true, "relative")
	t.eq(o.body.params, ["3-3"], "params")
	t.eq(o.body.layerIds, [100], "layers")
	t.eq(o.overwrite, "tstow", "asks before overwriting")
	t.eq(o.message, "Preset 1 overwritten from PGM (relative).", "message")
	t.eq(P.save_request(PRESETS, 4, 2, "  ", [1]).error, "Give the preset a name.", "name required")
	t.eq(P.save_request(PRESETS, 4, 2, "x", [1], true, [], [1]).error, "Choose the layer settings a relative preset stores.", "params required")
	t.eq(P.save_request(PRESETS, 4, 2, "x", [1], true, ["3-2"], []).error, "Choose the layers a relative preset stores.", "layers required")
	t.ok(P.save_request(PRESETS, 4, 2, "é".repeat(33), [1]).has("error"), "64 UTF-8 bytes")


func test_load_requests() -> void:
	var p: Dictionary = PRESETS[0]
	t.eq(P.load_request(p, 4, true, true, 800, true).body, {"action": "preset-load", "guid": "g1", "target": 4, "effect": false, "keyframes": false, "time": 0, "swap": true}, "to PVW: no transition")
	t.eq(P.load_request(p, 2, true, true, 800, false).body, {"action": "preset-load", "guid": "g1", "target": 2, "effect": true, "keyframes": true, "time": 800, "swap": false}, "to PGM with transition + keyframes")
	t.eq(P.load_request(p, 2, false, true, 800, true).body.keyframes, false, "keyframes only with the transition")
	var a := P.load_request(p, P.AUTO, false, false, 700, true)
	t.eq(a.body, {"action": "preset-autotake", "guid": "g1", "time": 700, "swap": true}, "auto-take")
	t.eq(a.message, "tstow: loaded to PVW, confirmed, taken.", "message")
	t.eq(P.preset_title(PRESETS[1]), "3. Rel ·rel", "relative title")
	t.eq(P.preset_tooltip(p, 2), "Load to PGM · absolute · saved from PVW · Screen 1, Screen 2", "tooltip")
	t.eq(P.rename_request(p, "New").body, {"action": "preset-rename", "guid": "g1", "name": "New"}, "rename")
	t.eq(P.rename_request(p, "tstow"), {}, "unchanged name sends nothing")
	t.eq(P.delete_body(p), {"action": "preset-delete", "guid": "g1"}, "delete")
	t.eq(P.scene_layers(T.state(), [1], 4).size(), 2, "relative layer choices")


func test_layer_presets() -> void:
	var info := {"supported": true, "colors": ["#257cff", "#e96a6a"], "parts": [["source", "Source"], ["pos", "Position"], ["cutFill", "Cut & Fill"]], "list": [{"id": 2, "name": "schadow", "color": "#257cff", "parts": ["shadow"]}]}
	var l := {"id": 100, "screenId": 1, "fx": {"cutFill": {"enable": false}}}
	var choices := P.part_choices(info, l, [])
	t.eq(choices, [["source", "Source", false], ["pos", "Position", true]], "source off by default, Cut & Fill hidden")
	t.eq(P.layer_preset_apply(l, info.list[0]).body, {"action": "layerpreset-apply", "screenId": 1, "id": 100, "presetId": 2}, "apply")
	var s := P.layer_preset_save(info, l, "", "#e96a6a", ["pos", "cutFill"])
	t.eq(s.body, {"action": "layerpreset-save", "screenId": 1, "id": 100, "name": "Layer preset 2", "color": "#e96a6a", "parts": ["pos"]}, "save drops cutFill")
	t.eq(P.layer_preset_save(info, l, "x", "#e96a6a", []).error, "Choose what the layer preset stores.", "parts required")
	t.eq(P.layer_preset_rename(info.list[0], "Glow").body, {"action": "layerpreset-update", "presetId": 2, "name": "Glow"}, "rename")
	t.eq(P.layer_preset_delete(info.list[0]), {"action": "layerpreset-delete", "presetId": 2}, "delete")


func test_groups_and_gallery() -> void:
	var s := T.state()
	t.eq(P.group_line(s, s.groupSources[0]), "Side by side · Input 1-DP 1.2 | Input 8-HDMI 2.0", "group line")
	t.eq(P.group_line(s, s.groupSources[1]), "Top / bottom · Input 1-DP 1.2 / missing source", "missing source")
	t.eq(P.group_options(s)[0], ["2:25", "IN 1 · Input 1-DP 1.2"], "menu entry")
	t.eq(P.group_save(1, "V", " P ", "2:25", "3:3").body, {"action": "groupsource-save", "screenId": 1, "orientation": "V", "name": "P", "sources": [{"type": 2, "id": 25}, {"type": 3, "id": 3}]}, "save")
	t.eq(P.group_save(1, "H", "", "2:25", "2:25").error, "Choose two different sources.", "same source")
	t.eq(P.group_delete(1, s.groupSources[0]), {"action": "groupsource-delete", "screenId": 1, "id": "u-1"}, "delete")
	var gal := {"support": {"bkg": {"maxWidth": 65535}, "logo": {"maxWidth": 512, "maxHeight": 512}}, "pictures": [{"id": 15, "type": 1, "name": "PGM 1", "width": 3072, "height": 896, "used": true}, {"id": 2, "type": 2, "name": "logo"}]}
	t.eq(P.pictures(gal, 1).size(), 1, "backgrounds")
	t.ok(P.supports(gal, "logo"), "logos supported")
	t.ok(not P.supports({"support": {"bkg": null}}, "bkg"), "not supported")
	t.eq(P.picture_line(gal.pictures[0]), "3072 × 896 · in use", "line")
	t.eq(P.capture_name(gal), "PGM 2", "next free capture name")
	t.ok(P.gallery_help(gal, 2).contains("512 × 512"), "logo help")
	t.eq(P.gallery_rename(gal.pictures[0], "B"), {"action": "rename", "id": 15, "name": "B"}, "rename")
	t.eq(P.gallery_delete(gal.pictures[0]), {"action": "delete", "ids": [15]}, "delete")
	t.eq(P.gallery_capture({"id": 1}, " Cap "), {"action": "capture", "source": "pgm", "id": 1, "name": "Cap"}, "capture")


func _fx_layer() -> Dictionary:
	return M.ints({"id": 1, "screenId": 1, "type": 2, "sourceType": 2, "window": {"x": 0, "y": 0, "width": 1920, "height": 1080},
		"fx": {"opacity": 100, "flipH": false, "flipV": false, "mono": false, "inverse": false, "locked": false,
			"border": {"enable": false, "style": 1, "h": 2, "v": 2, "color": "#3460d8", "opacity": 100},
			"mask": {"enable": false, "left": 0, "right": 0, "top": 0, "bottom": 0},
			"shadow": {"enable": false, "feather": 5, "width": 100, "height": 100, "x": 5, "y": 5, "color": "#000000", "opacity": 100},
			"quality": {"brightness": 100, "contrast": 100, "hue": 0, "saturation": 100},
			"crop": {"enable": false, "x": 0, "y": 0, "width": 100000, "height": 100000},
			"key": {"enable": false, "type": 2, "strength": 50, "gainAdjust": 0, "smartColor": "#000000"},
			"cutFill": {"enable": true, "x": 0, "y": 0, "width": 100, "height": 100, "startX": 0, "startY": 0, "endX": 255, "endY": 255, "inverse": false, "sourceId": 0, "sourceType": 0}}})


func _row(sections: Array, id: String, label: String) -> Dictionary:
	for s in sections:
		if s.id == id:
			for r in s.rows:
				if str(r.get("label")) == label:
					return r
	return {}


func test_fx_sections() -> void:
	var st := T.state()
	st.effects = {"opacity": true, "flip": true, "mono": true, "inverse": true, "mask": true, "shadow": true, "border": true, "quality": true, "crop": true, "key": true, "cutFill": true,
		"borderStyles": [[1, "Outer"], [3, "Soft"]]}
	var l := _fx_layer()
	var secs := FX.sections(st, l)
	t.eq(secs.map(func(s: Dictionary) -> String: return s.id), ["look", "border", "mask", "shadow", "colour", "crop", "key", "cutfill"], "all sections")
	var aux := l.duplicate(true)
	aux.type = 4
	t.eq(FX.sections(st, aux).map(func(s: Dictionary) -> String: return s.id), ["look", "mask", "colour", "crop"], "AUX layer")
	st.effects = {"opacity": true}
	t.eq(FX.sections(st, l).size(), 1, "unsupported sections are not shown")
	var locked := l.duplicate(true)
	locked.fx.locked = true
	t.eq(FX.sections(st, locked)[0].rows.size(), 2, "locked: only the unlock switch + a note")


func test_fx_effects() -> void:
	var st := T.state()
	st.effects = {"opacity": true, "border": true, "crop": true, "cutFill": true, "key": true, "mask": true}
	var l := _fx_layer()
	var secs := FX.sections(st, l)
	var fx: Dictionary = l.fx
	t.eq(FX.effect(_row(secs, "look", "Opacity"), 55.4, fx), {"opacity": 55}, "opacity")
	t.eq(FX.effect(_row(secs, "look", "Locked on device"), true, fx), {"locked": true}, "lock")
	t.eq(FX.effect(_row(secs, "border", "Width"), 600, fx), {"border": {"h": 512}}, "clamped to the device range")
	t.eq(FX.effect(_row(secs, "border", "Colour"), "#ff0000", fx), {"border": {"color": "#ff0000"}}, "colour")
	t.eq(FX.effect(_row(secs, "border", "Reset border"), null, fx), {"border": FX.BORDER_RESET}, "reset")
	t.eq(FX.effect(_row(secs, "crop", "X %"), 10.0, fx), {"crop": {"x": 10000, "width": 90000}}, "crop x keeps the crop inside")
	t.eq(FX.effect(_row(secs, "crop", "Width %"), 50.05, fx), {"crop": {"width": 50050}}, "crop width")
	t.eq(_row(secs, "crop", "Width %").value, 100.0, "percent shown")
	t.eq(FX.effect(_row(secs, "cutfill", "Cut source"), "2:25", fx), {"cutFill": {"source": {"id": 25, "type": 2}}}, "cut source")
	t.eq(FX.effect(_row(secs, "cutfill", "Cut source"), "0:0", fx), {"cutFill": {"reset": true}}, "no cut source = reset")
	t.eq(FX.effect(_row(secs, "key", "Type"), 0, fx), {"key": {"type": 0}}, "key type")
	t.eq(FX.effect(_row(secs, "mask", "Left px"), 5000, fx), {"mask": {"left": 1920}}, "mask px up to the width")
	t.eq(FX.color_hex(Color(1, 0, 0)), "#ff0000", "hex")
	t.eq(FX.pct(12345), 12.3, "ratio → percent")
