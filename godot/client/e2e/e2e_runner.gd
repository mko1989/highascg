extends Node
## WO-719 — runs GUI end-to-end scenarios inside the real client, then quits with exit code = failed steps.
##   godot --path godot/client -- --server=http://127.0.0.1:<sandbox> --e2e=new_project,outputs --e2e-out=<dir>
## `--e2e=all` runs every res://e2e/scenarios/*.gd in file order. Results: <dir>/results.json + one PNG per step.
## Only ever point this at a SANDBOX server (tools/e2e/run-gui-e2e.js starts one): scenarios create, wipe and
## re-cable projects exactly as an operator would.

const UI := preload("res://e2e/e2e_ui.gd")
const DIR := "res://e2e/scenarios"


func _ready() -> void:
	_run.call_deferred()


static func scenario_names(arg: String) -> PackedStringArray:
	var out := PackedStringArray()
	if arg != "all" and arg != "1":
		for s in arg.split(",", false):
			out.append(s.strip_edges())
		return out
	var files := DirAccess.get_files_at(DIR)
	for f in files:
		if f.ends_with(".gd"):
			out.append(f.get_basename())
	out.sort()
	return out


func _run() -> void:
	var out_dir := str(Config.args.get("e2e-out", ""))
	if out_dir != "":
		DirAccess.make_dir_recursive_absolute(out_dir)
	var ui := UI.new(get_tree(), get_parent(), out_dir)
	print("[e2e] waiting for the server (%s)…" % Config.origin)
	var up: Variant = await ui.wait_for(func() -> bool: return Ws.is_open and Settings.is_loaded, 30.0)
	var all_results: Array = []
	if not up:
		all_results.append({"scenario": "boot", "step": "connect", "ok": false, "skipped": false,
			"why": "client never connected to %s" % Config.origin, "ms": 0, "shot": await ui.shot("boot")})
	else:
		await ui.sleep(1.5)  # first project pull + deck render
		for n in scenario_names(str(Config.args.get("e2e", "all"))):
			var path := "%s/%s.gd" % [DIR, n]
			var script: GDScript = load(path) if ResourceLoader.exists(path) else null
			if script == null:
				all_results.append({"scenario": n, "step": "load", "ok": false, "skipped": false, "why": "no " + path, "ms": 0, "shot": ""})
				continue
			var sc: RefCounted = script.new()
			sc.ui = ui
			sc.name = n
			print("[e2e] ── %s" % n)
			await sc.run()
			all_results.append_array(sc.results)
	var failed := all_results.filter(func(r: Dictionary) -> bool: return not r.ok and not r.skipped).size()
	var skipped := all_results.filter(func(r: Dictionary) -> bool: return r.skipped).size()
	var passed := all_results.size() - failed - skipped
	print("[e2e] DONE %d passed, %d failed, %d skipped" % [passed, failed, skipped])
	if out_dir != "":
		var f := FileAccess.open(out_dir + "/results.json", FileAccess.WRITE)
		f.store_string(JSON.stringify({"passed": passed, "failed": failed, "skipped": skipped, "server": Config.origin,
			"steps": all_results}, "  "))
		f.close()
	get_tree().quit(failed + (1 if not up else 0))
