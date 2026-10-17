extends SceneTree
## WO-599 — dependency-free test runner (headless, CI-friendly):
##   godot --headless --path godot/client --script res://tests/run_tests.gd
## Runs every `test_*` method of every res://tests/test_*.gd file. Exit code = number of failures.

var failures := 0
var passes := 0
var _current := ""


func _init() -> void:
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
				suite.call(name)
				if passes + failures == before:
					failures += 1
					printerr("FAIL ", _current, ": no assertion ran (runtime error inside the test?)")
	print("\n[tests] %d passed, %d failed" % [passes, failures])
	quit(failures)


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
