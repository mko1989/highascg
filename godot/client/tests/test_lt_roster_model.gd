extends RefCounted
## WO-601 lower-third roster — golden values from the web's lower-third-roster-import.js under node.

const R := preload("res://features/live/lt_roster_model.gd")
var t


func test_guess_mapping() -> void:
	t.eq(R.guess_mapping(["Name", "Last name", "Job title"]), {"firstName": "Name", "surname": "Last name", "subtitle": "Job title"}, "english")
	t.eq(R.guess_mapping(["Imię", "Nazwisko", "Stanowisko"]), {"firstName": "", "surname": "", "subtitle": ""}, "polish headers: no guess (web has english needles only)")
	t.eq(R.guess_mapping(["FIRST", "Family name", "Role / position"]), {"firstName": "FIRST", "surname": "Family name", "subtitle": "Role / position"}, "case + contains")
	t.eq(R.guess_mapping(["full name", "company"]), {"firstName": "full name", "surname": "", "subtitle": ""}, "'name' needle")


func test_map_row_and_filter() -> void:
	var row := {"Name": "  Jan ", "Last name": "  Kowalski  Jr ", "Job title": " CEO "}
	t.eq(R.map_row(row, {"firstName": "Name", "surname": "Last name", "subtitle": "Job title"}), {"title": "Jan Kowalski Jr", "subtitle": "CEO"}, "full mapping, spaces collapsed")
	t.eq(R.map_row(row, {"firstName": "", "surname": "Last name", "subtitle": ""}), {"title": "Kowalski Jr", "subtitle": ""}, "surname only")
	t.eq(R.map_row(row, {"firstName": "Missing"}), {"title": "", "subtitle": ""}, "unknown column")
	var r := {"rows": [{"a": "Jan", "b": "CEO"}, {"a": "Anna", "b": "cto"}, {"a": "Ewa", "b": ""}]}
	var names := func(q: String) -> Array: return R.filter_rows(r, q).map(func(x: Dictionary) -> String: return x.a)
	t.eq(names.call(""), ["Jan", "Anna", "Ewa"], "blank → all")
	t.eq(names.call(" ct "), ["Anna"], "trimmed, case-insensitive")
	t.eq(names.call("AN"), ["Jan", "Anna"], "any cell")
	t.eq(names.call("zzz"), [], "none")


func test_normalize_and_cols() -> void:
	t.eq(R.normalize({"headers": ["x", "__proto__"], "rows": [{"x": " 1 "}]}),
		{"fileName": "import", "importedAt": "", "headers": ["x", "Column 2"], "mapping": {"firstName": "", "surname": "", "subtitle": ""}, "rows": [{"x": "1"}]}, "unsafe header renamed, cells trimmed")
	t.eq(R.normalize({"rows": [{"p": "q"}]}).headers, ["p"], "headers from the first row")
	t.eq(R.normalize({}), {}, "nothing → empty (web null)")
	t.eq(R.show_cols({"headers": ["a", "b", "c", "d", "e"], "mapping": {}}), ["a", "b", "c", "d"], "unmapped → first four")
	t.eq(R.show_cols({"headers": ["a", "b"], "mapping": {"firstName": "b", "surname": "", "subtitle": "a"}}), ["b", "a"], "mapped columns in field order")
