extends RefCounted
## WO-612 T7 — Export…: this project's WO-614 stage as an .mvr (GET /api/stage/mvr-export, built on the server from the
## saved project). Out of mvr_section.gd for the 500-line limit (WO-681).

const FilePick := preload("res://features/devices/file_pick.gd")


static func run(host: Node, status: Label) -> void:
	var name := str(Store.project.get("name", "stage")).validate_filename().replace(" ", "_")
	var path: String = await FilePick.save_path(host, "Export the stage as MVR", (name if name != "" else "stage") + ".mvr", ["*.mvr ; MVR scene"])
	if path == "":
		return
	if not path.to_lower().ends_with(".mvr"):
		path += ".mvr"
	status.text = "Exporting…"
	ProjectSync.flush()  # the server builds it from the saved project: let the latest stage edit land first
	while ProjectSync.in_flight:
		await host.get_tree().process_frame
	var res: Dictionary = await Api.get_bytes("/api/stage/mvr-export")
	if not res.ok:
		var body: Variant = JSON.parse_string((res.bytes as PackedByteArray).get_string_from_utf8())
		status.text = "Export failed: %s" % (body.get("error", res.error) if body is Dictionary else res.error)
		return
	var err := FilePick.write_bytes(path, res.bytes)
	status.text = ("Exported the stage to %s" % path) if err == "" else "Export failed: %s" % err
