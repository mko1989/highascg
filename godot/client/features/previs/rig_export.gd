extends RefCounted
## WO-765 — Export calibrated rig…: the rig as the desk should see it (GET /api/stage/rig-export, built on the server
## from the saved project). An .mvr is the imported scene with each calibrated head moved to where its marks put it
## (same fixture UUIDs, IDs, addresses — everything else byte for byte); a .csv is the position table (MVR /
## grandMA3 axes), *.magicq.csv the same in MagicQ's axes and column headings for its CSV "Vis only" import.
## Used by the previs MVR section and Lighting → Calibrate heads.

const FilePick := preload("res://features/devices/file_pick.gd")


## "3 measured, 5 inferred, 0 unchanged" from the export report.
static func counts_line(report: Dictionary) -> String:
	var c: Dictionary = report.get("counts", {}) if report.get("counts") is Dictionary else {}
	var line := "%d measured, %d inferred, %d unchanged" % [int(c.get("calibrated", 0)), int(c.get("inferred", 0)), int(c.get("unchanged", 0))]
	if int(c.get("added", 0)) > 0:
		line += ", %d added" % int(c.added)
	return line


## The export path → its query: .magicq.csv / .csv / .mvr.
static func query_for(path: String) -> String:
	var p := path.to_lower()
	if p.ends_with(".magicq.csv"):
		return "?format=csv&desk=magicq"
	return "?format=csv" if p.ends_with(".csv") else ""


static func run(host: Node, status: Label) -> void:
	var name := str(Store.project.get("name", "rig")).validate_filename().replace(" ", "_")
	var path: String = await FilePick.save_path(host, "Export the calibrated rig for the desk", (name if name != "" else "rig") + "_calibrated.mvr",
		["*.mvr ; MVR — the desk's 3D layout", "*.csv ; Position table (MVR / grandMA3 axes)", "*.magicq.csv ; Position table (MagicQ)"])
	if path == "":
		return
	if not (path.to_lower().ends_with(".mvr") or path.to_lower().ends_with(".csv")):
		path += ".mvr"
	status.text = "Exporting the calibrated rig…"
	ProjectSync.flush()  # the server builds it from the saved project: let the latest calibration land first
	while ProjectSync.in_flight:
		await host.get_tree().process_frame
	var rep: Dictionary = await Api.get_json("/api/stage/rig-export?format=json")
	var res: Dictionary = await Api.get_bytes("/api/stage/rig-export" + query_for(path))
	if not res.ok:
		var body: Variant = JSON.parse_string((res.bytes as PackedByteArray).get_string_from_utf8())
		status.text = "Export failed: %s" % (body.get("error", res.error) if body is Dictionary else res.error)
		return
	var err := FilePick.write_bytes(path, res.bytes)
	var what := counts_line(rep.data) if rep.ok and rep.data is Dictionary else ""
	status.text = ("Exported the rig (%s) to %s" % [what, path]) if err == "" else "Export failed: %s" % err
