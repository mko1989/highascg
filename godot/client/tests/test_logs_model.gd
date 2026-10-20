extends RefCounted
## WO-608 — logs window rules, same answers as client/components/logs-modal-filter.js.

const L := preload("res://app/logs_model.gd")
var t


func test_query_and_defaults() -> void:
	t.eq(L.default_categories().size(), L.CATEGORIES.size() - 1, "debug off by default")
	t.eq(L.default_categories().has("debug"), false)
	t.eq(L.query(["amcp", "system"], ["info", "warn"]), "/api/logs?lines=500&caspar=0&categories=amcp,system&levels=info,warn")
	t.eq(L.query([], ["info"], 50), "/api/logs?lines=50&caspar=0&categories=__none__&levels=info")


func test_record_and_filter() -> void:
	t.eq(L.record("plain"), {"line": "plain", "level": "info", "category": "system"})
	t.eq(L.record({"message": "m", "level": "warn", "category": "amcp"}), {"line": "m", "level": "warn", "category": "amcp"})
	t.eq(L.record({"line": "l", "message": "m"}).line, "l", "line wins over message")
	t.eq(L.record(3), {})
	var r := L.record({"line": "x", "level": "debug", "category": "amcp"})
	t.eq(L.matches(r, ["amcp"], ["info"]), false, "level filtered")
	t.eq(L.matches(r, ["amcp"], []), true, "no level filter = all levels")
	t.eq(L.matches(r, ["system"], ["debug"]), false, "category filtered")
	t.eq(L.matches(r, [], ["debug"]), false, "no categories = nothing")


func test_append_caps() -> void:
	t.eq(L.append("", "a"), "a")
	t.eq(L.append("a", "b"), "a\nb")
	t.eq(L.append("a\nb\nc", "d", 3), "b\nc\nd")
	t.eq(L.append("a\nb\nc\nd\ne", "f", 2), "e\nf")
