extends RefCounted
## WO-1103 — an own puppet given as MetaHuman DNA (a head + a body .dna and textures, e.g. Fab "OpenRigLogic Sample
## Content" in ~/.local/share/highascg/puppets/<name>/): picking it starts tools/people/dna_to_glb.py in the
## background (Epic's DNA library, built per machine by tools/people/openriglogic_build.sh), which writes
## <name>.converted.glb beside the DNA and its progress to convert.json; human_own.gd then loads that GLB like any
## other own model. Nothing leaves the folder (the per-machine exclusions cover it).

const LIB := ".local/share/highascg/openriglogic/lib"

static var _children := {}  # pid → true: converters this client started (WO-1106 A38)


## The DNA files in `folder` (and its sub-folders).
static func files(folder: String, into: Array = []) -> Array:
	var da := DirAccess.open(folder)
	if da == null:
		return into
	for f in da.get_files():
		if f.get_extension().to_lower() == "dna":
			into.append(folder.path_join(f))
	for d in da.get_directories():
		files(folder.path_join(d), into)
	return into


## The conversion's state: {} (never started) or convert.json ({state: running / done / failed, progress, step, error}).
static func job(folder: String) -> Dictionary:
	var p := folder.path_join("convert.json")
	if not FileAccess.file_exists(p):
		return {}
	var v: Variant = JSON.parse_string(FileAccess.get_file_as_string(p))
	if not (v is Dictionary):
		return {}
	var d: Dictionary = v
	if d.get("state") == "running" and d.has("pid") and not _alive(int(d.pid)):
		d.state = "failed"
		d.error = "the converter stopped (%s)" % d.get("step", "?")
	return d


## WO-1106 A38: our own converter is asked through OS.is_process_running, which reaps it — a crashed child stayed a
## zombie whose /proc entry read "converting" for the whole session and refused a restart. A converter another client
## process started (before a restart) is not our child: /proc says whether it still runs.
static func _alive(pid: int) -> bool:
	if pid <= 0:
		return false
	if _children.has(pid):
		return OS.is_process_running(pid)
	return DirAccess.dir_exists_absolute("/proc/%d" % pid)


## Start `cmd` in the background as a child this client tracks (and reaps): its pid, or -1.
static func _spawn(cmd: String, args: PackedStringArray) -> int:
	var pid := OS.create_process(cmd, args)
	if pid > 0:
		_children[pid] = true
	return pid


static func converter() -> String:
	return ProjectSettings.globalize_path("res://").path_join("../../tools/people/dna_to_glb.py").simplify_path()


static func lib() -> String:
	return OS.get_environment("HOME").path_join(LIB)


## Start the conversion of `folder` unless one runs. "" or why it cannot start.
static func start(folder: String) -> String:
	if job(folder).get("state") == "running":
		return ""
	if not FileAccess.file_exists(converter()):
		return "the converter is missing (%s)" % converter()
	if not DirAccess.dir_exists_absolute(lib()):
		return "MetaHuman DNA needs Epic's DNA library on this machine — run tools/people/openriglogic_build.sh once (see the help page)"
	var pid := _spawn("python3", PackedStringArray(["-I", converter(), folder, "--lib", lib()]))
	return "" if pid > 0 else "cannot start python3"


## The report line for a DNA-only folder: progress, failure, or why it cannot start.
static func status(folder: String) -> String:
	var j := job(folder)
	match str(j.get("state", "")):
		"running":
			return "converting the MetaHuman DNA: %d %% (%s)" % [roundi(float(j.get("progress", 0)) * 100.0), j.get("step", "")]
		"failed":
			return "MetaHuman DNA conversion failed: %s (delete convert.json to try again)" % j.get("error", "?")
	return ""
