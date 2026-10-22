extends RefCounted
## WO-675 — lower-third presenter picks from the backstage roster.

const P := preload("res://features/live/lt_presenters_model.gd")
var t


func test_picks() -> void:
	t.eq(P.picks(null), [], "no data")
	t.eq(P.picks({"presenters": []}), [], "empty roster → no row")
	var snap := {"presenters": [
		{"id": "p1", "name": "Anna Nowak ", "mic": "3", "note": "CEO, Acme", "created": 1, "person": null},
		{"id": "p2", "name": "Bob", "mic": "", "note": "", "created": 2, "person": "w:7"},
		{"id": "p3", "name": "  ", "mic": "4", "created": 3},
		{"id": "p4", "name": "Cleo", "mic": "5", "note": "Host", "created": 0}]}
	var got := P.picks(snap)
	t.eq(got.map(func(p: Dictionary) -> String: return p.id), ["p2", "p4", "p1"], "on stage first, then intake order; no blank names")
	t.eq(got[0].label, "Bob · on stage", "on stage, no mic")
	t.eq(got[2].label, "Anna Nowak · mic 3", "trimmed name + mic")
	t.eq([got[2].title, got[2].subtitle], ["Anna Nowak", "CEO, Acme"], "title = name, subtitle = note")
	t.eq(got[0].subtitle, "", "no note → empty subtitle")
