extends RefCounted
## WO-605 — core/math_input.gd against client/lib/math-input.js run under Node (evaluateMath, parseNumberInput,
## computeMathCommit over expressions, garbage, blanks and every Devices-inspector bound): tests/golden/math_input.json.
## Non-JSON numbers come encoded as "NaN" / "Infinity" / "-Infinity" / "-0".

const MI := preload("res://core/math_input.gd")
var t
var _g: Dictionary


func _golden() -> Dictionary:
	if _g.is_empty():
		_g = JSON.parse_string(FileAccess.get_file_as_string("res://tests/golden/math_input.json"))
	return _g


static func _dec(v: Variant) -> Variant:
	match v:
		"NaN":
			return NAN
		"Infinity":
			return INF
		"-Infinity":
			return -INF
		"-0":
			return 0.0
	return v


func _same(got: float, want: Variant, what: String) -> void:
	var w: Variant = _dec(want)
	if w is float and is_nan(w):
		t.ok(is_nan(got), what + " is NaN (got %s)" % got)
	else:
		t.eq(got, w, what)


func test_evaluate() -> void:
	for row in _golden().evaluate:
		_same(MI.evaluate(row[0]), row[1], "evaluate '%s'" % row[0])


func test_parse() -> void:
	for row in _golden().parse:
		_same(MI.parse(row[0]), row[1], "parse '%s'" % row[0])


func test_commit() -> void:
	for row in _golden().commit:
		var o: Dictionary = row[1]
		var r := MI.commit(row[0], float(o.get("min", -INF)), float(o.get("max", INF)), int(o.get("decimals", -1)),
			o.get("lastGood"))
		var what := "commit '%s' %s" % [row[0], o]
		_same(r.value, row[2].value, what + " value")
		t.eq([r.text, r.restored], [row[2].text, row[2].restored], what + " text/restored")
