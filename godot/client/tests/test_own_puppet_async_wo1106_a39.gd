extends RefCounted
## WO-1106 A39 — an own puppet imports on a WorkerThreadPool task: the first ask returns at once (the card keeps its
## pebble, the row says "loading"), the template lands on a later frame, the thread's private copies of the shipped
## bodies are freed, and settle() (quit) waits for an import in flight. The synthetic humanoid is test_human_own_wo1103's.

const Own := preload("res://features/previs/tracking/human_own.gd")
const Body := preload("res://features/previs/tracking/human_body.gd")
const Human := preload("res://features/previs/tracking/person_human.gd")
const Synth := preload("res://tests/test_human_own_wo1103.gd")
var t


func _dir() -> String:
	return OS.get_temp_dir().path_join("highascg-wo1106-a39-%d" % OS.get_process_id())


func _rm_tree(path: String) -> void:
	if not path.begins_with(OS.get_temp_dir().path_join("highascg-wo1106-a39-")) or not DirAccess.dir_exists_absolute(path):
		return
	for d in DirAccess.get_directories_at(path):
		_rm_tree(path.path_join(d))
	for f in DirAccess.get_files_at(path):
		DirAccess.remove_absolute(path.path_join(f))
	DirAccess.remove_absolute(path)


func test_own_body_imports_off_the_main_thread() -> void:
	var dir := _dir()
	_rm_tree(dir)
	var s: RefCounted = Synth.new()
	s._synthetic(dir.path_join("a39a/a39a.glb"))
	s._synthetic(dir.path_join("a39b/a39b.glb"))
	Body.own_root = dir
	var t0 := Time.get_ticks_usec()
	var first := Body.template("own:a39a")
	var ms := (Time.get_ticks_usec() - t0) / 1000.0
	t.eq(first, {}, "the first ask returns at once")
	t.ok(Body._loading.has("own:a39a"), "an import task runs")
	t.ok(not Human.wants("own:a39a"), "meanwhile the card keeps its pebble")
	t.eq(Own.report("a39a").get("loading"), true, "and the row says loading")
	var copies: Array = Body._loading["own:a39a"].moves.values().map(func(m: Dictionary) -> Node: return m.root)
	print("[a39] main-thread part of the first ask: %.1f ms" % ms)
	var until := Time.get_ticks_msec() + 10000
	while Body._loading.has("own:a39a") and Time.get_ticks_msec() < until:
		await t.process_frame
	t.ok(not Body._loading.has("own:a39a"), "landed on a later frame")
	t.ok(Human.wants("own:a39a"), "now the card gets the human")
	t.ok(Own.report("a39a").get("ok", false) and not Own.report("a39a").has("loading"), "report: %s" % Own.report("a39a"))
	t.ok(copies.size() == 2 and copies.all(func(n: Variant) -> bool: return not is_instance_valid(n)), "the thread's copies are freed")
	t.ok(not t.process_frame.is_connected(Body._poll), "no poll left on the tree")
	Body.template("own:a39b")  # quit mid-import: settle() waits for it
	t.ok(Body._loading.has("own:a39b"), "a second import runs")
	Body.settle()
	t.ok(Body._loading.is_empty() and not Body.template("own:a39b").is_empty(), "settled: landed, nothing left running")
	for b in ["own:a39a", "own:a39b"]:
		var tpl: Dictionary = Body._templates.get(b, {})
		if tpl.has("root") and is_instance_valid(tpl.root):
			(tpl.root as Node).free()
		Body._templates.erase(b)
		Own._reports.erase(b.substr(4))
		Own._sigs.erase(b.substr(4))
		Own._looked.erase(b.substr(4))
	Body.own_root = ""
	_rm_tree(dir)
