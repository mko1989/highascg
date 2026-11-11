extends RefCounted
## WO-1035 — pixelhue_match_model.gd: which switcher layers a look layer can copy, and the patch a pick makes.

const M := preload("res://features/live/pixelhue_match_model.gd")
var t


func test_choices_are_enabled_program_layers_with_a_rectangle() -> void:
	var fill := {"x": 0.5, "y": 0.25, "scaleX": 0.25, "scaleY": 0.5}
	var data := {"screens": [
		{"name": "Screen 1", "enabled": true, "layers": [
			{"name": "", "type": "bkg", "scene": "pgm", "enabled": true, "fill": fill},
			{"name": "PIP", "type": "normal", "scene": "pgm", "enabled": true, "x": 1536, "y": 256, "width": 768, "height": 512, "source": "Input 7", "fill": fill},
			{"name": "Next", "type": "normal", "scene": "pvw", "enabled": true, "fill": fill},
			{"name": "Off", "type": "normal", "scene": "pgm", "enabled": false, "fill": fill},
			{"name": "Tile", "type": "mvr", "scene": "pgm", "enabled": true, "fill": fill},
			{"name": "Aux", "type": "aux", "scene": "pgm", "enabled": true, "fill": fill},
			{"name": "NoSize", "type": "normal", "scene": "pgm", "enabled": true}]},
		{"name": "Screen 2", "enabled": false, "layers": [{"name": "X", "scene": "pgm", "enabled": true, "fill": fill}]}]}
	var c := M.choices(data)
	t.eq(c.size(), 1, "only the enabled program layer with a rectangle on an enabled screen")
	t.eq(c[0].label, "Screen 1 · PIP · 768×512 at 1536,256 · Input 7", "label says where it is")
	t.eq(M.choices(null), [], "no answer → no choices")


func test_patch_copies_the_rectangle_and_stretches_to_it() -> void:
	var p := M.patch_for({"fill": {"x": 0.5, "y": 0.25, "scaleX": 0.25, "scaleY": 0.5}})
	t.eq(p, {"fill": {"x": 0.5, "y": 0.25, "scaleX": 0.25, "scaleY": 0.5}, "contentFit": "stretch", "aspectLocked": false}, "rectangle + stretch, no aspect lock")


func test_dragged_row_is_an_empty_placeholder_that_carries_the_rectangle() -> void:
	var fill := {"x": 0.5, "y": 0.25, "scaleX": 0.25, "scaleY": 0.5}
	var p := M.drag_payload({"name": "Screen 1 · PIP", "fill": fill})
	t.eq([p.type, p.value, p.isPlaceholder, p.label], ["media", "#00000000", true, "PixelHue · Screen 1 · PIP"], "transparent black: nothing on fill or key")
	t.eq(M.patch_of_source(p), {"fill": fill, "contentFit": "stretch", "aspectLocked": false}, "the drop puts the layer on the rectangle")
	t.eq(M.patch_of_source({"type": "media", "value": "clip.mov"}), {}, "any other source: no rectangle")
	# WO-1038: the placeholder remembers its switcher layer
	var linked := M.drag_payload({"name": "Screen 1 · PIP", "fill": fill, "layerId": 121831424, "screenId": 1})
	t.eq(M.link_of_source(linked), {"layerId": 121831424, "screenId": 1, "name": "Screen 1 · PIP", "drive": true}, "link carried by the drag")
	t.eq(M.link_of_source(p), {}, "an older row without ids: no link")
	var layer := {"pixelhue": M.link_of_source(linked)}
	t.eq(M.drive_patch(layer, false).pixelhue.drive, false, "unticking keeps the link, stops the drive")
	t.eq(M.link_of_layer({"source": {}}), {}, "an ordinary layer has no link")
	# the source the switcher layer shows on take
	var routed: Dictionary = M.source_patch(layer, {"id": 31, "type": 2, "name": "Input 7", "connectorType": 8, "connected": true}).pixelhue
	t.eq(routed.source, {"id": 31, "type": 2, "name": "Input 7", "connectorType": 8}, "a picked source is kept on the link")
	t.eq([M.source_label({"pixelhue": routed}), M.source_label(layer)], ["Input 7", "Leave the switcher's source"], "what the closed drop-down shows")
	t.ok(not (M.source_patch({"pixelhue": routed}, {}).pixelhue as Dictionary).has("source"), "\"leave\" removes it")
	var rows := M.source_choices({"sources": [{"id": 31, "type": 2, "name": "Input 7", "connected": true}, {"id": 5, "type": 2, "name": "Input 5", "connected": false}]})
	t.eq(rows.map(func(r: Dictionary) -> String: return r.label), ["Leave the switcher's source", "Input 7", "Input 5  (no signal)"], "source rows")


func test_status_line() -> void:
	t.eq(M.status_line(false, {"error": "PixelHue at 10.0.0.9 did not answer: timeout"}), "PixelHue at 10.0.0.9 did not answer: timeout", "the server's reason")
	t.eq(M.status_line(true, {"device": {"ip": "10.0.0.7", "port": 8088}, "screens": [
		{"enabled": true, "layers": [{"enabled": true, "scene": "pgm"}, {"enabled": false, "scene": "pgm"}, {"enabled": true, "scene": "pvw"}]},
		{"enabled": false, "layers": [{"enabled": true, "scene": "pgm"}]}]}),
		"Connected — device 10.0.0.7:8088 · 1 screen(s) · 1 program layer(s)", "connected: what was read")
	t.eq(M.status_line(false, null), "No answer from the server.", "no body")


func test_empty_placeholder_layers_are_recognised() -> void:
	t.ok(M.is_empty_placeholder({"source": {"type": "media", "value": "#00000000", "isPlaceholder": true}}), "a dropped switcher layer")
	t.ok(not M.is_empty_placeholder({"source": {"type": "media", "value": "#FF112233", "isPlaceholder": true}}), "a solid offline placeholder plays a colour")
	t.ok(not M.is_empty_placeholder({"source": {"type": "media", "value": "clip.mov"}}), "media")
	t.ok(not M.is_empty_placeholder({}), "no source")
