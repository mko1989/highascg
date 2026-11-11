extends RefCounted
## Exported clients (Windows / macOS / remote Linux). Files the client reads raw from res:// are only in an export
## when their .import says importer="keep": a headless export gives an SVG without one a texture import and leaves
## the SVG itself out, so the icon is blank on the exported client only (step_back / step_fwd / eyedropper, 11.11).
## The box-only shared-memory extensions (Linux libraries) stay out of every preset.

var t

const RAW_DIRS := ["res://assets/ui/icons/", "res://assets/ui/", "res://assets/ui/bounce/", "res://assets/devices/"]


func test_raw_assets_are_kept_in_exports() -> void:
	var seen := 0
	for d: String in RAW_DIRS:
		var dir := DirAccess.open(d)
		if dir == null:
			continue
		for f in dir.get_files():
			if not (f.ends_with(".svg") or f.ends_with(".png")):
				continue
			seen += 1
			var imp := FileAccess.get_file_as_string(d + f + ".import")
			t.ok(imp.contains("importer=\"keep\""), "%s%s has a keep .import (read raw at runtime)" % [d, f])
	t.ok(seen > 20, "the raw asset folders were found")


func test_presets_leave_out_box_only_extensions() -> void:
	var presets := FileAccess.get_file_as_string("res://export_presets.cfg")
	var filters := 0
	for line in presets.split("\n"):
		if line.begins_with("exclude_filter="):
			filters += 1
			t.ok(line.contains("addons/hshm/*") and line.contains("addons/hshm_sink/*"), "preset leaves out both hshm extensions")
	t.ok(filters >= 4, "every preset has an exclude filter")
