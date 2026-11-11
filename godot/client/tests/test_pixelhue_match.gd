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
