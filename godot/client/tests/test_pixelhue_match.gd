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


func test_status_line() -> void:
	t.eq(M.status_line(false, {"error": "PixelHue at 10.0.0.9 did not answer: timeout"}), "PixelHue at 10.0.0.9 did not answer: timeout", "the server's reason")
	t.eq(M.status_line(true, {"device": {"ip": "10.0.0.7", "port": 8088}, "screens": [
		{"enabled": true, "layers": [{"enabled": true, "scene": "pgm"}, {"enabled": false, "scene": "pgm"}, {"enabled": true, "scene": "pvw"}]},
		{"enabled": false, "layers": [{"enabled": true, "scene": "pgm"}]}]}),
		"Connected — device 10.0.0.7:8088 · 1 screen(s) · 1 program layer(s)", "connected: what was read")
	t.eq(M.status_line(false, null), "No answer from the server.", "no body")


## The UI scripts are not instantiated by any suite: at least they compile with the autoloads present.
func test_ui_scripts_compile() -> void:
	for p in ["res://features/devices/pixelhue_panel.gd", "res://features/live/pixelhue_layers_list.gd", "res://features/live/live_sources_panel.gd",
			"res://features/devices/devices_tab.gd", "res://features/live/layer_inspector.gd", "res://features/previs/tracking/presenters_section.gd"]:
		var s: GDScript = load(p)
		t.ok(s != null and s.can_instantiate(), p + " compiles")
