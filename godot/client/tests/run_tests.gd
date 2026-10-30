extends SceneTree
## WO-599 — dependency-free test runner (headless, CI-friendly):
##   godot --headless --path godot/client --script res://tests/run_tests.gd
## Runs every `test_*` method of every res://tests/test_*.gd file. Exit code: 0 = all green, 1 = any failure
## (WO-836: it used to be `quit(failures)`, and a process exit status is 8-bit, so 256 failures exited 0).

var failures := 0
var passes := 0
var _current := ""
var _script_errors: _ScriptErrorLogger


## WO-836: a GDScript runtime error (invalid call/access, null deref) aborts the rest of a test body but only prints.
## The "no assertion ran" check below catches a test that dies BEFORE its first assert; one that asserts, then crashes,
## used to count as a pass. Script-type errors are counted per test so that case fails too. (Engine-level ERROR lines,
## e.g. get_node outside the tree, are a different error type and stay informational.)
class _ScriptErrorLogger:
	extends Logger
	var count := 0
	var last := ""

	func _log_error(function: String, file: String, line: int, code: String, rationale: String, _editor_notify: bool, error_type: int, _script_backtraces: Array[ScriptBacktrace]) -> void:
		if error_type == ERROR_TYPE_SCRIPT:
			count += 1
			last = "%s:%d %s" % [file, line, rationale if rationale != "" else code]


func _init() -> void:
	_script_errors = _ScriptErrorLogger.new()
	OS.add_logger(_script_errors)
	var dir := DirAccess.open("res://tests")
	var files := PackedStringArray()
	for f in dir.get_files():
		if f.begins_with("test_") and f.ends_with(".gd"):
			files.append(f)
	files.sort()
	for f in files:
		var script: GDScript = load("res://tests/" + f)
		if script == null or not script.can_instantiate():
			failures += 1
			printerr("FAIL ", f, ": suite failed to load/compile")
			continue
		var suite: Object = script.new()
		suite.set("t", self)
		for m in script.get_script_method_list():
			var name: String = m.name
			if name.begins_with("test_"):
				_current = "%s::%s" % [f.get_basename(), name]
				var before := passes + failures
				var errors_before := _script_errors.count
				# awaited: a test that yields (timer, signal) would otherwise "finish" at its first await and have its
				# remaining asserts run after quit(), or never
				await suite.call(name)
				if _script_errors.count > errors_before:
					failures += 1
					printerr("FAIL ", _current, ": script error during the test (asserts after it never ran): ", _script_errors.last)
				elif passes + failures == before:
					failures += 1
					printerr("FAIL ", _current, ": no assertion ran (runtime error inside the test?)")
	print("\n[tests] %d passed, %d failed" % [passes, failures])
	OS.remove_logger(_script_errors)
	quit(1 if failures > 0 else 0)


func eq(actual: Variant, expected: Variant, what := "") -> void:
	if typeof(actual) in [TYPE_INT, TYPE_FLOAT] and typeof(expected) in [TYPE_INT, TYPE_FLOAT]:
		ok(absf(float(actual) - float(expected)) < 1e-9, "%s expected %s got %s" % [what, expected, actual])
	else:
		ok(actual == expected, "%s expected %s got %s" % [what, str(expected), str(actual)])


func ok(cond: bool, what := "") -> void:
	if cond:
		passes += 1
	else:
		failures += 1
		printerr("FAIL ", _current, ": ", what)
