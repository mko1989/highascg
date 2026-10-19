extends RefCounted
## WO-616 attribution — about_model.gd rows(): loading / error states, the legal-notice rows, credits

const M := preload("res://features/settings/about_model.gd")
var t


func _info() -> Dictionary:
	return {"name": "HighAsCG", "version": "1.2.3", "copyright": "Copyright (C) 2026 X", "license": "AGPL-3.0-or-later",
		"warranty": "NO WARRANTY.", "source": "https://example.org/src", "notices": "NOTICES",
		"credits": [{"name": "A", "what": "w", "license": "MIT", "copyright": "(c) A", "url": "https://a"}, "junk"]}


func test_loading_and_error() -> void:
	t.eq(M.rows({}), [["note", "Loading…"]], "empty payload, no error → loading")
	t.eq(M.rows({}, "timeout"), [["note", "Could not load: timeout"]], "error is shown")


func test_legal_rows() -> void:
	var r := M.rows(_info())
	t.eq(r[0], ["heading", "HighAsCG 1.2.3"], "name + version heading")
	t.eq(r[1], ["note", "Copyright (C) 2026 X"], "copyright line")
	t.eq(r[2], ["note", "License: AGPL-3.0-or-later. NO WARRANTY."], "licence + warranty")
	t.eq(r[3], ["note", "Source code: https://example.org/src"], "source offer")
	t.eq(r[5], ["heading", "Credits"], "credits heading")


func test_credits_skip_non_dicts() -> void:
	var r := M.rows(_info())
	t.eq(r.size(), 7, "one credit row; the non-dictionary entry is skipped")
	t.eq(r[6], ["note", "A — w\nMIT · (c) A · https://a"], "credit row text")
