extends RefCounted
## WO-622 — live_sources_model.gd against the web Sources "Live" tab (sources-panel-live-render.js renderLiveTab) run
## under Node on a fake DOM: tests/golden/live_sources.json. Fixtures = the box's state / settings / live-audio / USB
## configs / device-view connectors; each case edits them and records the rendered rows (label, line 2, warning line,
## thumbnail channel, dragstart application/json) and the hint paragraph.

const M := preload("res://features/live/live_sources_model.gd")
var t


static func _norm(v: Variant) -> Variant:
	if v is int:
		return float(v)
	if v is Dictionary:
		var o := {}
		for k in v:
			o[k] = _norm(v[k])
		return o
	if v is Array:
		return v.map(func(x: Variant) -> Variant: return _norm(x))
	return v


func test_live_tab_replay() -> void:
	var g: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://tests/golden/live_sources.json"))
	for c in g.cases:
		var inp: Dictionary = c.input
		var cm: Variant = M.effective_cm(inp.planned, inp.channelMap)
		var rows := M.sources(cm, inp.connectors, inp.audio, inp.v4l2, inp.extra)
		t.eq(rows.size(), c.rows.size(), c.name + ": row count")
		t.eq(M.hint(rows), c.hint, c.name + ": hint")
		for i in mini(rows.size(), c.rows.size()):
			var w: Dictionary = c.rows[i]
			var s: Dictionary = rows[i]
			var what := "%s: row %d (%s)" % [c.name, i, w.label]
			t.eq(str(s.label), w.label, what + " label")
			t.eq(M.meta(s), w.meta, what + " meta")
			t.eq(M.slot_message(s, inp.status), w.slot, what + " warning")
			t.eq(_norm(M.thumb_channel(s)), w.thumb, what + " thumbnail channel")
			t.eq(_norm(M.drag_payload(s)), _norm(w.payload), what + " drag payload")


func test_helpers() -> void:
	t.eq(M.format_fps(29.97), "29.97", "fractional rate")
	t.eq(M.format_fps(50.0), "50", "whole rate")
	t.eq(M.format_fps(59.9401), "59.94", "rounded to 2 decimals")
	t.eq(M.format_fps(0), "", "zero → empty")
	t.eq(M.format_fps(null), "", "missing → empty")
	var cm := {"inputsCh": 4, "inputChannels": [{"kind": "decklink", "slot": 2, "channel": 5, "layer": 2, "route": "route://5-2"}]}
	t.eq(M.migrate_route(cm, " route://4-2 "), "route://5-2", "legacy shared inputs route → the slot's channel")
	t.eq(M.migrate_route(cm, "route://4-9"), "route://4-9", "layer past 8 stays")
	t.eq(M.migrate_route(cm, "route://3-2"), "route://3-2", "other channel stays")
	t.eq(M.thumb_channel({"type": "ndi", "value": "ndi://X", "useDirect": true, "thumbnailChannel": 3}), null, "direct NDI: no thumbnail")
	t.eq(M.thumb_channel({"value": "http://x", "liveThumbChannel": "7"}), 7, "saved thumbnail channel")
	t.eq(M.drag_payload({"type": "route", "value": "route://1", "label": ""}).label, "route://1", "empty label → value")
