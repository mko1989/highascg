extends RefCounted
## WO-1106 — review fixes to the "bring your own" test puppet (human_own.gd, human_own_dna.gd, human_body.gd): a folder
## with a body file AND a head file is refused (A12), changed files load again without a restart (A13), a crashed
## converter child is reaped and reads as stopped (A38), bone attachments that carry meshes stay (A40), puppet.json
## "moves" is only woman / man (A41), and a name without ASCII letters still gets a slug the server takes (A44).
## Scratch folders only under user://wo1106_* (removed before and after).

const Own := preload("res://features/previs/tracking/human_own.gd")
const Body := preload("res://features/previs/tracking/human_body.gd")
const Dna := preload("res://features/previs/tracking/human_own_dna.gd")
const Synth := preload("res://tests/test_human_own_wo1103.gd")  # its tiny synthetic humanoid (made in code, ours)
var t


func _moves(n: String) -> Dictionary:
	return Body.template(n)


func test_two_model_files_are_refused_not_loaded_headless() -> void:
	var dir := OS.get_user_data_dir().path_join("wo1106_two")
	_rm_tree(dir)
	var s: RefCounted = Synth.new()
	s._synthetic(dir.path_join("ada/body.glb"))
	s._synthetic(dir.path_join("ada/head.glb"))
	t.eq(Own.list(dir).size(), 1, "still listed")
	var tpl := Own.template("ada", _moves, dir)
	var rep := Own.report("ada")
	t.ok(tpl.is_empty() and not rep.get("ok", false), "two model files: not loaded as an ok puppet")
	t.ok(str(rep.get("error", "")).contains("one file") and str(rep.get("error", "")).contains("body.glb"), "says why: %s" % rep.get("error", ""))
	var help := FileAccess.get_file_as_string("res://help/own-test-puppet.md")
	t.ok(help.contains("one file"), "the help page says the same")
	Own._reports.erase("ada")
	Own._sigs.erase("ada")
	_rm_tree(dir)


func test_changed_files_load_again() -> void:
	var dir := OS.get_user_data_dir().path_join("wo1106_stale")
	var folder := dir.path_join("ben")
	_rm_tree(dir)
	var s: RefCounted = Synth.new()
	s._synthetic(folder.path_join("ben.glb"))
	var tpl := Own.template("ben", _moves, dir)
	t.ok(not tpl.is_empty(), "loads: %s" % Own.report("ben"))
	Own._looked.erase("ben")
	t.ok(not Own.stale("ben"), "nothing changed: the cached one stays")
	Own._looked.erase("ben")
	FileAccess.open(folder.path_join("convert.json"), FileAccess.WRITE).store_string("{}")
	t.ok(Own.stale("ben"), "a file added: load again")
	t.ok(not Own.stale("ben"), "asked again within a second: not re-listed (asked every frame)")
	var again := Own.template("ben", _moves, dir)  # read again: the new look is the one remembered
	if not again.is_empty():
		(again.root as Node).free()
	DirAccess.remove_absolute(folder.path_join("ben.glb"))
	Own._looked.erase("ben")
	t.ok(Own.stale("ben"), "the GLB deleted (the help's 'delete it to convert again'): load again")
	if not tpl.is_empty():
		(tpl.root as Node).free()
	# through human_body.gd: a loaded own body whose files changed is replaced (its old template freed), no restart
	var old := Node3D.new()
	Body._templates["own:wo1106-gone"] = {"root": old}
	Own._sigs["wo1106-gone"] = {"path": folder, "sig": "as it was"}
	Own._looked.erase("wo1106-gone")
	t.ok(Body.template("own:wo1106-gone").is_empty() and not is_instance_valid(old), "reloaded (the slug is gone: {}), the old template freed")
	Body._templates.erase("own:wo1106-gone")
	for k in ["ben", "wo1106-gone"]:
		Own._reports.erase(k)
		Own._sigs.erase(k)
		Own._looked.erase(k)
	_rm_tree(dir)


