extends RefCounted
## WO-598 B — the Godot client must hand the server back exactly the document it got: same values
## (floats bit-exact), same key order at every level (the server's projectContentEquals compares
## JSON.stringify output). Fixtures: tools/fixtures/projects/*.json (real-show shapes) + a synthetic case.

const NetUtil := preload("res://core/net_util.gd")
var t

const HARD := '{"zeta":1,"alpha":{"y":-0.125,"x":0.3333333333333333,"k":[0.1,0.2,0.30000000000000004]},"n":25,"big":1792270519972,"neg":-1e-7,"s":"ł ó \\u00e9 \\"q\\"","nil":null,"t":true}'


func _keys_in_order(a: Variant, b: Variant, path: String) -> String:
	if a is Dictionary:
		if not (b is Dictionary) or (a as Dictionary).keys() != (b as Dictionary).keys():
			return path
		for k in a:
			var r := _keys_in_order(a[k], b[k], "%s.%s" % [path, k])
			if r != "":
				return r
	elif a is Array:
		for i in (a as Array).size():
			var r := _keys_in_order(a[i], b[i], "%s[%d]" % [path, i])
			if r != "":
				return r
	return ""


func _roundtrip(src: String, name: String) -> void:
	var orig: Variant = JSON.parse_string(src)
	t.ok(orig != null, "%s parses" % name)
	var back: Variant = JSON.parse_string(NetUtil.to_json(orig))
	t.ok(back == orig, "%s: values identical after to_json (floats exact)" % name)
	t.eq(_keys_in_order(orig, back, "$"), "", "%s: key order kept everywhere" % name)


func test_synthetic_hard_case() -> void:
	_roundtrip(HARD, "synthetic")
	var orig: Variant = JSON.parse_string(HARD)
	t.ok(JSON.parse_string(JSON.stringify(orig)) != orig, "regression guard: the Godot default (15 digits, sorted) does NOT round-trip")
	t.ok(NetUtil.to_json(orig).begins_with('{"zeta"'), "first key stays first")


func test_project_fixtures() -> void:
	var dir := ProjectSettings.globalize_path("res://").path_join("../../tools/fixtures/projects").simplify_path()
	var files := DirAccess.get_files_at(dir)
	t.ok(files.size() > 0, "fixtures found in %s" % dir)
	for f in files:
		if f.ends_with(".json"):
			_roundtrip(FileAccess.get_file_as_string(dir.path_join(f)), f)