func test_a_crashed_converter_child_reads_as_stopped() -> void:
	var dir := OS.get_user_data_dir().path_join("wo1106_dna")
	_rm_tree(dir)
	DirAccess.make_dir_recursive_absolute(dir)
	var pid := Dna._spawn("true", PackedStringArray())
	t.ok(pid > 0, "a child started")
	OS.delay_msec(300)  # it has exited: a zombie until reaped, its /proc entry still there
	FileAccess.open(dir.path_join("convert.json"), FileAccess.WRITE).store_string(JSON.stringify({"state": "running", "progress": 0.2, "step": "mesh body", "pid": pid}))
	t.eq(str(Dna.job(dir).state), "failed", "our own dead child is not 'converting' for the session")
	t.ok(not DirAccess.dir_exists_absolute("/proc/%d" % pid), "and it was reaped")
	FileAccess.open(dir.path_join("convert.json"), FileAccess.WRITE).store_string(JSON.stringify({"state": "running", "pid": OS.get_process_id()}))
	t.eq(str(Dna.job(dir).state), "running", "a live process that is not our child still reads as running (/proc)")
	_rm_tree(dir)


func test_bone_attachments_with_meshes_stay() -> void:
	var scene := Node3D.new()
	var sk := Skeleton3D.new()
	sk.add_bone("head")
	scene.add_child(sk)
	var eyes := BoneAttachment3D.new()
	eyes.name = "Eyes"
	sk.add_child(eyes)
	var eye := MeshInstance3D.new()
	eye.name = "EyeL"
	eye.mesh = SphereMesh.new()
	eyes.add_child(eye)
	var empty := BoneAttachment3D.new()
	empty.name = "Empty"
	sk.add_child(empty)
	var ap := AnimationPlayer.new()
	scene.add_child(ap)
	Own._strip_helpers(scene)
	t.ok(is_instance_valid(eye) and eye.get_parent() == eyes and eyes.get_parent() == sk, "rigid eyes / glasses / a hat stay on their bone")
	t.ok(not is_instance_valid(empty) and not is_instance_valid(ap), "an empty attachment and the importer's player go")
	scene.free()


func test_puppet_json_moves_only_woman_or_man() -> void:
	t.eq(Own.MOVES, Body.BODIES, "the shipped bodies' moves")
	var dir := OS.get_user_data_dir().path_join("wo1106_moves")
	var folder := dir.path_join("cy")
	_rm_tree(dir)
	var s: RefCounted = Synth.new()
	s._synthetic(folder.path_join("cy.glb"))
	FileAccess.open(folder.path_join("puppet.json"), FileAccess.WRITE).store_string(JSON.stringify({"moves": "own:other"}))
	var tpl := Own.template("cy", _moves, dir)
	var rep := Own.report("cy")
	t.ok(rep.get("ok", false) and str(rep.get("moves", "")) in Own.MOVES, "loads with a shipped walk: %s" % rep)
	t.ok(str(rep.get("warnings", [])).contains("own:other"), "and says the puppet.json value was not used")
	if not tpl.is_empty():
		(tpl.root as Node).free()
	Own._reports.erase("cy")
	Own._sigs.erase("cy")
	_rm_tree(dir)


func test_slug_never_empty() -> void:
	var re := RegEx.create_from_string("^[a-z0-9][a-z0-9._-]{0,47}$")  # src/tracking/puppet-people.js OWN_RE
	for n in ["日本", "---", "Ålö", "Ada"]:
		var sl := Own.slug_of(n)
		t.ok(re.search(sl) != null, "%s → %s: a slug the server takes" % [n, sl])
	t.eq(Own.slug_of("日本"), Own.slug_of("日本"), "stable")
	t.ok(Own.slug_of("日本") != Own.slug_of("中国"), "distinct names stay distinct")
	t.eq(Own.slug_of("Ada"), "ada", "an ASCII name as before")


## Removes one of this file's own scratch folders under user:// (never anything else).
func _rm_tree(path: String) -> void:
	if not path.begins_with(OS.get_user_data_dir().path_join("wo1106_")):
		return
	for d in DirAccess.get_directories_at(path):
		_rm_tree(path.path_join(d))
	for f in DirAccess.get_files_at(path):
		DirAccess.remove_absolute(path.path_join(f))
	DirAccess.remove_absolute(path)
